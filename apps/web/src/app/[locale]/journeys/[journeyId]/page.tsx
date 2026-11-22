'use client';

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useRouter } from '@/i18n/navigation';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  ArrowLeft,
  ArrowLeftRight,
  ChevronDown,
  ChevronUp,
  Copy,
  GripVertical,
  Loader2,
  Pause,
  PenLine,
  Play,
  Plus,
  QrCode,
  Trash2,
} from 'lucide-react';
import { Page, PageHeader } from '@/components/Shell';
import { JourneyGraphView } from '@/components/JourneyGraphView';
import { JourneyPassageFinder } from '@/components/JourneyPassageFinder';
import { JourneySharePanel } from '@/components/JourneySharePanel';
import { usePodcast, type SpeechSegment } from '@/components/PodcastContext';
import { api, ApiError } from '@/lib/api';
import { MAX_COMPARISON, useComparisonStore, useJourneysStore } from '@/store';
import type { JourneyGraph } from '@ilm/shared';
import { passageReference } from '@/lib/passage-ref';
import { cn, getTextLabel } from '@/lib/utils';

export default function JourneyPage() {
  return (
    <Page wide>
      <Suspense fallback={<Fallback />}>
        <Journey />
      </Suspense>
    </Page>
  );
}

function Fallback() {
  const t = useTranslations('journeys');
  return (
    <p className="flex items-center gap-2 py-8 text-sm text-fg-muted" role="status">
      <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> {t('loading')}
    </p>
  );
}

