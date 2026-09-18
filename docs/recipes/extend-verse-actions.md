# Recipe: Extend Verse Actions

Goal: add a new verse-level action (for example, save a custom label).

1. Add API handler:
   - `src/app/api/<feature>/route.ts`
   - validate payload (`chapterId`, `verseNumber`, etc.)
   - call SDK server client method
2. Expose action in reader UI:
   - update `StarterShell` reader section
   - pass verse key from `readerData.verses`
3. Add optimistic UX:
   - temporary local state update
   - rollback on mutation error
4. Add tests:
   - parsing helpers in `src/lib/data.test.ts`
   - optional route smoke in `test/smoke-routes.cjs`

Follow current payload conventions:
- verse key format: `X:Y`
- chapter-only links: `/read/X`
