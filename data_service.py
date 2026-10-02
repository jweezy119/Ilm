"""Data Service - Connects to real Quran and Hadith APIs"""

import requests
import json
import re
import time
from collections import OrderedDict
from typing import List, Dict, Optional, Any
from dataclasses import dataclass
from pathlib import Path


@dataclass
class Verse:
    id: int
    verse_number: int
    text: str
    translation: Optional[str] = None
    transliteration: Optional[str] = None
    audio_url: Optional[str] = None
    chapter_id: Optional[int] = None
    chapter_name: Optional[str] = None
    juz_number: Optional[int] = None
    hizb_number: Optional[int] = None
    ruku_number: Optional[int] = None
    manzil_number: Optional[int] = None
    sajdah_number: Optional[int] = None
    verse_key: Optional[str] = None


@dataclass
class Chapter:
    id: int
    name_simple: str
    name_complex: str
    name_arabic: str
    revelation_place: str
    verses_count: int
    translated_name: Dict[str, str]


@dataclass
class Hadith:
    id: str
    collection: str
    book: str
    chapter: str
    hadith_number: str
    arabic_text: Optional[str]
    english_text: Optional[str]
    narrator: Optional[str]
    grade: Optional[str] = None
    reference: Optional[str] = None


class QuranAPIService:
    """Primary service for accessing Quran data from api.quran.com"""
    
    BASE_URL = "https://api.quran.com/api/v4"
    
    def __init__(self):
        self.session = requests.Session()
        self.session.headers.update({
            "Accept": "application/json",
            "User-Agent": "Ilm-Quran-App/1.0"
        })
        self._chapters_cache: Optional[List[Chapter]] = None
    
    def get_chapters(self, language: str = "en") -> List[Chapter]:
        """Get all chapters/surahs of the Quran."""
        if self._chapters_cache:
            return self._chapters_cache
        
        url = f"{self.BASE_URL}/chapters"
        params = {"language": language}
        
        try:
            response = self.session.get(url, params=params, timeout=30)
            response.raise_for_status()
            data = response.json()
            
            chapters = []
            for ch in data.get("chapters", []):
                chapters.append(Chapter(
                    id=ch["id"],
                    name_simple=ch["name_simple"],
                    name_complex=ch["name_complex"],
                    name_arabic=ch["name_arabic"],
                    revelation_place=ch["revelation_place"],
                    verses_count=ch["verses_count"],
                    translated_name=ch.get("translated_name", {})
                ))
            
            self._chapters_cache = chapters
            return chapters
        except Exception as e:
            print(f"Error fetching chapters: {e}")
            return []


