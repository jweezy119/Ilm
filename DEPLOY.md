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

### Search: Postgres, not an in-process index

Full-text retrieval runs in the database, in a `tsvector` column on `passages` with
a GIN index, maintained by triggers so it cannot drift from the data. Nothing is
held in the API's memory, so the whole corpus is searchable on a 512 MB instance
and the API boots in seconds instead of rebuilding an index first.

The in-process Orama index (`SEARCH_ENGINE=orama`) is still there and still
working, because switching between them changed what "search" means and a rollback
should be one word of configuration. It also has two limitations worth remembering
if it is ever turned back on:

- It held every indexed passage in RAM at a measured ~35 KB each, which caps a
  512 MB instance at roughly 13,000 of the 45,453 passages. That is why it was
  restricted to `quran,torah`.
- **It never contained the scripture.** It indexed theme names, book slugs and
  translation names, so "mercy" matched because passages carry a theme called
  mercy, not because the word appears in them. A word absent from the theme
  vocabulary returned nothing however common it was in the text — "nitre" found
  nothing at all. The Postgres index searches the English translation and still
  indexes themes, so everything findable before remains findable.

`SEARCH_INDEX_TEXTS` and `API_HEAP_MB` apply only to the Orama engine.

### Quotation detection

`npm run detect-quotations -w @ilm/api` finds passages that share long word
sequences with passages elsewhere, and stores them as cross-references. It is a
script rather than a request path because the n-gram index for the whole corpus
needs more memory than the web service has.

It is deliberately not a model. A fabricated quotation is indistinguishable from a
real one to a reader, and this way every claim carries the text it rests on, so a
finding can be checked by opening both passages. On the current corpus it finds
3,689 cross-corpus citations, 157 of them sharing seven or more consecutive words
and 53 sharing more than ten, at a strength of 0.9 or better.

Two parameters control recall, and they pull against each other:

| Flag | Default | Effect |
| --- | --- | --- |
| `--min-run` | 6 | Consecutive shared words required. Six is where shared idiom stops being plausible; ten is safer and finds less. |
| `--max-df` | 8 | How many passages an n-gram may appear in before it counts as stock phrasing. This is the important one — without it, "and he said unto him" links thousands of passages. |

Findings are stored in three types, because they are three different claims:

- `quotation` — one corpus drawing on another. The lineage this corpus is made of.
- `parallel` — the same corpus repeating itself: the Quran's formulaic echoes,
  the synoptic gospels, the duplicate narratives of the Pentateuch. Real, and worth
  arguing about, but not citation.
- `duplicate` — the same verse in two collections. The Pentateuch is in both
  `torah` and `ot`, and without this those arrive as ~1,300 confident-looking
  "OT cites Torah" claims that are really one text counted twice.

Direction is not stored. Verse order is per corpus, so there is no shared timeline
to infer which text came first, and asserting one would be inventing evidence.

Re-running is safe: references upsert on (source, target, type).

### Theme classification: measured, and not good enough

`npm run train-theme-classifier -w @ilm/api` trains a multi-label linear classifier
over the 80 themes, using the 47,007 labels Jev already assigned as its training
data. The aim is to label the 9,654 passages that have only keyword themes without
paying for them again.

It does not work, and the numbers are why:

| | |
| --- | --- |
| Training data | 35,799 passages, 47,007 labels, 80 classes, 384-dim vectors |
| Baseline (always the most common theme) | 14% micro F1 |
| This model, threshold tuned on held-out data | **41% micro F1**, 35% precision |
| Themes clearing F1 0.55 on 100+ examples | **3 of 80**, covering **6%** of label mass |

More epochs did not help: 14 epochs gave 40%, 45 gave 41%. The ceiling is the
features, not the model.

The diagnosis is that the current embeddings are the wrong tool for the job.
`paraphrase-multilingual-MiniLM` is a *similarity* model — trained so that two
sentences about the same thing are near each other — and topical classification
wants the opposite: the token-level evidence for what a passage is about. The same
reason `originalText` is not indexed for Hebrew or Arabic is the reason this is
weak: the signal is not in what the encoder was trained to preserve.

So no labels are written. A 40%-precision labeller would put a confident,
checkable-looking theme on roughly six passages in ten, which is the failure this
app is specifically built to avoid.

That hypothesis was then tested. `npm run train-lexical-classifier -w @ilm/api`
trains the same 80 classes on TF-IDF over stemmed, word-boundary-matched lexemes
taken from the passage text — never from `search_vector`, which contains the theme
names and would hand the model its own answers.

| | dense embeddings | lexical features |
| --- | --- | --- |
| micro F1 | 40.7% | 40.4% |
| macro F1 | 37.4% | **43.6%** |
| themes clearing F1 0.55 on 100+ examples | 3 of 80 | 3 of 80 |
| label mass covered | 6% | 5% |

Better on the per-theme average and no better in bulk. The reason is visible in the
label distribution rather than in the model: **half of all label mass sits in fifteen
themes**, led by `judgment` at 12.6%, and those are the broad overlapping ones —
`judgment`, `prophets`, `sin`, `worship`, `prayer`, `power`, `ritual`. Whether a
passage is about `sin` or `judgment` is a matter of reading, not of vocabulary, and
a classifier that could settle it would be claiming to do something no model does
reliably.

The themes that *are* predictable are the narrow concrete ones, and they predict
well: `sabbath` 75%, `light` 73%, `sacrifice` 68%, `satan` 65%, `angels` 64%. They
also carry almost none of the label mass.

So the honest conclusion is not "classification is impossible here" but that the
task splits in two: a local labeller is credible for concrete themes and useless for
the broad ones, and the broad ones are the majority of what the corpus is labelled
with. A local labeller can therefore serve as an aid for searching and exploring
concrete themes. It cannot stand in for the model, and no threshold will change
that.

Migrations are **not** a manual step for the API service: it runs
`prisma migrate deploy` on boot, before it accepts traffic, and refuses to start if
that fails — which rolls the deploy back to a commit whose code matches the schema.
The build command only generates the Prisma client, so this is what stops code that
reads a new table from deploying cleanly and then failing every request. Set
`SKIP_MIGRATE=1` to opt out where a separate migration job owns the schema.

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
