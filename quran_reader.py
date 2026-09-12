"""Quran Reader - A user-friendly module for managing Quran surahs and verses."""

from typing import List, Optional
from dataclasses import dataclass


@dataclass
class SurahInfo:
    """Information about a single surah (chapter)."""
    id: int
    name: str
    count: int
    verses: List[int]
    language: str
    
    def __str__(self) -> str:
        return f"Surah {self.id}: {self.name} ({self.count} verses) - {self.language}"


class QuranReader:
    """
    A user-friendly interface for accessing Quran surahs and verses.
    
    Provides easy methods to get all surahs, specific surahs, and their verses.
    
    Example:
        reader = QuranReader()
        for surah in reader.get_all_surahs():
            print(surah)
    """
    
    def __init__(self, base_url: str = "https://api.quran.com/api/v4"):
        """
        Initialize the Quran reader.
        
        Args:
            base_url: Base URL for the Quran API (default: https://api.quran.com/api/v4)
        """
        self.data_service = DataService()
        self.api = DataService()
        self.base_url = base_url
    
    def get_all_surahs(self, language: str = "en") -> List[SurahInfo]:
        """
        Get all surahs (chapters) of the Quran.
        
        Args:
            language: Language for translations (default: "en" for English)
            
        Returns:
            List of SurahInfo objects for all surahs
        """
        chapters = self.data_service.get_all_quran_chapters(language=language)
        
        surahs = []
        for chapter in chapters:
            # Get all verses for this surah
            surah_verses = self.data_service.get_quran_surah(chapter.id, language=language)
            
            surah_info = SurahInfo(
                id=chapter.id,
                name=chapter.chapter,
                count=len(surah_verses),
                verses=[v.id for v in surah_verses],
                language=language
            )
            surahs.append(surah_info)
        
        return surahs
    
    def get_surah_by_id(self, surah_id: int) -> Optional[SurahInfo]:
        """
        Get a specific surah by its chapter number.
        
        Args:
            surah_id: The chapter number (1-114)
            
        Returns:
            SurahInfo object if found, None otherwise
        """
        surah_verses = self.data_service.get_quran_surah(surah_id, language="en")
        if surah_verses:
            return SurahInfo(
                id=surah_verses[0].id,
                name=surah_verses[0].chapter,
                count=len(surah_verses),
                verses=[v.id for v in surah_verses],
                language="en"
            )
        return None
    
    def get_surah_with_verses(self, surah_id: int) -> Optional[List[int]]:
        """
        Get all verse IDs for a specific surah.
        
        Args:
            surah_id: The chapter number (1-114)
            
        Returns:
            List of verse IDs, or None if surah not found
        """
        return self.data_service.get_quran_surah(surah_id, language="en")
    
    def get_surah_info(self, surah_id: int) -> Optional[SurahInfo]:
        """
        Get detailed information about a specific surah.
        
        Args:
            surah_id: The chapter number (1-114)
            
        Returns:
            SurahInfo object with detailed info, or None if not found
        """
        surah_verses = self.data_service.get_quran_surah(surah_id, language="en")
        if surah_verses:
            return SurahInfo(
                id=surah_verses[0].id,
                name=surah_verses[0].chapter,
                count=len(surah_verses),
                verses=[v.id for v in surah_verses],
                language="en"
            )
        return None
    
    def get_surah_names(self, language: str = "en") -> List[str]:
        """
        Get the names of all surahs.
        
        Args:
            language: Language for translations (default: "en")
            
        Returns:
            List of surah names
        """
        surahs = self.get_all_surahs(language=language)
        return [s.name for s in surahs]
    
    def get_surah_by_name(self, name: str) -> Optional[SurahInfo]:
        """
        Find a surah by its name (first occurrence).
        
        Args:
            name: The surah name (e.g., "Al-Fatiha")
            
        Returns:
            SurahInfo object if found, None otherwise
        """
        for surah in self.get_all_surahs():
            if surah.name.lower() == name.lower():
                return surah
        return None
    
    def get_surah_by_index(self, index: int) -> Optional[SurahInfo]:
        """
        Get a surah by its zero-based index.
        
        Args:
            index: Zero-based index of the surah (0-113)
            
        Returns:
            SurahInfo object if found, None otherwise
        """
        surahs = self.get_all_surahs()
        if 0 <= index < len(surahs):
            return surahs[index]
        return None
    
    def display_surahs(self, language: str = "en") -> None:
        """
        Display all surahs in a formatted table.
        
        Args:
            language: Language for translations (default: "en")
        """
        surahs = self.get_all_surahs(language=language)
        if not surahs:
            print("No surahs found.")
            return
        
        print(f"{'ID':<4} {'Name':<25} {'Verses':<8} {'Language'}")
        print("-" * 60)
        for surah in surahs:
            print(f"{surah.id:<4} {surah.name:<25} {surah.count:<8} {surah.language}")
    
    def display_single_surah(self, surah_id: int) -> None:
        """
        Display detailed information about a single surah.
        
        Args:
            surah_id: The chapter number (1-114)
        """
        surah = self.get_surah_by_id(surah_id)
        if surah:
            print(f"Surah #{surah.id}: {surah.name}")
            print(f"  Verses: {surah.count}")
            print(f"  Language: {surah.language}")
            print(f"  First verse: {surah.verses[0] if surah.verses else 'N/A'}")
        else:
            print(f"Surah #{surah_id} not found.")


# Convenience function for quick access
def get_quran_reader() -> QuranReader:
    """Factory function to create a QuranReader instance."""
    return QuranReader()
