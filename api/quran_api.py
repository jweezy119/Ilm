"""API layer for Ilm - Quran AI App"""

from typing import List, Dict, Optional
from data_service import DataService, Verse, Chapter, Hadith


class QuraanApi:
    """Handles API endpoints for Quran data and AI interactions."""
    
    def __init__(self, base_url=None):
        self.base_url = base_url or "https://api.quran.com/api/v4"
        self.data_service = DataService()
    
    def get_verse(self, verse_key: str, language: str = "en") -> Optional[Verse]:
        """Retrieve a specific verse from the Quran."""
        return self.data_service.get_quran_verse(verse_key, language)
    
    def get_surah(self, chapter: int, language: str = "en") -> List[Verse]:
        """Retrieve all verses of a surah."""
        return self.data_service.get_quran_surah(chapter, language)
    
    def search_verses(self, query: str, language: str = "en") -> List[Dict]:
        """Search for verses matching a query."""
        return self.data_service.search_quran(query, language)
    
    def get_translations(self, verse_key: str, language: str = "en") -> Optional[str]:
        """Get translated version of a verse."""
        verse = self.data_service.get_quran_verse(verse_key, language)
        return verse.translation if verse else None
    
    def get_all_chapters(self, language: str = "en") -> List[Chapter]:
        """Get all chapters of the Quran."""
        return self.data_service.get_all_quran_chapters(language)
    
    def get_ai_response(self, question: str, user_id: str = "default") -> Dict:
        """Generate AI response to a question about the Quran."""
        return self.data_service.get_ai_response(question, user_id)
    
    def get_recommendations(self, user_id: str = "default", context: Dict = None) -> List[Dict]:
        """Provide personalized recommendations."""
        return self.data_service.get_recommendations(user_id, context)
    
    def load_hadith_inferences(self, query: str = None, collection: str = None) -> List[Dict]:
        """Load hadith inference data separate from Quran text."""
        return self.data_service.load_hadith_inferences(query, collection)
    
    def get_random_hadith(self, collection: str = None) -> Optional[Hadith]:
        """Get a random hadith from a collection."""
        return self.data_service.get_random_hadith(collection)
    
    def search_hadiths(self, query: str, collections: List[str] = None) -> List[Hadith]:
        """Search hadiths by keyword."""
        return self.data_service.search_hadiths(query, collections)
