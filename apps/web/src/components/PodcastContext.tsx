'use client';

import React, { createContext, useContext, useState, useCallback } from 'react';
import type { TextId } from '@ilm/shared';
import type { SpeechSegment } from './PodcastPlayer';

interface PodcastContextType {
  segments: SpeechSegment[];
  textId: TextId | null;
  playQueue: (segments: SpeechSegment[], textId: TextId, startIndex?: number) => void;
  clearQueue: () => void;
  // If we want to auto-advance chapters globally, we need a way to pass the next chapter URL
  nextChapterUrl: string | null;
  prevChapterUrl: string | null;
  setNavigationUrls: (next: string | null, prev: string | null) => void;
}

const PodcastContext = createContext<PodcastContextType | null>(null);

export function PodcastProvider({ children }: { children: React.ReactNode }) {
  const [segments, setSegments] = useState<SpeechSegment[]>([]);
  const [textId, setTextId] = useState<TextId | null>(null);
  const [nextChapterUrl, setNextChapterUrl] = useState<string | null>(null);
  const [prevChapterUrl, setPrevChapterUrl] = useState<string | null>(null);

  const playQueue = useCallback((newSegments: SpeechSegment[], newTextId: TextId) => {
    setSegments(newSegments);
    setTextId(newTextId);
  }, []);

  const clearQueue = useCallback(() => {
    setSegments([]);
    setTextId(null);
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
        segments,
        textId,
        playQueue,
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
