'use client';

import { usePodcast } from './PodcastContext';
import { PodcastPlayer } from './PodcastPlayer';
import { useRouter } from 'next/navigation';
import { X } from 'lucide-react';

export function GlobalPodcastPlayer() {
  const { segments, textId, nextChapterUrl, prevChapterUrl, clearQueue } = usePodcast();
  const router = useRouter();

  if (!segments.length || !textId) {
    return null;
  }

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 w-[calc(100%-2rem)] max-w-2xl bg-panel border border-line shadow-xl rounded-2xl p-4 z-50 transition-all">
      <button 
        onClick={clearQueue}
        className="absolute -top-2 -right-2 bg-panel border border-line rounded-full p-1 text-fg-muted hover:text-fg shadow-sm"
        aria-label="Close player"
      >
        <X className="w-4 h-4" />
      </button>
      <PodcastPlayer
        segments={segments}
        textId={textId}
        onNextChapter={nextChapterUrl ? () => router.push(nextChapterUrl) : undefined}
        onPrevChapter={prevChapterUrl ? () => router.push(prevChapterUrl) : undefined}
        hasNext={!!nextChapterUrl}
        hasPrev={!!prevChapterUrl}
      />
    </div>
  );
}
