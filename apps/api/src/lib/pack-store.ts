/**
 * In-memory Pack-Backed Corpus Store (`ILM_STORAGE=pack`)
 *
 * Allows Ilm to boot and serve all 46,464 passages, books, chapters, themes,
 * stats, cross-lingual terms, and compressed hybrid search with ZERO Docker
 * and ZERO Postgres — reading directly from `corpus.ilm.pack.br` in ~1-2s.
 */

import { existsSync } from 'node:fs';
import { BookMetadata, Passage, TEXT_METADATA, TextId } from '@ilm/shared';
import {
  DecodedIlmPack,
  UnpackedThemeEntry,
  defaultPackPath,
  packPassageKey,
  readIlmPack,
  unpackBookMetadata,
  unpackPassage,
  unpackThemesByDoc,
  unpackVerseOrders,
} from './ilm-pack';
import type { XlingualTerm } from '../services/xlingual';

export function isPackStorageEnabled(): boolean {
  return (process.env.ILM_STORAGE ?? '').trim().toLowerCase() === 'pack';
}

export class PackStore {
  readonly pack: DecodedIlmPack;
  readonly verseOrders: Uint32Array;
  readonly themesByDoc: Map<number, UnpackedThemeEntry[]>;
  private readonly keyToDoc = new Map<string, number>();
  private readonly booksByText = new Map<TextId, BookMetadata[]>();
  private readonly bookByKey = new Map<string, BookMetadata>();
  private readonly docsByText = new Map<TextId, number[]>();
  private readonly docsByBook = new Map<string, number[]>();
  private readonly docsByChapter = new Map<string, number[]>();
  private readonly themesByText = new Map<TextId, Set<string>>();
  private readonly xlingualByTheme = new Map<string, XlingualTerm[]>();

  constructor(pack: DecodedIlmPack) {
    this.pack = pack;
    const { payload } = pack;
    this.verseOrders = unpackVerseOrders(payload);
    this.themesByDoc = unpackThemesByDoc(payload);

    for (const rawBook of payload.books) {
      const bm = unpackBookMetadata(rawBook);
      const list = this.booksByText.get(bm.textId) ?? [];
      list.push(bm);
      this.booksByText.set(bm.textId, list);
      this.bookByKey.set(`${bm.textId}:${bm.id}`, bm);
    }
    for (const list of this.booksByText.values()) {
      list.sort((a, b) => a.order - b.order);
    }

    for (let docId = 0; docId < payload.count; docId += 1) {
      const textId = payload.texts[payload.textIdx[docId]] as TextId;
      const book = payload.books[payload.bookIdx[docId]];
      const chapter = payload.chapters[docId];
      const key = packPassageKey(payload, docId);
      this.keyToDoc.set(key, docId);

      let textDocs = this.docsByText.get(textId);
      if (!textDocs) {
        textDocs = [];
        this.docsByText.set(textId, textDocs);
      }
      textDocs.push(docId);

      const bKey = `${textId}:${book.bookId}`;
      let bookDocs = this.docsByBook.get(bKey);
      if (!bookDocs) {
        bookDocs = [];
        this.docsByBook.set(bKey, bookDocs);
      }
      bookDocs.push(docId);

      const cKey = `${textId}:${book.bookId}:${chapter}`;
      let chapDocs = this.docsByChapter.get(cKey);
      if (!chapDocs) {
        chapDocs = [];
        this.docsByChapter.set(cKey, chapDocs);
      }
      chapDocs.push(docId);

      const docThemes = this.themesByDoc.get(docId);
      if (docThemes) {
        let tSet = this.themesByText.get(textId);
        if (!tSet) {
          tSet = new Set<string>();
          this.themesByText.set(textId, tSet);
        }
        for (const t of docThemes) tSet.add(t.theme);
      }
    }

    for (const term of payload.xlingualTerms ?? []) {
      const list = this.xlingualByTheme.get(term.theme) ?? [];
      list.push(term);
      this.xlingualByTheme.set(term.theme, list);
    }
    for (const list of this.xlingualByTheme.values()) {
      list.sort((a, b) => b.inPassages - a.inPassages);
    }
  }