class AlQuranCloudService:
    """Primary text source using Al Quran Cloud API - reliable for Arabic + translations."""
    
    BASE_URL = "https://api.alquran.cloud/v1"
    
    def __init__(self):
        self.session = requests.Session()
        self.session.headers.update({
            "Accept": "application/json",
            "User-Agent": "Ilm-Quran-App/1.0"
        })
    
    def get_surah(self, surah_number: int, arabic_edition: str = "ar.uthmani", translation_edition: str = "en.sahih") -> List[Verse]:
        """Get a full surah with Arabic text and translation."""
        verses = []
        
        # Fetch Arabic text
        try:
            url = f"{self.BASE_URL}/surah/{surah_number}/{arabic_edition}"
            response = self.session.get(url, timeout=60)
            response.raise_for_status()
            data = response.json().get("data", {})
            arabic_ayahs = data.get("ayahs", [])
            
            # Fetch translation if different from Arabic edition
            translation_map = {}
            if translation_edition and translation_edition != arabic_edition:
                try:
                    trans_url = f"{self.BASE_URL}/surah/{surah_number}/{translation_edition}"
                    trans_resp = self.session.get(trans_url, timeout=60)
                    trans_resp.raise_for_status()
                    trans_data = trans_resp.json().get("data", {})
                    for ta in trans_data.get("ayahs", []):
                        translation_map[ta.get("numberInSurah")] = ta.get("text", "")
                except Exception as e:
                    print(f"Translation fetch error: {e}")
            
            for a in arabic_ayahs:
                verses.append(Verse(
                    id=a.get("number", 0),
                    verse_number=a.get("numberInSurah", 0),
                    text=a.get("text", ""),
                    translation=translation_map.get(a.get("numberInSurah")),
                    audio_url=a.get("audio"),
                    chapter_id=surah_number,
                    juz_number=a.get("juz"),
                    hizb_number=a.get("hizbQuarter"),
                    ruku_number=a.get("ruku"),
                    verse_key=f"{surah_number}:{a.get('numberInSurah')}"
                ))
        except Exception as e:
            print(f"Error fetching surah {surah_number}: {e}")
        
        return verses
    
    def get_verse(self, verse_key: str, arabic_edition: str = "ar.uthmani", translation_edition: str = "en.sahih") -> Optional[Verse]:
        """Get a specific verse with Arabic and translation."""
        # verse_key format: "2:255". Malformed keys used to raise
        # ValueError and surface as a 500; reject them cleanly instead.
        if not verse_key or not isinstance(verse_key, str):
            return None
        parts = verse_key.strip().split(":")
        if len(parts) != 2 or not parts[0].isdigit() or not parts[1].isdigit():
            return None

        chapter = int(parts[0])
        verse_num = int(parts[1])
        if not 1 <= chapter <= 114:
            return None
        
        try:
            # Get Arabic
            url = f"{self.BASE_URL}/ayah/{verse_key}/{arabic_edition}"
            response = self.session.get(url, timeout=30)
            response.raise_for_status()
            data = response.json().get("data", {})
            
            # Get translation if different
            translation = None
            if translation_edition and translation_edition != arabic_edition:
                try:
                    trans_url = f"{self.BASE_URL}/ayah/{verse_key}/{translation_edition}"
                    trans_resp = self.session.get(trans_url, timeout=30)
                    trans_resp.raise_for_status()
                    translation = trans_resp.json().get("data", {}).get("text")
                except Exception:
                    pass
            
            return Verse(
                id=data.get("number", 0),
                verse_number=data.get("numberInSurah", verse_num),
                text=data.get("text", ""),
                translation=translation,
                audio_url=data.get("audio"),
                chapter_id=chapter,
                juz_number=data.get("juz"),
                hizb_number=data.get("hizbQuarter"),
                ruku_number=data.get("ruku"),
                verse_key=verse_key
            )
        except Exception as e:
            print(f"Error fetching verse {verse_key}: {e}")
            return None
    
    def search(self, query: str, surah: str = "all") -> Optional[Dict]:
        """Search Quran text."""
        url = f"{self.BASE_URL}/search/{query}/{surah}"
        
        try:
            response = self.session.get(url, timeout=30)
            response.raise_for_status()
            return response.json().get("data")
        except Exception as e:
            print(f"Search error: {e}")
            return None


