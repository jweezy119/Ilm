'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pause, Play, SkipBack, SkipForward, Volume2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { TextId } from '@ilm/shared';
import { speechLanguage, splitForSpeech, SPEECH_RATES } from '@/lib/speech';
import { cn } from '@/lib/utils';
import { voiceProblem } from '@/lib/voice-help';
import { createSpeechEngine, type SpeechEngine, type SpeechPiece } from '@/lib/speech-engine';

export interface SpeechSegment {
  label: string;
  text: string;
}

export function PodcastPlayer({
  segments,
  textId,
  className,
  onNextChapter,
  onPrevChapter,
  hasNext,
  hasPrev,
}: {
  segments: SpeechSegment[];
  textId: TextId;
  className?: string;
  onNextChapter?: () => void;
  onPrevChapter?: () => void;
  hasNext?: boolean;
  hasPrev?: boolean;
  isExpanded?: boolean;
}) {
  const t = useTranslations('speech');
  const language = useMemo(() => speechLanguage(textId), [textId]);

  const [playing, setPlaying] = useState(false);
  const [rate, setRate] = useState<number>(1);
  const [notice, setNotice] = useState<string | null>(null);
  const [engineState, setEngineState] = useState<'device' | 'robotic' | 'cloud' | null>(null);

  const [currentIndex, setCurrentIndex] = useState(0);

  const engineRef = useRef<SpeechEngine | null>(null);
  const stoppedRef = useRef(false);

  const pieces = useMemo<SpeechPiece[]>(
    () =>
      segments.flatMap((seg) =>
        splitForSpeech(seg.text).map((chunk) => ({ label: seg.label, text: chunk }))
      ),
    [segments]
  );

  const stopEngine = useCallback(() => {
    stoppedRef.current = true;
    engineRef.current?.stop();
    setPlaying(false);
  }, []);

  useEffect(() => {
    return () => {
      stopEngine();
    };
  }, [stopEngine]);

  const playFromIndex = useCallback(
    async (startIndex: number) => {
      if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
        setNotice(t('unsupported'));
        return;
      }
      if (pieces.length === 0) return;

      stoppedRef.current = false;
      setNotice(null);
      setPlaying(true);
      setCurrentIndex(startIndex);

      try {
        if (!engineRef.current) {
          engineRef.current = await createSpeechEngine(language.tag);
        }
        setEngineState(engineRef.current.kind);

        const queue = pieces.slice(startIndex);
        await engineRef.current.speakQueue(queue, {
          rate,
          onPiece: (piece, idx) => {
            if (stoppedRef.current) return;
            setCurrentIndex(startIndex + idx);
          },
          onDone: () => {
            if (stoppedRef.current) return;
            setPlaying(false);
            if (onNextChapter && hasNext) {
              onNextChapter();
            }
          },
          onError: () => {
            if (stoppedRef.current) return;
            setPlaying(false);
            setNotice(t('voiceUnavailable'));
          },
        });
      } catch (err) {
        setPlaying(false);
        setNotice(t('voiceUnavailable'));
      }
    },
    [language.tag, pieces, rate, t, onNextChapter, hasNext]
  );

  const togglePlay = useCallback(() => {
    if (playing) {
      stopEngine();
    } else {
      playFromIndex(currentIndex < pieces.length ? currentIndex : 0);
    }
  }, [playing, stopEngine, playFromIndex, currentIndex, pieces.length]);

  const nextPiece = useCallback(() => {
    stopEngine();
    if (currentIndex < pieces.length - 1) {
      playFromIndex(currentIndex + 1);
    } else if (onNextChapter && hasNext) {
      onNextChapter();
    }
  }, [currentIndex, pieces.length, playFromIndex, stopEngine, onNextChapter, hasNext]);

  const prevPiece = useCallback(() => {
    stopEngine();
    if (currentIndex > 0) {
      playFromIndex(currentIndex - 1);
    } else if (onPrevChapter && hasPrev) {
      onPrevChapter();
    }
  }, [currentIndex, playFromIndex, stopEngine, onPrevChapter, hasPrev]);

  // When segments change (e.g. advanced to next chapter), auto-play if we were playing.
  // Actually, to implement continuous reading: if segments change, reset to 0.
  const prevSegmentsRef = useRef(segments);
  useEffect(() => {
    if (prevSegmentsRef.current !== segments) {
      prevSegmentsRef.current = segments;
      setCurrentIndex(0);
      if (playing && !stoppedRef.current) {
        // Stop current engine first
        engineRef.current?.stop();
        playFromIndex(0);
      }
    }
  }, [segments, playing, playFromIndex]);

  return (
    <div className={cn('flex flex-col gap-3', className)} onClick={(e) => e.stopPropagation()}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Volume2 className="h-5 w-5 text-accent" />
          <span className="text-sm font-medium">Podcast Mode</span>
        </div>
        <label className="flex items-center gap-1.5 text-xs text-fg-muted h-12">
          <span>{t('rate')}</span>
          <select
            value={String(rate)}
            onChange={(e) => {
              setRate(Number(e.target.value));
              if (playing) {
                stopEngine();
                // Play starts from current index but in the next tick
                setTimeout(() => playFromIndex(currentIndex), 50);
              }
            }}
            className="rounded-lg border border-line bg-panel px-2 py-1.5 outline-none focus:border-accent min-h-[44px]"
          >
            {SPEECH_RATES.map((r) => (
              <option key={r} value={String(r)}>{r}×</option>
            ))}
          </select>
        </label>
      </div>

      <div className="flex items-center justify-center gap-6">
        <button
          type="button"
          onClick={prevPiece}
          disabled={!hasPrev && currentIndex === 0}
          className="flex h-14 w-14 items-center justify-center rounded-full text-fg-muted hover:bg-panel hover:text-fg disabled:opacity-50"
          aria-label="Previous"
        >
          <SkipBack className="h-6 w-6 fill-current" />
        </button>

        <button
          type="button"
          onClick={togglePlay}
          className="flex h-16 w-16 items-center justify-center rounded-full bg-accent text-accent-fg shadow-sm hover:bg-accent-hover transition-transform active:scale-95"
          aria-label={playing ? t('pause') : t('play')}
          aria-pressed={playing}
        >
          {playing ? <Pause className="h-7 w-7 fill-current" /> : <Play className="h-7 w-7 fill-current ml-1" />}
        </button>

        <button
          type="button"
          onClick={nextPiece}
          disabled={!hasNext && currentIndex >= pieces.length - 1}
          className="flex h-14 w-14 items-center justify-center rounded-full text-fg-muted hover:bg-panel hover:text-fg disabled:opacity-50"
          aria-label="Next"
        >
          <SkipForward className="h-6 w-6 fill-current" />
        </button>
      </div>

      <div className="text-center text-xs text-fg-muted truncate px-2">
        {playing ? (
          <span>Reading: {pieces[currentIndex]?.label || '...'}</span>
        ) : (
          <span>{notice ? notice : 'Ready to read'}</span>
        )}
      </div>

      {isExpanded && pieces.length > 0 && (
        <div className="mt-4 flex-1 overflow-y-auto rounded-xl border border-line bg-bg p-3 shadow-inner">
          <h4 className="mb-3 text-[11px] font-bold uppercase tracking-wider text-fg-muted px-2">Reading Queue</h4>
          <div className="space-y-1">
            {pieces.map((piece, idx) => {
              const isCurrent = idx === currentIndex;
              const isPast = idx < currentIndex;
              return (
                <button
                  key={idx}
                  onClick={() => playFromIndex(idx)}
                  className={cn(
                    "w-full text-left flex flex-col gap-1 p-3 rounded-lg transition-colors text-sm min-h-[48px]",
                    isCurrent ? "bg-accent/10 text-accent" : "hover:bg-panel text-fg",
                    isPast && "opacity-50"
                  )}
                >
                  <span className="text-[10px] font-bold uppercase tracking-widest opacity-80">{piece.label}</span>
                  <span className="line-clamp-2">{piece.text}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
