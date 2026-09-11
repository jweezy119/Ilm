"""Data Service - Connects to real Quran and Hadith APIs"""

import requests
import json
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
    
    def get_verse(self, verse_key: str, translation_edition: str = "en.sahih") -> Optional[Verse]:
        """Get a specific verse by key (e.g., "2:255")."""
        url = f"{self.BASE_URL}/verses/by_key/{verse_key}"
        params = {
            "fields": "text_uthmani,translations,transliteration",
            "translations": "language:en,text_uthmani"
        }
        
        try:
            response = self.session.get(url, params=params, timeout=30)
            response.raise_for_status()
            data = response.json()
            
            verse_data = data.get("verse", {})
            translations = verse_data.get("translations", [])
            translation_text = translations[0]["text"] if translations else None
            
            return Verse(
                id=verse_data["id"],
                verse_number=verse_data["verse_number"],
                text=verse_data.get("text_uthmani", ""),
                translation=translation_text,
                chapter_id=verse_data.get("chapter_id"),
                juz_number=verse_data.get("juz_number"),
                hizb_number=verse_data.get("hizb_number"),
                ruku_number=verse_data.get("ruku_number")
            )
        except Exception as e:
            print(f"Error fetching verse {verse_key}: {e}")
            return None
    
    def get_surah(self, chapter_number: int, translation_edition: str = "en.sahih") -> List[Verse]:
        """Get all verses of a specific surah."""
        url = f"{self.BASE_URL}/surah/{chapter_number}"
        params = {
            "fields": "text_uthmani,translations,transliteration,audio",
            "translations": "language:en,text_uthmani"
        }
        
        try:
            response = self.session.get(url, params=params, timeout=60)
            response.raise_for_status()
            data = response.json()
            
            verses = []
            for v in data.get("verses", []):
                translations = v.get("translations", [])
                translation_text = translations[0]["text"] if translations else None
                audio = v.get("audio", {})
                
                verses.append(Verse(
                    id=v["id"],
                    verse_number=v["verse_number"],
                    text=v.get("text_uthmani", ""),
                    translation=translation_text,
                    transliteration=audio.get("url"),
                    audio_url=audio.get("url"),
                    chapter_id=v.get("chapter_id")
                ))
            
            return verses
        except Exception as e:
            print(f"Error fetching surah {chapter_number}: {e}")
            return []
    
    def search_verses(self, query: str, language: str = "en") -> List[Dict]:
        """Search verses by keyword."""
        url = f"{self.BASE_URL}/search"
        params = {
            "q": query,
            "language": language,
            "size": 50
        }
        
        try:
            response = self.session.get(url, params=params, timeout=30)
            response.raise_for_status()
            data = response.json()
            
            results = []
            for match in data.get("search", {}).get("results", []):
                results.append({
                    "verse_key": match.get("verse_key"),
                    "text": match.get("text", ""),
                    "translation": match.get("translations", [{}])[0].get("text", ""),
                    "score": match.get("score", 0)
                })
            return results
        except Exception as e:
            print(f"Search error: {e}")
            return []


