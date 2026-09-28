# Ilm (علم) — Sacred Text Comparison

> **Ilm** (Arabic: علم) means *knowledge, understanding, learning*. Ilm searches,
> compares, and traces themes across five sacred corpora, and explains every
> connection it draws as a **weighted score** rather than a generated claim.

The repository is a small monorepo:

| Package | What it is |
| --- | --- |
| `apps/web` | Next.js 14 App Router frontend |
| `apps/api` | Fastify API: search, comparison, recommendations, theme exploration |
| `packages/shared` | Zod schemas and types shared by both |

Postgres is the only datastore. Full-text search runs **in-process** with
OramaJS, and the semantic layer calls **Jev** (TypeSafe's System One model) over
HTTP. There is no Meilisearch, Qdrant, or Redis to run.

---

## Quick start

```bash
npm install

# 1. Postgres (mapped to 5433 so it does not collide with a Postgres on 5432)
docker run -d --rm --name ilm-postgres \
  -e POSTGRES_DB=ilm -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=postgres \
  -p 5433:5432 -v ilm_postgres_data:/var/lib/postgresql/data \
  --health-cmd "pg_isready -U postgres -d ilm" --health-interval 5s --health-retries 10 \
  postgres:16-alpine

# 2. Configure. Optional: every value can come from the environment instead, which
#    is how it works on a host. A .env file is only a local convenience.
cp apps/api/.env.example apps/api/.env

# 3. Schema
npm run db:deploy      # prisma migrate deploy

# 4. Text (~45,000 passages, roughly 15 minutes)
npm run ingest
npm run index

# 5. Run
npm run dev
```

Then open <http://localhost:3000>. The API is on <http://localhost:4000>; check
<http://localhost:4000/health> for its status.

### AI credentials are optional

The app runs fully without them. Every Jev-backed feature has a deterministic
local fallback, and the UI labels which one produced each number.

| Variable | Unset behaviour |
| --- | --- |
| `TYPESAFE_API_KEY` | Search is not re-ranked by meaning, cross-references are found by keyword overlap, and themes, alignments and search intent fall back to local scoring. `/health` reports `jev.configured: false` and the UI says "literal ranking". |
| `OPENROUTER_API_KEY` / `OPENAI_API_KEY` | Vector similarity is skipped; candidate ranking uses lexical overlap only. |

Add the keys to `apps/api/.env` and restart to switch both on. No code change
and no re-ingestion required.

---

## Corpus

| Text | Language | Structure | Passages | Source |
| --- | --- | --- | --- | --- |
| Quran | Arabic + English | 114 surahs | 6,236 | api.quran.com (Sahih International, Pickthall, Yusuf Ali) |
| Old Testament | English (KJV) | 39 books | 23,145 | thiagobodruk/bible bulk KJV |
| New Testament | English (KJV) | 27 books | 7,957 | thiagobodruk/bible bulk KJV |
| Torah | Hebrew + English | 5 books | 5,846 | Sefaria |
| Talmud | Aramaic + Hebrew + English | 38 tractates (Mishnah) | 2,269 | Sefaria |
| **Total** | | | **45,453** | |

Two honest limitations, both by design rather than omission:

- **The OT and NT carry no original-language text.** The bulk KJV source is
  English only, so `originalText` is empty rather than fabricated. Reading
  direction and translation for those two are handled correctly regardless.
- **The Talmud is the Mishnah only.** Sefaria's Gemara is organised by folio
  rather than chapter-and-verse, which does not fit this passage model. One
  tractate (Kerisos) has no Mishnah under any title spelling Sefaria accepts and
  is skipped with a warning.

### Passage keys

Every passage has a canonical key, used in URLs and in the `keys` query
parameter for shared comparisons:

```
textId:book:chapter:verse
```

For example `quran:2:1:255` (Ayat al-Kursi), `ot:Proverbs:3:19`,
`torah:Genesis:14:19`, `talmud:Berakhot:1:1`.

---

## How scoring works

Recommendations are ranked, never written. Three stages:

1. **Retrieve.** Candidates come from passages sharing the source's scored
   themes, capped per corpus, plus lexical neighbours. Retrieval queries Postgres
   rather than the search index: ranking index hits by verse order systematically
   favours the start of whichever corpus carries the theme.
2. **Prefilter.** A local lexical score (themes, significant terms, proper nouns,
   embeddings when available) ranks the pool. The shortlist is then interleaved
   across corpora, because a lexical measure almost always scores the source's
   own text highest and would otherwise hand the model a list of near-duplicates.
3. **Judge.** Jev scores each shortlisted pair across five dimensions —
   thematic, linguistic, historical, narrative, theological — in a **single**
   request per recommendation call. The composite is a weighted sum computed in
   code, so changing a weight slider re-ranks instantly without new inference.

Each dimension is normalised to 0–1. The response carries `source: 'jev'` or
`source: 'derived'`, and the UI shows which.

### Search

Search is two steps, and both are optional accelerants rather than requirements.

1. **Full-text retrieval.** Orama tokenises and matches, which means a multi-word
   query matches any of its words. A coverage pass then measures what fraction of
   the query's meaningful words each passage actually contains and discounts the
   rest. Without this, `"divine compassion for the humble"` returns 41,247
   passages, because tens of thousands of them contain "humble".
2. **Jev re-ranking.** One request scores every shortlisted passage against the
   query with a Noul, and adds a second corpus-level Noul answering whether the
   passages address the query *at all*. That second question is what lets the app
   say **"these texts do not address this"** instead of returning the five
   least-bad matches — a real answer rather than a failed search.

The two scores are blended (75% semantic, 25% full text) so a passage that
literally contains your words stays reachable. Set `semantic: false` on
`POST /api/search` to skip the extra request.

When literal recall is thin, a **Choice** question names the theme the query
reaches for, and the query is widened with that theme's vocabulary. Jev picks
from the closed taxonomy rather than inventing synonyms, which keeps the answer
usable as code.

### Cross-references

`detectCrossReferences` used to be reachable only from the indexing script, so the
cross-reference section of a passage could never populate. It now runs on the
first request for a passage and is stored, so later reads are a plain query. A
Noul gates each candidate, a Choice types the connection, and a Score grades its
strength — all in one request.

### Semantic density

Scored once per passage at index time and stored on the passage. Search uses it as
a small tie-breaker between passages full-text scored alike: a denser passage is
not automatically the right answer, only the more substantive one.

### Jev primitives in use

| Primitive | Where |
| --- | --- |
| **Score** | Five affinity dimensions, alignment strength, cross-reference strength, semantic density |
| **Choice** | Alignment type, cross-reference type, theme classification, search intent, query expansion |
| **Noul** | Search re-ranking, corpus-level relevance, alignment gate, cross-reference gate |

Independent questions are batched into one `systemOne` request rather than one
request each. Search re-ranking sends one Noul per shortlisted passage *plus* the
corpus-level check as a single request — see
`apps/api/src/services/typesafe-client.ts`.

### Cost per interaction

| Interaction | Requests | Notes |
| --- | --- | --- |
| Search | 1 + 1 | One for intent, one for re-ranking and the corpus verdict |
| Search with expansion | +1 | Only when literal recall is thin |
| Recommendations | 1 | Every shortlisted pair, all five dimensions, in one request |
| Comparison of 8 passages | 1 | All 28 pairs, typed and graded at once; cached pairs are answered from Postgres instead |
| Passage, first visit | 1 | Cross-reference detection, then cached forever |

---

## API

All responses use the same envelope: `{ success: true, data }` or
`{ success: false, error: { code, message } }`.

```
GET    /health

POST   /api/search                      unified search
GET    /api/search/suggest?q=           autocomplete
POST   /api/search/intent               classify a query's intent
GET    /api/search/stats                index statistics
GET    /api/themes                      themes present in the index

GET    /api/passages/:id
GET    /api/passages/by-key/:key        e.g. /api/passages/by-key/quran:2:1:255
POST   /api/passages/batch

GET    /api/texts                       corpus summary
GET    /api/texts/:textId
GET    /api/texts/:textId/books
GET    /api/texts/:textId/books/:bookId
GET    /api/texts/:textId/books/:bookId/passages
GET    /api/texts/:textId/books/:bookId/chapters/:chapter

POST   /api/recommendations
GET    /api/recommendations/explain/:sourceId/:targetId
GET    /api/themes/:theme/journey
GET    /api/themes/:theme/map
GET    /api/themes/:theme/shared?keys=a,b

GET    /api/users/:userId/weights
PUT    /api/users/:userId/weights

POST   /api/compare                     2-8 passages, all pairs in one Jev request
GET    /api/compare/translations/:textId/:book/:chapter/:verse

GET    /api/lexicon?word=               published dictionary entries for a Hebrew or Aramaic word

POST   /api/admin/reindex               rebuild the search index
GET    /api/admin/jobs/:jobId
```

The browser calls `/api/*` on its own origin; `apps/web/next.config.js` rewrites
those to the API, so development needs no CORS preflight and no internal host in
the client bundle. Set `NEXT_INTERNAL_API_URL` if the API is not on
`http://localhost:4000`.

---

## Scripts

```
npm run dev             web + api, with file watching
npm run build           shared -> api -> web
npm run typecheck       tsc --noEmit across all three packages
npm test                vitest across api and web
npm run db:generate     prisma generate
npm run db:deploy       apply migrations (use this on a host)
npm run db:push         push the schema without a migration history (local only)
npm run db:up           start the Postgres container

npm run ingest          fetch all corpora
npm run ingest -- quran --limit 3       one text, first 3 books only
npm run index           score themes, then build the search index
npm run index -- --themes 0             rebuild the search index only
npm run index -- --crossrefs            also detect cross-references

# Spend model budget only where it can change an answer. Skips passages whose
# top theme is clear of the runner-up; on this corpus that is about a third.
npm run index -- --only-uncertain --dry-run     report what it would judge, and the cost
npm run index -- --only-uncertain

# A failed model call leaves the passage's existing themes alone rather than
# overwriting them with keyword guesses. The count is reported as `deferred`.
npm run index

# Embeddings. Runs locally by default: no key, no cost, no data leaving the machine.
# Roughly two hours for the whole corpus on CPU.
EMBEDDING_PROVIDER=local npx tsx --env-file=apps/api/.env apps/api/scripts/embed.ts
npx tsx --env-file=apps/api/.env apps/api/scripts/embed.ts --limit 500   # a sample first

# Original-language text for the OT, which the KJV file does not carry.
# Update-only: it attaches Hebrew to verses that already exist rather than
# creating new ones, because the Masoretic and English verse divisions differ.
npx tsx --env-file=apps/api/.env apps/api/scripts/ingest-ot-original.ts
npx tsx --env-file=apps/api/.env apps/api/scripts/ingest-ot-original.ts --book Genesis
```

Ingestion is idempotent — every write is an upsert keyed on the passage key, so
re-running after a failure is safe.

`scripts/api-daemon.sh` and `scripts/web-daemon.sh` start and stop each service in
the background, which is handy for scripted checks.

---

## Deploying

See [DEPLOY.md](./DEPLOY.md) for Render, Fly, and any other host.

---

## Acknowledgments

Scripture texts come from [api.quran.com](https://api.quran.com),
[thiagobodruk/bible](https://github.com/thiagobodruk/bible), and
[Sefaria](https://www.sefaria.org). Semantic judgments come from
[TypeSafe](https://typesafe.ai).

## License

MIT
