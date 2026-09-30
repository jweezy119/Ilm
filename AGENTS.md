# Working in this repository

## Layout

```
apps/web      Next.js 14 App Router frontend
apps/api      Fastify API
packages/shared  Zod schemas + types, compiled to dist/ and consumed by both
```

`@ilm/shared` is built to `dist/` and both apps import the compiled output. Build
it before typechecking or running either app:

```bash
npm run build:shared
```

`npm run dev` and `npm run build` at the root do this for you.

## Before you commit

```bash
npm run typecheck
npm test
npm run build
```

## Conventions

- **AI features must degrade, not break.** Anything that calls Jev or an
  embedding provider checks `getJevJudge().available` first and falls back to the
  deterministic functions beside it in `apps/api/src/services/typesafe.ts`. A new
  AI-backed feature needs a fallback that works without credentials.
- **Label the source.** Scores and theme assignments report
  `source: 'jev' | 'derived'`, and the UI surfaces it. Do not silently pass local
  numbers off as model output.
- **No generated prose.** Ilm shows scores, evidence spans, and the passages
  themselves. It does not write commentary. Keep it that way — it is the product's
  central claim, not a style preference.
- **Batch Jev calls.** Independent questions go out in one `systemOne` request.
  The old code issued one HTTP request per dimension per candidate; do not
  reintroduce that pattern. Search re-ranking sends one Noul per shortlisted
  passage *plus* the corpus-level verdict in a single request.
- **Ask whether the corpus answers at all.** Re-ranking alone cannot tell a real
  match from the closest irrelevant passage, because Choice/Score probabilities
  always rank something first. The corpus-level Noul is what lets search say
  "these texts do not address this". Do not drop it in favour of a cheaper score.
- **Match theme keywords on word boundaries.** `containsKeyword` exists because
  plain substring matching reads "reincarnation" as containing "nation" and tags
  it as a passage about community. Use it rather than `.includes()`.
- **Retrieval comes from Postgres, not the search index.** The Orama index stores
  only what full-text ranking needs. Anything that enumerates or filters by
  relation (themes, cross-references, corpora) should query Postgres, and must
  not truncate results ordered by `verseOrder` — that biases toward the start of
  whichever corpus sorted first.
- **Passage keys are `textId:book:chapter:verse`.** The Quran is
  `quran:2:1:255` (surah:chapter:verse), not `quran:2:255`.
- **A blended score must stay unsaturated.** Search multiplies by
  `(1 - w*(1-coverage))` rather than `(1 + w*coverage)`; scaling up pinned every
  strong result to 1.00 and destroyed the ordering the UI shows.
- **API responses use the envelope** `{ success, data }` / `{ success, error }`,
  including `/health`. The web client reads `payload.data` and relies on it.

## Data

Ingestion is idempotent — every write upserts on the passage key, so re-running
after a failure is safe. The local Postgres is on **port 5433** so it does not
collide with a Postgres already on 5432; `apps/api/.env` expects that.

`apps/api/data/search-index/` is generated and gitignored. Delete it to force a
rebuild.

### Migrations are applied by the API on boot — do not apply them by hand

`src/index.ts` runs `npx prisma migrate deploy` before `app.listen`, and calls
`process.exit(1)` if it fails, so a schema change cannot ship ahead of its migration.
This is deliberate: a half-migrated database cannot serve requests, and refusing to
boot rolls the deploy back to a commit whose code matches the schema.

The consequence is that **running the migration SQL through `psql` breaks it.** A
hand-applied migration leaves no row in `_prisma_migrations`, the next boot replays
it, it fails against tables that already exist, and the service will not start. It
looks like the new code broke the API when the migration did. If you need a
migration applied to production out of band, delete it from `_prisma_migrations` and
drop what it created, and let the deploy do it.

Render is otherwise not involved: it builds and runs, and the migration happens as
part of starting up.
