import { TextId } from '@ilm/shared';

export function getTextLabel(textId: TextId): string {
  const labels: Record<TextId, string> = {
    quran: 'Quran',
    talmud: 'Talmud',
    torah: 'Torah',
    ot: 'Old Testament',
    nt: 'New Testament',
  };
  return labels[textId] || textId;
}

export function getTextBadgeClass(textId: TextId): string {
  const classes: Record<TextId, string> = {
    quran: 'badge-quran',
    talmud: 'badge-talmud',
    torah: 'badge-torah',
    ot: 'badge-ot',
    nt: 'badge-nt',
  };
  return classes[textId] || 'badge';
}

export function getTextDirection(textId: TextId): 'rtl' | 'ltr' {
  const rtlTexts: TextId[] = ['quran', 'talmud', 'torah'];
  return rtlTexts.includes(textId) ? 'rtl' : 'ltr';
}

export function getTextColor(textId: TextId): string {
  const colors: Record<TextId, string> = {
    quran: '#1a5c3e',
    talmud: '#8b4513',
    torah: '#1e3a5f',
    ot: '#5c2a1a',
    nt: '#3d1a5c',
  };
  return colors[textId] || '#334e68';
}

export function formatPassageKey(textId: TextId, book: string, chapter: number, verse: number): string {
  return `${textId}:${book}:${chapter}:${verse}`;
}

export function parsePassageKey(key: string): { textId: TextId; book: string; chapter: number; verse: number } | null {
  const parts = key.split(':');
  if (parts.length !== 4) return null;
  
  const [textId, book, chapter, verse] = parts;
  return {
    textId: textId as TextId,
    book,
    chapter: parseInt(chapter, 10),
    verse: parseInt(verse, 10),
  };
}

export function cn(...classes: (string | boolean | undefined | null)[]): string {
  return classes.filter(Boolean).join(' ');
}

export function debounce<T extends (...args: any[]) => any>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeout: NodeJS.Timeout | null = null;
  
  return (...args: Parameters<T>) => {
    if (timeout) clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), wait);
  };
}

export function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength).trim() + '...';
}

export function highlightText(text: string, query: string): React.ReactNode {
  if (!query.trim()) return text;
  
  const parts = text.split(new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'));
  
  return parts.map((part, i) =>
    part.toLowerCase() === query.toLowerCase() ? (
      <mark key={i} className="bg-yellow-200 dark:bg-yellow-800 px-0.5 rounded">
        {part}
      </mark>
    ) : (
      <span key={i}>{part}</span>
    )
  );
}

export function scrollToElement(elementId: string, offset = 80): void {
  const element = document.getElementById(elementId);
  if (element) {
    const elementPosition = element.getBoundingClientRect().top;
    const offsetPosition = elementPosition + window.pageYOffset - offset;
    window.scrollTo({ top: offsetPosition, behavior: 'smooth' });
  }
}

export function copyToClipboard(text: string): Promise<void> {
  return navigator.clipboard.writeText(text);
}

export function generateShareUrl(path: string, params: Record<string, string>): string {
  const url = new URL(path, window.location.origin);
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
  return url.toString();
}

export function parseShareUrl(url: string): Record<string, string> {
  const parsed = new URL(url);
  const params: Record<string, string> = {};
  parsed.searchParams.forEach((value, key) => {
    params[key] = value;
  });
  return params;
}