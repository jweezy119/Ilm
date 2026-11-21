'use client';

import React, { createContext, useContext, useState, useCallback, useRef } from 'react';
import type { TextId } from '@ilm/shared';

export interface SpeechSegment {
  /** Optional canonical passage key, enabling Quranic Arabic recitation when present. */
  passageKey?: string;
  label: string;
  text: string;
}

export interface PlayQueueOptions {
  queueId?: string;
  title?: string;
  startIndex?: number;
}

interface PodcastContextType {
  queueId: string | null;
  title: string;
  segments: SpeechSegment[];
  textId: TextId | null;
  startIndex: number;
  /** Incremented whenever the reader explicitly starts or jumps playback. */
  playToken: number;
  /** Incremented when an external page button wants to toggle play/pause on the loaded queue. */
  togglePlaySignal: number;
  /** Current verse index & playing flag reported back by the unified media player. */
  activeIndex: number;
  isPlaying: boolean;
  playQueue: (segments: SpeechSegment[], textId: TextId, options?: PlayQueueOptions | number) => void;
  togglePlayback: () => void;
  reportPlaybackState: (activeIndex: number, isPlaying: boolean) => void;
  /** Update queue when navigating to a DIFFERENT chapter while the media player is open. */
  syncChapter: (
    queueId: string,
    title: string,
    segments: SpeechSegment[],
    textId: TextId,
    next: string | null,
    prev: string | null
  ) => void;
  clearQueue: () => void;
  nextChapterUrl: string | null;
  prevChapterUrl: string | null;
  setNavigationUrls: (next: string | null, prev: string | null) => void;
}

const PodcastContext = createContext<PodcastContextType | null>(null);

export function PodcastProvider({ children }: { children: React.ReactNode }) {
  const [queueId, setQueueId] = useState<string | null>(null);
  const [title, setTitle] = useState<string>('');
  const [segments, setSegments] = useState<SpeechSegment[]>([]);
  const [textId, setTextId] = useState<TextId | null>(null);
  const [startIndex, setStartIndex] = useState(0);
  const [playToken, setPlayToken] = useState(0);
  const [togglePlaySignal, setTogglePlaySignal] = useState(0);
  const [activeIndex, setActiveIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [nextChapterUrl, setNextChapterUrl] = useState<string | null>(null);
  const [prevChapterUrl, setPrevChapterUrl] = useState<string | null>(null);

  const queueIdRef = useRef<string | null>(null);
  queueIdRef.current = queueId;

  const playQueue = useCallback(
    (newSegments: SpeechSegment[], newTextId: TextId, options?: PlayQueueOptions | number) => {
      const normalized: PlayQueueOptions =
        typeof options === 'number' ? { startIndex: options } : (options ?? {});
      const nextId =
        normalized.queueId ??
        `${newTextId}:${newSegments[0]?.passageKey ?? newSegments[0]?.label ?? 'queue'}:${newSegments.length}`;
      const nextStart = Math.max(0, Math.min(Math.max(0, newSegments.length - 1), normalized.startIndex ?? 0));

      queueIdRef.current = nextId;
      setQueueId(nextId);
      setTitle(normalized.title ?? '');
      setSegments(newSegments);
      setTextId(newTextId);
      setStartIndex(nextStart);
      setActiveIndex(nextStart);
      setPlayToken((n) => n + 1);
    },
    []
  );

  const togglePlayback = useCallback(() => {
    setTogglePlaySignal((n) => n + 1);
  }, []);

  const reportPlaybackState = useCallback((nextActiveIndex: number, nextIsPlaying: boolean) => {
    setActiveIndex(nextActiveIndex);
    setIsPlaying(nextIsPlaying);
  }, []);

  // Only swap the active chapter when the queueId actually changes, preventing
  // re-renders on the same chapter from restarting verse 0 in a loop.
  const syncChapter = useCallback(
    (
      nextQueueId: string,
      nextTitle: string,
      newSegments: SpeechSegment[],
      newTextId: TextId,
      next: string | null,
      prev: string | null
    ) => {
      if (!queueIdRef.current) return;
      if (queueIdRef.current === nextQueueId) {
        setNextChapterUrl(next);
        setPrevChapterUrl(prev);
        return;
      }
      queueIdRef.current = nextQueueId;
      setQueueId(nextQueueId);
      setTitle(nextTitle);
      setSegments(newSegments);
      setTextId(newTextId);
      setStartIndex(0);
      setActiveIndex(0);
      setNextChapterUrl(next);
      setPrevChapterUrl(prev);
    },
    []
  );

  const clearQueue = useCallback(() => {
    queueIdRef.current = null;
    setQueueId(null);
    setTitle('');
    setSegments([]);
    setTextId(null);
    setStartIndex(0);
    setActiveIndex(0);
    setIsPlaying(false);
    setNextChapterUrl(null);
    setPrevChapterUrl(null);
  }, []);

  const setNavigationUrls = useCallback((next: string | null, prev: string | null) => {
    setNextChapterUrl(next);
    setPrevChapterUrl(prev);
  }, []);

  return (
    <PodcastContext.Provider
      value={{
        queueId,
        title,
        segments,
        textId,
        startIndex,
        playToken,
        togglePlaySignal,
        activeIndex,
        isPlaying,
        playQueue,
        togglePlayback,
        reportPlaybackState,
        syncChapter,
        clearQueue,
        nextChapterUrl,
        prevChapterUrl,
        setNavigationUrls,
      }}
    >
      {children}
    </PodcastContext.Provider>
  );
}

export function usePodcast() {
  const ctx = useContext(PodcastContext);
  if (!ctx) throw new Error('usePodcast must be used within PodcastProvider');
  return ctx;
}
