'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ListVideo,
  Pause,
  Play,
  Repeat,
  Repeat1,
  RotateCcw,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { TextId } from '@ilm/shared';
import { speechLanguage, splitForSpeech } from '@/lib/speech';
import { RECITERS, DEFAULT_RECITER, ayahAudioUrl } from '@/lib/reciters';
import { cn, getTextLabel } from '@/lib/utils';
import { createSpeechEngine, type SpeechEngine } from '@/lib/speech-engine';
import type { SpeechSegment } from './PodcastContext';

export type { SpeechSegment };

const PLAYER_SPEEDS = [0.75, 1, 1.25, 1.5, 1.75, 2] as const;
const ENGLISH_VOICE_ID = 'english';
type LoopMode = 'off' | 'chapter' | 'verse';

const PREFS_KEY = 'ilm.mediaPlayer.prefs.v1';

interface PlayerPrefs {
  volume: number;
  muted: boolean;
  rate: number;
  loopMode: LoopMode;
  autoPlayNext: boolean;
  reciterId: string;
  includeEnglish: boolean;
}

const DEFAULT_PREFS: PlayerPrefs = {
  volume: 1,
  muted: false,
  rate: 1,
  loopMode: 'off',
  autoPlayNext: true,
  reciterId: DEFAULT_RECITER.id,
  includeEnglish: true,
};

