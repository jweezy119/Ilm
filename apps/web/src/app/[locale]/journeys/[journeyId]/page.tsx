'use client';

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from '@/i18n/navigation';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ArrowLeft, ChevronDown, ChevronUp, Loader2, Trash2 } from 'lucide-react';
import { Page, PageHeader } from '@/components/Shell';
import { JourneyGraphView } from '@/components/JourneyGraphView';
import { api, ApiError } from '@/lib/api';
import type { JourneyGraph } from '@ilm/shared';
import { passageReference } from '@/lib/passage-ref';

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
  const params = useParams<{ journeyId: string }>();
  const id = params?.journeyId as string | undefined;

  const [graph, setGraph] = useState<JourneyGraph | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const [draftNote, setDraftNote] = useState('');
  const [noteFor, setNoteFor] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!id) return;
    api
      .journeyGraph(id)
      .then((d) => setGraph(d.graph))
      .catch((caught) => setError(caught instanceof ApiError ? caught.message : t('loadFailed')));
  }, [id, t]);

  useEffect(() => {
    load();
  }, [load]);

  /**
   * Reordering with buttons rather than drag.
   *
   * Drag has no keyboard equivalent, so a drag-only reorder is a feature a
   * keyboard user cannot use at all — and this is the one place in a journey
   * where the reader's own sequence is the content. Move up / move down says
   * exactly what it does, and the announcement below says what happened.
   */
  const move = useCallback(
    async (passageKey: string, delta: -1 | 1) => {
      if (!graph) return;
      const keys = graph.nodes.map((n) => n.passageKey);
      const from = keys.indexOf(passageKey);
      const to = from + delta;
      if (from < 0 || to < 0 || to >= keys.length) return;
      const reordered = [...keys];
      [reordered[from], reordered[to]] = [reordered[to], reordered[from]];

      const previous = graph;
      setGraph({ ...graph, nodes: reordered.map((key, i) => ({ ...graph.nodes.find((n) => n.passageKey === key)!, position: i })) });
      try {
        await api.reorderJourney(id!, reordered);
        setAnnouncement(t('moved', { position: to + 1, of: keys.length }));
        load();
      } catch (caught) {
        setGraph(previous);
        setError(caught instanceof ApiError ? caught.message : t('reorderFailed'));
      }
    },
    [graph, id, load, t]
  );

  const removeNode = useCallback(
    async (passageKey: string) => {
      if (!id) return;
      setError(null);
      try {
        await api.removeJourneyNode(id, passageKey);
        setAnnouncement(t('removed'));
        load();
      } catch (caught) {
        setError(caught instanceof ApiError ? caught.message : t('removeFailed'));
      }
    },
    [id, load, t]
  );

  const saveNote = useCallback(
    async (passageKey: string) => {
      if (!id) return;
      try {
        await api.saveJourneyNote(id, passageKey, draftNote.trim() || null);
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

  /** Every reference on this page, from the key — see passageReference. */
  const ref = (node: { passageKey: string }) => passageReference(node.passageKey);

  const ordered = useMemo(() => [...(graph?.nodes ?? [])].sort((a, b) => a.position - b.position), [graph]);

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

      <PageHeader title={graph.journey.name} description={graph.journey.description ?? t('defaultDescription')} />

      {graph.nodes.length === 0 ? (
        <p className="rounded-xl border border-dashed border-line p-8 text-center text-sm text-fg-muted">
          {t('noNodes')}
        </p>
      ) : (
        <JourneyGraphView graph={graph} />
      )}

      {/*
        The list, in the reader's order, with the controls that change it. The
        graph above is the shape; this is the sequence, and it is the part they
        edit.
      */}
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
              <li key={node.passageKey} className="rounded-xl border border-line p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="w-6 shrink-0 text-center font-mono text-xs text-fg-faint tabular-nums">{index + 1}</span>
                  <span className="min-w-0 flex-1 text-sm">
                    <span className="font-medium">{ref(node)}</span>
                    {node.preview ? <span className="ms-2 text-fg-muted">{node.preview.slice(0, 90)}</span> : null}
                  </span>

                  <button
                    type="button"
                    onClick={() => move(node.passageKey, -1)}
                    disabled={index === 0}
                    aria-label={t('moveUp', { reference: ref(node) })}
                    className="icon-btn"
                  >
                    <ChevronUp className="h-4 w-4" aria-hidden />
                  </button>
                  <button
                    type="button"
                    onClick={() => move(node.passageKey, 1)}
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
                    onClick={() => removeNode(node.passageKey)}
                    aria-label={t('removeNamed', { reference: ref(node) })}
                    className="icon-btn"
                  >
                    <Trash2 className="h-4 w-4" aria-hidden />
                  </button>
                </div>

                {node.note ? <p className="mt-2 border-s-2 border-line ps-3 text-sm italic text-fg-muted">{node.note}</p> : null}

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
                      <button type="button" onClick={() => saveNote(node.passageKey)} className="btn btn-primary px-3 py-1.5 text-xs">
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