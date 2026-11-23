"""Per-process HTTP and committed write metrics."""

from time import perf_counter

from fastapi import FastAPI, Request, Response
from prometheus_client import (
    CONTENT_TYPE_LATEST,
    CollectorRegistry,
    Counter,
    Gauge,
    Histogram,
    generate_latest,
)
from sqlalchemy import func, select
from sqlalchemy.orm import sessionmaker

from .db import Search

HTTP_METHODS = {"GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "CONNECT", "TRACE"}


def install_metrics(app: FastAPI, sessions: sessionmaker) -> tuple[Counter, Counter]:
    registry = CollectorRegistry()
    requests = Counter(
        "http_requests_total", "HTTP requests", ("method", "route", "status"), registry=registry
    )
    duration = Histogram(
        "http_request_duration_seconds",
        "Time to produce the HTTP response",
        ("method", "route"),
        registry=registry,
    )
    ingested = Counter(
        "listings_ingested_total", "Listing ingestion outcomes", ("result",), registry=registry
    )
    for result in ("created", "duplicate"):
        ingested.labels(result)
    matches_created = Counter("matches_created_total", "Matches created", registry=registry)
    active = Gauge("searches_active", "Active searches in the database", registry=registry)

    def count_active() -> int:
        with sessions() as session:
            return session.scalar(select(func.count()).select_from(Search).where(Search.active))

    active.set_function(count_active)

    @app.get("/metrics", include_in_schema=False)
    def metrics() -> Response:
        return Response(generate_latest(registry), headers={"Content-Type": CONTENT_TYPE_LATEST})

    @app.middleware("http")
    async def measure(request: Request, call_next):
        started = perf_counter()
        status = 500
        try:
            response = await call_next(request)
            status = response.status_code
            return response
        finally:
            route = getattr(request.scope.get("route"), "path", "__unmatched__")
            if route != "/metrics" and request.url.path != "/metrics":
                method = request.method if request.method in HTTP_METHODS else "OTHER"
                duration.labels(method, route).observe(perf_counter() - started)
                requests.labels(method, route, status).inc()

    return ingested, matches_created
