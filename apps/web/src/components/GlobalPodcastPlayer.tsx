'use client';

import { useState } from 'react';
import { usePodcast } from './PodcastContext';
import { PodcastPlayer } from './PodcastPlayer';
import { useRouter } from 'next/navigation';
import { X, Maximize2, Minimize2 } from 'lucide-react';
import { cn } from '@/lib/utils';

export function GlobalPodcastPlayer() {
  const { segments, textId, nextChapterUrl, prevChapterUrl, clearQueue } = usePodcast();
  const router = useRouter();
  const [isExpanded, setIsExpanded] = useState(true);

  if (!segments.length || !textId) {
    return null;
  }

  return (
    <div
      className={cn(
        "fixed z-50 flex flex-col bg-panel border-line shadow-2xl transition-all duration-300",
        isExpanded
          ? "inset-y-0 end-0 w-full sm:max-w-md border-s pt-4 px-4 pb-[env(safe-area-inset-bottom)]"
          : "top-20 end-4 w-72 rounded-2xl border p-4"
      )}
    >
      <div className="absolute top-2 end-2 flex gap-1 z-10">
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="flex h-8 w-8 items-center justify-center rounded-full bg-panel border border-line text-fg-muted hover:text-fg shadow-sm"
          aria-label={isExpanded ? "Minimize player" : "Expand player"}
        >
          {isExpanded ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
        </button>
        <button
          onClick={clearQueue}
          className="flex h-8 w-8 items-center justify-center rounded-full bg-panel border border-line text-fg-muted hover:text-fg shadow-sm"
          aria-label="Close player"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <PodcastPlayer
        segments={segments}
        textId={textId}
        onNextChapter={nextChapterUrl ? () => router.push(nextChapterUrl) : undefined}
        onPrevChapter={prevChapterUrl ? () => router.push(prevChapterUrl) : undefined}
        hasNext={!!nextChapterUrl}
        hasPrev={!!prevChapterUrl}
        isExpanded={isExpanded}
        className={isExpanded ? "mt-6 flex-1 overflow-hidden" : ""}
      />
    </div>
  );
}
