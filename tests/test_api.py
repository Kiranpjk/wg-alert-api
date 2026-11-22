import json
import os
from datetime import date
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from app.db import Base
from app.main import create_app
from app.matching import matches

SAMPLE = json.loads((Path(__file__).parent.parent / "fixtures/sample_listings.json").read_text())
SEARCH = {"label": "Jena under 400", "city": "Jena", "max_rent": 400, "min_size_m2": 12}


@pytest.fixture
def client(monkeypatch):
    monkeypatch.delenv("INGEST_API_KEY", raising=False)
    app = create_app(os.getenv("TEST_DATABASE_URL", "sqlite://"))
    with TestClient(app) as c:
        yield c
    Base.metadata.drop_all(app.state.engine)  # fresh schema per test, also on Postgres


def s(**kw):
    base = dict(city="Jena", max_rent=400, min_size_m2=None, districts=[], available_by=None)
    return SimpleNamespace(**(base | kw))


def listing(**kw):
    base = dict(city="Jena", district="Zentrum", rent=350, size_m2=15, available_from=None)
    return SimpleNamespace(**(base | kw))


@pytest.mark.parametrize(
    "search,item,expected",
    [
        (s(), listing(), True),
        (s(), listing(city=" JENA "), True),
        (s(), listing(city="Erfurt"), False),
        (s(), listing(rent=401), False),
        (s(min_size_m2=16), listing(size_m2=15), False),
        (s(min_size_m2=16), listing(size_m2=None), True),
        (s(districts=["lobeda"]), listing(district="Zentrum"), False),
        (s(districts=["Lobeda"]), listing(district="lobeda"), True),
        (s(available_by=date(2026, 12, 31)), listing(available_from=date(2027, 1, 1)), False),
    ],
)
def test_matching_rules(search, item, expected):
    assert matches(search, item) is expected


def test_health(client):
    assert client.get("/health").json() == {"status": "ok"}


def test_ingest_matches_and_dedupes(client):
    sid = client.post("/searches", json=SEARCH).json()["id"]
    r = client.post("/listings", json=SAMPLE)
    assert r.json() == {"created": 5, "duplicates": 0, "matches": 2}
    r = client.post("/listings", json=SAMPLE[:2] + SAMPLE[:1])
    assert r.json() == {"created": 0, "duplicates": 3, "matches": 0}
    ids = {m["listing"]["external_id"] for m in client.get(f"/searches/{sid}/matches").json()}
    assert ids == {"jena-101", "jena-102"}


def test_new_search_backfills_recent_listings(client):
    client.post("/listings", json=SAMPLE)
    sid = client.post("/searches", json=SEARCH | {"districts": ["Lobeda"]}).json()["id"]
    (m,) = client.get(f"/searches/{sid}/matches").json()
    assert m["listing"]["external_id"] == "jena-102"


def test_mark_seen_and_unseen_filter(client):
    sid = client.post("/searches", json=SEARCH).json()["id"]
    client.post("/listings", json=SAMPLE)
    assert client.post(f"/searches/{sid}/matches/seen").json() == {"marked_seen": 2}
    assert client.get(f"/searches/{sid}/matches", params={"unseen_only": True}).json() == []
    assert len(client.get(f"/searches/{sid}/matches").json()) == 2


def test_validation_and_404(client):
    assert client.post("/searches", json=SEARCH | {"max_rent": -5}).status_code == 422
    bad = SAMPLE[0] | {"url": "not a url"}
    assert client.post("/listings", json=[bad]).status_code == 422
    assert client.get("/searches/999/matches").status_code == 404
    assert client.delete("/searches/999").status_code == 404


def test_delete_search_removes_matches(client):
    sid = client.post("/searches", json=SEARCH).json()["id"]
    client.post("/listings", json=SAMPLE)
    assert client.delete(f"/searches/{sid}").status_code == 204
    assert client.get("/searches").json() == []


def test_ingest_requires_api_key_when_configured(client, monkeypatch):
    monkeypatch.setenv("INGEST_API_KEY", "test-key")
    assert client.post("/listings", json=SAMPLE).status_code == 401
    assert client.post("/listings", json=SAMPLE, headers={"X-API-Key": "wrong"}).status_code == 401
    ok = client.post("/listings", json=SAMPLE, headers={"X-API-Key": "test-key"})
    assert ok.status_code == 200
