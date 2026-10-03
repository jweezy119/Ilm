'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Volume2, VolumeX } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { TextId } from '@ilm/shared';
import {
  speechLanguage,
  pickVoice,
  voiceMatchesLanguage,
  splitForSpeech,
  SPEECH_RATES,
  type SpeechVoice,
} from '@/lib/speech';
import { cn } from '@/lib/utils';
import { voiceProblem } from '@/lib/voice-help';
import { createRoboticVoice, roboticVoicePossible, type RoboticVoice } from '@/lib/robotic-voice';

/**
 * The voice list, waiting briefly for it to arrive if it has not.
 *
 * Bounded so a device genuinely without voices is told so promptly rather than
 * leaving the button apparently dead, and so it never outlasts the press.
 */
export async function voicesWhenReady(synth: SpeechSynthesis, timeoutMs = 1500): Promise<SpeechVoice[]> {
  const immediate = synth.getVoices() as SpeechVoice[];
  if (immediate.length > 0) return immediate;

  // Some engines populate without ever firing the event, so the list is read
  // again on the timer as well as on the event.
  return new Promise<SpeechVoice[]>((resolve) => {
    let settled = false;
    const finish = (voices: SpeechVoice[]) => {
      if (settled) return;
      settled = true;
      synth.removeEventListener('voiceschanged', onChanged);
      clearTimeout(timer);
      resolve(voices);
    };
    const onChanged = () => finish(synth.getVoices() as SpeechVoice[]);
    const timer = setTimeout(() => finish(synth.getVoices() as SpeechVoice[]), timeoutMs);
    try {
      synth.addEventListener('voiceschanged', onChanged);
    } catch {
      // An engine without the event still gets polled by the timer.
    }
  });
}

export interface SpeechSegment {
  /** What a screen reader hears before the text, e.g. "3:16". */
  label: string;
  text: string;
}

/**
 * Read the translation aloud with a voice the reader's own device has.
 *
 * Not a recitation, and the label never says it is. A recitation is a human
 * voice; the Quran has one for free and the player beside this uses it. There is
 * no free per-verse Hebrew, Aramaic or Greek recitation, so for those corpora this
 * is what being able to hear a passage means — and pretending otherwise would be
 * the overstatement this library exists to avoid.
 *
 * Nothing plays on its own. A page that starts talking unasked is a page people
 * leave.
 */
