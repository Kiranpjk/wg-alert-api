import json
from datetime import date
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.db import Listing, insert_ignore, make_sessionmaker
from app.main import create_app

SAMPLE = json.loads((Path(__file__).parent.parent / "fixtures/sample_listings.json").read_text())
SEARCH = {"label": "t", "city": "Jena", "max_rent": 400}


@pytest.fixture
def keyed(monkeypatch):
    monkeypatch.setenv("INGEST_API_KEY", "secret-key")
    monkeypatch.delenv("ALLOW_NO_API_KEY", raising=False)
    with TestClient(create_app("sqlite://")) as c:
        yield c


def test_every_route_needs_the_key_except_probes_and_metrics(keyed):
    for method, path in [
        ("get", "/searches"),
        ("post", "/searches"),
        ("get", "/searches/1"),
        ("delete", "/searches/1"),
        ("get", "/searches/1/matches"),
        ("post", "/searches/1/matches/seen"),
        ("post", "/listings"),
    ]:
        assert getattr(keyed, method)(path).status_code == 401, (method, path)
    for path in ("/health", "/livez", "/metrics"):
        assert keyed.get(path).status_code == 200, path


def test_correct_key_unlocks_the_api(keyed):
    headers = {"X-API-Key": "secret-key"}
    assert keyed.post("/searches", json=SEARCH, headers=headers).status_code == 201
    assert keyed.get("/searches", headers=headers).status_code == 200
    assert keyed.get("/searches", headers={"X-API-Key": "wrong"}).status_code == 401


def test_app_refuses_to_start_without_a_key(monkeypatch):
    monkeypatch.delenv("INGEST_API_KEY", raising=False)
    monkeypatch.delenv("ALLOW_NO_API_KEY", raising=False)
    with pytest.raises(RuntimeError, match="INGEST_API_KEY"), TestClient(create_app("sqlite://")):
        pass


def test_insert_ignore_returns_none_for_a_duplicate():
    app = create_app("sqlite://")
    with make_sessionmaker(app.state.engine)() as db:
        from app.db import Base

        Base.metadata.create_all(app.state.engine)
        values = SAMPLE[0] | {"available_from": date.fromisoformat(SAMPLE[0]["available_from"])}
        keys = ("source", "external_id")
        assert insert_ignore(db, Listing, values, keys) is not None
        assert insert_ignore(db, Listing, values, keys) is None


def test_same_listing_twice_in_one_batch_is_one_created_one_duplicate(keyed):
    headers = {"X-API-Key": "secret-key"}
    result = keyed.post("/listings", json=[SAMPLE[0], SAMPLE[0]], headers=headers).json()
    assert result["created"] == 1 and result["duplicates"] == 1