  get passageCount(): number {
    return this.pack.payload.count;
  }

  private hydrate(docId: number): Passage {
    return unpackPassage(
      this.pack.payload,
      docId,
      this.verseOrders[docId],
      this.themesByDoc.get(docId) ?? []
    );
  }

  getPassageByKey(key: string): Passage | null {
    const docId = this.keyToDoc.get(key);
    return docId === undefined ? null : this.hydrate(docId);
  }

  getPassagesByKeys(keys: string[]): Passage[] {
    const out: Passage[] = [];
    for (const key of keys) {
      const p = this.getPassageByKey(key);
      if (p) out.push(p);
    }
    return out;
  }

  getPassagesByText(textId: TextId, limit = 100, offset = 0): Passage[] {
    const docs = this.docsByText.get(textId) ?? [];
    return docs.slice(offset, offset + limit).map((d) => this.hydrate(d));
  }

  getPassagesByBook(textId: TextId, bookSlug: string, limit = 200, offset = 0): Passage[] {
    const docs = this.docsByBook.get(`${textId}:${bookSlug}`) ?? [];
    return docs.slice(offset, offset + limit).map((d) => this.hydrate(d));
  }

  getPassagesByChapter(textId: TextId, bookSlug: string, chapter: number): Passage[] {
    const docs = this.docsByChapter.get(`${textId}:${bookSlug}:${chapter}`) ?? [];
    return docs.map((d) => this.hydrate(d));
  }

  getBooks(textId: TextId): BookMetadata[] {
    return this.booksByText.get(textId) ?? [];
  }

  getBook(textId: TextId, bookId: string): BookMetadata | null {
    return this.bookByKey.get(`${textId}:${bookId}`) ?? null;
  }

  getXlingualTermsForTheme(theme: string, limit = 4): XlingualTerm[] {
    return (this.xlingualByTheme.get(theme) ?? []).slice(0, limit);
  }

  getTextStats(textId: TextId) {
    const meta = TEXT_METADATA[textId];
    return {
      textId,
      name: meta?.name ?? textId,
      originalLanguage: meta?.originalLanguage ?? null,
      direction: meta?.direction ?? 'ltr',
      passageCount: (this.docsByText.get(textId) ?? []).length,
      bookCount: (this.booksByText.get(textId) ?? []).length,
      themeCount: (this.themesByText.get(textId) ?? new Set()).size,
      crossRefCount: 0,
      alignmentCount: 0,
    };
  }

  getCorpusStats() {
    const texts = (Object.keys(TEXT_METADATA) as TextId[]).map((textId) => this.getTextStats(textId));
    return {
      texts,
      totals: {
        passages: texts.reduce((sum, t) => sum + t.passageCount, 0),
        books: texts.reduce((sum, t) => sum + t.bookCount, 0),
        crossReferences: 0,
      },
    };
  }
}

let activeStore: PackStore | null = null;

/** Load (or return cached) PackStore from `filePath`. */
export function loadPackStore(filePath = defaultPackPath()): PackStore {
  if (!activeStore) {
    activeStore = new PackStore(readIlmPack(filePath));
  }
  return activeStore;
}

/** Return the loaded PackStore if `ILM_STORAGE=pack` (loading lazily if needed). */
export function getPackStoreIfEnabled(): PackStore | null {
  if (!isPackStorageEnabled()) return null;
  return loadPackStore();
}

/** Return an already-loaded PackStore without forcing a load, or load if the file exists. */
export function tryLoadPackStore(filePath = defaultPackPath()): PackStore | null {
  if (activeStore) return activeStore;
  if (!existsSync(filePath)) return null;
  activeStore = new PackStore(readIlmPack(filePath));
  return activeStore;
}

/** Test hook to inject or clear a PackStore. */
export function setPackStoreForTests(store: PackStore | null): void {
  activeStore = store;
}
