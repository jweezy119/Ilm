'use client';

import { BookOpen, X } from 'lucide-react';
import { useRouter } from '@/i18n/navigation';
import type { TextId } from '@ilm/shared';
import { segmentForGlossary, GLOSSARY_TEXTS, type GlossaryEntry } from '@/lib/glossary';
import { useDisclosurePanel } from '@/lib/useDisclosurePanel';

/**
 * An English translation with its Quranic terms tappable.
 *
 * The counterpart to LookupableText, which offers every word of the original text
 * to the Sefaria dictionaries. Here the source is a curated glossary bundled with
 * the app, so a tap resolves immediately and offline rather than costing a request.
 *
 * Only Quran translations get it. The entries gloss terms in the Quran's sense, and
 * attaching "messenger" meaning the Prophet Muhammad to a word in the Hebrew Torah
 * would be a quiet misreading rather than a help - so other texts fall through to
 * plain text and keep their existing original-text lookup.
 */
export function GlossableText({
  text,
  textId,
  className,
}: {
  text: string;
  textId: TextId;
  className?: string;
}) {
  const { panel: open, panelId, open: showEntry, close, isOpen } = useDisclosurePanel<GlossaryEntry>();

  if (!GLOSSARY_TEXTS.has(textId)) {
    return <p className={className}>{text}</p>;
  }

  const segments = segmentForGlossary(text);

  return (
    <>
      <p className={className}>
        {segments.map((segment, i) =>
          segment.kind === 'plain' ? (
            <span key={i}>{segment.text}</span>
          ) : (
            <button
              key={i}
              type="button"
              onClick={(e) => (isOpen(segment.entry) ? close() : showEntry(segment.entry, e.currentTarget))}
              aria-expanded={isOpen(segment.entry)}
              aria-controls={isOpen(segment.entry) ? panelId : undefined}
              className="rounded px-0.5 text-left underline decoration-dotted decoration-fg-faint underline-offset-4 transition-colors hover:bg-accent-soft/50 focus:bg-accent-soft/50"
              title={`${segment.entry.term} — ${segment.entry.short}`}
            >
              {segment.text}
            </button>
          )
        )}
      </p>

      {open ? <GlossaryPanel id={panelId} entry={open} onClose={close} /> : null}
    </>
  );
}

function GlossaryPanel({ id, entry, onClose }: { id: string; entry: GlossaryEntry; onClose: () => void }) {
  const router = useRouter();

  return (
    <aside id={id} className="mt-4 rounded-xl border border-accent/40 bg-panel p-4">
      <header className="mb-3 flex items-start gap-2">
        <BookOpen className="mt-0.5 h-4 w-4 shrink-0 text-fg-faint" />
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold">
            {entry.term}
            {entry.translit ? <span className="ms-2 text-xs font-normal italic text-fg-muted">{entry.translit}</span> : null}
          </h2>
          {/* Said out loud rather than claimed: these entries are written and
              checked against the text, and the verses below are how a reader
              checks them. */}
          <p className="text-[11px] text-fg-faint">Curated reference entry, not a generated gloss.</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close definition"
          className="grid h-6 w-6 place-items-center rounded hover:bg-raised"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </header>

      {entry.arabic ? (
        <p dir="rtl" lang="ar" className="mb-2 font-[family-name:var(--font-arabic)] text-xl leading-loose text-fg">
          {entry.arabic}
        </p>
      ) : null}

      <p className="text-sm text-fg">{entry.short}</p>
      {entry.detail ? <p className="mt-2 text-sm leading-relaxed text-fg-muted">{entry.detail}</p> : null}

      {entry.refs?.length ? (
        <div className="mt-3 border-t border-line pt-3">
          <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-fg-faint">In the text</p>
          <div className="flex flex-wrap gap-1.5">
            {entry.refs.map((ref) => {
              // Quran keys are textId:surah:1:ayah, so the surah and the ayah are
              // what a reader recognises as "2:255".
              const [, surah, , ayah] = ref.split(':');
              return (
                <button
                  key={ref}
                  type="button"
                  onClick={() => router.push(`/passage/${ref.split(':').map(encodeURIComponent).join('/')}`)}
                  className="rounded-full border border-line bg-raised px-2 py-0.5 text-[11px] text-fg-muted transition-colors hover:border-accent hover:text-fg"
                >
                  {surah}:{ayah}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </aside>
  );
}
