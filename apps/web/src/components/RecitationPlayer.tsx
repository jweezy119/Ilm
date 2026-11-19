'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pause, Play, SkipBack, SkipForward, Repeat, Volume2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { RECITERS, DEFAULT_RECITER, RECITATION_SPEEDS, ayahAudioUrl, verseLabel } from '@/lib/reciters';
import { useEnglishVoice, recordedFor } from '@/lib/english-voice';
import { useWakeLock } from '@/lib/useWakeLock';
import { usePauseOnHidden } from '@/lib/usePauseOnHidden';

/**
 * The English option in the voice selector.
 *
 * Not a reciter: there is no recording, and calling it one would blur the line
 * the rest of this library is careful to keep. It is a mode of the same player,
 * because a reader choosing between "al-ʿAfasy" and "English" is choosing how
 * to hear the same verse, and two separate controls would make them assemble
 * the sequence themselves.
 */
export const ENGLISH_VOICE_ID = 'english';

export interface RecitationVerse {
  passageKey: string;
  /** Shown to a screen reader and in the now-playing line, e.g. "2:255". */
  label: string;
  /**
   * The translation, read aloud after the Arabic — or instead of it, which is
   * the whole chapter for every corpus but the Quran.
   *
   * Optional, and the reason this is one player rather than two. A reader who
   * cannot read Arabic is played a verse and then told what it means; offering
   * them a recitation button and a separate read-aloud button, in either order,
   * makes assembling that sequence their work — which is the whole thing being
   * done for them.
   */
  translation?: string;
}

type RepeatMode = 'off' | 'one' | 'all';

