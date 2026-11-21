'use client';

import { usePodcast } from './PodcastContext';
import { PodcastPlayer } from './PodcastPlayer';
import { useRouter } from 'next/navigation';
import { useComparisonStore } from '@/store';
import { cn } from '@/lib/utils';
import { useWakeLock } from '@/lib/useWakeLock';

export function GlobalPodcastPlayer() {
  const {
    queueId,
    title,
    segments,
    textId,
    startIndex,
    playToken,
    togglePlaySignal,
    nextChapterUrl,
    prevChapterUrl,
    reportPlaybackState,
    clearQueue,
  } = usePodcast();
  const router = useRouter();
  // The tray occupies the bottom edge when a comparison is being assembled.
  // Raise the player instead of covering the bar that owns the primary action.
  const trayCount = useComparisonStore((s) => s.passageKeys.length);
  useWakeLock(segments.length > 0);

  if (!segments.length || !textId || !queueId) {
    return null;
  }

  return (
    <div
      className={cn(
        'fixed left-1/2 -translate-x-1/2 w-[calc(100%-1.5rem)] max-w-2xl bg-panel/95 backdrop-blur-md border border-line shadow-xl rounded-2xl px-4 py-3 z-50 transition-all',
        trayCount > 0 ? 'bottom-24' : 'bottom-4'
      )}
    >
      <PodcastPlayer
        queueId={queueId}
        title={title}
        segments={segments}
        textId={textId}
        startIndex={startIndex}
        playToken={playToken}
        togglePlaySignal={togglePlaySignal}
        onNextChapter={nextChapterUrl ? () => router.push(nextChapterUrl) : undefined}
        onPrevChapter={prevChapterUrl ? () => router.push(prevChapterUrl) : undefined}
        onStateChange={reportPlaybackState}
        onClose={clearQueue}
        hasNext={!!nextChapterUrl}
        hasPrev={!!prevChapterUrl}
      />
    </div>
  );
}
