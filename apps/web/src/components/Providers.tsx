'use client';

import { ThemeProvider } from './ThemeProvider';
import { PodcastProvider } from './PodcastContext';
import { GlobalPodcastPlayer } from './GlobalPodcastPlayer';
import { GlobalAiSidebar } from './GlobalAiSidebar';

/**
 * Client boundary for the app shell.
 *
 * ThemeProvider reads localStorage and matchMedia, so it cannot run on the
 * server. Keeping it here means the root layout can stay a server component.
 */
export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
      <PodcastProvider>
        {children}
        <GlobalPodcastPlayer />
        <GlobalAiSidebar />
      </PodcastProvider>
    </ThemeProvider>
  );
}
