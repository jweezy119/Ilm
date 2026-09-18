# Recipe: Customize Branding

1. Edit [starter.config.ts](../../starter.config.ts):
   - app name/description
   - color tokens
   - defaults and feature flags
2. Update theme variables in `src/app/globals.css`.
3. Tune component styles in `src/components/starter-shell.module.css`.
4. Update metadata and copy in `src/app/layout.tsx` and `src/components/starter-shell.tsx`.
5. Verify desktop + mobile:
   - `npm run dev`
   - open `/`, `/read/1`, `/reflect`
