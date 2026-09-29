/** Presentation helpers for text identity, direction, and passage references. */

import { TEXT_METADATA, type Passage, type TextId } from '@ilm/shared';

export const TEXT_IDS: TextId[] = ['quran', 'torah', 'talmud', 'ot', 'nt'];

export function getTextLabel(textId: TextId, short = false): string {
  const name = TEXT_METADATA[textId]?.name ?? textId;
  if (!short) return name;
  // Bukhari and Muslim abbreviate to their own initials rather than to "Hadith":
  // a hadith is cited by collection, and two chips that both read "H" would erase
  // the distinction the citation depends on.
  return { quran: 'Qur’an', torah: 'Torah', talmud: 'Talmud', ot: 'OT', nt: 'NT', bukhari: 'Bukhari', muslim: 'Muslim' }[textId] ?? name;
}

/** Tailwind text colour per corpus, so passages stay visually distinguishable. */
export const TEXT_STYLES: Record<TextId, { chip: string; accent: string; border: string }> = {
  quran: { chip: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-900/50 dark:text-emerald-100', accent: 'text-emerald-700 dark:text-emerald-400', border: 'border-l-emerald-600' },
  torah: { chip: 'bg-sky-100 text-sky-900 dark:bg-sky-900/50 dark:text-sky-100', accent: 'text-sky-700 dark:text-sky-400', border: 'border-l-sky-600' },
  talmud: { chip: 'bg-amber-100 text-amber-900 dark:bg-amber-900/50 dark:text-amber-100', accent: 'text-amber-700 dark:text-amber-400', border: 'border-l-amber-600' },
  ot: { chip: 'bg-rose-100 text-rose-900 dark:bg-rose-900/50 dark:text-rose-100', accent: 'text-rose-700 dark:text-rose-400', border: 'border-l-rose-600' },
  nt: { chip: 'bg-violet-100 text-violet-900 dark:bg-violet-900/50 dark:text-violet-100', accent: 'text-violet-700 dark:text-violet-400', border: 'border-l-violet-600' },
  // Slate for both hadith corpora. They are the same kind of text from the same
  // tradition, so sharing a colour says so; the initials are what tell them apart,
  // which is also how they are cited. Teal and stone would have read as two more
  // unrelated traditions.
  bukhari: { chip: 'bg-slate-100 text-slate-900 dark:bg-slate-900/50 dark:text-slate-100', accent: 'text-slate-700 dark:text-slate-400', border: 'border-l-slate-600' },
  muslim: { chip: 'bg-slate-100 text-slate-900 dark:bg-slate-900/50 dark:text-slate-100', accent: 'text-slate-700 dark:text-slate-400', border: 'border-l-slate-600' },
};

export function getTextChipClass(textId: TextId): string {
  return `inline-flex shrink-0 items-center rounded px-1.5 py-0.5 text-[11px] font-medium ${TEXT_STYLES[textId]?.chip ?? ''}`;
}

export function getTextDirection(textId: TextId): 'rtl' | 'ltr' {
  return TEXT_METADATA[textId]?.direction ?? 'ltr';
}

/**
 * Which way a given string reads.
 *
 * The direction of a *corpus* is not the direction of a *verse*. The Old Testament's
 * corpus direction is ltr, because the text a reader searches is English, and using
 * it to lay out a Hebrew original rendered the Hebrew left to right. Arabic, Hebrew
 * and Aramaic are right to left; everything else the corpus holds is not.
 */
export function getLanguageDirection(language: string): 'rtl' | 'ltr' {
  return language === 'arabic' || language === 'hebrew' || language === 'aramaic' ? 'rtl' : 'ltr';
}

/** The script a passage's original text is written in. */
export function getScriptFont(language: string): string {
  switch (language) {
    case 'arabic':
      return 'font-[family-name:var(--font-arabic)] text-xl leading-loose';
    case 'hebrew':
    case 'aramaic':
      return 'font-[family-name:var(--font-hebrew)] text-xl leading-loose';
    case 'greek':
      return 'font-[family-name:var(--font-greek)] text-xl leading-loose';
    default:
      return 'text-base leading-relaxed';
  }
}

export function formatReference(passage: Pick<Passage, 'textId' | 'book' | 'chapter' | 'verse'>): string {
  return `${getTextLabel(passage.textId, true)} ${passage.book} ${passage.chapter}:${passage.verse}`;
}

export function passageHref(passage: Pick<Passage, 'passageKey'>): string {
  return `/passage/${passage.passageKey.split('/').map(encodeURIComponent).join('/')}`;
}

export function compareHref(keys: string[]): string {
  return `/compare?keys=${keys.map(encodeURIComponent).join(',')}`;
}

export function cn(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(' ');
}

export function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength).trimEnd()}…`;
}

export function percent(value: number, digits = 0): string {
  return `${(value * 100).toFixed(digits)}%`;
}

export function debounce<T extends (...args: never[]) => void>(fn: T, wait: number): (...args: Parameters<T>) => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return (...args: Parameters<T>) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}