function Journey() {
  const t = useTranslations('journeys');
  const router = useRouter();
  const params = useParams<{ journeyId: string }>();
  const id = params?.journeyId as string | undefined;

  const setActiveJourney = useJourneysStore((s) => s.setActiveJourney);
  const loadJourneysStore = useJourneysStore((s) => s.load);
  const createJourneyInStore = useJourneysStore((s) => s.create);
  const {
    queueId: activeQueueId,
    activeIndex: activePlayerIndex,
    isPlaying: playerIsPlaying,
    playQueue,
    togglePlayback,
  } = usePodcast();

  const [graph, setGraph] = useState<JourneyGraph | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const [draftNote, setDraftNote] = useState('');
  const [noteFor, setNoteFor] = useState<string | null>(null);
  const [showFinder, setShowFinder] = useState(false);
  const [showShare, setShowShare] = useState(false);
  const [editingMeta, setEditingMeta] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [draftDesc, setDraftDesc] = useState('');
  const [savingMeta, setSavingMeta] = useState(false);
  const [duplicating, setDuplicating] = useState(false);
  const [dragKey, setDragKey] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!id) return;
    api
      .journeyGraph(id)
      .then((d) => {
        setGraph(d.graph);
        setActiveJourney(id);
        if (d.graph.nodes.length === 0) setShowFinder(true);
      })
      .catch((caught) => setError(caught instanceof ApiError ? caught.message : t('loadFailed')));
  }, [id, setActiveJourney, t]);

  useEffect(() => {
    load();
  }, [load]);

  const ordered = useMemo(() => [...(graph?.nodes ?? [])].sort((a, b) => a.position - b.position), [graph]);
  const existingKeys = useMemo(() => new Set(ordered.map((n) => n.passageKey)), [ordered]);

  // Build PodcastPlayer queue from all playable nodes in the reader's custom order.
  const journeyQueueId = id ? `journey:${id}:${ordered.map((n) => n.passageKey).join(',')}` : '';
  const journeySegments = useMemo<SpeechSegment[]>(() => {
    return ordered
      .filter((n) => !n.missing && (n.preview || n.originalText))
      .map((n, idx) => ({
        passageKey: n.passageKey,
        label: `${idx + 1}. ${passageReference(n.passageKey)} (${getTextLabel(n.textId, true)})`,
        text: n.preview || n.originalText,
      }));
  }, [ordered]);

  const isThisJourneyLoaded = Boolean(journeyQueueId && activeQueueId === journeyQueueId);
  const isThisJourneyPlaying = isThisJourneyLoaded && playerIsPlaying;
  const activePlayingKey = isThisJourneyLoaded ? journeySegments[activePlayerIndex]?.passageKey ?? null : null;

  const startJourneyAudio = useCallback(
    (startIdx = 0) => {
      if (!graph || journeySegments.length === 0) return;
      const firstTextId = ordered.find((n) => !n.missing)?.textId ?? 'quran';
      playQueue(journeySegments, firstTextId, {
        queueId: journeyQueueId,
        title: graph.journey.name,
        startIndex: Math.max(0, Math.min(startIdx, journeySegments.length - 1)),
      });
    },
    [graph, journeySegments, journeyQueueId, ordered, playQueue]
  );

  const handleToggleJourneyAudio = useCallback(() => {
    if (isThisJourneyLoaded) {
      togglePlayback();
    } else {
      startJourneyAudio(0);
    }
  }, [isThisJourneyLoaded, togglePlayback, startJourneyAudio]);

  const handlePlayFromNode = useCallback(
    (passageKey: string) => {
      const idx = journeySegments.findIndex((s) => s.passageKey === passageKey);
      if (idx >= 0) startJourneyAudio(idx);
    },
    [journeySegments, startJourneyAudio]
  );

  const handleCompareJourney = useCallback(() => {
    const playable = ordered.filter((n) => !n.missing).slice(0, MAX_COMPARISON);
    if (playable.length < 2) return;
    const store = useComparisonStore.getState();
    store.clear();
    for (const n of playable) store.addKey(n.passageKey);
    router.push('/compare');
  }, [ordered, router]);

  const commitOrder = useCallback(
    async (reordered: string[], announcementText: string) => {
      if (!graph || !id) return;
      const previous = graph;
      setGraph({
        ...graph,
        nodes: reordered.map((key, i) => ({
          ...graph.nodes.find((n) => n.passageKey === key)!,
          position: i,
        })),
      });
      try {
        await api.reorderJourney(id, reordered);
        setAnnouncement(announcementText);
        load();
      } catch (caught) {
        setGraph(previous);
        setError(caught instanceof ApiError ? caught.message : t('reorderFailed'));
      }
    },
    [graph, id, load, t]
  );

  const move = useCallback(
    async (passageKey: string, delta: -1 | 1) => {
      const keys = ordered.map((n) => n.passageKey);
      const from = keys.indexOf(passageKey);
      const to = from + delta;
      if (from < 0 || to < 0 || to >= keys.length) return;
      const reordered = [...keys];
      [reordered[from], reordered[to]] = [reordered[to], reordered[from]];
      await commitOrder(reordered, t('moved', { position: to + 1, of: keys.length }));
    },
    [ordered, commitOrder, t]
  );

  const handleDropOn = useCallback(
    async (targetKey: string) => {
      if (!dragKey || dragKey === targetKey) {
        setDragKey(null);
        return;
      }
      const keys = ordered.map((n) => n.passageKey);
      const from = keys.indexOf(dragKey);
      const to = keys.indexOf(targetKey);
      setDragKey(null);
      if (from < 0 || to < 0) return;
      const reordered = [...keys];
      const [moved] = reordered.splice(from, 1);
      reordered.splice(to, 0, moved);
      await commitOrder(reordered, t('moved', { position: to + 1, of: keys.length }));
    },
    [dragKey, ordered, commitOrder, t]
  );

  const handleAddKey = useCallback(
    async (passageKey: string) => {
      if (!id) return;
      await api.addJourneyNode(id, passageKey);
      setAnnouncement(t('addedPassage', { reference: passageReference(passageKey) }));
      load();
      void loadJourneysStore(true);
    },
    [id, load, loadJourneysStore, t]
  );

  const handleAddBatch = useCallback(
    async (passageKeys: string[]) => {
      if (!id || passageKeys.length === 0) return;
      const res = await api.addJourneyNodesBatch(id, passageKeys);
      setAnnouncement(t('addedBatch', { count: res.added.length }));
      load();
      void loadJourneysStore(true);
    },
    [id, load, loadJourneysStore, t]
  );

  const removeNode = useCallback(
    async (passageKey: string) => {
      if (!id) return;
      setError(null);
      try {
        await api.removeJourneyNode(id, passageKey);
        setAnnouncement(t('removed'));
        load();
        void loadJourneysStore(true);
      } catch (caught) {
        setError(caught instanceof ApiError ? caught.message : t('removeFailed'));
      }
    },
    [id, load, loadJourneysStore, t]
  );

  const saveNote = useCallback(
    async (passageKey: string, noteValue?: string | null) => {
      if (!id) return;
      const next = noteValue !== undefined ? noteValue : draftNote.trim() || null;
      try {
        await api.saveJourneyNote(id, passageKey, next);
        setNoteFor(null);
        setDraftNote('');
        setAnnouncement(t('noteSaved'));
        load();
      } catch (caught) {
        setError(caught instanceof ApiError ? caught.message : t('noteFailed'));
      }
    },
    [id, draftNote, load, t]
  );

  const saveMeta = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      if (!id || !draftName.trim() || savingMeta) return;
      setSavingMeta(true);
      setError(null);
      try {
        await api.renameJourney(id, {
          name: draftName.trim(),
          description: draftDesc.trim() || null,
        });
        setEditingMeta(false);
        setAnnouncement(t('updatedMeta'));
        load();
        void loadJourneysStore(true);
      } catch (caught) {
        setError(caught instanceof ApiError ? caught.message : t('updateFailed'));
      } finally {
        setSavingMeta(false);
      }
    },
    [id, draftName, draftDesc, savingMeta, load, loadJourneysStore, t]
  );

  const handleDuplicate = useCallback(async () => {
    if (!graph || duplicating) return;
    setDuplicating(true);
    setError(null);
    try {
      const notes: Record<string, string | null> = {};
      for (const n of ordered) if (n.note) notes[n.passageKey] = n.note;
      const copyName = `${graph.journey.name.slice(0, 68)} (${t('copySuffix')} ${Date.now() % 100})`;
      const created = await createJourneyInStore(
        copyName,
        graph.journey.description ?? undefined,
        ordered.map((n) => n.passageKey),
        notes
      );
      router.push(`/journeys/${created.id}`);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : t('createFailed'));
    } finally {
      setDuplicating(false);
    }
  }, [graph, duplicating, ordered, createJourneyInStore, router, t]);

  const ref = (node: { passageKey: string }) => passageReference(node.passageKey);

  if (error && !graph) {
    return (
      <>
        <Link href="/journeys" className="btn btn-secondary mb-6">
          <ArrowLeft className="h-4 w-4" aria-hidden /> {t('back')}
        </Link>
        <p className="rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
          {error}
        </p>
      </>
    );
  }

  if (!graph) return <Fallback />;

  return (
    <>
      <Link href="/journeys" className="btn btn-secondary mb-6">
        <ArrowLeft className="h-4 w-4" aria-hidden /> {t('back')}
      </Link>

      {editingMeta ? (
        <form onSubmit={saveMeta} className="mb-6 rounded-2xl border border-line bg-panel/50 p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="edit-journey-name" className="mb-1 block text-xs font-medium text-fg-muted">
                {t('newLabel')}
              </label>
              <input
                id="edit-journey-name"
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
                maxLength={80}
                className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg"
              />
            </div>
            <div>
              <label htmlFor="edit-journey-desc" className="mb-1 block text-xs font-medium text-fg-muted">
                {t('descriptionLabel')}
              </label>
              <input
                id="edit-journey-desc"
                value={draftDesc}
                onChange={(e) => setDraftDesc(e.target.value)}
                maxLength={280}
                placeholder={t('descriptionPlaceholder')}
                className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg"
              />
            </div>
          </div>
          <div className="mt-3 flex gap-2">
            <button type="submit" disabled={!draftName.trim() || savingMeta} className="btn btn-primary px-3 py-1.5 text-xs">
              {savingMeta ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : t('save')}
            </button>
            <button type="button" onClick={() => setEditingMeta(false)} className="btn btn-secondary px-3 py-1.5 text-xs">
              {t('cancel')}
            </button>
          </div>
        </form>
      ) : (
        <PageHeader title={graph.journey.name} description={graph.journey.description ?? t('defaultDescription')} />
      )}

      {/* Functional Journey Workspace Action Bar */}
      <div className="mb-6 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setShowFinder((v) => !v)}
          aria-expanded={showFinder}
          className={cn('btn text-xs', showFinder ? 'btn-primary' : 'btn-secondary')}
        >
          <Plus className="h-4 w-4" aria-hidden />
          {t('addPassages')}
        </button>

        {journeySegments.length > 0 ? (
          <button
            type="button"
            onClick={handleToggleJourneyAudio}
            aria-pressed={isThisJourneyPlaying}
            className={cn(
              'btn text-xs',
              isThisJourneyPlaying ? 'btn-primary' : 'btn-secondary'
            )}
          >
            {isThisJourneyPlaying ? (
              <Pause className="h-4 w-4 fill-current" aria-hidden />
            ) : (
              <Play className="h-4 w-4 fill-current" aria-hidden />
            )}
            {isThisJourneyPlaying ? t('pauseJourney') : t('listenJourney')}
          </button>
        ) : null}

        {ordered.filter((n) => !n.missing).length >= 2 ? (
          <button type="button" onClick={handleCompareJourney} className="btn btn-secondary text-xs">
            <ArrowLeftRight className="h-4 w-4" aria-hidden />
            {t('compareJourney')}
          </button>
        ) : null}

        {graph.nodes.length > 0 ? (
          <button
            type="button"
            onClick={() => setShowShare((v) => !v)}
            aria-expanded={showShare}
            className={cn('btn text-xs', showShare ? 'btn-primary' : 'btn-secondary')}
          >
            <QrCode className="h-4 w-4" aria-hidden />
            {t('shareAndExport')}
          </button>
        ) : null}

        <button
          type="button"
          onClick={() => {
            setDraftName(graph.journey.name);
            setDraftDesc(graph.journey.description ?? '');
            setEditingMeta((v) => !v);
          }}
          className="btn btn-secondary text-xs"
        >
          <PenLine className="h-3.5 w-3.5" aria-hidden />
          {t('editDetails')}
        </button>

        {graph.nodes.length > 0 ? (
          <button
            type="button"
            disabled={duplicating}
            onClick={() => void handleDuplicate()}
            className="btn btn-secondary text-xs"
          >
            {duplicating ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Copy className="h-3.5 w-3.5" aria-hidden />}
            {t('duplicate')}
          </button>
        ) : null}
      </div>

      {showShare && graph.nodes.length > 0 ? (
        <JourneySharePanel graph={graph} onClose={() => setShowShare(false)} />
      ) : null}

      {showFinder ? (
        <JourneyPassageFinder
          existingKeys={existingKeys}
          onAddKey={handleAddKey}
          onAddBatch={handleAddBatch}
          onClose={graph.nodes.length > 0 ? () => setShowFinder(false) : undefined}
        />
      ) : null}

      {graph.nodes.length === 0 ? (
        <p className="rounded-xl border border-dashed border-line p-8 text-center text-sm text-fg-muted">
          {t('noNodes')}
        </p>
      ) : (
        <JourneyGraphView
          graph={graph}
          activePlayingKey={activePlayingKey}
          onAddSuggested={handleAddKey}
          onSaveNote={saveNote}
          onPlayFromNode={handlePlayFromNode}
        />
      )}

      {graph.nodes.length > 0 ? (
        <section aria-labelledby="journey-manage-heading" className="mt-10">
          <h2 id="journey-manage-heading" className="text-lg font-medium">
            {t('manageHeading')}
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-fg-muted">{t('manageBody')}</p>

          {error ? (
            <p className="mt-3 rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
              {error}
            </p>
          ) : null}

          <ol className="mt-4 space-y-2">
            {ordered.map((node, index) => (
              <li
                key={node.passageKey}
                draggable
                onDragStart={() => setDragKey(node.passageKey)}
                onDragOver={(e) => {
                  if (dragKey && dragKey !== node.passageKey) e.preventDefault();
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  void handleDropOn(node.passageKey);
                }}
                onDragEnd={() => setDragKey(null)}
                className={cn(
                  'rounded-xl border border-line p-3 transition-colors',
                  dragKey === node.passageKey && 'opacity-50',
                  activePlayingKey === node.passageKey && 'border-accent bg-accent-soft/20'
                )}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <GripVertical className="hidden h-4 w-4 shrink-0 cursor-grab text-fg-faint sm:block" aria-hidden />
                  <span className="w-6 shrink-0 text-center font-mono text-xs text-fg-faint tabular-nums">
                    {index + 1}
                  </span>
                  <span className="min-w-0 flex-1 text-sm">
                    <span className="font-medium">{ref(node)}</span>
                    {node.preview ? <span className="ms-2 text-fg-muted">{node.preview.slice(0, 90)}</span> : null}
                  </span>

                  <button
                    type="button"
                    onClick={() => void move(node.passageKey, -1)}
                    disabled={index === 0}
                    aria-label={t('moveUp', { reference: ref(node) })}
                    className="icon-btn"
                  >
                    <ChevronUp className="h-4 w-4" aria-hidden />
                  </button>
                  <button
                    type="button"
                    onClick={() => void move(node.passageKey, 1)}
                    disabled={index === ordered.length - 1}
                    aria-label={t('moveDown', { reference: ref(node) })}
                    className="icon-btn"
                  >
                    <ChevronDown className="h-4 w-4" aria-hidden />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setNoteFor(noteFor === node.passageKey ? null : node.passageKey);
                      setDraftNote(node.note ?? '');
                    }}
                    aria-expanded={noteFor === node.passageKey}
                    aria-label={t('noteFor', { reference: ref(node) })}
                    className="btn btn-secondary px-2 py-1 text-xs"
                  >
                    {t('note')}
                  </button>
                  <button
                    type="button"
                    onClick={() => void removeNode(node.passageKey)}
                    aria-label={t('removeNamed', { reference: ref(node) })}
                    className="icon-btn"
                  >
                    <Trash2 className="h-4 w-4" aria-hidden />
                  </button>
                </div>

                {node.note ? (
                  <p className="mt-2 border-s-2 border-line ps-3 text-sm italic text-fg-muted">{node.note}</p>
                ) : null}

                {noteFor === node.passageKey ? (
                  <div className="mt-3">
                    <label htmlFor={`note-${index}`} className="mb-1 block text-xs font-medium text-fg-muted">
                      {t('noteLabel')}
                    </label>
                    <textarea
                      id={`note-${index}`}
                      value={draftNote}
                      onChange={(e) => setDraftNote(e.target.value)}
                      maxLength={2000}
                      rows={3}
                      className="w-full rounded-lg border border-line bg-surface p-2 text-sm"
                    />
                    <div className="mt-2 flex gap-2">
                      <button
                        type="button"
                        onClick={() => void saveNote(node.passageKey)}
                        className="btn btn-primary px-3 py-1.5 text-xs"
                      >
                        {t('save')}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setNoteFor(null);
                          setDraftNote('');
                        }}
                        className="btn btn-secondary px-3 py-1.5 text-xs"
                      >
                        {t('cancel')}
                      </button>
                    </div>
                  </div>
                ) : null}
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {announcement}
      </p>
    </>
  );
}