function loadPrefs(): PlayerPrefs {
  if (typeof window === 'undefined') return DEFAULT_PREFS;
  try {
    const raw = window.localStorage.getItem(PREFS_KEY);
    if (!raw) return DEFAULT_PREFS;
    const parsed = JSON.parse(raw) as Partial<PlayerPrefs>;
    return {
      volume: typeof parsed.volume === 'number' && parsed.volume >= 0 && parsed.volume <= 1 ? parsed.volume : 1,
      muted: Boolean(parsed.muted),
      rate: typeof parsed.rate === 'number' && parsed.rate >= 0.5 && parsed.rate <= 2.5 ? parsed.rate : 1,
      loopMode: parsed.loopMode === 'verse' || parsed.loopMode === 'chapter' ? parsed.loopMode : 'off',
      autoPlayNext: typeof parsed.autoPlayNext === 'boolean' ? parsed.autoPlayNext : true,
      reciterId: typeof parsed.reciterId === 'string' && parsed.reciterId ? parsed.reciterId : DEFAULT_RECITER.id,
      includeEnglish: typeof parsed.includeEnglish === 'boolean' ? parsed.includeEnglish : true,
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

function savePrefs(prefs: PlayerPrefs): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // Storage quota or private mode; non-fatal.
  }
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const total = Math.floor(seconds);
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
}

export function PodcastPlayer({
  queueId,
  title,
  segments,
  textId,
  startIndex = 0,
  playToken = 0,
  togglePlaySignal = 0,
  className,
  onNextChapter,
  onPrevChapter,
  onStateChange,
  onClose,
  hasNext,
  hasPrev,
}: {
  queueId: string;
  title?: string;
  segments: SpeechSegment[];
  textId: TextId;
  startIndex?: number;
  playToken?: number;
  togglePlaySignal?: number;
  className?: string;
  onNextChapter?: () => void;
  onPrevChapter?: () => void;
  onStateChange: (activeIndex: number, isPlaying: boolean) => void;
  onClose: () => void;
  hasNext?: boolean;
  hasPrev?: boolean;
}) {
  const t = useTranslations('speech');
  const r = useTranslations('recitation');
  const language = useMemo(() => speechLanguage(textId), [textId]);

  const initialPrefs = useMemo(() => loadPrefs(), []);
  const [playing, setPlaying] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(startIndex);
  const [phase, setPhase] = useState<'arabic' | 'english' | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [minimized, setMinimized] = useState(false);
  const [trackTime, setTrackTime] = useState<{ current: number; duration: number }>({ current: 0, duration: 0 });

  const [rate, setRate] = useState<number>(initialPrefs.rate);
  const [volume, setVolume] = useState<number>(initialPrefs.volume);
  const [muted, setMuted] = useState<boolean>(initialPrefs.muted);
  const [loopMode, setLoopMode] = useState<LoopMode>(initialPrefs.loopMode);
  const [autoPlayNext, setAutoPlayNext] = useState<boolean>(initialPrefs.autoPlayNext);
  const [reciterId, setReciterId] = useState<string>(initialPrefs.reciterId);
  const [includeEnglish, setIncludeEnglish] = useState<boolean>(initialPrefs.includeEnglish);

  const hasArabic = useMemo(
    () => segments.some((seg) => seg.passageKey && ayahAudioUrl(seg.passageKey, DEFAULT_RECITER.id) !== null),
    [segments]
  );
  const englishOnlyMode = !hasArabic || reciterId === ENGLISH_VOICE_ID;

  // Refs for reading fresh control values inside the long-lived playback loop
  // without restarting playback when the reader toggles loop/auto-play/volume/speed.
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const engineRef = useRef<SpeechEngine | null>(null);
  const sessionRef = useRef(0);
  const stoppedRef = useRef(false);
  const abortArabicRef = useRef<(() => void) | null>(null);
  const autoContinueChapterRef = useRef(false);

  const segmentsRef = useRef(segments);
  const currentIndexRef = useRef(currentIndex);
  const playingRef = useRef(playing);
  const rateRef = useRef(rate);
  const volumeRef = useRef(muted ? 0 : volume);
  const loopModeRef = useRef(loopMode);
  const autoPlayNextRef = useRef(autoPlayNext);
  const reciterIdRef = useRef(reciterId);
  const includeEnglishRef = useRef(includeEnglish);
  const englishOnlyRef = useRef(englishOnlyMode);
  const hasNextRef = useRef(Boolean(hasNext));
  const onNextChapterRef = useRef(onNextChapter);

  segmentsRef.current = segments;
  currentIndexRef.current = currentIndex;
  playingRef.current = playing;
  rateRef.current = rate;
  volumeRef.current = muted ? 0 : volume;
  loopModeRef.current = loopMode;
  autoPlayNextRef.current = autoPlayNext;
  reciterIdRef.current = reciterId;
  includeEnglishRef.current = includeEnglish;
  englishOnlyRef.current = englishOnlyMode;
  hasNextRef.current = Boolean(hasNext);
  onNextChapterRef.current = onNextChapter;

  // Persist user preferences.
  useEffect(() => {
    savePrefs({ volume, muted, rate, loopMode, autoPlayNext, reciterId, includeEnglish });
  }, [volume, muted, rate, loopMode, autoPlayNext, reciterId, includeEnglish]);

  // Apply live volume & speed updates to whichever audio element or TTS engine is active.
  useEffect(() => {
    const effectiveVolume = muted ? 0 : volume;
    if (audioRef.current) audioRef.current.volume = effectiveVolume;
    engineRef.current?.setVolume?.(effectiveVolume);
  }, [volume, muted]);

  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = rate;
    engineRef.current?.setRate?.(rate);
  }, [rate]);

  // Report live state back to PodcastContext so /read highlights the active verse.
  useEffect(() => {
    onStateChange(currentIndex, playing);
  }, [currentIndex, playing, onStateChange]);

  const stopPlayback = useCallback((clearAutoContinue = true) => {
    sessionRef.current += 1;
    stoppedRef.current = true;
    if (clearAutoContinue) autoContinueChapterRef.current = false;
    abortArabicRef.current?.();
    abortArabicRef.current = null;
    if (audioRef.current) {
      audioRef.current.pause();
    }
    engineRef.current?.stop();
    setPlaying(false);
    setPhase(null);
  }, []);

  // Only stop on true unmount (closing the player), NOT on tab switch — background
  // tab playback is intentionally preserved.
  useEffect(() => {
    return () => {
      stopPlayback(true);
    };
  }, [stopPlayback]);

  const waitForAudioEnd = useCallback(
    (el: HTMLAudioElement, mySession: number): Promise<'ended' | 'stopped' | 'error'> => {
      return new Promise((resolve) => {
        let settled = false;
        const cleanup = () => {
          el.removeEventListener('ended', onEnded);
          el.removeEventListener('error', onErr);
          el.removeEventListener('timeupdate', onTime);
          el.removeEventListener('loadedmetadata', onTime);
          if (abortArabicRef.current === onAbort) abortArabicRef.current = null;
        };
        const done = (outcome: 'ended' | 'stopped' | 'error') => {
          if (settled) return;
          settled = true;
          cleanup();
          resolve(outcome);
        };
        const onEnded = () => done('ended');
        const onErr = () => done('error');
        const onAbort = () => done('stopped');
        const onTime = () => {
          if (sessionRef.current !== mySession) return;
          setTrackTime({
            current: el.currentTime || 0,
            duration: Number.isFinite(el.duration) ? el.duration : 0,
          });
        };

        abortArabicRef.current = onAbort;
        el.addEventListener('ended', onEnded);
        el.addEventListener('error', onErr);
        el.addEventListener('timeupdate', onTime);
        el.addEventListener('loadedmetadata', onTime);

        if (stoppedRef.current || sessionRef.current !== mySession) {
          done('stopped');
        }
      });
    },
    []
  );

  const speakEnglishVerse = useCallback(
    async (text: string, mySession: number): Promise<boolean> => {
      const pieces = splitForSpeech(text, 180).map((chunk) => ({ text: chunk }));
      if (pieces.length === 0) return true;

      if (!engineRef.current) {
        engineRef.current = await createSpeechEngine(language.tag);
      }
      if (stoppedRef.current || sessionRef.current !== mySession) return false;

      let failed = false;
      await engineRef.current.speakQueue(pieces, {
        rate: rateRef.current,
        volume: volumeRef.current,
        onProgress: (cur, dur) => {
          if (sessionRef.current === mySession) {
            setTrackTime({ current: cur, duration: dur });
          }
        },
        onError: () => {
          failed = true;
        },
      });
      return !failed && !stoppedRef.current && sessionRef.current === mySession;
    },
    [language.tag]
  );

  const playFromIndex = useCallback(
    async (startAt: number) => {
      if (typeof window === 'undefined') {
        setNotice(t('unsupported'));
        return;
      }
      const list = segmentsRef.current;
      if (list.length === 0) return;

      stopPlayback(true);
      const mySession = sessionRef.current;
      stoppedRef.current = false;
      setNotice(null);
      setPlaying(true);

      let cursor = Math.max(0, Math.min(list.length - 1, startAt));

      while (!stoppedRef.current && sessionRef.current === mySession) {
        const activeList = segmentsRef.current;
        const verse = activeList[cursor];
        if (!verse) break;

        setCurrentIndex(cursor);
        currentIndexRef.current = cursor;
        setTrackTime({ current: 0, duration: 0 });

        const arabicUrl =
          !englishOnlyRef.current && verse.passageKey
            ? ayahAudioUrl(verse.passageKey, reciterIdRef.current)
            : null;

        // 1. Arabic recitation (Quran reciter mode)
        if (arabicUrl) {
          const el = audioRef.current;
          if (el) {
            setPhase('arabic');
            try {
              if (el.src !== arabicUrl) el.src = arabicUrl;
              el.playbackRate = rateRef.current;
              el.volume = volumeRef.current;
              el.currentTime = 0;
              const ended = waitForAudioEnd(el, mySession);
              await el.play();
              const outcome = await ended;
              if (outcome === 'stopped' || stoppedRef.current || sessionRef.current !== mySession) {
                return;
              }
              if (outcome === 'error') {
                setNotice(t('arabicFailed'));
              }
            } catch {
              abortArabicRef.current?.();
              if (stoppedRef.current || sessionRef.current !== mySession) return;
              setNotice(t('arabicFailed'));
            }
          }
        }

        if (stoppedRef.current || sessionRef.current !== mySession) return;

        // 2. English meaning (always in English-only mode, or after Arabic when +English is enabled)
        const shouldSpeakEnglish = englishOnlyRef.current || includeEnglishRef.current;
        if (shouldSpeakEnglish && verse.text.trim()) {
          setPhase('english');
          setTrackTime({ current: 0, duration: 0 });
          const ok = await speakEnglishVerse(verse.text, mySession);
          if (stoppedRef.current || sessionRef.current !== mySession) return;
          if (!ok) {
            if (englishOnlyRef.current) {
              setPlaying(false);
              setPhase(null);
              setNotice(t('voiceUnavailable'));
              return;
            }
            setNotice(t('englishFailed'));
          }
        }

        if (stoppedRef.current || sessionRef.current !== mySession) return;

        // 3. Decide next step: Loop Verse → Next Verse → Loop Chapter → Auto-Play Next Chapter → Stop
        if (loopModeRef.current === 'verse') {
          continue;
        }

        if (cursor < activeList.length - 1) {
          cursor += 1;
          continue;
        }

        if (loopModeRef.current === 'chapter') {
          cursor = 0;
          continue;
        }

        if (autoPlayNextRef.current && hasNextRef.current && onNextChapterRef.current) {
          autoContinueChapterRef.current = true;
          setPhase(null);
          onNextChapterRef.current();
          return;
        }

        setPlaying(false);
        setPhase(null);
        return;
      }
    },
    [stopPlayback, waitForAudioEnd, speakEnglishVerse, t]
  );

  const togglePlay = useCallback(() => {
    if (playingRef.current) {
      stopPlayback(true);
    } else {
      void playFromIndex(currentIndexRef.current < segmentsRef.current.length ? currentIndexRef.current : 0);
    }
  }, [stopPlayback, playFromIndex]);

  const restartVerse = useCallback(() => {
    void playFromIndex(currentIndexRef.current);
  }, [playFromIndex]);

  const nextVerse = useCallback(() => {
    const idx = currentIndexRef.current;
    const len = segmentsRef.current.length;
    if (idx < len - 1) {
      if (playingRef.current) {
        void playFromIndex(idx + 1);
      } else {
        setCurrentIndex(idx + 1);
        setTrackTime({ current: 0, duration: 0 });
      }
    } else if (hasNext && onNextChapter) {
      const wasPlaying = playingRef.current;
      stopPlayback(false);
      autoContinueChapterRef.current = wasPlaying;
      onNextChapter();
    }
  }, [playFromIndex, hasNext, onNextChapter, stopPlayback]);

  const prevVerse = useCallback(() => {
    const idx = currentIndexRef.current;
    if (idx > 0) {
      if (playingRef.current) {
        void playFromIndex(idx - 1);
      } else {
        setCurrentIndex(idx - 1);
        setTrackTime({ current: 0, duration: 0 });
      }
    } else if (hasPrev && onPrevChapter) {
      const wasPlaying = playingRef.current;
      stopPlayback(false);
      autoContinueChapterRef.current = wasPlaying;
      onPrevChapter();
    }
  }, [playFromIndex, hasPrev, onPrevChapter, stopPlayback]);

  const goNextChapter = useCallback(() => {
    if (!hasNext || !onNextChapter) return;
    const wasPlaying = playingRef.current;
    stopPlayback(false);
    autoContinueChapterRef.current = wasPlaying;
    onNextChapter();
  }, [hasNext, onNextChapter, stopPlayback]);

  const goPrevChapter = useCallback(() => {
    if (!hasPrev || !onPrevChapter) return;
    const wasPlaying = playingRef.current;
    stopPlayback(false);
    autoContinueChapterRef.current = wasPlaying;
    onPrevChapter();
  }, [hasPrev, onPrevChapter, stopPlayback]);

  const cycleLoop = useCallback(() => {
    setLoopMode((m) => (m === 'off' ? 'chapter' : m === 'chapter' ? 'verse' : 'off'));
  }, []);

  const handleReciterChange = useCallback(
    (nextVoice: string) => {
      setReciterId(nextVoice);
      reciterIdRef.current = nextVoice;
      englishOnlyRef.current = !hasArabic || nextVoice === ENGLISH_VOICE_ID;
      if (playingRef.current) {
        void playFromIndex(currentIndexRef.current);
      }
    },
    [hasArabic, playFromIndex]
  );

  const handleToggleIncludeEnglish = useCallback(() => {
    setIncludeEnglish((prev) => {
      const next = !prev;
      includeEnglishRef.current = next;
      return next;
    });
  }, []);

  // Explicit play/jump trigger from page buttons ("Listen to chapter" or per-verse play).
  const lastTokenRef = useRef<number>(0);
  useEffect(() => {
    if (playToken > 0 && playToken !== lastTokenRef.current && segments.length > 0) {
      lastTokenRef.current = playToken;
      void playFromIndex(startIndex);
    }
  }, [playToken, startIndex, segments.length, playFromIndex]);

  // External Play/Pause toggle from the chapter header button when this chapter is already loaded.
  const lastToggleRef = useRef<number>(togglePlaySignal);
  useEffect(() => {
    if (togglePlaySignal > 0 && togglePlaySignal !== lastToggleRef.current) {
      lastToggleRef.current = togglePlaySignal;
      togglePlay();
    }
  }, [togglePlaySignal, togglePlay]);

  // Chapter switch: keyed strictly by stable `queueId` (never by array reference),
  // so re-renders on the same chapter can never restart or loop verse 0.
  const lastQueueIdRef = useRef<string>(queueId);
  useEffect(() => {
    if (queueId !== lastQueueIdRef.current) {
      lastQueueIdRef.current = queueId;
      setCurrentIndex(0);
      currentIndexRef.current = 0;
      setTrackTime({ current: 0, duration: 0 });
      if (autoContinueChapterRef.current) {
        autoContinueChapterRef.current = false;
        void playFromIndex(0);
      }
    }
  }, [queueId, playFromIndex]);

  // Media Session API: keeps background tab playback integrated with browser
  // media controls, OS media keys, and phone lock screens.
  const activeSegment = segments[currentIndex] ?? segments[0];
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
    const session = navigator.mediaSession;

    const voiceLabel = englishOnlyMode
      ? r('voiceEnglish')
      : RECITERS.find((rec) => rec.id === reciterId)?.name ?? DEFAULT_RECITER.name;

    if (typeof MediaMetadata !== 'undefined') {
      session.metadata = new MediaMetadata({
        title: `${title || getTextLabel(textId)} · ${activeSegment?.label ?? ''}`,
        artist: voiceLabel,
        album: getTextLabel(textId),
      });
    }
    session.playbackState = playing ? 'playing' : 'paused';

    const bind = (action: MediaSessionAction, handler: MediaSessionActionHandler | null) => {
      try {
        session.setActionHandler(action, handler);
      } catch {
        // Not every browser supports every action.
      }
    };

    bind('play', () => {
      if (!playingRef.current) void playFromIndex(currentIndexRef.current);
    });
    bind('pause', () => {
      if (playingRef.current) stopPlayback(true);
    });
    bind('previoustrack', () => prevVerse());
    bind('nexttrack', () => nextVerse());
    bind('stop', () => stopPlayback(true));

    return () => {
      bind('play', null);
      bind('pause', null);
      bind('previoustrack', null);
      bind('nexttrack', null);
      bind('stop', null);
    };
  }, [title, textId, activeSegment?.label, playing, englishOnlyMode, reciterId, r, playFromIndex, stopPlayback, prevVerse, nextVerse]);

  const loopLabel = loopMode === 'off' ? t('loopOff') : loopMode === 'verse' ? t('loopVerse') : t('loopChapter');
  const progressPercent = segments.length > 1 ? (currentIndex / (segments.length - 1)) * 100 : playing ? 100 : 0;
  const voices = hasArabic ? [...RECITERS.map((rec) => rec.id), ENGLISH_VOICE_ID] : [ENGLISH_VOICE_ID];

  return (
    <div className={cn('flex flex-col gap-2.5', className)} onClick={(e) => e.stopPropagation()}>
      {/* Persistent hidden audio element for Quranic Arabic recitation */}
      <audio ref={audioRef} preload="none" />

      {/* Header bar: title, active verse, phase pill, minimize & close */}
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium text-fg">
              {title || getTextLabel(textId)}
            </span>
            {activeSegment?.label ? (
              <span className="shrink-0 rounded bg-accent/10 px-1.5 py-0.5 font-mono text-[11px] font-medium text-accent">
                {activeSegment.label}
              </span>
            ) : null}
            {phase ? (
              <span className="shrink-0 text-[11px] text-fg-muted">
                {phase === 'arabic' ? t('phaseArabic') : t('phaseEnglish')}
              </span>
            ) : null}
          </div>
          {!minimized && activeSegment?.text ? (
            <p className="mt-0.5 truncate text-xs text-fg-muted" dir="ltr">
              {activeSegment.text}
            </p>
          ) : null}
        </div>

        {minimized ? (
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={prevVerse}
              disabled={!hasPrev && currentIndex === 0}
              className="rounded-full p-1.5 text-fg-muted hover:bg-bg hover:text-fg disabled:opacity-40"
              aria-label={t('previous')}
            >
              <SkipBack className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={togglePlay}
              className="flex h-8 w-8 items-center justify-center rounded-full bg-accent text-accent-fg shadow-sm hover:bg-accent-hover"
              aria-label={playing ? t('pause') : t('play')}
              aria-pressed={playing}
            >
              {playing ? <Pause className="h-4 w-4 fill-current" /> : <Play className="h-4 w-4 fill-current ml-0.5" />}
            </button>
            <button
              type="button"
              onClick={nextVerse}
              disabled={!hasNext && currentIndex >= segments.length - 1}
              className="rounded-full p-1.5 text-fg-muted hover:bg-bg hover:text-fg disabled:opacity-40"
              aria-label={t('next')}
            >
              <SkipForward className="h-4 w-4" />
            </button>
          </div>
        ) : null}

        <button
          type="button"
          onClick={() => setMinimized((v) => !v)}
          className="rounded-full p-1.5 text-fg-muted hover:bg-bg hover:text-fg"
          aria-label={minimized ? t('expand') : t('minimize')}
          title={minimized ? t('expand') : t('minimize')}
        >
          {minimized ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </button>

        <button
          type="button"
          onClick={onClose}
          className="rounded-full p-1.5 text-fg-muted hover:bg-bg hover:text-fg"
          aria-label={t('closePlayer')}
          title={t('closePlayer')}
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Slim progress line when minimized */}
      {minimized ? (
        <div className="h-1 w-full overflow-hidden rounded-full bg-line">
          <div className="h-full bg-accent transition-all" style={{ width: `${progressPercent}%` }} />
        </div>
      ) : (
        <>
          {/* Interactive Verse Scrubber + Live Audio Timestamp */}
          <div className="flex items-center gap-2.5 text-[11px] tabular-nums text-fg-muted">
            <span className="shrink-0">
              {currentIndex + 1}/{segments.length}
            </span>
            <input
              type="range"
              min={0}
              max={Math.max(0, segments.length - 1)}
              value={currentIndex}
              disabled={segments.length <= 1}
              onChange={(e) => {
                const target = Number(e.target.value);
                setCurrentIndex(target);
                currentIndexRef.current = target;
                if (playingRef.current) {
                  void playFromIndex(target);
                }
              }}
              aria-label={t('playingNow')}
              className="h-1.5 flex-1 cursor-pointer accent-accent disabled:cursor-default"
            />
            <span className="shrink-0 font-mono">
              {trackTime.duration > 0
                ? `${formatTime(trackTime.current)} / ${formatTime(trackTime.duration)}`
                : activeSegment?.label ?? ''}
            </span>
          </div>

          {/* Primary Transport Bar */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            {/* Left: Loop Mode */}
            <button
              type="button"
              onClick={cycleLoop}
              aria-label={loopLabel}
              aria-pressed={loopMode !== 'off'}
              title={loopLabel}
              className={cn(
                'inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs transition-colors',
                loopMode !== 'off'
                  ? 'bg-accent/15 font-medium text-accent'
                  : 'text-fg-muted hover:bg-bg hover:text-fg'
              )}
            >
              {loopMode === 'verse' ? <Repeat1 className="h-4 w-4" /> : <Repeat className="h-4 w-4" />}
              <span className="hidden sm:inline">{loopLabel}</span>
            </button>

            {/* Center: Chapter Prev, Verse Prev, Restart, Play/Pause, Verse Next, Chapter Next */}
            <div className="flex items-center gap-1.5">
              {hasPrev ? (
                <button
                  type="button"
                  onClick={goPrevChapter}
                  className="rounded-full p-1.5 text-fg-muted hover:bg-bg hover:text-fg"
                  aria-label={t('prevChapter')}
                  title={t('prevChapter')}
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
              ) : null}

              <button
                type="button"
                onClick={prevVerse}
                disabled={!hasPrev && currentIndex === 0}
                className="rounded-full p-2 text-fg-muted hover:bg-bg hover:text-fg disabled:opacity-40"
                aria-label={t('previous')}
                title={t('previous')}
              >
                <SkipBack className="h-4 w-4 fill-current" />
              </button>

              <button
                type="button"
                onClick={restartVerse}
                className="rounded-full p-1.5 text-fg-muted hover:bg-bg hover:text-fg"
                aria-label={t('restartVerse')}
                title={t('restartVerse')}
              >
                <RotateCcw className="h-3.5 w-3.5" />
              </button>

              <button
                type="button"
                onClick={togglePlay}
                className="flex h-10 w-10 items-center justify-center rounded-full bg-accent text-accent-fg shadow-sm transition-colors hover:bg-accent-hover"
                aria-label={playing ? t('pause') : t('play')}
                aria-pressed={playing}
                data-testid="media-player-toggle"
              >
                {playing ? (
                  <Pause className="h-5 w-5 fill-current" />
                ) : (
                  <Play className="h-5 w-5 fill-current ml-0.5" />
                )}
              </button>

              <button
                type="button"
                onClick={nextVerse}
                disabled={!hasNext && currentIndex >= segments.length - 1}
                className="rounded-full p-2 text-fg-muted hover:bg-bg hover:text-fg disabled:opacity-40"
                aria-label={t('next')}
                title={t('next')}
              >
                <SkipForward className="h-4 w-4 fill-current" />
              </button>

              {hasNext ? (
                <button
                  type="button"
                  onClick={goNextChapter}
                  className="rounded-full p-1.5 text-fg-muted hover:bg-bg hover:text-fg"
                  aria-label={t('nextChapter')}
                  title={t('nextChapter')}
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              ) : null}
            </div>

            {/* Right: Auto-Play Next Chapter toggle */}
            <button
              type="button"
              onClick={() => setAutoPlayNext((v) => !v)}
              aria-pressed={autoPlayNext}
              aria-label={t('autoPlay')}
              title={t('autoPlay')}
              className={cn(
                'inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs transition-colors',
                autoPlayNext
                  ? 'bg-accent/15 font-medium text-accent'
                  : 'text-fg-muted hover:bg-bg hover:text-fg'
              )}
            >
              <ListVideo className="h-4 w-4" />
              <span className="hidden sm:inline">{t('autoPlay')}</span>
            </button>
          </div>

          {/* Secondary Audio Controls Row: Voice/Reciter, +English toggle, Speed, Volume */}
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line/70 pt-2 text-xs">
            <div className="flex flex-wrap items-center gap-1.5">
              {voices.length > 1 ? (
                <select
                  value={englishOnlyMode ? ENGLISH_VOICE_ID : reciterId}
                  onChange={(e) => handleReciterChange(e.target.value)}
                  aria-label={r('reciter')}
                  className="rounded-lg border border-line bg-bg px-2 py-1 text-xs text-fg outline-none focus:border-accent"
                >
                  {voices.map((id) => (
                    <option key={id} value={id}>
                      {id === ENGLISH_VOICE_ID
                        ? r('voiceEnglish')
                        : RECITERS.find((rec) => rec.id === id)?.name ?? id}
                    </option>
                  ))}
                </select>
              ) : (
                <span className="text-fg-muted">{r('voiceEnglish')}</span>
              )}

              {hasArabic && !englishOnlyMode ? (
                <button
                  type="button"
                  onClick={handleToggleIncludeEnglish}
                  aria-pressed={includeEnglish}
                  className={cn(
                    'rounded-lg border px-2 py-1 text-xs transition-colors',
                    includeEnglish
                      ? 'border-accent/40 bg-accent/15 font-medium text-accent'
                      : 'border-line bg-bg text-fg-muted hover:text-fg'
                  )}
                >
                  {t('includeEnglish')}
                </button>
              ) : null}
            </div>

            <div className="flex items-center gap-2.5">
              {/* Speed */}
              <label className="inline-flex items-center gap-1 text-fg-muted">
                <span className="sr-only">{t('rate')}</span>
                <select
                  value={String(rate)}
                  onChange={(e) => setRate(Number(e.target.value))}
                  aria-label={t('rate')}
                  className="rounded-lg border border-line bg-bg px-1.5 py-0.5 text-xs text-fg outline-none focus:border-accent"
                >
                  {PLAYER_SPEEDS.map((s) => (
                    <option key={s} value={String(s)}>
                      {s}×
                    </option>
                  ))}
                </select>
              </label>

              {/* Volume / Mute */}
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setMuted((m) => !m)}
                  aria-label={muted ? t('unmute') : t('mute')}
                  title={muted ? t('unmute') : t('mute')}
                  className="rounded p-1 text-fg-muted hover:bg-bg hover:text-fg"
                >
                  {muted || volume === 0 ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
                </button>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={muted ? 0 : volume}
                  onChange={(e) => {
                    const nextVol = Number(e.target.value);
                    setVolume(nextVol);
                    if (nextVol > 0 && muted) setMuted(false);
                  }}
                  aria-label={t('volume')}
                  className="h-1.5 w-16 cursor-pointer accent-accent sm:w-20"
                />
              </div>
            </div>
          </div>

          {notice ? <p className="text-center text-[11px] text-fg-muted">{notice}</p> : null}
        </>
      )}
    </div>
  );
}
