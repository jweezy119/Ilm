"""Intelligent Recommendation Engine for Ilm - Quran AI App"""

from typing import List, Dict, Optional
from datetime import datetime, timedelta
from .search_engine import ContextIntelligence, QueryUnderstanding
from .data_service import DataService, Verse, Hadith


@dataclass
class Recommendation:
    """Represents a personalized recommendation."""
    id: str
    type: str  # "verse", "hadith", "topic", "practice", "reading_plan"
    title: str
    description: str
    content: Dict  # Verse or Hadith data
    reason: str
    priority: float
    tags: List[str] = None
    source: str = "quran"
    
    def to_dict(self):
        return {
            "id": self.id,
            "type": self.type,
            "title": self.title,
            "description": self.description,
            "content": self.content,
            "reason": self.reason,
            "priority": self.priority,
            "tags": self.tags or [],
            "source": self.source
        }


class RecommendationEngine:
    """Context-aware recommendation engine with user profiling."""
    
    def __init__(self, data_service: DataService, context_intelligence: ContextIntelligence):
        self.data_service = data_service
        self.context_intelligence = context_intelligence
        self.query_understanding = QueryUnderstanding()
        
        # Topic mappings to Quranic themes
        self.topic_verses = {
            "faith": ["2:255", "3:18", "112:1-4", "2:285"],
            "prayer": ["2:3", "2:45", "20:14", "29:45"],
            "charity": ["2:177", "2:261", "57:7", "107:1-7"],
            "mercy": ["1:1-3", "7:156", "39:53", "55:1-13"],
            "patience": ["2:153", "2:155-157", "3:200", "103:1-3"],
            "gratitude": ["14:7", "16:18", "31:12", "34:13"],
            "knowledge": ["20:114", "39:9", "58:11", "96:1-5"],
            "repentance": ["2:222", "39:53", "110:1-3", "5:39"],
            "family": ["30:21", "17:23-24", "25:74", "64:14-15"],
            "leadership": ["2:247", "38:26", "28:5-6", "21:73"]
        }
    
    def get_personalized_recommendations(self, user_id: str, limit: int = 10) -> List[Recommendation]:
        """Get context-aware personalized recommendations."""
        context = self.context_intelligence.user_contexts.get(user_id, {})
        recommendations = []
        
        # 1. Based on user interests and reading history
        recommendations.extend(self._interest_based_recommendations(user_id, context))
        
        # 2. Based on time/occasion (daily, weekly, etc.)
        recommendations.extend(self._time_based_recommendations())
        
        # 3. Based on knowledge gaps or popular topics
        recommendations.extend(self._exploratory_recommendations(context))
        
        # 4. Based on complementary verses (related to past readings)
        recommendations.extend(self._complementary_recommendations(user_id, context))
        
        # Sort and deduplicate
        seen_ids = set()
        unique = []
        for rec in sorted(recommendations, key=lambda x: x.priority, reverse=True):
            if rec.id not in seen_ids:
                seen_ids.add(rec.id)
                unique.append(rec)
        
        return unique[:limit]
    
    def get_topic_recommendations(self, topic: str, user_id: str = None, limit: int = 5) -> List[Recommendation]:
        """Get recommendations for a specific topic."""
        recommendations = []
        
        # Find relevant verses for this topic
        topic_key = self._find_topic_key(topic)
        if topic_key and topic_key in self.topic_verses:
            verse_keys = self.topic_verses[topic_key]
            for vk in verse_keys[:limit]:
                verse = self.data_service.get_quran_verse(vk, "en")
                if verse:
                    recommendations.append(Recommendation(
                        id=f"topic_{topic_key}_{vk}",
                        type="verse",
                        title=f"Verse about {topic}",
                        description=f"Relevant Quranic verse on {topic}",
                        content=verse.to_dict() if hasattr(verse, 'to_dict') else vars(verse),
                        reason=f"This verse relates to {topic}",
                        priority=0.85,
                        tags=[topic_key, topic],
                        source="quran"
                    ))
        
        # Find relevant hadiths
        hadiths = self.data_service.search_hadiths(topic)
        for hadith in hadiths[:2]:
            recommendations.append(Recommendation(
                id=f"hadith_{hadith.id}",
                type="hadith",
                title=f"Hadith on {topic}",
                description=f"Prophetic tradition related to {topic}",
                content=vars(hadith),
                reason=f"Hadith related to {topic}",
                priority=0.75,
                tags=[topic],
                source="hadith"
            ))
        
        return recommendations[:limit]
    
    def get_contextual_reading_plan(self, user_id: str, duration_days: int = 7) -> List[Recommendation]:
        """Generate a personalized reading plan."""
        context = self.context_intelligence.user_contexts.get(user_id, {})
        interests = context.get("interests", ["mercy", "patience", "gratitude"])
        
        plan = []
        # Get daily verses based on interests
        for day in range(duration_days):
            topic = interests[day % len(interests)]
            verse_keys = self.topic_verses.get(topic, ["1:1", "2:255", "36:9", "55:1"])
            vk = verse_keys[day % len(verse_keys)]
            
            verse = self.data_service.get_quran_verse(vk, "en")
            if verse:
                plan.append(Recommendation(
                    id=f"plan_{day}_{vk}",
                    type="verse",
                    title=f"Day {day+1}: Reflection on {topic.title()}",
                    description=f"Today's reading for your personalized plan",
                    content=verse.to_dict() if hasattr(verse, 'to_dict') else vars(verse),
                    reason=f"Part of your {duration_days}-day reading plan focusing on {topic}",
                    priority=0.9,
                    tags=["reading_plan", topic],
                    source="quran"
                ))
        
        return plan
    
    def _interest_based_recommendations(self, user_id: str, context: Dict) -> List[Recommendation]:
        """Recommend based on user interests."""
        recommendations = []
        interests = context.get("interests", [])
        
        for interest in interests[:5]:
            recs = self.get_topic_recommendations(interest, user_id, limit=2)
            recommendations.extend(recs)
        
        return recommendations
    
    def _time_based_recommendations(self) -> List[Recommendation]:
        """Recommend based on time, day, occasion."""
        recommendations = []
        now = datetime.now()
        hour = now.hour
        
        # Morning verses
        if 5 <= hour < 12:
            recommendations.append(Recommendation(
                id="time_morning",
                type="verse",
                title="Morning Reflection",
                description="Start your day with this verse",
                content={"verse_key": "93:1-11", "text": "By the morning brightness"},
                reason="Morning dhikr",
                priority=0.8,
                tags=["morning", "daily"],
                source="quran"
            ))
        
        # Evening verses
        elif 17 <= hour < 21:
            recommendations.append(Recommendation(
                id="time_evening",
                type="verse",
                title="Evening Reflection",
                description="Reflect before night",
                content={"verse_key": "113:1-5", "text": "Say: I seek refuge in the Lord of daybreak"},
                reason="Evening dhikr",
                priority=0.8,
                tags=["evening", "daily"],
                source="quran"
            ))
        
        # Friday reminder
        if now.weekday() == 4:  # Friday
            recommendations.append(Recommendation(
                id="time_friday",
                type="verse",
                title="Friday Remembrance",
                description="Special Friday verse",
                content={"verse_key": "18:24", "text": "Except when Allah wills"},
                reason="Friday blessings",
                priority=0.9,
                tags=["friday", "weekly"],
                source="quran"
            ))
        
        return recommendations
    
    def _exploratory_recommendations(self, context: Dict) -> List[Recommendation]:
        """Recommend new topics for exploration."""
        recommendations = []
        reading_level = context.get("reading_level", "intermediate")
        
        # Suggest complementary topics
        explored = set(context.get("interests", []))
        all_topics = set(self.topic_verses.keys())
        unexplored = list(all_topics - explored)[:3]
        
        for topic in unexplored:
            recommendations.append(Recommendation(
                id=f"explore_{topic}",
                type="topic",
                title=f"Explore: {topic.title()}",
                description=f"Discover Quranic teachings on {topic}",
                content={"topic": topic, "suggested_verses": self.topic_verses.get(topic, [])},
                reason=f"You haven't explored {topic} yet",
                priority=0.6,
                tags=["explore", topic],
                source="quran"
            ))
        
        return recommendations
    
    def _complementary_recommendations(self, user_id: str, context: Dict) -> List[Recommendation]:
        """Recommend verses complementary to user's recent readings."""
        recommendations = []
        recent_queries = context.get("recent_queries", [])
        
        if recent_queries:
            latest_query = recent_queries[-1]
            intent = self.query_understanding.analyze_query(latest_query)
            
            for topic in intent.topics[:2]:
                related = self.context_intelligence.knowledge_graph.get_related_concepts(topic, depth=1)
                for concept in related[:2]:
                    if concept["concept"] in self.topic_verses:
                        vk = self.topic_verses[concept["concept"]][0]
                        verse = self.data_service.get_quran_verse(vk, "en")
                        if verse:
                            recommendations.append(Recommendation(
                                id=f"comp_{concept['concept']}_{vk}",
                                type="verse",
                                title=f"Related: {concept['data'].get('description', concept['concept'])}",
                                description=f"Connected to your recent interest in {topic}",
                                content=verse.to_dict() if hasattr(verse, 'to_dict') else vars(verse),
                                reason=f"Related concept to {topic}",
                                priority=0.7,
                                tags=[topic, concept["concept"]],
                                source="quran"
                            ))
        
        return recommendations