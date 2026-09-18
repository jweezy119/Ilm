# Recipe: Add a New SDK Feature

1. Decide token path:
   - user-session API (needs logged-in user + scope)
   - app-token API (content/search style)
2. Add server-side integration in an `/api/*` route.
3. For user APIs:
   - gate with `ensureUserScope`
   - execute with `runUserAction`
   - return mutation-safe JSON via `withSessionJson`
4. Add UI controls in `StarterShell`:
   - form inputs
   - action button
   - optimistic update if list mutation
5. Add or update tests in `src/lib/*.test.ts` and smoke checks if route-level.

Keep browser code SDK-free. All SDK usage should remain on server routes.
