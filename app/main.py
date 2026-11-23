"""wg-alert-api: save WG room searches, push listings in, get the matching ones back."""

from __future__ import annotations

import os
import secrets
from collections.abc import Iterator
from contextlib import asynccontextmanager
from datetime import timedelta

from fastapi import Depends, FastAPI, Header, HTTPException, Request, status
from sqlalchemy import select, text, update
from sqlalchemy.orm import Session, selectinload

from .db import (
    Base,
    Listing,
    Match,
    Search,
    insert_ignore,
    make_engine,
    make_sessionmaker,
    utcnow,
)
from .matching import matches
from .metrics import install_metrics
from .schemas import IngestResult, ListingIn, MatchOut, SearchIn, SearchOut

BACKFILL_DAYS = 7
MAX_BATCH = 500
# Reachable without the key: probes and the Prometheus scrape (nginx hides /metrics from the web).
OPEN_PATHS = {"/health", "/livez", "/metrics"}


def require_key(request: Request, x_api_key: str | None = Header(default=None)) -> None:
    expected = os.getenv("INGEST_API_KEY")
    if request.url.path in OPEN_PATHS or not expected:
        return
    if not (x_api_key and secrets.compare_digest(x_api_key, expected)):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "invalid or missing X-API-Key")


def create_app(database_url: str | None = None) -> FastAPI:
    engine = make_engine(database_url)
    SessionLocal = make_sessionmaker(engine)

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        if not os.getenv("INGEST_API_KEY") and os.getenv("ALLOW_NO_API_KEY") != "1":
            raise RuntimeError(
                "INGEST_API_KEY is not set. Set it (openssl rand -hex 32) or, for local "
                "development only, set ALLOW_NO_API_KEY=1."
            )
        with engine.begin() as connection:
            if connection.dialect.name == "postgresql":
                # Serialize initial schema creation across replicas.
                connection.execute(text("SELECT pg_advisory_xact_lock(830041)"))
            Base.metadata.create_all(connection)
        yield
        engine.dispose()

    app = FastAPI(
        title="wg-alert-api",
        version="0.1.0",
        lifespan=lifespan,
        dependencies=[Depends(require_key)],
    )
    app.state.engine = engine
    ingested, matches_created = install_metrics(app, SessionLocal)

    def get_db() -> Iterator[Session]:
        with SessionLocal() as session:
            yield session

    def get_search(search_id: int, db: Session) -> Search:
        search = db.get(Search, search_id)
        if search is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "search not found")
        return search

    @app.get("/livez")
    def livez() -> dict:
        # No database call: a database outage must not make Kubernetes restart the API.
        return {"status": "ok"}

    @app.get("/health")
    def health(db: Session = Depends(get_db)) -> dict:
        db.execute(select(1))
        return {"status": "ok"}

    @app.post("/searches", response_model=SearchOut, status_code=201)
    def create_search(body: SearchIn, db: Session = Depends(get_db)) -> Search:
        search = Search(**body.model_dump())
        db.add(search)
        db.flush()
        # Backfill: a new search immediately sees recent listings that fit.
        since = utcnow() - timedelta(days=BACKFILL_DAYS)
        recent = db.scalars(select(Listing).where(Listing.received_at >= since))
        backfilled = 0
        for listing in recent:
            if matches(search, listing) and insert_ignore(
                db,
                Match,
                {"search_id": search.id, "listing_id": listing.id},
                ("search_id", "listing_id"),
            ):
                backfilled += 1
        db.commit()
        matches_created.inc(backfilled)
        return search

    @app.get("/searches", response_model=list[SearchOut])
    def list_searches(db: Session = Depends(get_db)) -> list[Search]:
        return list(db.scalars(select(Search).order_by(Search.id)))

    @app.get("/searches/{search_id}", response_model=SearchOut)
    def read_search(search_id: int, db: Session = Depends(get_db)) -> Search:
        return get_search(search_id, db)

    @app.delete("/searches/{search_id}", status_code=204)
    def delete_search(search_id: int, db: Session = Depends(get_db)) -> None:
        db.delete(get_search(search_id, db))
        db.commit()

    @app.post(
        "/listings",
        response_model=IngestResult,
    )
    def ingest(listings: list[ListingIn], db: Session = Depends(get_db)) -> IngestResult:
        if len(listings) > MAX_BATCH:
            raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, f"max {MAX_BATCH}")
        searches = list(db.scalars(select(Search).where(Search.active.is_(True))))
        created = duplicates = matched = 0
        for item in listings:
            values = item.model_dump() | {"url": str(item.url), "received_at": utcnow()}
            listing_id = insert_ignore(db, Listing, values, ("source", "external_id"))
            if listing_id is None:
                duplicates += 1
                continue
            created += 1
            listing = Listing(
                **values, id=listing_id
            )  # not added to the session; used for matching only
            for search in searches:
                if matches(search, listing) and insert_ignore(
                    db,
                    Match,
                    {"search_id": search.id, "listing_id": listing_id, "created_at": utcnow()},
                    ("search_id", "listing_id"),
                ):
                    matched += 1
        db.commit()
        ingested.labels("created").inc(created)
        ingested.labels("duplicate").inc(duplicates)
        matches_created.inc(matched)
        return IngestResult(created=created, duplicates=duplicates, matches=matched)

    @app.get("/searches/{search_id}/matches", response_model=list[MatchOut])
    def list_matches(
        search_id: int, unseen_only: bool = False, db: Session = Depends(get_db)
    ) -> list[Match]:
        get_search(search_id, db)
        query = (
            select(Match)
            .where(Match.search_id == search_id)
            .options(selectinload(Match.listing))
            .order_by(Match.created_at.desc(), Match.id.desc())
        )
        if unseen_only:
            query = query.where(Match.seen.is_(False))
        return list(db.scalars(query))

    @app.post("/searches/{search_id}/matches/seen")
    def mark_seen(search_id: int, db: Session = Depends(get_db)) -> dict:
        get_search(search_id, db)
        result = db.execute(
            update(Match)
            .where(Match.search_id == search_id, Match.seen.is_(False))
            .values(seen=True)
        )
        db.commit()
        return {"marked_seen": result.rowcount}

    return app


app = create_app()
