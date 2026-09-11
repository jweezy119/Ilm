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
        # Analyze query intent
        intent = self.search_engine.query_understanding.analyze_query(question)
        
        # Expand query with related terms from knowledge graph and topic keywords
        expanded_queries = self._expand_query(question, intent)
        
        # Search with multiple expanded queries
        all_results = []
        for q in expanded_queries:
            result = self.search_engine.search(q, user_id=user_id, limit=10)
            all_results.extend(result.get("results", []))
        
        # Deduplicate by verse_id and re-rank
        seen = {}
        for r in all_results:
            key = r.verse_id
            if key not in seen or r.score > seen[key].score:
                seen[key] = r
        
        combined = sorted(seen.values(), key=lambda x: x.score, reverse=True)[:8]
        
        # Generate contextual insights
        insights = self._generate_answer_insights(question, combined, intent)
        
        # Generate suggestions
        suggestions = self._generate_suggestions(question, intent)
        
        # Update context
        self.context_intelligence.add_to_history(user_id, question, combined)
        
        return {
            "query": question,
            "intent": intent,
            "results": combined,
            "insights": insights,
            "suggestions": suggestions
        }
    
    def _expand_query(self, question: str, intent) -> list:
        """Expand query with related terms for better search."""
        queries = [question]
        query_lower = question.lower()
        
        # Add topic-based expansions from knowledge graph
        for topic in intent.topics:
            related = self.search_engine.context_intelligence.knowledge_graph.get_related_concepts(topic, depth=1)
            for concept in related[:3]:
                desc = concept.get("data", {}).get("description", "")
                if desc:
                    queries.append(f"{question} {desc}")
        
        # Add keyword expansions from query understanding topic keywords
        topic_keywords = getattr(intent, 'topics', [])
        for topic in topic_keywords[:3]:
            queries.append(f"Quran {topic}")
            queries.append(f"Islamic {topic}")
        
        # If question looks like a "what are" question, add direct topic search
        if any(word in query_lower for word in ["what are", "what is", "how should", "responsibilities", "duties", "rights"]):
            # Extract likely topic words
            words = query_lower.replace("?", "").replace("what are", "").replace("what is", "").replace("how should", "").replace("the", "").replace("in the quran", "").strip()
            if words:
                queries.append(words)
                # Also try the topic keyword mappings
                for topic, keywords in self.search_engine.query_understanding.topic_keywords.items():
                    if any(kw in query_lower for kw in keywords):
                        queries.append(topic)
        
        # Remove duplicates while preserving order
        seen = set()
        unique = []
        for q in queries:
            q_lower = q.lower()
            if q_lower not in seen:
                seen.add(q_lower)
                unique.append(q)
        
        return unique[:6]
    
    def _generate_answer_insights(self, question: str, results: list, intent) -> list:
        """Generate insights that act as an AI answer summary."""
        insights = []
        
        if not results:
            insights.append({
                "type": "answer",
                "message": "I couldn't find direct verses matching that question. Try rephrasing or asking about a specific topic like 'patience', 'prayer', or 'family'."
            })
            return insights
        
        # Group results by topic similarity
        topics = set()
        for r in results[:5]:
            text = (r.text or "") + " " + (r.translation or "")
            for topic, keywords in self.search_engine.query_understanding.topic_keywords.items():
                if any(kw in text.lower() for kw in keywords):
                    topics.add(topic)
        
        if topics:
            insights.append({
                "type": "answer",
                "message": f"Based on Quranic verses, this relates to: {', '.join(list(topics)[:3])}. Here are the most relevant passages."
            })
        
        # Add context about the best match
        if results:
            best = results[0]
            insights.append({
                "type": "best_match",
                "message": f"Most relevant: {best.chapter}:{best.verse_number} (score: {best.score:.2f})"
            })
        
        return insights
    
    def _generate_suggestions(self, question: str, intent) -> list:
        """Generate helpful follow-up suggestions."""
        suggestions = []
        query_lower = question.lower()
        
        # Based on detected topics
        for topic in intent.topics[:3]:
            suggestions.append(f"Tell me more about {topic}")
            suggestions.append(f"Verses about {topic}")
        
        # If question is about responsibilities/duties
        if any(word in query_lower for word in ["responsibilities", "duties", "rights", "should", "must"]):
            suggestions.append("What does the Quran say about family?")
            suggestions.append("What are Islamic duties?")
        
        # If question is about a specific group
        if "father" in query_lower or "parent" in query_lower:
            suggestions.append("What does the Quran say about mothers?")
            suggestions.append("What does the Quran say about children?")
            suggestions.append("Family verses in the Quran")
        
        # If question is about relationships
        if any(word in query_lower for word in ["relationship", "marriage", "family", "parents", "children"]):
            suggestions.append("Quran on marriage")
            suggestions.append("Quran on parenting")
        
        return suggestions[:5]
    
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
