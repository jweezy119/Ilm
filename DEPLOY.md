# Deploying Ilm

The app needs one managed service (Postgres) plus the two Node services. The
search index is built in-process at boot, so there is no search service to
provision.

| Component | What to provision |
| --- | --- |
| Postgres 16 | Managed instance, or the bundled container |
| `apps/api` | Node 20+ web service, or a container |
| `apps/web` | Node 20+ web service, or a container |

---

## No `.env` file is required

The app reads configuration from the environment only — there is no `dotenv` at
runtime, and nothing in `src/` opens a `.env` file. Every variable you set on your
host is the whole configuration. `apps/api/.env` is gitignored and is only a local
convenience.

`prisma generate` and `prisma migrate deploy` likewise read `DATABASE_URL` from the
environment, so both work on a host that has no `.env`. The build runs
`prisma generate` as part of `npm run build`, so the client can never be missing.

## Build and start commands

```bash
npm ci
npm run build          # builds @ilm/shared, then api (incl. prisma generate) and web
```

| Service | Build | Start | Port |
| --- | --- | --- | --- |
| api | `npm run build` | `npm run start -w @ilm/api` | 4000 |
| web | `npm run build` | `npm run start -w @ilm/web` | 3000 |

`@ilm/shared` must be built before either service starts, because both consume its
compiled output. The root `build` script handles the ordering; if your host runs
the steps separately, run `npm run build:shared` first.

### One-time setup

```bash
npm run db:deploy      # prisma migrate deploy — creates the schema
npm run ingest         # ~15 minutes, fetches ~45,000 passages
npm run index          # scores themes, builds the search index
```

Migrations live in `apps/api/prisma/migrations/` and are committed, so
`db:deploy` applies a known history. Run this whenever the schema changes, and
before the first deploy against a new database.

The search index is cached to `apps/api/data/search-index/orama.json` (~96 MB at
full corpus). Persist that path between deploys, or let the first request after a
cold start rebuild it from Postgres — which takes a couple of minutes and delays
that first request.

---

## Environment

### API

| Variable | Required | Notes |
| --- | --- | --- |
| `DATABASE_URL` | yes | `postgresql://user:pass@host:5432/ilm?schema=public` |
| `PORT` | no | defaults to 4000 |
| `HOST` | no | defaults to `0.0.0.0` |
| `LOG_LEVEL` | no | defaults to `info` |
| `CORS_ORIGIN` | no | comma-separated origins; defaults to `http://localhost:3000` |
| `RATE_LIMIT_MAX` / `RATE_LIMIT_WINDOW` | no | defaults to 600 requests / 60 s |
| `TYPESAFE_API_KEY` | no | without it, scoring falls back to local |
| `OPENROUTER_API_KEY` or `OPENAI_API_KEY` | no | without it, no vector similarity |
| `ADMIN_TOKEN` | recommended in production | required for `POST /api/admin/reindex`; send as `x-admin-token` |

In production the API refuses to reindex without that header, so if you plan to
rebuild the search index from a shell, either set `ADMIN_TOKEN` or run
`npm run index` directly.

### Web

| Variable | Required | Notes |
| --- | --- | --- |
| `NEXT_INTERNAL_API_URL` | **yes on the web service** | API origin for the server-side rewrite, e.g. `https://ilm-api.onrender.com`. Must be set in the **build** environment, not just at runtime. |
| `NEXT_PUBLIC_SITE_URL` | no | used for metadata URLs; defaults to `http://localhost:3000` |

`NEXT_INTERNAL_API_URL` is the one variable whose absence is silent: the pages
render, and every search quietly returns nothing. It is not `NEXT_PUBLIC_*` so it
stays out of the client bundle, which means the browser cannot report the
misconfiguration. The web build therefore fails outright when `RENDER=true` or
`CI=true` and the variable is missing or points at localhost. If the build stops
with that message, set the variable on the **web** service and rebuild.

`NEXT_INTERNAL_API_URL` is read by the Next config at build time as well as at
runtime, so set it in the build environment too. It is deliberately *not*
`NEXT_PUBLIC_*`, which keeps the internal host out of the client bundle.

---

## Render

1. **Postgres** — New → Postgres. Copy the *Internal Database URL* into
   `DATABASE_URL` on both services.
2. **API** — New → Web Service, pointing at this repo.
   - Build command: `npm ci && npm run build`
   - Start command: `npm run start -w @ilm/api`
   - Health check path: `/health`
3. **Web** — New → Web Service, pointing at this repo.
   - Build command: `npm ci && npm run build`
   - Start command: `npm run start -w @ilm/web`
   - Environment: `NEXT_INTERNAL_API_URL` = the API's URL

Then run ingestion once from a shell or a one-off job:

```bash
DATABASE_URL=... npm run ingest
DATABASE_URL=... npm run index
```

**Pre-deploy check.** `GET /health` on the API reports the search index size and
whether Jev is configured:

```json
{"success":true,"data":{"status":"ok",
  "search":{"ready":true,"passagesIndexed":45453},
  "jev":{"configured":true,"reason":"configured"}}}
```

If `passagesIndexed` is 0 the corpus has not been ingested into that database, and
if `jev.configured` is false the search box is running in literal mode.

## Docker

The API and web images build from their own directories but need the whole
workspace, so build from the repository root:

```bash
docker build -f apps/api/Dockerfile -t ilm-api .
docker build -f apps/web/Dockerfile -t ilm-web .

docker run -p 4000:4000 -e DATABASE_URL=... ilm-api
docker run -p 3000:3000 -e NEXT_INTERNAL_API_URL=http://api:4000 ilm-web
```

---

## Operational notes

**Rate limits.** Jev allows 1,200 requests per minute per account. Every
interaction batches its questions into a single request, so the default
`RATE_LIMIT_MAX` of 600/min is the binding constraint rather than Jev. Search
costs one request for intent plus one for re-ranking (and a third only when
literal recall is thin); recommendations and comparison are one request each.

**Search latency.** Re-ranking adds a round trip to every search. Lower
`SEARCH_RERANK_LIMIT` to shrink the request, or set `semantic: false` on the
search body to skip it entirely.

**Indexing cost.** `npm run index` makes Jev requests per passage for theme
classification and density, so a full 45,000-passage run is on the order of
90,000 requests. Run `--themes 2000` to sample instead, or run with no key to use
local scoring for both.

**Cross-references** are computed on a passage's first request and stored after
that, so the cost is one-time per passage rather than per view. The passage
endpoint serves without them if detection fails.

**Health checks.** `GET /health` returns `200` whenever the process is up, and
includes index size and whether Jev is configured. It does not fail when the
index is still building, so use it as a liveness probe rather than a readiness
one.

**Storage.** Budget roughly 2 GB for Postgres, 100 MB for the cached index, and
enough memory to hold the index in-process — around 1.5 GB for the full corpus.
The API holds the Orama index in memory for its lifetime.
