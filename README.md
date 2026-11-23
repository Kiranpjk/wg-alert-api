# wg-alert-api

[![CI](https://github.com/Kiranpjk/wg-alert-api/actions/workflows/ci.yml/badge.svg)](https://github.com/Kiranpjk/wg-alert-api/actions/workflows/ci.yml)
[![Docker](https://github.com/Kiranpjk/wg-alert-api/actions/workflows/docker.yml/badge.svg)](https://github.com/Kiranpjk/wg-alert-api/actions/workflows/docker.yml)

A small FastAPI + PostgreSQL service for students hunting for a WG room. You save searches
(city, max rent, minimum size, districts, latest move-in date). Listings are pushed into the
API from feeds you are allowed to use. Each new listing is deduplicated and matched against
every active search, and you poll only the **unseen** matches.

## Problem

In German university towns a room ad gets dozens of messages within hours, so the people who
reply first get the viewings. Checking several sites by hand, and re-reading the same ads,
wastes the time you need to write good messages.

Source: r/Darmstadt, <https://www.reddit.com/r/Darmstadt/comments/1fvcvy8/>. A student
describes three months of tailored messages to WG-Gesucht ads with almost no replies, while
stuck in an expensive room.

### What this does not do

It does **not** scrape WG-Gesucht or any other portal. Their terms do not allow automated
access, and scraping would also mean getting around logins and captchas. Listings come in
through `POST /listings`, so you can feed it from sources you control: a university or
Studentenwerk feed, a script that parses the alert emails you already receive, or manual entry.

## Architecture

```
feed / script / manual  --POST /listings (X-API-Key)-->  FastAPI
                                                          |  dedupe on (source, external_id)
                                                          |  match against active searches
                                                          v
                                                    PostgreSQL (SQLite for local dev/tests)
client  --GET /searches/{id}/matches?unseen_only=true-->  new rooms only
```

| File | Purpose |
| --- | --- |
| `app/main.py` | App factory and routes |
| `app/db.py` | SQLAlchemy 2.0 models: `Search`, `Listing`, `Match` (unique per search+listing) |
| `app/matching.py` | Pure matching rules (city case-insensitive, rent, size, districts, move-in date) |
| `app/schemas.py` | Pydantic request/response models with validation limits |

Design choices:

- **Idempotent ingest**: the same listing posted twice is counted as a duplicate, never matched twice.
- **Backfill**: a newly created search gets matches from the last 7 days immediately.
- **Missing size is kept**: a listing without m² still matches, because a false positive costs less than a missed room.
- **Ingest auth**: if `INGEST_API_KEY` is set, `POST /listings` needs a matching `X-API-Key` header (constant-time compare). Read endpoints are open because this is meant as a single-user, self-hosted tool.
- Tables are created on startup. There is no migration tool yet.

## Dashboard

The web dashboard lets you save WG-room searches and review new matches as
listings arrive. Create searches with city, warm rent, optional room size,
districts and a move-in deadline. Browse matches by newest, lowest rent or
best price per square metre. You can show seen matches, mark all matches as
seen, and delete searches. The dashboard also includes API health, light
and dark themes, and sample-feed ingestion under Settings.

Run the full stack:

```sh
docker compose up --build
```

Open http://localhost:8080. To ingest the sample feed against Compose, enter
the configured `INGEST_API_KEY` in Settings. Compose defaults to `change-me`.

For frontend development, run the API on port 8000 and start Vite:

```sh
cd web && npm ci && npm run dev
```

Run `VITE_DEMO=true npm run dev` from `web/` to try the dashboard without
an API. The demo seeds a few fictional rooms, saves data in browser storage,
and sends the rest of the sample feed in three batches when you select
**Ingest sample feed**. The demo needs no ingest key.

## API

| Method | Path | Description |
| --- | --- | --- |
| GET | `/health` | Liveness + DB check |
| POST | `/searches` | Create a saved search (backfills matches) |
| GET | `/searches`, `/searches/{id}` | List / read |
| DELETE | `/searches/{id}` | Delete search and its matches |
| POST | `/listings` | Ingest up to 500 listings → `{created, duplicates, matches}` |
| GET | `/searches/{id}/matches?unseen_only=true` | Matches, newest first |
| POST | `/searches/{id}/matches/seen` | Mark all matches as seen |

Interactive docs: `http://localhost:8000/docs`.

## Demo

A real local run with the sample feed in `fixtures/sample_listings.json` (fictional listings):

```
$ curl -s localhost:8000/health
{"status":"ok"}

$ curl -s -X POST localhost:8000/searches -H "Content-Type: application/json" \
    -d '{"label":"Jena under 400","city":"Jena","max_rent":400,"min_size_m2":12}'
{"label":"Jena under 400","city":"Jena","max_rent":400.0,"min_size_m2":12.0,"districts":[],"available_by":null,"id":1,"active":true,"created_at":"2026-11-22T23:48:04.744621Z"}

$ curl -s -X POST localhost:8000/listings -H "X-API-Key: $INGEST_API_KEY" \
    -H "Content-Type: application/json" -d @fixtures/sample_listings.json
{"created":5,"duplicates":0,"matches":2}

$ # same request again
{"created":0,"duplicates":5,"matches":0}

$ curl -s "localhost:8000/searches/1/matches?unseen_only=true" \
    | jq -r '.[].listing | [.rent, .size_m2, .district, .title] | @tsv'
340.0   18.0    Lobeda  Large room, Lobeda, furnished
390.0   14.0    Zentrum 14 m2 room in 3er-WG near Paradies

$ curl -s -X POST localhost:8000/listings -d '[]' -o /dev/null -w "%{http_code}\n"   # no key
401
```

## Usage (local)

```bash
python -m venv .venv && . .venv/bin/activate
pip install -e ".[dev]"
INGEST_API_KEY=change-me uvicorn app.main:app --reload      # SQLite file wg_alert.db
```

## Run with Docker

```bash
cp .env.example .env        # set your own values
docker compose up --build   # API on :8000, PostgreSQL 16 with a named volume
```

Image published by CI: `ghcr.io/kiranpjk/wg-alert-api`.

## Tests

```bash
pytest -q                                   # 16 tests on in-memory SQLite
TEST_DATABASE_URL=postgresql+psycopg://user:pass@localhost:5432/wg_test pytest -q
```

Covers the matching rules (parametrised), dedupe, backfill, seen/unseen, validation errors,
404s, cascade delete, and API-key auth. Both the SQLite and PostgreSQL runs were done locally.

## CI/CD

- `.github/workflows/ci.yml`: ruff lint + format check, then pytest twice: on SQLite and on a
  `postgres:16-alpine` service container.
- `.github/workflows/docker.yml`: builds the image on PRs; pushes to GHCR on `main` and `v*`
  tags using `GITHUB_TOKEN`.
- `.github/dependabot.yml`: weekly pip, GitHub Actions and Docker updates.

## License

MIT, see [LICENSE](LICENSE).
