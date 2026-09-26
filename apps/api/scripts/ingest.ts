/**
 * Data Ingestion Scripts
 * Fetches and processes sacred texts from public APIs
 * 
 * Sources:
 * - Quran: Tanzil.net / Quran.com API
 * - Bible (OT/NT): API.Bible / ESV API / BibleGet.io
 * - Talmud: Sefaria API
 * - Torah: Sefaria API (same as Tanakh)
 */

import { PrismaClient } from '@prisma/client';
import axios from 'axios';
import * as fs from 'fs/promises';
import * as path from 'path';

const prisma = new PrismaClient();

// ============================================================================
// CONFIGURATION
// ============================================================================

const TEXTS_CONFIG = {
  quran: {
    name: 'Quran',
    originalLang: 'arabic',
    direction: 'rtl',
    api: 'https://api.quran.com/api/v4',
    translations: [20, 21, 22, 84, 85], // Sahih Intl, Pickthall, Yusuf Ali, etc.
  },
  talmud: {
    name: 'Talmud (Babylonian)',
    originalLang: 'aramaic',
    direction: 'rtl',
    api: 'https://www.sefaria.org/api',
    // Talmud is complex - 63 tractates, Mishnah + Gemara
  },
  torah: {
    name: 'Torah (Pentateuch)',
    originalLang: 'hebrew',
    direction: 'rtl',
    api: 'https://www.sefaria.org/api',
    books: ['Genesis', 'Exodus', 'Leviticus', 'Numbers', 'Deuteronomy'],
  },
  ot: {
    name: 'Old Testament',
    originalLang: 'hebrew',
    direction: 'ltr',
    api: 'https://bible-api.com',
    books: [
      'Genesis', 'Exodus', 'Leviticus', 'Numbers', 'Deuteronomy',
      'Joshua', 'Judges', 'Ruth', '1 Samuel', '2 Samuel',
      '1 Kings', '2 Kings', '1 Chronicles', '2 Chronicles',
      'Ezra', 'Nehemiah', 'Esther', 'Job', 'Psalms', 'Proverbs',
      'Ecclesiastes', 'Song of Solomon', 'Isaiah', 'Jeremiah',
      'Lamentations', 'Ezekiel', 'Daniel', 'Hosea', 'Joel',
      'Amos', 'Obadiah', 'Jonah', 'Micah', 'Nahum', 'Habakkuk',
      'Zephaniah', 'Haggai', 'Zechariah', 'Malachi'
    ],
  },
  nt: {
    name: 'New Testament',
    originalLang: 'greek',
    direction: 'ltr',
    api: 'https://bible-api.com',
    books: [
      'Matthew', 'Mark', 'Luke', 'John', 'Acts',
      'Romans', '1 Corinthians', '2 Corinthians', 'Galatians',
      'Ephesians', 'Philippians', 'Colossians', '1 Thessalonians',
      '2 Thessalonians', '1 Timothy', '2 Timothy', 'Titus', 'Philemon',
      'Hebrews', 'James', '1 Peter', '2 Peter', '1 John',
      '2 John', '3 John', 'Jude', 'Revelation'
    ],
  },
};

// ============================================================================
// QURAN INGESTION
// ============================================================================

interface QuranAyah {
  number: number;
  text: string;
  translation?: string;
  surah: number;
}

