"""Main application class for Ilm - Quran AI App"""

import os
from pathlib import Path

from data_service import DataService, Verse, Chapter, Hadith
from search_engine import (
    IntelligentSearchEngine,
    SearchResult,
    QueryIntent,
    ContextIntelligence,
    KnowledgeGraph,
    QueryUnderstanding
)
from agent import AgenticChatEngine
from recommendations import RecommendationEngine, Recommendation


class QuraanApp:
    """Main application controller for Ilm - Quran AI."""
    
    def __init__(self):
        # Base directory for the app
        self.base_dir = Path(__file__).parent.resolve()
        
        # Subdirectories
        self.api_dir = self.base_dir / "api"
        self.models_dir = self.base_dir / "models"
        self.views_dir = self.base_dir / "views"
        self.data_dir = self.base_dir / "data"
        self.assets_dir = self.base_dir / "assets"
        
        # Initialize services
        self.data_service = DataService()
        self.search_engine = IntelligentSearchEngine(data_service=self.data_service)
        self.context_intelligence = ContextIntelligence()
        self.recommendation_engine = RecommendationEngine(
            self.data_service,
            self.context_intelligence
        )
        self.agentic_chat = AgenticChatEngine(
            self.data_service,
            self.search_engine,
            self.context_intelligence
        )
        
        # Configuration
        self.config = {
            "quran_source": "online",
            "primary_quran_api": "api.quran.com",
            "fallback_quran_api": "api.alquran.cloud",
            "hadith_source": "ummahapi",
            "languages": ["ar", "ur", "en"],
            "enable_chat": True,
            "enable_search": True,
            "enable_recommendations": True,
            "enable_hadiths": True,
            "index_on_startup": True,
        }
        
        # Index Quran if enabled
        if self.config["index_on_startup"]:
            self._index_quran()
    
    def _index_quran(self):
        """Build search indexes from Quran text."""
        # Placeholder: would iterate surahs and index verses
        # For now, mark as ready
        print("Quran index initialized (connect to API to populate).")
    
    def get_quran_text(self, verse_key=None, language="en"):
        """Retrieve Quran text for a specific verse."""
        if not verse_key:
            return None
        return self.data_service.get_quran_verse(verse_key, language)
    
    def get_quran_surah(self, chapter, language="en"):
        """Retrieve all verses of a surah."""
        return self.data_service.get_quran_surah(chapter, language)
    
    def get_ai_response(self, question, user_id="default"):
        """Generate AI response to a user question about the Quran."""
        return self.agentic_chat.chat(user_id, question)
    
    def search_verses(self, query, language="en", user_id="default"):
        """Search for verses matching a query."""
        result = self.search_engine.search(query, user_id=user_id, limit=20)
        return {
            "query": query,
            "results": result.get("results", []),
            "intent": result.get("intent"),
            "insights": result.get("insights", [])
        }
    
    def get_recommendations(self, user_id="default", context=None):
        """Provide AI recommendations based on user context."""
        if context:
            self.context_intelligence.update_user_context(user_id, context)
        
        recs = self.recommendation_engine.get_personalized_recommendations(user_id)
        return [r.to_dict() for r in recs]
    
    def get_topic_recommendations(self, topic, user_id="default", limit=5):
        """Get recommendations for a specific topic."""
        recs = self.recommendation_engine.get_topic_recommendations(topic, user_id, limit)
        return [r.to_dict() for r in recs]
    
    def get_reading_plan(self, user_id="default", days=7):
        """Generate a personalized reading plan."""
        recs = self.recommendation_engine.get_contextual_reading_plan(user_id, days)
        return [r.to_dict() for r in recs]
    
    def load_hadith_inferences(self, query=None, collection=None):
        """Load hadith inference data separate from Quran text."""
        if query:
            hadiths = self.data_service.search_hadiths(query, [collection] if collection else None)
            return [vars(h) for h in hadiths]
        elif collection:
            # Return sample hadiths from collection
            hadiths = []
            for i in range(1, 6):
                h = self.data_service.get_hadith(collection, i)
                if h:
                    hadiths.append(vars(h))
            return hadiths
        else:
            # Return random hadith from various collections
            collections = ["bukhari", "muslim", "abudawud"]
            hadiths = []
            for col in collections:
                h = self.data_service.get_random_hadith(col)
                if h:
                    hadiths.append(vars(h))
            return hadiths
    
    def update_user_context(self, user_id, context):
        """Update user context for personalization."""
        self.context_intelligence.update_user_context(user_id, context)
    
    def get_quran_chapters(self, language="en"):
        """Get all chapters of the Quran."""
        return [vars(ch) for ch in self.data_service.get_all_quran_chapters(language)]


# Optional imports for package compatibility
try:
    from api.quran_api import QuraanApi
    from models.quran_model import QuranModel, HadithInference
    from views.chat_view import ChatView, SearchView, RecommendationView
except ImportError:
    pass

app = QuraanApp()
