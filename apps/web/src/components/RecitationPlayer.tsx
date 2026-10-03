'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pause, Play, SkipBack, SkipForward, Repeat, Volume2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { RECITERS, DEFAULT_RECITER, RECITATION_SPEEDS, ayahAudioUrl, verseLabel } from '@/lib/reciters';

export interface RecitationVerse {
  passageKey: string;
  /** Shown to a screen reader and in the now-playing line, e.g. "2:255". */
  label: string;
}

type RepeatMode = 'off' | 'one' | 'all';

/**
 * Verse-by-verse Quran recitation.
 *
 * One MP3 per ayah, so the verse being recited is known exactly: there are no
 * timings to fetch, no drift, and nothing to keep in step with the audio. The
 * tradeoff is a request per verse, which is why preload is "none" and a verse is
 * only fetched once the reader asks for it — a chapter of audio is roughly two
 * megabytes and nobody asked for that up front.
 *
 * Built for the keyboard first, because audio nobody can operate is not
 * accessible audio. Every control is a real button or select, the play state is
 * announced rather than merely shown, and the buttons stop event propagation so
 * a reader paging through the passage can reach them without the reader's own
 * shortcuts firing.
 */
export function RecitationPlayer({
  verses,
  className,
  autoLabel = true,
}: {
  verses: RecitationVerse[];
  className?: string;
  autoLabel?: boolean;
}) {
  const t = useTranslations('recitation');
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [reciterId, setReciterId] = useState(DEFAULT_RECITER.id);
  const [speed, setSpeed] = useState<number>(1);
  const [repeat, setRepeat] = useState<RepeatMode>('off');
  const [error, setError] = useState<string | null>(null);
  // Politely rather than assertively: a reader who is not listening for it
  // should not have the next verse read over their screen.
  const [announcement, setAnnouncement] = useState('');

  const current = verses[index];
  const src = current ? ayahAudioUrl(current.passageKey, reciterId) : null;

  useEffect(() => {
    const el = audioRef.current;
    if (el) el.playbackRate = speed;
  }, [speed]);

  // A new source has to be played deliberately; browsers reject it otherwise,
  // and a rejection here would be an unhandled promise rather than a message.
  useEffect(() => {
    const el = audioRef.current;
    if (!el || !src) return;
    setError(null);
    if (playing) {
      el.play().catch(() => {
        setPlaying(false);
        setError(t('blocked'));
      });
    }
    // `t` is stable enough for this and re-running on a locale change would
    // restart audio the reader is in the middle of.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src]);

  const go = useCallback(
    (next: number) => {
      const clamped = Math.max(0, Math.min(verses.length - 1, next));
      setIndex(clamped);
      setAnnouncement(t('nowPlaying', { label: verses[clamped]?.label ?? '' }));
    },
    [verses, t]
  );

  const toggle = useCallback(() => {
    const el = audioRef.current;
    if (!el || !src) return;
    if (playing) {
      el.pause();
      setPlaying(false);
      setAnnouncement(t('paused'));
    } else {
      el.play()
        .then(() => {
          setPlaying(true);
          setError(null);
          setAnnouncement(t('nowPlaying', { label: current?.label ?? '' }));
        })
        .catch(() => {
          setPlaying(false);
          setError(t('blocked'));
        });
    }
  }, [playing, src, current, t]);

  const onEnded = useCallback(() => {
    if (repeat === 'one') {
      const el = audioRef.current;
      if (el) {
        el.currentTime = 0;
        el.play().catch(() => setPlaying(false));
      }
      setAnnouncement(t('repeating', { label: current?.label ?? '' }));
      return;
    }
    if (index < verses.length - 1) {
      go(index + 1);
      return;
    }
    if (repeat === 'all') {
      go(0);
      return;
    }
    setPlaying(false);
    setAnnouncement(t('finished'));
  }, [repeat, index, verses.length, go, current, t]);

  const cycleRepeat = useCallback(() => {
    setRepeat((mode) => (mode === 'off' ? 'one' : mode === 'one' ? 'all' : 'off'));
  }, []);

  if (!verses.length || !src) return null;

  const repeatLabel = repeat === 'off' ? t('repeatOff') : repeat === 'one' ? t('repeatOne') : t('repeatAll');

  return (
    <section
      aria-label={autoLabel ? undefined : t('region')}
      className={className}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <audio
        ref={audioRef}
        src={src}
        preload="none"
        onEnded={onEnded}
        onError={() => setError(t('unavailable'))}
      />

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={toggle}
          aria-label={playing ? t('pause') : t('play')}
          className="btn"
          data-testid="recitation-toggle"
        >
          {playing ? <Pause className="h-4 w-4" aria-hidden /> : <Play className="h-4 w-4" aria-hidden />}
          <span>{playing ? t('pause') : t('play')}</span>
        </button>

        {verses.length > 1 ? (
          <>
            <button
              type="button"
              onClick={() => go(index - 1)}
              disabled={index === 0}
              aria-label={t('previous')}
              className="icon-btn"
            >
              <SkipBack className="h-4 w-4" aria-hidden />
            </button>
            <button
              type="button"
              onClick={() => go(index + 1)}
              disabled={index === verses.length - 1}
              aria-label={t('next')}
              className="icon-btn"
            >
              <SkipForward className="h-4 w-4" aria-hidden />
            </button>
          </>
        ) : null}

        <label className="sr-only" htmlFor="recitation-reciter">
          {t('reciter')}
        </label>
        <select
          id="recitation-reciter"
          value={reciterId}
          onChange={(e) => setReciterId(e.target.value)}
          className="rounded-lg border border-line bg-panel px-2 py-1 text-sm"
        >
          {RECITERS.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
              {r.style ? ` — ${r.style}` : ''}
            </option>
          ))}
        </select>

        <label className="sr-only" htmlFor="recitation-speed">
          {t('speed')}
        </label>
        <select
          id="recitation-speed"
          value={String(speed)}
          onChange={(e) => setSpeed(Number(e.target.value))}
          className="rounded-lg border border-line bg-panel px-2 py-1 text-sm"
        >
          {RECITATION_SPEEDS.map((s) => (
            <option key={s} value={String(s)}>
              {s}×
            </option>
          ))}
        </select>

        <button
          type="button"
          onClick={cycleRepeat}
          aria-label={repeatLabel}
          aria-pressed={repeat !== 'off'}
          className="icon-btn"
        >
          <Repeat className="h-4 w-4" aria-hidden />
          {repeat !== 'off' ? <span className="sr-only">{repeatLabel}</span> : null}
        </button>

        {autoLabel ? (
          <span className="text-sm text-fg-muted">
            <Volume2 className="me-1 inline h-3.5 w-3.5" aria-hidden />
            {current.label}
          </span>
        ) : null}
      </div>

      {error ? (
        <p className="mt-2 text-sm text-red-700 dark:text-red-300">{error}</p>
      ) : null}

      {/*
        The state a sighted reader takes from the button and the underline; a
        screen reader needs it in words. Polite, because it is confirmation
        rather than an alarm.
      */}
      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {announcement}
      </p>
    </section>
  );
}

/** The verses for one Quran passage key, for the single-verse case. */
export function useRecitationVerse(passageKey: string) {
  return useMemo<RecitationVerse[]>(() => {
    const label = verseLabel(passageKey);
    if (!label || !ayahAudioUrl(passageKey, DEFAULT_RECITER.id)) return [];
    return [{ passageKey, label }];
  }, [passageKey]);
}