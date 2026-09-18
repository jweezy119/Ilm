# Recipe: Add a New Route

1. Add a page under `src/app/<route>/page.tsx`.
2. Reuse `StarterShell` if it is a dashboard-style surface:
   ```tsx
   import StarterShell from "@/components/starter-shell";

   export default function NewRoutePage() {
     return <StarterShell route="settings" />;
   }
   ```
3. If you need new data, add `/api/<new-route>/route.ts`.
4. Keep SDK calls server-side in the route handler.
5. Update nav in `src/components/starter-shell.tsx`.
6. Run `npm run lint && npm run build`.
