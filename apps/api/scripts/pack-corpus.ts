/**
 * Pack the live Postgres corpus into a single Brotli-compressed columnar file
 * (`apps/api/data/corpus.ilm.pack.br`).
 *
 * Includes all passages, books, themes, cross-lingual terms, and (if present in
 * Postgres or in `vectors.ilm.vec.br`) 2-stage BQ+SQ8 quantized semantic vectors.
 *
 * Usage:
 *   npm run pack --workspace=@ilm/api
 *   npx tsx scripts/pack-corpus.ts --out data/corpus.ilm.pack.br --quality 9
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { brotliDecompressSync } from 'node:zlib';
import type { TextId } from '@ilm/shared';
import { loadLocalEnv } from '../src/lib/env';
import { prisma } from '../src/lib/db';
import {
  buildColumnarPayload,
  defaultPackPath,
  writeIlmPack,
  type PackBook,
  type PackPassageInput,
} from '../src/lib/ilm-pack';
import { CompactVectorIndex } from '../src/search/compact-vectors';

loadLocalEnv();

function argValue(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  return idx >= 0 ? args[idx + 1] : undefined;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const outPath = argValue(args, '--out') ?? defaultPackPath();
  const quality = Number(argValue(args, '--quality') ?? 9);
  const sqDims = Number(argValue(args, '--sq-dims') ?? 128);
  const startedAt = Date.now();

  console.log(`📦 Packing Ilm corpus -> ${outPath} (Brotli q=${quality})`);

  const [books, passages, themeRows, primaryTransRows, xlingualRows, embeddedRows] = await Promise.all([
    prisma.book.findMany({ orderBy: [{ textId: 'asc' }, { order: 'asc' }] }),
    prisma.passage.findMany({
      select: {
        id: true,
        passageKey: true,
        textId: true,
        bookSlug: true,
        chapterNum: true,
        verseNum: true,
        originalText: true,
        primaryTranslation: true,
        language: true,
        verseOrder: true,
        metadata: true,
      },
      orderBy: [{ verseOrder: 'asc' }, { passageKey: 'asc' }],
    }),
    prisma.passageTheme.findMany({
      select: { passageId: true, themeId: true, score: true, confidence: true, source: true },
    }),
    prisma.$queryRaw<Array<{ passage_id: string; name: string }>>`
      SELECT DISTINCT ON (pt.passage_id) pt.passage_id, t.name
      FROM passage_translations pt
      JOIN translations t ON t.id = pt.translation_id
      WHERE t.is_primary = true
      ORDER BY pt.passage_id
    `,
    prisma.xlingualTerm.findMany({ orderBy: [{ theme: 'asc' }, { inPassages: 'desc' }] }),
    prisma.$queryRaw<Array<{ passage_key: string; embeddings: number[] }>>`
      SELECT passage_key, embeddings
      FROM passages
      WHERE jsonb_typeof(embeddings) = 'array' AND jsonb_array_length(embeddings) > 0
    `,
  ]);

  const themesByPassageId = new Map<string, Array<{ theme: string; score: number; confidence: number; source: string }>>();
  for (const t of themeRows) {
    let list = themesByPassageId.get(t.passageId);
    if (!list) {
      list = [];
      themesByPassageId.set(t.passageId, list);
    }
    list.push({ theme: t.themeId, score: t.score, confidence: t.confidence, source: t.source });
  }
  const primaryNameByPassageId = new Map<string, string>(
    primaryTransRows.map((r) => [r.passage_id, r.name])
  );

  const packBooks: PackBook[] = books.map((b) => ({
    textId: b.textId as TextId,
    bookId: b.bookId,
    name: b.name,
    nameOriginal: b.nameOriginal ?? undefined,
    nameTranslit: b.nameTranslit ?? undefined,
    chapterCount: b.chapterCount,
    verseCount: b.verseCount,
    order: b.order,
    testament: b.testament ?? undefined,
    category: b.category ?? undefined,
    description: b.description ?? undefined,
  }));

  const packPassages: PackPassageInput[] = passages.map((p) => {
    const meta = (p.metadata ?? {}) as Record<string, unknown>;
    return {
      id: p.id,
      passageKey: p.passageKey,
      textId: p.textId as TextId,
      bookSlug: p.bookSlug,
      chapter: p.chapterNum,
      verse: p.verseNum,
      originalText: p.originalText,
      translation: p.primaryTranslation,
      primaryTranslationName: primaryNameByPassageId.get(p.id),
      language: p.language,
      verseOrder: p.verseOrder,
      density: typeof meta.density === 'number' ? meta.density : 0.5,
      metadata: meta,
      themes: themesByPassageId.get(p.id) ?? [],
    };
  });

  const payload = buildColumnarPayload({
    books: packBooks,
    passages: packPassages,
    xlingualTerms: xlingualRows.map((x) => ({
      theme: x.theme,
      language: x.language,
      term: x.term,
      inPassages: x.inPassages,
      specificity: x.specificity,
    })),
  });

  // Build or reuse quantized semantic vectors if available.
  let vectorBlob: Uint8Array | null = null;
  if (embeddedRows.length > 0) {
    const dims = embeddedRows[0].embeddings.length;
    const keyToDoc = new Map<string, number>();
    packPassages.forEach((p, idx) => keyToDoc.set(p.passageKey, idx));
    const vecIndex = new CompactVectorIndex(payload.count, dims, Math.min(dims, sqDims));
    for (const row of embeddedRows) {
      const docId = keyToDoc.get(row.passage_key);
      if (docId !== undefined && Array.isArray(row.embeddings) && row.embeddings.length === dims) {
        vecIndex.set(docId, row.embeddings);
      }
    }
    vectorBlob = vecIndex.serialize();
    console.log(
      `   Quantized ${vecIndex.size} embeddings (${dims}d -> 1-bit BQ + ${vecIndex.sqDims}d SQ8 = ` +
        `${(vectorBlob.byteLength / 1024 / 1024).toFixed(2)} MB raw)`
    );
  } else {
    const standalone = process.env.ILM_VECTOR_PATH?.trim() || join(process.cwd(), 'data', 'vectors.ilm.vec.br');
    if (existsSync(standalone)) {
      const raw = readFileSync(standalone);
      const dec = standalone.endsWith('.br') ? brotliDecompressSync(raw) : raw;
      const blob = new Uint8Array(dec.buffer, dec.byteOffset, dec.byteLength);
      const check = CompactVectorIndex.deserialize(blob);
      if (check.count === payload.count) {
        vectorBlob = blob;
        console.log(`   Bundled standalone quantized vectors (${check.size} docs)`);
      }
    }
  }

  const rawTextBytes =
    payload.translations.reduce((s, t) => s + Buffer.byteLength(t, 'utf8'), 0) +
    payload.originals.reduce((s, t) => s + Buffer.byteLength(t, 'utf8'), 0);

  const written = writeIlmPack(outPath, payload, vectorBlob, quality);
  const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(2);
  const ratio = (rawTextBytes / Math.max(1, written.jsonBytes)).toFixed(2);

  console.log(
    `✅ Packed ${payload.count} passages, ${payload.books.length} books, ` +
      `${payload.themeLinks.length / 5} theme links, ${payload.xlingualTerms.length} xlingual terms in ${elapsedSec}s`
  );
  console.log(
    `   Raw text: ${(rawTextBytes / 1024 / 1024).toFixed(2)} MB -> ` +
      `Pack total: ${(written.bytes / 1024 / 1024).toFixed(2)} MB ` +
      `(corpus=${(written.jsonBytes / 1024 / 1024).toFixed(2)} MB, ${ratio}x vs raw text; ` +
      `vectors=${(written.vectorBytes / 1024 / 1024).toFixed(2)} MB)`
  );
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error('❌ Pack failed:', error);
    await prisma.$disconnect();
    process.exit(1);
  });
