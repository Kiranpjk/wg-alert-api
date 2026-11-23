# wg-alert-api

[![CI](https://github.com/Kiranpjk/wg-alert-api/actions/workflows/ci.yml/badge.svg)](https://github.com/Kiranpjk/wg-alert-api/actions/workflows/ci.yml)
[![Docker](https://github.com/Kiranpjk/wg-alert-api/actions/workflows/docker.yml/badge.svg)](https://github.com/Kiranpjk/wg-alert-api/actions/workflows/docker.yml)

[![Live demo](https://img.shields.io/badge/live%20demo-GitHub%20Pages-B4411F)](https://kiranpjk.github.io/wg-alert-api/)

![WG Alert dashboard walkthrough](docs/media/demo.gif)

[Watch the 54-second walkthrough (MP4)](docs/media/demo.mp4). It is a real browser recording of the
[live demo](https://kiranpjk.github.io/wg-alert-api/), made with `docs/media/record-demo.mjs`. The demo keeps its
data in your browser and shows a canned result for **Add from ad**; the real stack (FastAPI, PostgreSQL, Docker)
is what the rest of this README describes.

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
- **Auth**: every route except `/health`, `/livez` and `/metrics` needs the `X-API-Key` header (constant-time compare). The app refuses to start without `INGEST_API_KEY`; for local development only, `ALLOW_NO_API_KEY=1` turns the check off. This is a single shared key for a self-hosted tool, not per-user accounts. Over plain HTTP the key travels unencrypted, so put TLS or a VPN in front of any internet-facing deployment.
- **Probes**: `/livez` never touches the database (used for Kubernetes liveness); `/health` checks the database (readiness).
- **Atomic ingest**: duplicates are skipped with a single `INSERT ... ON CONFLICT DO NOTHING`, so simultaneous identical requests cannot crash each other.
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

Open http://localhost:8080. Enter the `INGEST_API_KEY` from your `.env` under Settings once; the dashboard then sends it with every request.

For frontend development, run the API on port 8000 and start Vite:

```sh
cd web && npm ci && npm run dev
```

Run `VITE_DEMO=true npm run dev` from `web/` to try the dashboard without
an API. The demo seeds a few fictional rooms, saves data in browser storage,
and sends the rest of the sample feed in three batches when you select
**Ingest sample feed**. The demo needs no ingest key.

## AI: add a listing from a pasted ad

Room ads often arrive by email, chat or portal notifications. Use **Add from ad**
to paste one into the dashboard and extract a draft. The API strips email
addresses and phone numbers before sending up to 6,000 characters to Anthropic,
then validates the entire response against the draft schema. Review and edit
the fields before selecting **Add to feed**. Only that final action saves and
matches a listing.

The ad text, minus the contact details detected by the redaction patterns,
is sent to Anthropic. Remove any other private information before pasting.

Set these environment variables on the API service:

| Variable | Purpose |
| --- | --- |
| `ANTHROPIC_API_KEY` | Enables AI extraction. Keep this key on the server. |
| `ANTHROPIC_MODEL` | Optional model override. Defaults to `claude-haiku-5-5`. |
| `PARSE_DAILY_LIMIT` | Defaults to 100 parse requests per API process per UTC day. Configured attempts count toward the limit, including failed upstream calls. The counter resets on process restart and at midnight UTC. |

On Kubernetes, put the optional configuration in the `wg-alert-api` Secret.
The bundled NetworkPolicy restricts API egress. To enable extraction, allow
the API pods to reach `api.anthropic.com:443` through your cluster's egress
policy or HTTPS proxy.

The model can misread an ad and is instructed to extract only the first
listing in the pasted text. Matching uses warm rent. When the model finds
only cold rent, the dashboard shows that amount and asks you to enter the
warm rent. The Pages demo uses a fixed example and makes no AI request.
The Anthropic integration tests use mocked responses.

## API

| Method | Path | Description |
| --- | --- | --- |
| GET | `/livez` | Liveness (no database call), no key needed |
| GET | `/health` | Readiness: database check, no key needed |
| GET | `/metrics` | Prometheus text metrics |
| POST | `/searches` | Create a saved search (backfills matches) |
| GET | `/searches`, `/searches/{id}` | List / read |
| DELETE | `/searches/{id}` | Delete search and its matches |
| POST | `/listings/parse` | Extract a draft from pasted ad text |
| POST | `/listings` | Ingest up to 500 listings → `{created, duplicates, matches}` |
| GET | `/searches/{id}/matches?unseen_only=true` | Matches, newest first |
| POST | `/searches/{id}/matches/seen` | Mark all matches as seen |

Interactive docs: `http://localhost:8000/docs`.

## Demo

A real local run with the sample feed in `fixtures/sample_listings.json` (fictional listings):

```
$ curl -s localhost:8000/health
{"status":"ok"}

$ curl -s -X POST localhost:8000/searches -H "X-API-Key: $INGEST_API_KEY" -H "Content-Type: application/json" \
    -d '{"label":"Jena under 400","city":"Jena","max_rent":400,"min_size_m2":12}'
{"label":"Jena under 400","city":"Jena","max_rent":400.0,"min_size_m2":12.0,"districts":[],"available_by":null,"id":1,"active":true,"created_at":"2026-11-22T23:48:04.744621Z"}

$ curl -s -X POST localhost:8000/listings -H "X-API-Key: $INGEST_API_KEY" \
    -H "Content-Type: application/json" -d @fixtures/sample_listings.json
{"created":5,"duplicates":0,"matches":2}

$ # same request again
{"created":0,"duplicates":5,"matches":0}

$ curl -s -H "X-API-Key: $INGEST_API_KEY" "localhost:8000/searches/1/matches?unseen_only=true" \
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
INGEST_API_KEY=dev-key uvicorn app.main:app --reload      # SQLite file wg_alert.db
```

## Run with Docker

```bash
cp .env.example .env        # set INGEST_API_KEY (openssl rand -hex 32); compose refuses to start without it
docker compose up --build   # API on :8000, PostgreSQL 16 with a named volume
```

CI publishes `ghcr.io/kiranpjk/wg-alert-api` and `ghcr.io/kiranpjk/wg-alert-web`.

## Tests

```bash
pytest -q
TEST_DATABASE_URL=postgresql+psycopg://user:pass@localhost:5432/wg_test pytest -q
```

Covers the matching rules (parametrised), dedupe, backfill, seen/unseen, validation errors,
404s, cascade delete, API-key auth, metrics, monitoring configuration, and ad parsing
with mocked Anthropic responses. CI also runs the suite with PostgreSQL.

## CI/CD

- `.github/workflows/ci.yml`: ruff lint + format check, then pytest twice: on SQLite and on a
  `postgres:16-alpine` service container.
- `.github/workflows/docker.yml`: builds both images on PRs and pushes to GHCR on `main` and `v*`
  tags using `GITHUB_TOKEN`.
- `.github/dependabot.yml`: weekly pip, GitHub Actions and Docker updates.

## Observability

`GET /metrics` exports request counts by method, route template and status,
and a request-duration histogram by method and route template. Unknown paths
share one label. Scrapes are excluded. Listing and match counters record
committed writes per API process. Each replica reports the same database-wide
active search count, so the dashboard uses `max` for that gauge.

To start the monitoring stack alongside the app, run from the repo root in Bash:

```bash
read -rsp 'Grafana admin password: ' GRAFANA_PASSWORD
export GRAFANA_PASSWORD
docker compose -f docker-compose.yml -f docker-compose.monitoring.yml up --build -d
```

Prometheus binds to `127.0.0.1:9090`, scrapes every 15 seconds and evaluates
three alerts covering scrape failures, 5xx ratio and p95 latency. Grafana binds
to `127.0.0.1:3000`. Sign in as `admin` to open the provisioned WG Alert API dashboard.

```sh
promtool check config deploy/monitoring/prometheus.yml
promtool check rules deploy/monitoring/alerts.yml
pytest tests/test_metrics.py tests/test_monitoring_files.py
```

## Kubernetes

The Kustomize base deploys into `wg-alert`. Set the Ingress hostname and the two
GHCR image tags in `k8s/kustomization.yaml`. The defaults use `main`. For a
reproducible deployment, set both to published SHA or release tags.

```sh
kustomize build k8s | kubeconform -strict -summary
kubeconform -strict -summary k8s/secret.example.yaml
```

To deploy, use a cluster with a NetworkPolicy-capable CNI, default storage
class, Metrics API for the CPU HPA, and an NGINX ingress controller matching
the namespace and pod selectors in `k8s/base/network-policy.yaml`. The policy
also allows CoreDNS and Prometheus using the selectors in that file. Configure
your Prometheus instance to discover annotated API pods if you want cluster
scraping. Both GHCR images must be pullable by the cluster.

```sh
kubectl apply -f k8s/base/namespace.yaml
cp -n k8s/secret.example.yaml k8s/secret.yaml
# Edit k8s/secret.yaml using a new hex DB password in both fields and a new ingest key.
kubectl apply -f k8s/secret.yaml
kubectl apply -k k8s
```

## Terraform

[The AWS deployment guide](infra/terraform/README.md) covers the EC2 stack,
required inputs and generated credentials. This is a single-node deployment
with HTTP and no TLS termination.

```sh
cd infra/terraform
terraform fmt -check -recursive
terraform init -backend=false
terraform validate
```

## What is verified

| Artifact | Local check performed |
| --- | --- |
| API and Prometheus exposition | `pytest` passed all 26 tests, including the 16 existing tests and 8 new metrics tests. Ruff lint and format checks passed. |
| Prometheus scrape config and alerts | `promtool` v3.5.0 passed `check config` and `check rules` for all three alerts. |
| Grafana provisioning and monitoring Compose | Two pytest configuration tests cover monitoring file structure, including the dashboard datasource and Compose mount and password wiring. |
| Kubernetes manifests and Secret template | Kustomize v5.6.0 rendered 15 resources. Kubeconform v0.6.7 strict validation passed all 15 plus the two example Secret documents, with zero skips. |
| AWS Terraform and bootstrap | Terraform 1.10.5 passed format check, backendless init and validate. The rendered bootstrap script passed `bash -n`. |
| Docker, Kubernetes and Terraform workflows | `actionlint` v1.7.7 passed for the three workflow files. |

Docker and the monitoring stack were not run locally. Kubernetes checks were
static manifest validation. Terraform was not applied to AWS, and the GitHub
Actions workflows were not executed here.

## License

MIT, see [LICENSE](LICENSE).
