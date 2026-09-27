'use client';

import { ThemeProvider } from './ThemeProvider';

/**
 * Client boundary for the app shell.
 *
 * ThemeProvider reads localStorage and matchMedia, so it cannot run on the
 * server. Keeping it here means the root layout can stay a server component.
 */
export function Providers({ children }: { children: React.ReactNode }) {
  return <ThemeProvider>{children}</ThemeProvider>;
}