/**
 * Verse-by-verse audio for one passage.
 *
 * Two ways to hear it, and the selector offers both where both exist. The Quran
 * has a human recitation, one MP3 per ayah, so the verse being played is known
 * exactly: no timings to fetch, no drift, nothing to keep in step with. The
 * tradeoff is a request per verse, which is why preload is "none" and a verse is
 * only fetched once the reader asks for it.
 *
 * Every other corpus has no recording at all, so it is read in English — by a
 * recording where one has been generated, and by the reader's own device voice
 * otherwise. That is not a second-best fallback: it is the only thing that makes
 * the Torah, the Talmud and the Testaments hearable, and the player says which
 * voice it used rather than letting a synthetic one pass for a recitation.
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
  const s = useTranslations('speech');
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  useWakeLock(playing);
  const [reciterId, setReciterId] = useState(DEFAULT_RECITER.id);
  const [speed, setSpeed] = useState<number>(1);
  const [repeat, setRepeat] = useState<RepeatMode>('off');
  const [error, setError] = useState<string | null>(null);
  // Politely rather than assertively: a reader who is not listening for it
  // should not have the next verse read over their screen.
  const [announcement, setAnnouncement] = useState('');

  /**
   * Which half is sounding: the recording, or the translation being read after
   * it — or, in English mode, the translation instead of it.
   */
  const [phase, setPhase] = useState<'arabic' | 'english' | null>(null);
  const [englishNotice, setEnglishNotice] = useState<string | null>(null);
  const stopped = useRef(false);
  /**
   * The English half: a recording where one exists, the reader's own voice
   * otherwise. One hook for both, because the reader should not be able to tell
   * which they got by anything except being told.
   */
  const english = useEnglishVoice();

  // Switching tabs must not leave a chapter reading to itself. The same stop
  // path as the pause button, so a hidden tab and a pressed pause agree.
  const pauseOnHidden = useCallback(() => {
    if (!playing) return;
    stopped.current = true;
    audioRef.current?.pause();
    english.stop();
    setPlaying(false);
    setPhase(null);
  }, [playing, english]);
  usePauseOnHidden(pauseOnHidden);
  const [englishSource, setEnglishSource] = useState<'recorded' | 'device' | 'none'>('none');

  const current = verses[index];

  /**
   * Whether this passage has a human recitation at all.
   *
   * The Quran has one; nothing else does. A corpus with no Arabic audio is read
   * in English rather than offered a selector whose every option is silent.
   */
  const hasArabic = useMemo(
    () => verses.some((verse) => ayahAudioUrl(verse.passageKey, DEFAULT_RECITER.id) !== null),
    [verses]
  );
  const englishMode = reciterId === ENGLISH_VOICE_ID || !hasArabic;
  const src = !englishMode && current ? ayahAudioUrl(current.passageKey, reciterId) : null;

  const voices: string[] = hasArabic
    ? [...RECITERS.map((reciter) => reciter.id), ENGLISH_VOICE_ID]
    : [ENGLISH_VOICE_ID];

  useEffect(() => {
    const el = audioRef.current;
    if (el) el.playbackRate = speed;
  }, [speed]);

  /*
   * Stop the speech when the component goes away, or when the passage changes.
   *
   * There was no cleanup here at all, so navigating away mid-verse left the
   * translation still being read on a page the reader had left.
   *
   * Only the engine is stopped. The audio element is removed with the component
   * and the browser stops it by itself; reaching into a ref during cleanup is
   * both unnecessary and the thing the hooks lint warns about, because the ref
   * may already have been cleared.
   */
  useEffect(() => {
    return () => {
      stopped.current = true;
      english.stop();
    };
    // `english` is stable apart from its stop handler, which is a useCallback
    // with no dependencies, so this fires when the passage changes and on unmount.
  }, [verses, english]);

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
      // Skipping while the English is speaking would otherwise leave the two
      // halves talking over each other.
      english.stop();
      setPhase(null);
      const clamped = Math.max(0, Math.min(verses.length - 1, next));
      setIndex(clamped);
      setAnnouncement(t('nowPlaying', { label: verses[clamped]?.label ?? '' }));
    },
    [verses, t, english]
  );

  /**
   * Carry on after verse `from` has been heard.
   *
   * Shared by both modes, because what follows a verse — repeat it, move on, or
   * stop — does not depend on how it was played.
   */
  const proceed = useCallback(
    (from: number) => {
      setPhase(null);

      if (repeat === 'one') {
        if (englishMode) {
          void speakOne(from);
          return;
        }
        const el = audioRef.current;
        if (el) {
          el.currentTime = 0;
          el.play().catch(() => setPlaying(false));
        }
        setAnnouncement(t('repeating', { label: verses[from]?.label ?? '' }));
        return;
      }
      if (from < verses.length - 1) {
        go(from + 1);
        return;
      }
      if (repeat === 'all') {
        go(0);
        return;
      }
      setPlaying(false);
      setAnnouncement(t('finished'));
    },
    // speakOne is deliberately omitted: it is recreated when the mode or the
    // speed changes, and re-running proceed on those would only matter if a
    // repeat were in flight at that exact moment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [repeat, englishMode, verses.length, go, t]
  );

  /**
   * Speak one verse in the current mode, and report whether anything was spoken.
   *
   * In Arabic mode this plays the recording and then reads the translation after
   * it — the handoff is the feature, because a reader who cannot read Arabic is
   * the one this is for and making them assemble the sequence would be the work.
   * In English mode the translation is the whole of it.
   */
  const speakOne = useCallback(
    async (from: number): Promise<boolean> => {
      const verse = verses[from];
      if (!verse) return false;

      if (englishMode) {
        if (!verse.translation?.trim()) return false;
        setPhase('english');
        setEnglishNotice(null);
        setAnnouncement(`${verse.label}: ${s('phaseEnglish')}`);
        await english.speak({
          audioUrl: recordedFor(verse.passageKey),
          text: verse.translation,
          rate: speed,
          onSource: setEnglishSource,
          onError: () => setEnglishNotice(s('englishFailed')),
        });
        return true;
      }

      const el = audioRef.current;
      if (!el || !ayahAudioUrl(verse.passageKey, reciterId)) return false;

      setPhase('arabic');
      setAnnouncement(t('nowPlaying', { label: verse.label }));
      try {
        el.currentTime = 0;
        await el.play();
      } catch {
        setError(t('blocked'));
        return false;
      }

      /*
       * The translation follows the recording with no second press. A recording
       * that exists for this passage is played if there is one; otherwise the
       * device voice reads it. Either way the verse is explained, and which
       * voice did it is reported rather than assumed.
       */
      if (verse.translation?.trim()) {
        const recorded = recordedFor(verse.passageKey);
        if (recorded) setEnglishNotice(null);
        setPhase('english');
        setAnnouncement(`${verse.label}: ${s('phaseEnglish')}`);
        await english.speak({
          audioUrl: recorded,
          text: verse.translation,
          rate: speed,
          onSource: setEnglishSource,
          onError: () => setEnglishNotice(s('englishFailed')),
        });
      }
      return true;
    },
    [verses, englishMode, reciterId, speed, s, t, english]
  );

  const toggle = useCallback(async () => {
    if (playing) {
      stopped.current = true;
      audioRef.current?.pause();
      english.stop();
      setPlaying(false);
      setPhase(null);
      setAnnouncement(t('paused'));
      return;
    }

    if (englishMode) {
      const verse = verses[index];
      if (!verse?.translation?.trim()) {
        setEnglishNotice(s('nothingToRead'));
        return;
      }
      setError(null);
      setEnglishNotice(null);
      stopped.current = false;
      setPlaying(true);
      const spoke = await speakOne(index);
      if (stopped.current) return;
      if (!spoke) {
        setPlaying(false);
        setEnglishNotice(s('englishFailed'));
        return;
      }
      proceed(index);
      return;
    }

    const el = audioRef.current;
    if (!el || !src) return;

    setError(null);
    stopped.current = false;
    setPlaying(true);
    const spoke = await speakOne(index);
    if (stopped.current) return;
    /*
     * A translation that could not be spoken is not a reason to stop. The
     * recording is the passage; the explanation is a courtesy, and skipping the
     * courtesy keeps the reader inside the passage they asked for.
     */
    if (!spoke && verses[index]?.translation) {
      setEnglishNotice(s('englishFailed'));
    }
    proceed(index);
  }, [playing, englishMode, verses, index, src, speakOne, proceed, s, t, english]);

  const cycleRepeat = useCallback(() => {
    setRepeat((mode) => (mode === 'off' ? 'one' : mode === 'one' ? 'all' : 'off'));
  }, []);

  if (!verses.length) return null;

  const repeatLabel = repeat === 'off' ? t('repeatOff') : repeat === 'one' ? t('repeatOne') : t('repeatAll');
  const phaseLabel = phase === 'english' ? s('phaseEnglish') : phase === 'arabic' ? s('phaseArabic') : null;
  // Only worth showing once something has actually been read, and only for the
  // recorded form — a device voice needs no explanation.
  const englishNote = phase !== 'english' && englishSource === 'recorded' ? s('englishRecorded') : null;
  const hasTranslation = verses.some((v) => Boolean(v.translation?.trim()));

  return (
    <section
      aria-label={autoLabel ? undefined : t('region')}
      className={className}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      {!englishMode ? (
        <audio
          ref={audioRef}
          src={src ?? undefined}
          preload="none"
          onEnded={() => proceed(index)}
          onError={() => setError(t('unavailable'))}
        />
      ) : null}

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
          {voices.map((id) => (
            <option key={id} value={id}>
              {id === ENGLISH_VOICE_ID
                ? t('voiceEnglish')
                : (() => {
                    const reciter = RECITERS.find((r) => r.id === id);
                    return reciter ? `${reciter.name}${reciter.style ? ` — ${reciter.style}` : ''}` : id;
                  })()}
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
            {phaseLabel ? <span className="ms-1.5 text-xs">{phaseLabel}</span> : null}
          </span>
        ) : null}
      </div>

      {error ? (
        <p className="mt-2 text-sm text-red-700 dark:text-red-300">{error}</p>
      ) : null}

      {englishNotice ? (
        <p className="mt-1 text-[11px] text-fg-muted">{englishNotice}</p>
      ) : null}

      {/* Says which voice read the translation, because for a while both are in
          play depending on whether the passage has been generated yet, and a
          reader should not have to guess. */}
      {englishNote ? <p className="mt-1 text-[11px] text-fg-faint">{englishNote}</p> : null}

      {/* Only worth saying where a translation is actually attached, or the
          explanation appears on passages that never had one. */}
      {/* Only where there is an Arabic recording to be played first. On an
          English-mode corpus that sentence would promise a recitation that
          is not there. */}
      {hasTranslation && !englishMode && !phase && !englishNotice ? (
        <p className="mt-1 text-[11px] text-fg-faint">{s('sequenceNote')}</p>
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

/**
 * The verses for one passage key, for the single-verse case.
 *
 * Deliberately not gated on there being a recording: the English option reads
 * any passage, so a Torah or Testament verse gets a player too. Callers attach
 * the translation, which is what the English half speaks.
 */
export function useRecitationVerse(passageKey: string) {
  return useMemo<RecitationVerse[]>(() => {
    const label = verseLabel(passageKey);
    if (!label) return [];
    return [{ passageKey, label }];
  }, [passageKey]);
}