class HadithAPIService:
    """Service for accessing Hadith data from UmmahAPI"""
    
    BASE_URL = "https://ummahapi.com/api/hadith"
    
    def __init__(self):
        self.session = requests.Session()
        self.session.headers.update({
            "Accept": "application/json",
            "User-Agent": "Ilm-Quran-App/1.0"
        })
        self._collections_cache: Optional[List[str]] = None
    
    def get_collections(self) -> List[str]:
        """Get list of available hadith collections."""
        if self._collections_cache:
            return self._collections_cache
        
        url = f"{self.BASE_URL}/collections"
        
        try:
            response = self.session.get(url, timeout=30)
            response.raise_for_status()
            payload = response.json()
            inner = payload.get("data", {})
            collections = inner.get("collections", [])
            if isinstance(collections, dict):
                collections = list(collections.keys())
            elif isinstance(collections, list):
                collections = [
                    c.get("key") or c.get("name") or str(c)
                    for c in collections
                    if isinstance(c, dict)
                ]
            self._collections_cache = [c for c in collections if c]
            return self._collections_cache
        except Exception as e:
            print(f"Error fetching hadith collections: {e}")
            return []
    
    def get_hadith(self, collection: str, hadith_number: int) -> Optional[Hadith]:
        """Get a specific hadith from a collection."""
        url = f"{self.BASE_URL}/{collection}/{hadith_number}"
        
        try:
            response = self.session.get(url, timeout=30)
            response.raise_for_status()
            data = response.json()
            h = data.get("data", {})
            
            return Hadith(
                id=h.get("id", f"{collection}:{hadith_number}"),
                collection=collection,
                book=h.get("collection_name", ""),
                chapter=h.get("chapter", ""),
                hadith_number=str(h.get("hadithnumber", hadith_number)),
                arabic_text=h.get("arabic"),
                english_text=h.get("english"),
                narrator=h.get("narrator"),
                grade=h.get("grade"),
                reference=h.get("reference")
            )
        except Exception as e:
            print(f"Error fetching hadith {collection}:{hadith_number}: {e}")
            return None
    
    def search_hadiths(self, query: str, collections: Optional[List[str]] = None) -> List[Hadith]:
        """Search hadiths by keyword."""
        url = f"{self.BASE_URL}/search"
        params = {"q": query}

        if collections:
            params["collections"] = ",".join(collections)

        try:
            # Kept short deliberately: this runs inline with the user's
            # chat request, so a slow provider must not stall the answer.
            response = self.session.get(url, params=params, timeout=8)
            response.raise_for_status()
            payload = response.json()
            inner = payload.get("data", {})
            hadith_list = inner.get("hadiths", []) if isinstance(inner, dict) else []
            
            hadiths = []
            for h in hadith_list:
                hadiths.append(Hadith(
                    id=h.get("id", ""),
                    collection=h.get("collection", ""),
                    book=h.get("collection_name", ""),
                    chapter=h.get("chapter", ""),
                    hadith_number=str(h.get("hadithnumber", "")),
                    arabic_text=h.get("arabic"),
                    english_text=h.get("english"),
                    narrator=h.get("narrator"),
                    grade=h.get("grade"),
                    reference=h.get("reference")
                ))
            return hadiths
        except Exception as e:
            print(f"Hadith search error: {e}")
            return []

    def get_hadiths_by_collection(self, collection: str, limit: int = 20) -> List[Hadith]:
        """Get hadiths for a specific collection (paginated)."""
        url = f"{self.BASE_URL}/{collection}"
        params = {"limit": limit}
        
        try:
            response = self.session.get(url, params=params, timeout=30)
            response.raise_for_status()
            payload = response.json()
            inner = payload.get("data", {})
            hadith_list = inner.get("hadiths", []) if isinstance(inner, dict) else []
            
            hadiths = []
            for h in hadith_list:
                hadiths.append(Hadith(
                    id=h.get("id", ""),
                    collection=h.get("collection", ""),
                    book=h.get("collection_name", ""),
                    chapter=h.get("chapter", ""),
                    hadith_number=str(h.get("hadithnumber", "")),
                    arabic_text=h.get("arabic"),
                    english_text=h.get("english"),
                    narrator=h.get("narrator"),
                    grade=h.get("grade"),
                    reference=h.get("reference")
                ))
            return hadiths
        except Exception as e:
            print(f"Error fetching collection {collection}: {e}")
            return []
    
    def get_random_hadith(self, collection: Optional[str] = None) -> Optional[Hadith]:
        """Get a random hadith, optionally from a specific collection."""
        url = f"{self.BASE_URL}/random"
        params = {}
        if collection:
            params["collection"] = collection
        
        try:
            response = self.session.get(url, params=params, timeout=30)
            response.raise_for_status()
            data = response.json()
            h = data.get("data", {})
            
            return Hadith(
                id=h.get("id", ""),
                collection=h.get("collection", ""),
                book=h.get("collection_name", ""),
                chapter=h.get("chapter", ""),
                hadith_number=str(h.get("hadithnumber", "")),
                arabic_text=h.get("arabic"),
                english_text=h.get("english"),
                narrator=h.get("narrator"),
                grade=h.get("grade"),
                reference=h.get("reference")
            )
        except Exception as e:
            print(f"Error fetching random hadith: {e}")
            return None