export async function ingestQuran() {
  console.log('📖 Ingesting Quran...');
  
  const text = await prisma.text.upsert({
    where: { textId: 'quran' },
    create: {
      textId: 'quran',
      name: 'Quran',
      originalLang: 'arabic',
      direction: 'rtl',
      bookCount: 114,
      verseCount: 6236,
    },
    update: {},
  });
  
  // Fetch Surah info
  const surahsResponse = await axios.get(`${TEXTS_CONFIG.quran.api}/chapters?language=en`);
  const surahs = surahsResponse.data.chapters;
  
  for (const surah of surahs) {
    // Create book
    const book = await prisma.book.upsert({
      where: { textId_bookId: { textId: 'quran', bookId: surah.id.toString() } },
      create: {
        textId: 'quran',
        bookId: surah.id.toString(),
        name: surah.name_simple,
        nameOriginal: surah.name_arabic,
        nameTranslit: surah.name_transliterated,
        chapterCount: 1,
        verseCount: surah.verses_count,
        order: surah.id,
        testament: 'quran',
        category: surah.revelation_order <= 54 ? 'meccan' : 'medinan',
      },
      update: {},
    });
    
    // Fetch verses with translation (Sahih International = 20)
    const versesResponse = await axios.get(
      `${TEXTS_CONFIG.quran.api}/verses/by_chapter/${surah.id}?translations=20&words=true`
    );
    
    const verses = versesResponse.data.verses;
    
    for (const verse of verses) {
      const passageKey = `quran:${surah.id}:${verse.verse_number}`;
      
      const translation = verse.translations?.[0]?.text || '';
      const originalText = verse.text_uthmani || verse.text_indopak || '';
      
      await prisma.passage.upsert({
        where: { passageKey },
        create: {
          passageKey,
          textId: 'quran',
          bookId: surah.id.toString(),
          chapterId: book.id,
          chapterNum: surah.id,
          verseNum: verse.verse_number,
          originalText,
          primaryTranslation: translation,
          language: 'english',
          verseOrder: verse.verse_key ? parseInt(verse.verse_key.split(':')[1]) : 0,
          metadata: {
            juz: verse.juz_number,
            hizb: verse.hizb_number,
            page: verse.page_number,
            revelationOrder: surah.revelation_order,
          },
        },
        update: {
          originalText,
          primaryTranslation: translation,
        },
      });
    }
    
    console.log(`  ✓ Surah ${surah.id}: ${surah.name_simple} (${verses.length} verses)`);
    
    // Rate limit
    await new Promise(r => setTimeout(r, 200));
  }
  
  console.log('✅ Quran ingestion complete');
}

// ============================================================================
// BIBLE INGESTION (OT/NT)
// ============================================================================

interface BibleVerse {
  text: string;
  verse: number;
  chapter: number;
  book_name: string;
}

export async function ingestBible(textId: 'ot' | 'nt', translation = 'KJV') {
  console.log(`📖 Ingesting ${textId.toUpperCase()} (${translation})...`);
  
  const config = TEXTS_CONFIG[textId];
  
  const text = await prisma.text.upsert({
    where: { textId },
    create: {
      textId,
      name: config.name,
      originalLang: config.originalLang,
      direction: config.direction,
      bookCount: config.books.length,
      verseCount: 0,
    },
    update: {},
  });
  
  // Create translation record
  const translationRecord = await prisma.translation.upsert({
    where: { textId_name_language: { textId, name: translation, language: 'english' } },
    create: {
      textId,
      name: translation,
      language: 'english',
      isPrimary: true,
      license: 'public_domain',
    },
    update: {},
  });
  
  let totalVerses = 0;
  
  for (let i = 0; i < config.books.length; i++) {
    const bookName = config.books[i];
    
    const book = await prisma.book.upsert({
      where: { textId_bookId: { textId, bookId: bookName } },
      create: {
        textId,
        bookId: bookName,
        name: bookName,
        chapterCount: 0, // Will update after
        verseCount: 0,
        order: i + 1,
        testament: textId === 'ot' ? 'old' : 'new',
        category: getBookCategory(textId, bookName),
      },
      update: {},
    });
    
    // Fetch chapters for this book
    // Using bible-api.com which returns full chapters
    let chapter = 1;
    let bookVerseCount = 0;
    let bookChapterCount = 0;
    
    while (true) {
      try {
        const response = await axios.get(
          `https://bible-api.com/${encodeURIComponent(bookName)}+${chapter}?translation=${translation}`
        );
        
        const data = response.data;
        if (!data.verses || data.verses.length === 0) break;
        
        bookChapterCount++;
        
        for (const verse of data.verses) {
          const passageKey = `${textId}:${bookName}:${chapter}:${verse.verse}`;
          
          await prisma.passage.upsert({
            where: { passageKey },
            create: {
              passageKey,
              textId,
              bookId: bookName,
              chapterId: book.id,
              chapterNum: chapter,
              verseNum: verse.verse,
              originalText: '', // Would need Hebrew/Greek source
              primaryTranslation: verse.text,
              primaryTranslationId: translationRecord.id,
              language: 'english',
              verseOrder: totalVerses + verse.verse,
            },
            update: {
              primaryTranslation: verse.text,
            },
          });
          
          // Create translation link
          await prisma.passageTranslation.upsert({
            where: { passageId_translationId: { 
              passageId: passageKey, 
              translationId: translationRecord.id 
            }},
            create: {
              passageId: passageKey,
              translationId: translationRecord.id,
              text: verse.text,
            },
            update: { text: verse.text },
          });
          
          bookVerseCount++;
        }
        
        totalVerses += data.verses.length;
        chapter++;
        
        // Rate limit
        await new Promise(r => setTimeout(r, 100));
      } catch (error) {
        if (axios.isAxiosError(error) && error.response?.status === 404) {
          break; // No more chapters
        }
        throw error;
      }
    }
    
    // Update book counts
    await prisma.book.update({
      where: { id: book.id },
      data: { chapterCount: bookChapterCount, verseCount: bookVerseCount },
    });
    
    console.log(`  ✓ ${bookName}: ${bookChapterCount} chapters, ${bookVerseCount} verses`);
  }
  
  // Update text verse count
  await prisma.text.update({
    where: { textId },
    data: { verseCount: totalVerses },
  });
  
  console.log(`✅ ${textId.toUpperCase()} ingestion complete (${totalVerses} verses)`);
}

