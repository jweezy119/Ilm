"""Models for Ilm - Quran AI App"""

from dataclasses import dataclass
from enum import Enum
from typing import Optional, List


class Language(Enum):
    AR = "ar"  # Arabic
    UR = "ur"  # Urdu
    EN = "en"  # English
    HE = "he"  # Hebrew
    FR = "fr"  # French


@dataclass
class QuranVerse:
    """Represents a single verse from the Quran."""
    id: int
    chapter: str
    verse_number: int
    text: str
    translation: Optional[str] = None
    language: Language = Language.AR
    
    def to_dict(self):
        return {
            "id": self.id,
            "chapter": self.chapter,
            "verse_number": self.verse_number,
            "text": self.text,
            "translation": self.translation,
            "language": self.language.value,
        }


@dataclass
class HadithInference:
    """Separate hadith inference data (not part of Quran text)."""
    id: int
    hadith_id: str
    theme: str
    insight: str
    source: str
    
    def to_dict(self):
        return {
            "id": self.id,
            "hadith_id": self.hadith_id,
            "theme": self.theme,
            "insight": self.insight,
            "source": self.source,
        }


class QuranModel:
    """Handles Quran data processing and retrieval."""
    
    def __init__(self, api: "QuraanApi"):
        self.api = api
    
    def get_verse_by_id(self, verse_id: int) -> Optional[QuranVerse]:
        """Retrieve a verse by its ID."""
        # Implementation: call API to get verse
        pass
    
    def search_verses(self, query: str, language: Language = Language.AR) -> List[QuranVerse]:
        """Search for verses matching a query."""
        # Implementation: search API endpoint
        pass
    
    def get_all_verses(self) -> List[QuranVerse]:
        """Get all verses from the Quran."""
        # Implementation: fetch all verses
        pass
    
    def get_translation(self, verse_id: int, language: Language) -> Optional[str]:
        """Get translated version of a verse."""
        # Implementation: fetch translation
        pass
    
    def load_hadith_inferences(self) -> List[HadithInference]:
        """Load hadith inference data separately from Quran text."""
        # Implementation: load from data directory
        pass