class DataService:
    """Unified data service for Quran and Hadith APIs"""
    
    CACHE_VERSION = 2
    CACHE_TTL_SECONDS = 7 * 24 * 60 * 60  # 7 days
    HADITH_CACHE_TTL = 300  # seconds
    HADITH_CACHE_SIZE = 64

    def __init__(self, cache_dir: Optional[Path] = None):
        self.quran_service = QuranAPIService()
        self.hadith_service = HadithAPIService()
        self.fallback_service = AlQuranCloudService()
        self.cache_dir = cache_dir or (Path(__file__).parent / "data")
        self._full_quran_cache: Optional[List[Verse]] = None
        self._hadith_search_cache: "OrderedDict[Any, Any]" = OrderedDict()
    
    @staticmethod
    def normalize_verse_key(verse_key: str) -> Optional[str]:
        """Reduce a reference to a single fetchable verse key.

        Recommendation topics use ranges such as "1:1-3" or "55:1-13",
        which are valid references but not single verses. Fetch the first
        verse of the range; the caller keeps the full range for display.
        """
        if not verse_key or not isinstance(verse_key, str):
            return None
        match = re.match(r"^\s*(\d{1,3})\s*:\s*(\d{1,3})", verse_key)
        if not match:
            return None
        chapter, verse = int(match.group(1)), int(match.group(2))
        if not 1 <= chapter <= 114:
            return None
        return f"{chapter}:{verse}"

    def get_quran_verse(self, verse_key: str, language: str = "en") -> Optional[Verse]:
        """Get a Quran verse with Arabic text and translation."""
        normalized = self.normalize_verse_key(verse_key)
        if not normalized:
            return None
        # Serve from the bulk cache when possible: one lookup instead of
        # two live HTTP calls, and immune to upstream rate limiting.
        cached = self._find_cached_verse(normalized, language)
        if cached:
            return cached
        arabic_edition = "ar.uthmani"
        translation_edition = f"{language}.sahih" if language != "ar" else None
        return self.fallback_service.get_verse(normalized, arabic_edition, translation_edition)
    
    def get_quran_surah(self, chapter: int, language: str = "en") -> List[Verse]:
        """Get a full surah with Arabic text and translation."""
        cached = self._get_full_quran(language)
        if cached:
            return [v for v in cached if v.chapter_id == chapter]
        arabic_edition = "ar.uthmani"
        translation_edition = f"{language}.sahih" if language != "ar" else None
        return self.fallback_service.get_surah(chapter, arabic_edition, translation_edition)

    def _find_cached_verse(self, verse_key: str, language: str) -> Optional[Verse]:
        """Look up a single verse in the bulk cache."""
        cached = self._get_full_quran(language)
        if not cached:
            return None
        for v in cached:
            if v.verse_key == verse_key:
                return v
        return None

    def _cache_path(self, language: str) -> Path:
        safe = re.sub(r"[^a-zA-Z0-9_-]", "", language or "en")
        return self.cache_dir / f"quran_full_{safe}_v{self.CACHE_VERSION}.json"

    def _get_full_quran(self, language: str = "en") -> List[Verse]:
        """Return the whole Quran, fetching it in a single request.

        The previous implementation fetched 30 surahs with two sequential
        requests each (60 calls) on the first user request. That took
        several seconds, hit 429 rate limits, and left the search index
        silently half-built. One bulk request takes well under a second
        and covers all 6236 verses.
        """
        if self._full_quran_cache is not None:
            return self._full_quran_cache

        path = self._cache_path(language)
        verses = self._load_cache_file(path)
        if verses is None:
            verses = self._fetch_full_quran(language)
            if verses:
                self._save_cache_file(path, verses)
        self._full_quran_cache = verses
        return verses

    def _load_cache_file(self, path: Path) -> Optional[List[Verse]]:
        try:
            if not path.exists():
                return None
            if (time.time() - path.stat().st_mtime) > self.CACHE_TTL_SECONDS:
                return None
            with path.open("r", encoding="utf-8") as fh:
                rows = json.load(fh)
            verses = [Verse(**row) for row in rows]
            return verses or None
        except Exception as e:
            print(f"Quran cache read failed: {e}")
            return None

    def _save_cache_file(self, path: Path, verses: List[Verse]) -> None:
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            tmp = path.with_suffix(".tmp")
            with tmp.open("w", encoding="utf-8") as fh:
                json.dump([vars(v) for v in verses], fh, ensure_ascii=False)
            tmp.replace(path)
        except Exception as e:
            print(f"Quran cache write failed: {e}")

    def _fetch_full_quran(self, language: str) -> List[Verse]:
        """Fetch the entire Quran (Arabic + translation) in two requests."""
        arabic_by_key: Dict[str, Dict] = {}
        translation_by_key: Dict[str, str] = {}

        try:
            url = f"{self.fallback_service.BASE_URL}/quran/ar.uthmani"
            response = self.fallback_service.session.get(url, timeout=90)
            response.raise_for_status()
            for surah in response.json().get("data", {}).get("surahs", []):
                number = surah.get("number")
                for ayah in surah.get("ayahs", []):
                    key = f"{number}:{ayah.get('numberInSurah')}"
                    arabic_by_key[key] = {
                        "text": ayah.get("text", ""),
                        "number": ayah.get("number", 0),
                        "juz": ayah.get("juz"),
                        "hizb": ayah.get("hizbQuarter"),
                        "ruku": ayah.get("ruku"),
                        "audio": ayah.get("audio"),
                    }
        except Exception as e:
            print(f"Bulk Arabic fetch failed: {e}")

        if language and language != "ar":
            try:
                edition = f"{language}.sahih"
                url = f"{self.fallback_service.BASE_URL}/quran/{edition}"
                response = self.fallback_service.session.get(url, timeout=90)
                response.raise_for_status()
                for surah in response.json().get("data", {}).get("surahs", []):
                    number = surah.get("number")
                    for ayah in surah.get("ayahs", []):
                        key = f"{number}:{ayah.get('numberInSurah')}"
                        translation_by_key[key] = ayah.get("text", "")
            except Exception as e:
                print(f"Bulk translation fetch failed: {e}")

        verses = []
        for key, data in arabic_by_key.items():
            chapter_text, verse_text = key.split(":")
            verses.append(Verse(
                id=data.get("number", 0),
                verse_number=int(verse_text),
                text=data.get("text", ""),
                translation=translation_by_key.get(key),
                audio_url=data.get("audio"),
                chapter_id=int(chapter_text),
                juz_number=data.get("juz"),
                hizb_number=data.get("hizb"),
                ruku_number=data.get("ruku"),
                verse_key=key
            ))
        return verses

    
    def search_quran(self, query: str, language: str = "en") -> List[Dict]:
        """Search the Quran."""
        results = []
        
        # Use api.quran.com search for Arabic text matches
        try:
            url = f"{self.quran_service.BASE_URL}/search"
            params = {"q": query, "language": language, "size": 20}
            response = self.quran_service.session.get(url, params=params, timeout=30)
            response.raise_for_status()
            data = response.json()
            
            for match in data.get("search", {}).get("results", []):
                results.append({
                    "verse_key": match.get("verse_key"),
                    "text": match.get("text", ""),
                    "translation": None,
                    "score": match.get("score", 0)
                })
        except Exception as e:
            print(f"Quran search error: {e}")
        
        # Fallback to alquran cloud search
        if not results:
            try:
                data = self.fallback_service.search(query)
                if data and isinstance(data, dict):
                    for match in data.get("matches", []):
                        results.append({
                            "verse_key": match.get("verseKey"),
                            "text": match.get("text", ""),
                            "translation": match.get("translation"),
                            "score": 1.0
                        })
            except Exception as e:
                print(f"Fallback search error: {e}")
        
        # Enhance results with translations for top matches
        for r in results[:5]:
            if not r.get("translation") and r.get("verse_key"):
                try:
                    v = self.get_quran_verse(r["verse_key"], language)
                    if v:
                        r["translation"] = v.translation
                except Exception:
                    pass
        
        return results
    
    def get_hadith(self, collection: str, hadith_number: int) -> Optional[Hadith]:
        """Get a specific hadith."""
        return self.hadith_service.get_hadith(collection, hadith_number)
    
    def search_hadiths(self, query: str, collections: Optional[List[str]] = None) -> List[Hadith]:
        """Search hadiths, memoized briefly to avoid repeat network calls."""
        key = (query.strip().lower(), tuple(collections) if collections else None)
        hit = self._hadith_search_cache.get(key)
        if hit and (time.time() - hit[0]) < self.HADITH_CACHE_TTL:
            return hit[1]

        hadiths = self.hadith_service.search_hadiths(query, collections)
        self._hadith_search_cache[key] = (time.time(), hadiths)
        while len(self._hadith_search_cache) > self.HADITH_CACHE_SIZE:
            self._hadith_search_cache.popitem(last=False)
        return hadiths

    def get_hadiths_by_collection(self, collection: str, limit: int = 20) -> List[Hadith]:
        """Get hadiths by collection."""
        return self.hadith_service.get_hadiths_by_collection(collection, limit)
    
    def get_random_hadith(self, collection: Optional[str] = None) -> Optional[Hadith]:
        """Get a random hadith."""
        return self.hadith_service.get_random_hadith(collection)
    
    def get_all_quran_chapters(self, language: str = "en") -> List[Chapter]:
        """Get all 114 chapters."""
        return self.quran_service.get_chapters(language)