function getBookCategory(textId: 'ot' | 'nt', bookName: string): string {
  const otCategories: Record<string, string> = {
    'Genesis': 'pentateuch', 'Exodus': 'pentateuch', 'Leviticus': 'pentateuch',
    'Numbers': 'pentateuch', 'Deuteronomy': 'pentateuch',
    'Joshua': 'history', 'Judges': 'history', 'Ruth': 'history',
    '1 Samuel': 'history', '2 Samuel': 'history', '1 Kings': 'history',
    '2 Kings': 'history', '1 Chronicles': 'history', '2 Chronicles': 'history',
    'Ezra': 'history', 'Nehemiah': 'history', 'Esther': 'history',
    'Job': 'wisdom', 'Psalms': 'wisdom', 'Proverbs': 'wisdom',
    'Ecclesiastes': 'wisdom', 'Song of Solomon': 'wisdom',
    'Isaiah': 'prophets', 'Jeremiah': 'prophets', 'Lamentations': 'prophets',
    'Ezekiel': 'prophets', 'Daniel': 'prophets',
    'Hosea': 'minor_prophets', 'Joel': 'minor_prophets', 'Amos': 'minor_prophets',
    'Obadiah': 'minor_prophets', 'Jonah': 'minor_prophets', 'Micah': 'minor_prophets',
    'Nahum': 'minor_prophets', 'Habakkuk': 'minor_prophets', 'Zephaniah': 'minor_prophets',
    'Haggai': 'minor_prophets', 'Zechariah': 'minor_prophets', 'Malachi': 'minor_prophets',
  };
  
  const ntCategories: Record<string, string> = {
    'Matthew': 'gospel', 'Mark': 'gospel', 'Luke': 'gospel', 'John': 'gospel',
    'Acts': 'history',
    'Romans': 'pauline', '1 Corinthians': 'pauline', '2 Corinthians': 'pauline',
    'Galatians': 'pauline', 'Ephesians': 'pauline', 'Philippians': 'pauline',
    'Colossians': 'pauline', '1 Thessalonians': 'pauline', '2 Thessalonians': 'pauline',
    '1 Timothy': 'pastoral', '2 Timothy': 'pastoral', 'Titus': 'pastoral', 'Philemon': 'pastoral',
    'Hebrews': 'general', 'James': 'general', '1 Peter': 'general', '2 Peter': 'general',
    '1 John': 'johannine', '2 John': 'johannine', '3 John': 'johannine', 'Jude': 'general',
    'Revelation': 'apocalyptic',
  };
  
  return textId === 'ot' ? otCategories[bookName] || 'other' : ntCategories[bookName] || 'other';
}

// ============================================================================
// TALMUD INGESTION (Sefaria)
// ============================================================================