export function ReadAloud({
  text,
  segments,
  textId,
  fallbackNote,
  className,
  compact = false,
}: {
  /** A single passage's text. Ignored when `segments` is given. */
  text?: string;
  /** A chapter, read in order with each piece announced. */
  segments?: SpeechSegment[];
  textId: TextId;
  /**
   * Shown when this browser cannot speak at all, where another way to hear the
   * passage exists. The Quran has a human recitation that plays whatever this
   * device can synthesise, and saying the passage cannot be heard would be
   * wrong exactly when someone has just been told they cannot hear anything.
   */
  fallbackNote?: string;
  className?: string;
  compact?: boolean;
}) {
  const t = useTranslations('speech');
  const language = useMemo(() => speechLanguage(textId), [textId]);

  const [speaking, setSpeaking] = useState(false);
  const [rate, setRate] = useState<number>(1);
  const [notice, setNotice] = useState<string | null>(null);
  /**
   * Where to send someone whose browser has no voice, and what to tell them.
   *
   * Held as state rather than read during render because it is only needed once
   * someone has actually pressed the button and been refused.
   */
  const [voiceProblemState, setVoiceProblemState] = useState<{
    message: string;
    helpUrl: string;
    helpLabel: string;
    privateNote: string;
  } | null>(null);
  // Politely: a reader who did not press the button does not need to be told
  // about it while reading.
  const [announcement, setAnnouncement] = useState('');

  const queueIndex = useRef(0);
  const cancelled = useRef(false);

  /**
   * Which engine is speaking, and the fallback once it is loaded.
   *
   * A device voice is always preferred — it is the better voice for free — so the
   * fallback is only built when there is genuinely nothing to use.
   */
  const roboticRef = useRef<RoboticVoice | null>(null);
  const [engine, setEngine] = useState<'device' | 'robotic' | null>(null);
  const [preparing, setPreparing] = useState(false);

  /*
   * Voices are read when the button is pressed, not on mount.
   *
   * `getVoices()` returns an empty list on Chrome until it has finished loading,
   * which it signals with `voiceschanged` a moment later — so a copy taken on
   * mount is usually the empty one, and caching it would make the control
   * permanently deaf on exactly the browsers most likely to have the voices.
   * Reading at press time cannot be stale.
   *
   * There is deliberately no "is this browser supported" flag either: a browser
   * without a speech engine still renders the button, and pressing it explains
   * that it cannot read. Hiding it would leave a reader wondering whether the
   * page is broken.
   */

  // Stop if the component goes away, or the passage changes underneath it.
  useEffect(() => {
    return () => {
      cancelled.current = true;
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) window.speechSynthesis.cancel();
    };
  }, [textId, text]);


  /**
   * The queue, built once per text.
   *
   * One passage is one piece; a chapter is a piece per verse. Announcing the
   * reference before each one is what makes a chapter usable by ear — a voice
   * reading four hundred words with no signpost is a recording, not a reading, and
   * the reader cannot find their place in the text they are following.
   *
   * Held here rather than inside speak() because two engines drain the same
   * queue and only one of them is chosen at the moment of speaking.
   */
  const verseCount = segments?.length ?? (text?.trim() ? 1 : 0);
  const pieces = useMemo<Array<{ label: string; text: string }>>(
    () =>
      segments?.length
        ? segments.flatMap((seg) =>
            splitForSpeech(seg.text).map((chunk) => ({ label: seg.label, text: chunk }))
          )
        : splitForSpeech(text ?? '').map((chunk) => ({ label: '', text: chunk })),
    [segments, text]
  );

  /**
   * Speak the prepared queue one piece at a time, with the engine already chosen.
   *
   * Shared by both engines because the queue, the announcements and the stopping
   * rules are the same; only the thing that makes a noise differs. Written as a
   * callback so it can be called from before its own definition.
   */
  const speakChunks = useCallback(
    async (makeNoise: (text: string) => Promise<void>) => {
      /*
       * Announced up front whatever the shape of the queue. A single passage has
       * no per-verse labels, so without this the live region stayed silent for
       * the whole reading and a screen-reader user heard nothing happen at all.
       *
       * The count is of *verses given*, not of speech chunks. A long passage is
       * split for synthesis into several pieces, and announcing "3 passages" for
       * one verse because it needed three chunks is simply untrue — and the
       * previous wording also read "Reading aloud in English., 3 passages", the
       * sentence's full stop landing mid-clause.
       */
      setAnnouncement(
        verseCount > 1 ? t('readingMany', { language: language.label, count: verseCount }) : t('readingAloud', { language: language.label })
      );

      for (let i = 0; i < pieces.length; i += 1) {
        if (cancelled.current) return;
        const piece = pieces[i];
        // Only where a reference exists to announce; a single passage needs none.
        if (piece.label) setAnnouncement(`${piece.label}: ${t('readingNow')}`);
        try {
          await makeNoise(piece.text);
        } catch {
          if (!cancelled.current) {
            setSpeaking(false);
            setNotice(t('failed'));
            setAnnouncement(t('failed'));
          }
          return;
        }
      }
      if (cancelled.current) return;
      setSpeaking(false);
      setAnnouncement(t('finishedReading'));
    },
    [pieces, verseCount, language.label, t]
  );

  const stop = useCallback(() => {
    cancelled.current = true;
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) window.speechSynthesis.cancel();
    setSpeaking(false);
  }, []);

  const speak = useCallback(async () => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      setNotice(t('unsupported'));
      setAnnouncement(t('unsupported'));
      return;
    }

    const synth = window.speechSynthesis;
    synth.cancel();
    cancelled.current = false;

    /*
     * Wait for the voice list before concluding there is none.
     *
     * `getVoices()` returns an empty array until the browser has finished
     * loading the system's voice list, and signals it with `voiceschanged`
     * shortly afterwards — Chrome does exactly this on a cold page, and Firefox
     * does it on some platforms. Reading the list once at press time and calling
     * an empty one "no speech voice installed" therefore told a reader with
     * perfectly good voices that they had none, because they pressed within the
     * second the page opened. That is the whole feature refusing to work for
     * someone who could hear it.
     *
     * So: if the list is empty, wait for the event, briefly. Only after it has
     * stayed empty is it really a device without a voice engine.
     */
    const available = await voicesWhenReady(synth);
    const voice = pickVoice(available, language.tag);

    if (available.length === 0) {
      /*
       * Refused, and now say something that can be acted on.
       *
       * "This browser has no speech voice installed" was accurate and useless:
       * the steps differ entirely between Windows, macOS, Android and Linux, and
       * a reader has no way to know which one applies to them. So the message
       * names their platform's own menu, and a private window is mentioned as a
       * thing to try rather than asserted — see voice-help for why it is not
       * detected.
       */
      const problem = voiceProblem({
        userAgent: navigator.userAgent ?? '',
        platformHint: (navigator as { userAgentData?: { platform?: string } }).userAgentData?.platform,
        maxTouchPoints: navigator.maxTouchPoints ?? 0,
      });
      const guidance = {
        message: t(problem.messageKey),
        helpUrl: problem.helpUrl,
        helpLabel: t('voiceHelpLabel'),
        privateNote: t('voicePrivateNote'),
      };
      /*
       * No voice from the operating system. Before telling the reader nothing can
       * be done, try the fallback: eSpeak compiled to WebAssembly, which needs no
       * voice installed and no network beyond its own chunk. It sounds robotic
       * and that is stated plainly, but a reader who cannot hear anything at all
       * has been offered nothing.
       */
      if (roboticVoicePossible()) {
        setPreparing(true);
        setAnnouncement(t('voicePreparing'));
        try {
          const voice = await createRoboticVoice();
          if (cancelled.current) return;
          roboticRef.current = voice;
          setPreparing(false);
          setEngine('robotic');
          setVoiceProblemState(null);
          // No notice here: the engine line below already says which voice is
          // speaking and that it is synthetic. Setting both said the same thing
          // twice, stacked.
          setNotice(null);
          setSpeaking(true);
          void speakChunks((line) => voice.speak(line, { rate }));
          return;
        } catch {
          setPreparing(false);
          // Falls through to the guidance below, which is the honest answer:
          // the fallback exists but did not work here.
          guidance.message = t('voiceFallbackUnavailable');
        }
      }

      setVoiceProblemState(guidance);
      setNotice(t('voiceUnavailable'));
      setAnnouncement(t('voiceUnavailable'));
      setSpeaking(false);
      return;
    }

    setVoiceProblemState(null);
    setEngine('device');
    if (voice && !voiceMatchesLanguage(voice, language.tag)) {
      // Said out loud rather than done quietly: being read in the wrong language
      // is a small problem, being read in the wrong language without being told
      // is a rude one.
      setNotice(t('wrongLanguage', { language: voice.lang }));
    } else {
      setNotice(null);
    }

    if (pieces.length === 0) {
      setNotice(t('nothingToRead'));
      return;
    }

    queueIndex.current = 0;
    setSpeaking(true);
    setAnnouncement(
      t('readingAloud', { language: language.label }) + (pieces.length > 1 ? ` ${pieces.length} ${t('passages')}` : '')
    );

    const next = () => {
      if (cancelled.current) return;
      if (queueIndex.current >= pieces.length) {
        setSpeaking(false);
        setAnnouncement(t('finishedReading'));
        return;
      }

      const piece = pieces[queueIndex.current];
      const utterance = new SpeechSynthesisUtterance(piece.text);
      utterance.lang = language.tag;
      utterance.rate = rate;

      if (piece.label) setAnnouncement(`${piece.label}: ${t('readingNow')}`);

      /*
       * Assigning the voice is guarded, and that is not paranoia.
       *
       * The `voice` setter validates its argument, and the list can change
       * between the moment it was read and the moment it is used — voices are
       * installed and removed while the page is open. A rejected assignment
       * throws out of this function, which would skip `synth.speak` entirely and
       * leave the button showing "stop" with silence behind it: the one state
       * that looks exactly like a broken page. So a bad voice costs the voice
       * and nothing else, and the browser picks for itself.
       */
      if (voice) {
        try {
          utterance.voice = voice as unknown as SpeechSynthesisVoice;
        } catch {
          // Deliberately empty: no voice is better than no sound.
        }
      }

      utterance.onend = () => {
        queueIndex.current += 1;
        next();
      };
      utterance.onerror = () => {
        setSpeaking(false);
        setNotice(t('failed'));
        setAnnouncement(t('failed'));
      };

      try {
        synth.speak(utterance);
      } catch {
        // Some engines refuse synchronously rather than firing onerror.
        setSpeaking(false);
        setNotice(t('failed'));
        setAnnouncement(t('failed'));
      }
    };

    next();
  }, [language, rate, pieces, speakChunks, t]);

  return (
    <div className={cn('inline-flex flex-col gap-1', className)} onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        onClick={speaking ? stop : () => void speak()}
        aria-pressed={speaking}
        className={cn('btn btn-secondary', compact && 'px-2.5 py-1 text-xs')}
        data-testid="read-aloud"
      >
        {speaking ? <VolumeX className="h-4 w-4" aria-hidden /> : <Volume2 className="h-4 w-4" aria-hidden />}
        {speaking ? t('stop') : t('readAloud')}
      </button>

      {/*
        Which voice is speaking, and the fact that a synthetic one is involved at
        all. Both states existed and neither was shown: the engine choice and the
        wait for the fallback to load were tracked but invisible, so a reader who
        pressed play during an 1.8 MB download had no idea anything was happening.
      */}
      {preparing ? (
        <p className="text-[11px] text-fg-muted" role="status">
          {t('voicePreparing')}
        </p>
      ) : engine === 'robotic' ? (
        <p className="text-[11px] text-fg-muted">{t('engineRobotic')}</p>
      ) : engine === 'device' ? (
        <p className="text-[11px] text-fg-faint">{t('engineDevice')}</p>
      ) : null}

      {/*
        Speed, because a reading pace that is wrong for the reader makes the
        feature useless rather than merely irritating. Placed under the button
        rather than in it, so the label stays one word.
      */}
      <label className="inline-flex items-center gap-1.5 text-[11px] text-fg-muted">
        <span className="sr-only">{t('rate')}</span>
        <select
          value={String(rate)}
          onChange={(e) => setRate(Number(e.target.value))}
          className="rounded-lg border border-line bg-panel px-1.5 py-0.5 text-[11px]"
        >
          {SPEECH_RATES.map((r) => (
            <option key={r} value={String(r)}>
              {r}×
            </option>
          ))}
        </select>
      </label>

      {notice ? <p className="text-[11px] text-fg-muted">{notice}</p> : null}

      {/*
        The steps, a link to the full instructions, and — where one exists — a
        way to hear the passage anyway. On a Quran passage the recitation above is
        a recording that plays regardless of what this browser can synthesise, so
        "you cannot read anything aloud" would be true and misleading at once.
      */}
      {voiceProblemState ? (
        <div className="mt-1 max-w-sm rounded-lg border border-line bg-panel/60 p-2.5 text-[11px] leading-relaxed text-fg-muted">
          <p>{voiceProblemState.message}</p>
          {fallbackNote ? <p className="mt-1.5 text-fg">{fallbackNote}</p> : null}
          <p className="mt-1.5">{voiceProblemState.privateNote}</p>
          <a
            href={voiceProblemState.helpUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="mt-1.5 inline-block font-medium text-accent underline underline-offset-2"
          >
            {voiceProblemState.helpLabel}
          </a>
        </div>
      ) : null}

      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {announcement}
      </p>
    </div>
  );
}
