# Recipe: Add a Reflection Surface

1. Identify the reflection API behavior you want:
   - feed read
   - create reflection
   - comments/engagement preview
2. Add or extend route handler under `/api/reflections` (or a new `/api/reflect/*` path).
3. Keep scope checks explicit (`post`, `comment`, `user`).
4. Render read/write UI in `StarterShell` under the reflect route.
5. On create actions:
   - keep body + verse key validation strict
   - show toast on success/error
   - revalidate bootstrap feed slice

Reference semantics from `quranreflect-frontend-next` for composition and feed behavior. Prefer simpler local state and fewer layers in this starter.
