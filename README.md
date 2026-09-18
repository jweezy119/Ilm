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
- chat uses `/api/chat` with contextual Quranic synthesis

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
- `/chat`
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
- `/api/chat`
- `/api/search`
- `/api/reader/[chapterId]`
- `/api/notes`
- `/api/bookmarks`
- `/api/collections`
- `/api/goals`
- `/api/preferences`
- `/api/reflections`

## Deploy on Render

1. Push this repo to GitHub/GitLab
2. Create a new **Web Service** on [Render](https://dashboard.render.com)
3. Connect your repo and branch `main`
4. Set:
   - **Build Command:** `npm run build`
   - **Start Command:** `npm start`
5. Add environment variables in the Render dashboard:
   - `APP_BASE_URL` = `https://<your-service-name>.onrender.com`
   - `CLIENT_ID` = your Quran Foundation client ID
   - `CLIENT_SECRET` = your Quran Foundation client secret
   - `SESSION_SECRET` = generate with `openssl rand -hex 32`
   - `SCOPES` = `openid offline_access user note collection bookmark goal preference post comment`
   - `TRANSLATION_IDS` = `131`
   - `DEFAULT_READER_CHAPTER` = `1`
6. Deploy

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
