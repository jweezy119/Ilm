/**
 * Journey Study Guide Export & Portable Share-Link Codec
 *
 * Strictly honors Ilm's core claim (AGENTS.md): zero generated prose.
 * Exports contain only the sacred texts, the reader's own notes, and the
 * relations detected by the app with their provenance.
 *
 * Share links encode a compact JSON payload into URL-safe base64 (`?import=...`)
 * so a journey can be shared as a URL or QR code with zero server-side state
 * and imported in one click by any recipient.
 */

import { JOURNEY_LIMITS, PassageKeySchema, type JourneyGraph } from '@ilm/shared';
import { getTextLabel } from '@/lib/utils';
import { passageReference } from '@/lib/passage-ref';

export interface SharedJourneyPayload {
  name: string;
  description?: string;
  keys: string[];
  notes?: Record<string, string>;
}

interface CompactWirePayload {
  v: 1;
  n: string;
  d?: string;
  k: string[];
  m?: Record<string, string>;
}

const MAX_QR_SAFE_URL_LENGTH = 1650;

function utf8ToBase64Url(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  const b64 = typeof btoa === 'function' ? btoa(binary) : Buffer.from(bytes).toString('base64');
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlToUtf8(encoded: string): string {
  const padded = encoded.replace(/-/g, '+').replace(/_/g, '/');
  const padLen = (4 - (padded.length % 4)) % 4;
  const b64 = padded + '='.repeat(padLen);
  if (typeof atob === 'function') {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }
  return Buffer.from(b64, 'base64').toString('utf8');
}

/** Encode a journey into a compact URL-safe token. */
export function encodeJourneyShare(
  input: SharedJourneyPayload,
  options: { includeNotes?: boolean } = {}
): string {
  const cleanKeys = [...new Set(input.keys)]
    .filter((k) => PassageKeySchema.safeParse(k).success)
    .slice(0, JOURNEY_LIMITS.maxNodes);

  const wire: CompactWirePayload = {
    v: 1,
    n: input.name.trim().slice(0, JOURNEY_LIMITS.nameLength) || 'Shared Journey',
    ...(input.description?.trim() ? { d: input.description.trim().slice(0, 280) } : {}),
    k: cleanKeys,
  };

  if (options.includeNotes !== false && input.notes) {
    const compactNotes: Record<string, string> = {};
    cleanKeys.forEach((key, idx) => {
      const note = input.notes?.[key]?.trim();
      if (note) compactNotes[String(idx)] = note.slice(0, 240);
    });
    if (Object.keys(compactNotes).length > 0) wire.m = compactNotes;
  }

  return utf8ToBase64Url(JSON.stringify(wire));
}

/** Decode and defensively validate a portable journey share token. */
export function decodeJourneyShare(token: string | null | undefined): SharedJourneyPayload | null {
  if (!token || token.length > 16_000) return null;
  try {
    const parsed = JSON.parse(base64UrlToUtf8(token)) as Partial<CompactWirePayload>;
    if (!parsed || parsed.v !== 1 || typeof parsed.n !== 'string' || !Array.isArray(parsed.k)) {
      return null;
    }

    const name = parsed.n.trim().slice(0, JOURNEY_LIMITS.nameLength);
    if (!name) return null;

    const keys: string[] = [];
    const seen = new Set<string>();
    for (const raw of parsed.k) {
      if (typeof raw !== 'string') continue;
      const check = PassageKeySchema.safeParse(raw);
      if (!check.success || seen.has(check.data)) continue;
      seen.add(check.data);
      keys.push(check.data);
      if (keys.length >= JOURNEY_LIMITS.maxNodes) break;
    }
    if (keys.length === 0) return null;

    const notes: Record<string, string> = {};
    if (parsed.m && typeof parsed.m === 'object') {
      for (const [idxStr, val] of Object.entries(parsed.m)) {
        const idx = Number(idxStr);
        if (Number.isInteger(idx) && idx >= 0 && idx < keys.length && typeof val === 'string') {
          const clean = val.trim().slice(0, JOURNEY_LIMITS.noteLength);
          if (clean) notes[keys[idx]] = clean;
        }
      }
    }

    return {
      name,
      ...(typeof parsed.d === 'string' && parsed.d.trim()
        ? { description: parsed.d.trim().slice(0, 280) }
        : {}),
      keys,
      ...(Object.keys(notes).length > 0 ? { notes } : {}),
    };
  } catch {
    return null;
  }
}

/** Build a shareable URL for a journey, keeping it QR-scannable by omitting long notes if needed. */
export function buildJourneyShareUrl(
  origin: string,
  locale: string,
  graph: JourneyGraph
): { url: string; notesIncluded: boolean; qrSafe: boolean } {
  const ordered = [...graph.nodes].sort((a, b) => a.position - b.position);
  const notesMap: Record<string, string> = {};
  for (const n of ordered) {
    if (n.note?.trim()) notesMap[n.passageKey] = n.note.trim();
  }
  const payload: SharedJourneyPayload = {
    name: graph.journey.name,
    description: graph.journey.description ?? undefined,
    keys: ordered.map((n) => n.passageKey),
    notes: notesMap,
  };

  const base = `${origin.replace(/\/$/, '')}/${locale}/journeys?import=`;
  const withNotes = base + encodeJourneyShare(payload, { includeNotes: true });
  if (withNotes.length <= MAX_QR_SAFE_URL_LENGTH) {
    return { url: withNotes, notesIncluded: Object.keys(notesMap).length > 0, qrSafe: true };
  }

  const withoutNotes = base + encodeJourneyShare(payload, { includeNotes: false });
  return {
    url: withoutNotes,
    notesIncluded: false,
    qrSafe: withoutNotes.length <= MAX_QR_SAFE_URL_LENGTH,
  };
}

/** Export a journey as a clean Markdown study guide (texts, user notes, and detected relations only). */
export function journeyToMarkdown(graph: JourneyGraph, shareUrl?: string): string {
  const ordered = [...graph.nodes].sort((a, b) => a.position - b.position);
  const corpora = [...new Set(ordered.filter((n) => !n.missing).map((n) => getTextLabel(n.textId)))];
  const lines: string[] = [];

  lines.push(`# ${graph.journey.name}`);
  lines.push('');
  if (graph.journey.description) {
    lines.push(graph.journey.description);
    lines.push('');
  }
  lines.push(
    `*${ordered.length} ${ordered.length === 1 ? 'passage' : 'passages'}${
      corpora.length ? ` · ${corpora.join(', ')}` : ''
    }*`
  );
  if (shareUrl) {
    lines.push(`*Share link: ${shareUrl}*`);
  }
  lines.push('');
  lines.push('---');
  lines.push('');

  ordered.forEach((node, index) => {
    const ref = passageReference(node.passageKey);
    const corpus = getTextLabel(node.textId);
    lines.push(`## ${index + 1}. ${ref} (${corpus})`);
    lines.push('');
    if (node.originalText) {
      lines.push(node.originalText);
      lines.push('');
    }
    if (node.preview) {
      lines.push(`> ${node.preview}`);
      lines.push('');
    }
    if (node.note) {
      lines.push(`**Note:** ${node.note}`);
      lines.push('');
    }
  });

  if (graph.edges.length > 0) {
    lines.push('---');
    lines.push('');
    lines.push(`## Detected Relations (${graph.edges.length})`);
    lines.push('');
    for (const edge of graph.edges) {
      const from = passageReference(edge.from);
      const to = passageReference(edge.to);
      const kind = edge.theme ? `shared theme: ${edge.theme}` : edge.kind;
      lines.push(`- **${from} ↔ ${to}** — ${kind} *(found by ${edge.provenance})*`);
    }
    lines.push('');
  }

  return lines.join('\n');
}
