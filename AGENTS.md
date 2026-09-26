# AGENTS

## What This App Is

This is the official Quran Foundation Next.js starter. It demonstrates OAuth2/OIDC login, secure server sessions, Content API reads, Search API reads, and signed-in User API calls through `@quranjs/api`.

Keep changes small, explicit, and easy to review. Port behavior from larger Quran.com or QuranReflect apps only when it helps this starter stay correct.

## Project Map

- Server routes live in `src/app/api/**/route.ts` and `src/app/callback/route.ts`.
- Browser-rendered pages live in `src/app/**/page.tsx`.
- Shared browser components live in `src/components`.
- Server session code lives in `src/lib/session`.
- SDK clients and runtime helpers live in `src/lib/sdk.ts`, `src/lib/oauth.ts`, and `src/lib/env.ts`.
- App copy, routes, and common constants live in `src/lib/constants.ts`.

## SDK Boundary

- Use `@quranjs/api/public` only for browser-safe OAuth initiation helpers.
- Use `@quranjs/api/server` for OAuth token exchange, token refresh, Content APIs, Search APIs, and signed-in User APIs.
- Do not import `@quranjs/api/server` into `page.tsx`, client components, or any file with `"use client"`.
- Do not use `@quranjs/api/public` for backend token exchange or refresh logic.

## Secrets And Tokens

Never expose these values to browser code, client bundles, logs, analytics, or rendered HTML:

- `CLIENT_SECRET`
- `SESSION_SECRET`
- OAuth access tokens
- OAuth refresh tokens
- session identifiers or raw session payloads

Keep app-level Content/Search tokens separate from signed-in user session tokens. Do not call signed-in User APIs without a valid user session.

## Auth Behavior To Preserve

- Preserve Authorization Code with PKCE.
- Preserve the `/callback` server route for code exchange and session creation.
- Preserve `/api/session/refresh` so user sessions can refresh server-side.
- Preserve `/api/auth/logout` and OIDC end-session logout. Do not replace it with local cookie deletion only.
- Keep session cookies `httpOnly`, same-site aware, and server-owned.

## Verification

Run the narrowest check that covers your change, then run the full checks before finalizing a starter-wide change:

```bash
npm run lint
npm run build
npm test
npm run smoke:config
npm run smoke:routes
```

For SDK wiring changes, also run:

```bash
npm run sdk:status
```