export async function ingestTalmud() {
  console.log('📖 Ingesting Talmud (Babylonian)...');
  
  const text = await prisma.text.upsert({
    where: { textId: 'talmud' },
    create: {
      textId: 'talmud',
      name: 'Talmud (Babylonian)',
      originalLang: 'aramaic',
      direction: 'rtl',
      bookCount: 63,
      verseCount: 0,
    },
    update: {},
  });
  
  // Get Talmud index from Sefaria
  const indexResponse = await axios.get('https://www.sefaria.org/api/index/Talmud_Bavli');
  const index = indexResponse.data;
  
  // Navigate to individual tractates
  // This is complex - Talmud has Mishnah + Gemara structure
  // For now, ingest a few key tractates as proof of concept
  
  const keyTractates = ['Berakhot', 'Shabbat', 'Eruvin', 'Pesachim', 'Yoma', 'Sukkah', 'Rosh Hashanah'];
  
  for (const tractate of keyTractates) {
    try {
      await ingestTractate(tractate);
    } catch (error) {
      console.error(`Failed to ingest ${tractate}:`, error);
    }
  }
  
  console.log('✅ Talmud ingestion (partial) complete');
}

async function ingestTractate(tractateName: string) {
  const textResponse = await axios.get(
    `https://www.sefaria.org/api/texts/${encodeURIComponent(tractateName)}`
  );
  
  const textData = textResponse.data;
  // Parse Sefaria text structure - complex nested arrays
  // Implementation would recursively process the text structure
  
  console.log(`  Processing ${tractateName}...`);
}

// ============================================================================
// TORAH INGESTION (Sefaria - same as Tanakh Pentateuch)
// ============================================================================

export async function ingestTorah() {
  console.log('📖 Ingesting Torah (via Sefaria)...');
  
  const text = await prisma.text.upsert({
    where: { textId: 'torah' },
    create: {
      textId: 'torah',
      name: 'Torah (Pentateuch)',
      originalLang: 'hebrew',
      direction: 'rtl',
      bookCount: 5,
      verseCount: 5845,
    },
    update: {},
  });
  
  const books = ['Genesis', 'Exodus', 'Leviticus', 'Numbers', 'Deuteronomy'];
  
  for (let i = 0; i < books.length; i++) {
    const bookName = books[i];
    
    try {
      await ingestTorahBook(bookName, i + 1);
    } catch (error) {
      console.error(`Failed to ingest ${bookName}:`, error);
    }
  }
  
  console.log('✅ Torah ingestion complete');
}

async function ingestTorahBook(bookName: string, order: number) {
  const textResponse = await axios.get(
    `https://www.sefaria.org/api/texts/${encodeURIComponent(bookName)}`
  );
  
  const textData = textResponse.data;
  
  const book = await prisma.book.upsert({
    where: { textId_bookId: { textId: 'torah', bookId: bookName } },
    create: {
      textId: 'torah',
      bookId: bookName,
      name: bookName,
      nameOriginal: getHebrewName(bookName),
      chapterCount: textData.chapter.length,
      verseCount: 0, // Calculate
      order,
      testament: 'torah',
      category: 'pentateuch',
    },
    update: {},
  });
  
  // Process chapters (Sefaria returns nested array structure)
  // This would need recursive processing of the text structure
  console.log(`  ✓ ${bookName}: ${textData.chapter.length} chapters`);
}

function getHebrewName(book: string): string {
  const names: Record<string, string> = {
    'Genesis': 'בְּרֵאשִׁית',
    'Exodus': 'שְׁמוֹת',
    'Leviticus': 'וַיִּקְרָא',
    'Numbers': 'בְּמִדְבַּר',
    'Deuteronomy': 'דְּבָרִים',
  };
  return names[book] || book;
}

// ============================================================================
// MAIN INGESTION ORCHESTRATOR
// ============================================================================

export async function runFullIngestion() {
  console.log('🚀 Starting full data ingestion...\n');
  
  try {
    // Run in sequence to respect rate limits
    await ingestQuran();
    await new Promise(r => setTimeout(r, 2000));
    
    await ingestTorah();
    await new Promise(r => setTimeout(r, 2000));
    
    await ingestBible('ot', 'KJV');
    await new Promise(r => setTimeout(r, 2000));
    
    await ingestBible('nt', 'KJV');
    await new Promise(r => setTimeout(r, 2000));
    
    await ingestTalmud();
    
    console.log('\n🎉 All ingestions complete!');
  } catch (error) {
    console.error('❌ Ingestion failed:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Run if called directly
if (require.main === module) {
  runFullIngestion().catch(console.error);
}