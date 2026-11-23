import pytest
from fastapi.testclient import TestClient
from prometheus_client.parser import text_string_to_metric_families
from sqlalchemy import update
from test_api import SAMPLE, SEARCH

from app.db import Search
from app.main import create_app


@pytest.fixture
def client(monkeypatch):
    monkeypatch.delenv("INGEST_API_KEY", raising=False)
    monkeypatch.setenv("ALLOW_NO_API_KEY", "1")
    with TestClient(create_app("sqlite://")) as test_client:
        yield test_client


def samples(client, name):
    response = client.get("/metrics")
    assert response.status_code == 200
    return [
        sample
        for family in text_string_to_metric_families(response.text)
        for sample in family.samples
        if sample.name == name
    ]


def test_metrics_content_type(client):
    response = client.get("/metrics")
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/plain")
    assert "# TYPE searches_active gauge" in response.text


def test_scrapes_are_not_counted(client):
    client.get("/metrics")
    assert not samples(client, "http_requests_total")
    assert not samples(client, "http_request_duration_seconds_count")


def test_ingest_counts_created_and_duplicate_listings(client):
    assert client.post("/listings", json=SAMPLE).status_code == 200
    assert client.post("/listings", json=SAMPLE[:2]).status_code == 200
    counts = {
        sample.labels["result"]: sample.value
        for sample in samples(client, "listings_ingested_total")
    }
    assert counts == {"created": 5, "duplicate": 2}


def test_matches_count_ingest_and_backfill(client):
    client.post("/searches", json=SEARCH)
    client.post("/listings", json=SAMPLE)
    assert samples(client, "matches_created_total")[0].value == 2
    client.post("/searches", json=SEARCH)
    assert samples(client, "matches_created_total")[0].value == 4


def test_active_searches_tracks_create_and_delete(client):
    assert samples(client, "searches_active")[0].value == 0
    inactive_id = client.post("/searches", json=SEARCH).json()["id"]
    with client.app.state.engine.begin() as connection:
        connection.execute(update(Search).where(Search.id == inactive_id).values(active=False))
    search_id = client.post("/searches", json=SEARCH).json()["id"]
    assert samples(client, "searches_active")[0].value == 1
    assert client.delete(f"/searches/{search_id}").status_code == 204
    assert samples(client, "searches_active")[0].value == 0


def test_http_metrics_use_route_template(client):
    for search_id in (101, 102):
        assert client.get(f"/searches/{search_id}").status_code == 404
    (counter,) = samples(client, "http_requests_total")
    assert counter.labels == {"method": "GET", "route": "/searches/{search_id}", "status": "404"}
    assert counter.value == 2
    (histogram_count,) = samples(client, "http_request_duration_seconds_count")
    assert histogram_count.labels == {"method": "GET", "route": "/searches/{search_id}"}
    assert histogram_count.value == 2


def test_unknown_paths_share_one_label(client):
    for path in ("/unknown/a", "/not-a-route/b", "/unknown/c"):
        assert client.get(path).status_code == 404
    (counter,) = samples(client, "http_requests_total")
    assert counter.labels == {"method": "GET", "route": "__unmatched__", "status": "404"}
    assert counter.value == 3


def test_unhandled_errors_are_counted(monkeypatch):
    monkeypatch.setenv("ALLOW_NO_API_KEY", "1")
    app = create_app("sqlite://")

    @app.get("/fail/{item}")
    def fail(item: str):
        raise RuntimeError(item)

    with TestClient(app, raise_server_exceptions=False) as client:
        assert client.get("/fail/example").status_code == 500
        (counter,) = samples(client, "http_requests_total")
        assert counter.labels == {"method": "GET", "route": "/fail/{item}", "status": "500"}