class AlQuranCloudService:
    """Alternative service using Al Quran Cloud API (api.alquran.cloud)"""
    
    BASE_URL = "https://api.alquran.cloud/v1"
    
    def __init__(self):
        self.session = requests.Session()
        self.session.headers.update({
            "Accept": "application/json",
            "User-Agent": "Ilm-Quran-App/1.0"
        })
    
    def get_surah(self, surah_number: int, edition: str = "en.sahih") -> Optional[Dict]:
        """Get a full surah with translations."""
        url = f"{self.BASE_URL}/surah/{surah_number}/{edition}"
        
        try:
            response = self.session.get(url, timeout=60)
            response.raise_for_status()
            return response.json().get("data")
        except Exception as e:
            print(f"Error fetching surah {surah_number} from Al Quran Cloud: {e}")
            return None
    
    def get_verse(self, verse_number: int, edition: str = "en.sahih") -> Optional[Dict]:
        """Get a specific verse by global number."""
        url = f"{self.BASE_URL}/ayah/{verse_number}/{edition}"
        
        try:
            response = self.session.get(url, timeout=30)
            response.raise_for_status()
            return response.json().get("data")
        except Exception as e:
            print(f"Error fetching verse {verse_number}: {e}")
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
            data = response.json()
            self._collections_cache = data.get("collections", [])
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
                id=f"{collection}:{hadith_number}",
                collection=collection,
                book=h.get("book", ""),
                chapter=h.get("chapter", ""),
                hadith_number=str(hadith_number),
                arabic_text=h.get("hadith_arabic"),
                english_text=h.get("hadith_english"),
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
            response = self.session.get(url, params=params, timeout=30)
            response.raise_for_status()
            data = response.json()
            
            hadiths = []
            for h in data.get("data", []):
                hadiths.append(Hadith(
                    id=h.get("id", ""),
                    collection=h.get("collection", ""),
                    book=h.get("book", ""),
                    chapter=h.get("chapter", ""),
                    hadith_number=str(h.get("number", "")),
                    arabic_text=h.get("hadith_arabic"),
                    english_text=h.get("hadith_english"),
                    narrator=h.get("narrator"),
                    grade=h.get("grade"),
                    reference=h.get("reference")
                ))
            return hadiths
        except Exception as e:
            print(f"Hadith search error: {e}")
            return []
    
    def get_random_hadith(self, collection: Optional[str] = None) -> Optional[Hadith]:
        """Get a random hadith, optionally from a specific collection."""
        url = f"{self.BASE_URL}/random"
        if collection:
            url += f"/{collection}"
        
        try:
            response = self.session.get(url, timeout=30)
            response.raise_for_status()
            data = response.json()
            h = data.get("data", {})
            
            return Hadith(
                id=h.get("id", ""),
                collection=h.get("collection", ""),
                book=h.get("book", ""),
                chapter=h.get("chapter", ""),
                hadith_number=str(h.get("number", "")),
                arabic_text=h.get("hadith_arabic"),
                english_text=h.get("hadith_english"),
                narrator=h.get("narrator"),
                grade=h.get("grade"),
                reference=h.get("reference")
            )
        except Exception as e:
            print(f"Error fetching random hadith: {e}")
            return None


class DataService:
    """Unified data service for Quran and Hadith APIs"""
    
    def __init__(self):
        self.quran_service = QuranAPIService()
        self.hadith_service = HadithAPIService()
        self.fallback_service = AlQuranCloudService()
    
    def get_quran_verse(self, verse_key: str, language: str = "en") -> Optional[Verse]:
        """Get a Quran verse with translation."""
        return self.quran_service.get_verse(verse_key, f"{language}.sahih")
    
    def get_quran_surah(self, chapter: int, language: str = "en") -> List[Verse]:
        """Get a full surah with translation."""
        return self.quran_service.get_surah(chapter, f"{language}.sahih")
    
    def search_quran(self, query: str, language: str = "en") -> List[Dict]:
        """Search the Quran."""
        results = self.quran_service.search_verses(query, language)
        if not results:
            # Fallback to Al Quran Cloud
            data = self.fallback_service.search(query)
            if data:
                results = data.get("matches", [])
        return results
    
    def get_hadith(self, collection: str, hadith_number: int) -> Optional[Hadith]:
        """Get a specific hadith."""
        return self.hadith_service.get_hadith(collection, hadith_number)
    
    def search_hadiths(self, query: str, collections: Optional[List[str]] = None) -> List[Hadith]:
        """Search hadiths."""
        return self.hadith_service.search_hadiths(query, collections)
    
    def get_random_hadith(self, collection: Optional[str] = None) -> Optional[Hadith]:
        """Get a random hadith."""
        return self.hadith_service.get_random_hadith(collection)
    
    def get_all_quran_chapters(self, language: str = "en") -> List[Chapter]:
        """Get all 114 chapters."""
        return self.quran_service.get_chapters(language)