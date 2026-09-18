# Quran Foundation Next.js Starter

Deployable Next.js App Router source starter for Quran Foundation apps using
`@quranjs/api`.

This template demonstrates the production boundary every Quran Foundation web
app should keep:
- browser code starts OAuth with `@quranjs/api/public`
- server routes use `@quranjs/api/server` for token exchange, refresh, and API calls
- `CLIENT_SECRET`, access tokens, refresh tokens, and session secrets stay server-side
- content/search use an app-token backend path
- notes/bookmarks/collections/goals/preferences/reflections use the logged-in user session

## Quick Start

```bash
npm install
cp .env.example .env.local
npm run dev
```

Set these required values in `.env.local`:
- `APP_BASE_URL`
- `CLIENT_ID`
- `CLIENT_SECRET`
- `SESSION_SECRET`

Optional local values:
- `PORT`, defaults to `3000`
- `REDIS_URL`, enables shared session storage
- local service overrides such as `OAUTH2_BASE_URL`, `GATEWAY_URL`, and `QR_BASE_URL`

Open [http://localhost:3000](http://localhost:3000).

## Routes

UI:
- `/`
- `/read/[chapterId]`
- `/search`
- `/library`
- `/goals`
- `/reflect`
- `/settings`

Auth and data:
- `/api/auth/start`
- `/callback`
- `/api/auth/logout`
- `/api/bootstrap`
- `/api/search`
- `/api/reader/[chapterId]`
- `/api/notes`
- `/api/bookmarks`
- `/api/collections`
- `/api/goals`
- `/api/preferences`
- `/api/reflections`

## SDK Source Switching

Remote npm:
```bash
npm run sdk:remote -- latest
```

Local SDK build:
```bash
npm run sdk:local -- /absolute/path/to/api-js/packages/api
```

Show installed SDK:
```bash
npm run sdk:status
```

## Verification

```bash
npm run lint
npm run build
npm test
npm run smoke:config
npm run smoke:routes
```

## Architecture

See [docs/architecture.md](./docs/architecture.md).
