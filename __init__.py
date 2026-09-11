"""Ilm - Quran AI Application"""

__version__ = "1.0.0"
__author__ = "Ilm Team"

# Core modules
from .data_service import DataService, Verse, Chapter, Hadith
from .search_engine import (
    IntelligentSearchEngine,
    InvertedIndex,
    SemanticSearchEngine,
    QueryUnderstanding,
    ContextIntelligence,
    KnowledgeGraph,
    SearchResult,
    QueryIntent
)
from .recommendations import RecommendationEngine, Recommendation
from .models.quran_model import QuranModel, HadithInference
from .views.chat_view import ChatView, SearchView, RecommendationView, HadithInferenceView
from .api.quran_api import QuraanApi
from .app import app as application

# Initialize the application
app = application
