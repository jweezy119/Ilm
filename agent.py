"""Agentic conversation layer for Ilm."""

from dataclasses import dataclass, field
from typing import List, Dict, Optional, Any
import re
from datetime import datetime


@dataclass
class UserMessage:
    role: str
    text: str
    timestamp: datetime = field(default_factory=datetime.now)


@dataclass
class AgentTurn:
    query: str
    intent: Any
    verses: List[Dict]
    hadiths: List[Dict]
    insights: List[Dict]
    suggestions: List[str]
    summary: str = ""


@dataclass
class ConversationState:
    user_id: str
    history: List[UserMessage] = field(default_factory=list)
    last_turn: Optional[AgentTurn] = None
    active_topic: Optional[str] = None
    active_entities: List[str] = field(default_factory=list)
    turn_count: int = 0
    emotional_state: Optional[str] = None
    confidence_level: float = 1.0
    user_context: Dict[str, Any] = field(default_factory=dict)
    situational_context: Dict[str, Any] = field(default_factory=dict)


class ConversationMemory:
    """Per-user conversation memory."""
    
    def __init__(self):
        self.sessions: Dict[str, ConversationState] = {}
        # New: Store interaction data for training/learning
        self.training_data: List[Dict] = []
        # New: Pattern learning
        self.query_patterns: Dict[str, Dict] = {}
        # New: Response effectiveness tracking
        self.response_metrics: Dict[str, Dict] = {}
    
    def get_state(self, user_id: str) -> ConversationState:
        if user_id not in self.sessions:
            self.sessions[user_id] = ConversationState(user_id=user_id)
        return self.sessions[user_id]
    
    def add_user_message(self, user_id: str, text: str):
        state = self.get_state(user_id)
        state.history.append(UserMessage(role="user", text=text))
        state.turn_count += 1
        
        # Learn from user's query patterns
        self._learn_from_user_query(user_id, text)
    
    def add_agent_turn(self, user_id: str, turn: AgentTurn):
        state = self.get_state(user_id)
        state.last_turn = turn
        if turn.intent and getattr(turn.intent, 'topics', None):
            state.active_topic = turn.intent.topics[0] if turn.intent.topics else state.active_topic
        if turn.verses:
            state.active_entities = []
            for v in turn.verses[:2]:
                chapter = (v.get("chapter") if hasattr(v, 'get') else getattr(v, 'chapter', ''))
                verse_number = (v.get("verse_number") if hasattr(v, 'get') else getattr(v, 'verse_number', ''))
                state.active_entities.append(f"{chapter}:{verse_number}")
        # Initialize situational context if needed
        if not state.situational_context:
            state.situational_context = {
                "consecutive_followups": 0,
                "user_consistency_level": "exploratory",
                "response_complexity": "moderate",
                "engagement_depth": "surface"
            }
    
    def _learn_from_user_query(self, user_id: str, query: str):
        """Analyze and learn from user query patterns."""
        query_lower = query.lower()
        
        # Track query types and frequency
        if user_id not in self.query_patterns:
            self.query_patterns[user_id] = {
                "query_types": {},
                "topics": {},
                "common_phrases": [],
                "follow_up_patterns": {},
                "effective_responses": []
            }
        
        patterns = self.query_patterns[user_id]
        
        # Classify query type
        if any(word in query_lower for word in ["what", "why", "how", "explain"]):
            query_type = "clarification"
        elif any(word in query_lower for word in ["tell me more", "more", "expand"]):
            query_type = "follow_up"
        elif any(word in query_lower for word in ["compare", "difference", "similar"]):
            query_type = "comparison"
        elif any(word in query_lower for word in ["application", "example", "practical"]):
            query_type = "application"
        else:
            query_type = "general"
        
        patterns["query_types"][query_type] = patterns["query_types"].get(query_type, 0) + 1
        
        # Extract topics from query
        if hasattr(self, 'search_engine') and hasattr(self.search_engine, 'query_understanding'):
            try:
                intent = self.search_engine.query_understanding.analyze_query(query)
                if intent.topics:
                    for topic in intent.topics:
                        patterns["topics"][topic] = patterns["topics"].get(topic, 0) + 1
            except:
                pass
        
        # Track follow-up patterns
        if any(word in query_lower for word in ["tell me more", "more", "also", "and", "another"]):
            patterns["follow_up_patterns"]["continuation"] = patterns["follow_up_patterns"].get("continuation", 0) + 1
        
        # Update most common phrases (last 5 queries)
        if len(patterns["common_phrases"]) >= 5:
            patterns["common_phrases"].pop(0)
        patterns["common_phrases"].append(query)
    
    def save_interaction_for_learning(self, user_id: str, interaction_data: Dict[str, Any]):
        """Save interaction data for potential future training.
        
        This allows the system to learn from actual user interactions,
        improving responses over time based on real usage patterns.
        """
        # Store interaction with metadata
        saved_interaction = {
            "timestamp": datetime.now(),
            "user_id": user_id,
            "interaction": interaction_data,
            "session_context": {
                "active_topic": self.get_state(user_id).active_topic,
                "turn_count": self.get_state(user_id).turn_count,
                "emotional_state": self.get_state(user_id).emotional_state,
                "user_consistency": self.get_state(user_id).situational_context.get("user_consistency_level"),
                "engagement_depth": self.get_state(user_id).situational_context.get("engagement_depth"),
            }
        }
        
        self.training_data.append(saved_interaction)
        
        # Update response effectiveness metrics
        self._update_response_effectiveness(user_id, interaction_data)
        
        # Keep training data manageable (last 1000 interactions)
        if len(self.training_data) > 1000:
            self.training_data = self.training_data[-1000:]
    
    def _update_response_effectiveness(self, user_id: str, interaction_data: Dict[str, Any]):
        """Track which responses are most effective."""
        user_metrics = self.response_metrics.setdefault(user_id, {
            "successful_patterns": {},
            "improvement_areas": {},
            "topic_preferences": {},
            "response_quality_scores": []
        })
        
        # Analyze what worked
        query = interaction_data.get("user_message", "")
        response_summary = interaction_data.get("response_summary", "")
        route_used = interaction_data.get("route_used", {})
        
        # Track successful response patterns
        if response_summary and "I couldn't find direct guidance" not in response_summary:
            # Response was helpful - record the pattern
            if route_used.get("search_hadith"):
                user_metrics["successful_patterns"]["hadith_relevant"] = user_metrics["successful_patterns"].get("hadith_relevant", 0) + 1
            if route_used.get("search_quran"):
                user_metrics["successful_patterns"]["quran_relevant"] = user_metrics["successful_patterns"].get("quran_relevant", 0) + 1
        
        # Track topics user asks about frequently
        intent = interaction_data.get("intent", {})
        for topic in intent.get("topics", []):
            user_metrics["topic_preferences"][topic] = user_metrics["topic_preferences"].get(topic, 0) + 1
        
        # Record response quality (simplified - based on length and content)
        if response_summary:
            score = min(10, len(response_summary) / 50)  # Simple heuristic
            user_metrics["response_quality_scores"].append(score)
    
    def get_training_data(self, limit: int = 100) -> List[Dict]:
        """Retrieve recent interaction data for training purposes."""
        return self.training_data[-limit:] if self.training_data else []
    
    def get_user_patterns(self, user_id: str) -> Dict[str, Any]:
        """Get learned patterns for a specific user."""
        return self.query_patterns.get(user_id, {})
    
    def get_context(self, user_id: str) -> Dict[str, Any]:
        state = self.get_state(user_id)
        recent_user_texts = [m.text for m in state.history[-6:] if m.role == "user"]
        return {
            "user_id": user_id,
            "turn_count": state.turn_count,
            "active_topic": state.active_topic,
            "active_entities": state.active_entities,
            "recent_queries": recent_user_texts,
            "last_intent_topics": getattr(state.last_turn, 'intent', None) and getattr(state.last_turn.intent, 'topics', []) or [],
            "emotional_state": state.emotional_state,
            "confidence_level": state.confidence_level,
            "user_context": state.user_context,
            "situational_context": state.situational_context
        }


class ReferenceResolver:
    """Resolve follow-up references like 'it', 'that', 'the father thing'."""
    
    def __init__(self):
        self.pronouns = {
            "it", "that", "this", "these", "those", "them", "they",
            "he", "she", "his", "her", "its"
        }
        self.continuation_phrases = [
            "tell me more", "more", "explain", "expand", "elaborate",
            "why", "how", "what about", "and", "also", "further",
            "what is", "what are"
        ]
    
    def is_follow_up(self, text: str) -> bool:
        text_lower = text.lower()
        return any(p in text_lower for p in self.pronouns) or any(p in text_lower for p in self.continuation_phrases)
    
    def expand_with_context(self, text: str, context: Dict[str, Any]) -> str:
        if not self.is_follow_up(text):
            return text
        
        text_lower = text.lower()
        expanded = text
        
        # Update situational context for follow-ups
        situational_context = context.get("situational_context", {})
        situational_context["consecutive_followups"] = situational_context.get("consecutive_followups", 0) + 1
        context["situational_context"] = situational_context
        
        # Enhanced pronoun resolution with situational awareness
        if any(p in text_lower for p in self.pronouns):
            # Determine consistency level based on previous queries
            recent_queries = context.get("recent_queries", [])
            if len(recent_queries) >= 3:
                # More consistent, focus on active topic
                if context.get("active_topic"):
                    expanded = f"{context['active_topic']} {text}"
                elif context.get("active_entities"):
                    expanded = f"{context['active_entities'][-1]} {text}"
                else:
                    expanded = f"the topic of {text}"
            else:
                # Exploratory phase, be more flexible
                if context.get("active_topic"):
                    expanded = f"{context['active_topic']} {text}"
                elif context.get("active_entities"):
                    expanded = f"{context['active_entities'][-1]} {text}"
                elif context.get("recent_queries"):
                    expanded = f"{context['recent_queries'][-1]} {text}"
        
        # Enhanced continuation phrase resolution
        if any(p in text_lower for p in self.continuation_phrases) and context.get("active_topic"):
            # Adjust based on emotional state and confidence
            emotional_state = context.get("emotional_state", "neutral")
            if emotional_state == "curious":
                expanded = f"Let's explore {context['active_topic']} {text}"
            elif emotional_state == "uncertain":
                expanded = f"Looking into {context['active_topic']} {text}"
            else:
                expanded = f"{context['active_topic']} {text}"
        
        # Track user consistency pattern
        if situational_context.get("consecutive_followups", 0) > 2:
            if "tell me more" in text_lower or "more" in text_lower:
                # User is being repetitive, adjust confidence
                context["confidence_level"] = max(0.3, context.get("confidence_level", 1.0) - 0.2)
        
        return expanded


class DialogueRouter:
    """Route queries to Quran/Hadith based on intent and topic."""
    
    def __init__(self):
        self.family_duty_keywords = {
            "father", "mother", "parent", "child", "children", "family",
            "marriage", "spouse", "husband", "wife", "responsibilities",
            "duties", "rights", "treatment", "obedience", "kindness",
            "parents", "father", "mother", "guardian", "caregiver",
            "nurturing", "raising", "education", "guidance",
            "support", "protect", "teach", "guide", "mentor"
        }
        self.duty_keywords = {
            "responsibilities", "duties", "rights", "should", "must",
            "obligations", "requirements", "command", "ordered",
            "debt", "payment", "financial", "legal", "moral"
        }
        self.positive_indicators = {"thank", "helpful", "interesting", "love", "appreciate",
                                   "grateful", "wonderful", "beautiful", "peaceful", "joyful"}
        self.negative_indicators = {"confusing", "difficult", "hard", "frustrated", "lost",
                                   "overwhelmed", "anxious", "stressed", "boring", "tedious"}
        self.exploratory_phrases = {"tell me more", "more", "explain", "expand", "what is",
                                   "why", "how", "what about", "also", "further"}
        
        # Context tracking for personalized responses
        self.context_prefs = {}  # user_id -> preferred topics
        self.previous_questions = {}  # user_id -> list of recent questions
        self.learning_history = []  # track successful/unsuccessful responses
        
        # Enhanced topic categorization
        self.family_topics = ["family", "parents", "children", "marriage", "spouse", "kids",
                              "nurturing", "raising", "education", "guidance"]
        self.duty_topics = ["responsibilities", "duties", "obligations", "rights", "ethics",
                            "morality", "commitment", "accountability"]
        self.positive_topics = ["faith", "belief", "spirituality", "meaning", "purpose",
                                "growth", "progress", "inspiration", "hope"]
        self.negative_topics = ["conflict", "dispute", "argument", "failure", "loss",
                                "pain", "sorrow", "regret", "mistake"]
    
    def detect_emotional_state(self, text: str, situational_context: Dict[str, Any]) -> str:
        """Detect user's emotional state and engagement level."""
        text_lower = text.lower()
        
        # Check for emotional indicators
        positive_count = sum(1 for w in self.positive_indicators if w in text_lower)
        negative_count = sum(1 for w in self.negative_indicators if w in text_lower)
        
        # Determine state with more nuanced classification
        if negative_count > positive_count:
            return "uncertain"
        elif positive_count > negative_count:
            return "curious"
        elif positive_count == negative_count:
            return "neutral"
        else:
            # Tie-breaker: look for stronger signals
            strongest = max([(positive_count, "positive"), (negative_count, "negative")], key=lambda x: x[0])
            return "curious" if strongest[1] == "positive" else "uncertain"
    
    def analyze_engagement_depth(self, text: str, situational_context: Dict[str, Any]) -> str:
        """Analyze user's engagement depth based on query complexity, follow-up patterns, and context."""
        text_lower = text.lower()
        followups = situational_context.get("consecutive_followups", 0)
        recent_queries = situational_context.get("recent_queries", [])
        
        # Count distinct topics in recent queries
        recent_topics = set()
        for query in recent_queries:
            if any(word in query.lower() for word in ["patience", "prayer", "family", "charity", "fasting", "prayer", "quran", "hadith"]):
                recent_topics.add(query)
        
        # Check for exploratory language
        exploratory = any(phrase in text_lower for phrase in self.exploratory_phrases)
        
        # Consider user consistency level
        consistency = situational_context.get("user_consistency_level", "exploratory")
        
        # Deep engagement: multiple follow-ups OR exploratory language OR consistent focus on deep topics
        if followups > 2 or exploratory or consistency == "focused":
            return "deep"
        # Moderate engagement: some follow-ups OR consistent focus
        elif followups > 0 or consistency == "focused":
            return "moderate"
        # Surface engagement: simple queries with no follow-up patterns
        else:
            return "surface"
    
    def update_situational_context(self, text: str, situational_context: Dict[str, Any], 
                                 active_topic: Optional[str], recent_queries: List[str]) -> Dict[str, Any]:
        """Update situational context based on query and state."""
        updated_context = situational_context.copy()
        text_lower = text.lower()
        
        # Update emotional state
        updated_context["emotional_state"] = self.detect_emotional_state(text, situational_context)
        
        # Update engagement depth
        updated_context["engagement_depth"] = self.analyze_engagement_depth(text, situational_context)
        
        # Adjust response complexity based on context
        confidence = updated_context.get("confidence_level", 1.0)
        if updated_context["engagement_depth"] == "deep":
            updated_context["response_complexity"] = "complex"
        elif updated_context["engagement_depth"] == "moderate":
            updated_context["response_complexity"] = "moderate"
        else:
            updated_context["response_complexity"] = "simple"
        
        # Track user consistency
        if recent_queries:
            last_query = recent_queries[-1].lower()
            current_query = text_lower
            
            # Check if user is being consistent with their topic focus
            if active_topic:
                if active_topic in last_query or active_topic in current_query:
                    updated_context["user_consistency_level"] = "focused"
                else:
                    updated_context["user_consistency_level"] = "exploratory"
            
            # Check for clarification requests
            if any(word in current_query for word in ["what", "why", "how", "explain"]):
                updated_context["user_consistency_level"] = "clarifying"
        
        return updated_context
    
    def needs_hadith(self, text: str, intent_topics: List[str], situational_context: Dict[str, Any]) -> bool:
        """Determine if Hadith search is needed based on situational context."""
        text_lower = text.lower()
        topic_match = any(t in text_lower for t in intent_topics)
        family_match = any(w in text_lower for w in self.family_duty_keywords)
        duty_match = any(w in text_lower for w in self.duty_keywords)
        
        # Adjust Hadith needs based on situational context
        engagement_depth = situational_context.get("engagement_depth", "surface")
        user_consistency = situational_context.get("user_consistency_level", "exploratory")
        
        # More likely to need Hadith in deeper engagement scenarios
        if engagement_depth == "deep":
            return True
        elif engagement_depth == "moderate" and (topic_match or family_match or duty_match):
            return True
        elif user_consistency == "focused" and (topic_match or family_match or duty_match):
            return True
        else:
            return topic_match or family_match or duty_match
    
    def route(self, text: str, intent_topics: List[str], situational_context: Dict[str, Any]) -> Dict[str, Any]:
        """Route queries to Quran/Hadith based on intent and situational context."""
        needs_hadith = self.needs_hadith(text, intent_topics, situational_context)
        
        # Adjust search parameters based on situational context
        engagement_depth = situational_context.get("engagement_depth", "surface")
        response_complexity = situational_context.get("response_complexity", "moderate")
        
        if engagement_depth == "deep":
            max_verses = 12
        elif engagement_depth == "moderate":
            max_verses = 8
        else:
            max_verses = 5
        
        if response_complexity == "complex":
            max_hadiths = 5 if needs_hadith else 0
        else:
            max_hadiths = 3 if needs_hadith else 0
        
        return {
            "search_quran": True,
            "search_hadith": needs_hadith,
            "hadith_collections": ["bukhari", "muslim"] if needs_hadith else [],
            "max_verses": max_verses,
            "max_hadiths": max_hadiths,
        }


class AnswerSynthesizer:
    """Synthesize a coherent answer from Quran verses and Hadiths."""
    
    def synthesize(self, question: str, verses: List[Dict], hadiths: List[Dict], intent_topics: List[str]) -> str:
        if not verses and not hadiths:
            return "I couldn't find direct guidance on that. Try rephrasing or asking about a specific topic like 'patience', 'prayer', or 'family'."
        
        parts = []
        
        if verses:
            topics = []
            for v in verses[:5]:
                # Handle both dicts and SearchResult objects
                text_val = (v.get("text") if hasattr(v, 'get') else getattr(v, 'text', ''))
                translation_val = (v.get("translation") if hasattr(v, 'get') else getattr(v, 'translation', ''))
                
                text = (text_val or "") + " " + (translation_val or "")
                
                for topic, keywords in {
                    "faith": ["iman", "faith", "belief", "believe"],
                    "prayer": ["salah", "prayer", "salat", "worship"],
                    "charity": ["zakat", "charity", "giving"],
                    "family": ["family", "parents", "children", "father", "mother", "spouse"],
                    "ethics": ["good", "evil", "right", "wrong", "justice"],
                    "patience": ["patience", "perseverance", "endure"],
                    "gratitude": ["gratitude", "thankful", "thanks"],
                }.items():
                    if any(kw in text.lower() for kw in keywords):
                        topics.append(topic)
            
            unique_topics = list(dict.fromkeys(topics))[:3]
            if unique_topics:
                parts.append(f"This relates to: {', '.join(unique_topics)}.")
            
            best = verses[0]
            chapter = (best.get("chapter") if hasattr(best, 'get') else getattr(best, 'chapter', ''))
            verse_number = (best.get("verse_number") if hasattr(best, 'get') else getattr(best, 'verse_number', ''))
            parts.append(f"Most relevant verse: {chapter}:{verse_number}.")
        
        if hadiths:
            parts.append(f"Also found {len(hadiths)} related hadith(s) that provide additional guidance.")
        
        return " ".join(parts)


class AgenticChatEngine:
    """Main agentic chat engine."""
    
    def __init__(self, data_service, search_engine, context_intelligence):
        self.data_service = data_service
        self.search_engine = search_engine
        self.context_intelligence = context_intelligence
        self.memory = ConversationMemory()
        self.reference_resolver = ReferenceResolver()
        self.dialogue_router = DialogueRouter()
        self.answer_synthesizer = AnswerSynthesizer()
    
    def chat(self, user_id: str, message: str) -> Dict[str, Any]:
        state = self.memory.get_state(user_id)
        
        # Resolve follow-up references
        expanded_query = self.reference_resolver.expand_with_context(message, {
            "active_topic": state.active_topic,
            "active_entities": state.active_entities,
            "recent_queries": [m.text for m in state.history if m.role == "user"],
            "situational_context": state.situational_context
        })
        
        # Update situational context based on current query
        state.situational_context = self.dialogue_router.update_situational_context(
            message, state.situational_context, state.active_topic,
            [m.text for m in state.history if m.role == "user"]
        )
        
        # Update confidence based on situational context
        state.confidence_level = max(0.5, min(1.0, state.confidence_level + 0.1))
        
        # Understand intent
        intent = self.search_engine.query_understanding.analyze_query(expanded_query)
        
        # Route to appropriate sources with situational context
        route = self.dialogue_router.route(expanded_query, getattr(intent, 'topics', []), state.situational_context)
        
        # Search Quran
        quran_results = []
        if route["search_quran"]:
            q_search = self.search_engine.search(expanded_query, user_id=user_id, limit=route["max_verses"])
            quran_results = q_search.get("results", [])[:route["max_verses"]]
        
        # Search Hadith if needed
        hadith_results = []
        if route["search_hadith"]:
            try:
                hadith_results = self.data_service.search_hadiths(expanded_query, route["hadith_collections"])[:route["max_hadiths"]]
            except Exception:
                pass
        
        # Synthesize answer
        summary = self.answer_synthesizer.synthesize(expanded_query, quran_results, hadith_results, getattr(intent, 'topics', []))
        
        # Build turn
        turn = AgentTurn(
            query=message,
            intent=intent,
            verses=quran_results,
            hadiths=[vars(h) if hasattr(h, '__dict__') else h for h in hadith_results],
            insights=[],
            suggestions=self._generate_suggestions(message, intent, state),
            summary=summary
        )
        
        # Update memory
        self.memory.add_user_message(user_id, message)
        self.memory.add_agent_turn(user_id, turn)
        
        # Save interaction for learning
        self.memory.save_interaction_for_learning(user_id, {
            "user_message": message,
            "expanded_query": expanded_query,
            "intent": {
                "intent_type": intent.intent_type,
                "topics": intent.topics,
                "confidence": intent.confidence
            },
            "route_used": route,
            "verses_found": len(quran_results),
            "hadiths_found": len(hadith_results),
            "response_summary": summary
        })
        
        # Also update legacy context
        self.context_intelligence.add_to_history(user_id, message, quran_results)
        
        return {
            "query": message,
            "expanded_query": expanded_query if expanded_query != message else None,
            "intent": {
                "intent_type": getattr(intent, 'intent_type', 'topic_search'),
                "entities": getattr(intent, 'entities', []),
                "topics": getattr(intent, 'topics', []),
                "confidence": getattr(intent, 'confidence', 0.0)
            },
            "results": quran_results[:5],
            "hadiths": turn.hadiths[:3],
            "insights": [{"type": "answer", "message": summary}] if summary else [],
            "suggestions": turn.suggestions,
            "context": self.memory.get_context(user_id)
        }
    
    def _generate_suggestions(self, message: str, intent, state: ConversationState) -> List[str]:
        suggestions = []
        text = message.lower()
        topics = getattr(intent, 'topics', []) or []
        
        # Generate suggestions based on situational context
        situational_context = state.situational_context
        engagement_depth = situational_context.get("engagement_depth", "surface")
        emotional_state = situational_context.get("emotional_state", "neutral")
        user_consistency = situational_context.get("user_consistency_level", "exploratory")
        
        # Generate dynamic suggestions based on context
        if engagement_depth == "deep" and user_consistency == "focused":
            # User is deeply engaged and focused - provide advanced suggestions
            if topics:
                suggestions.append(f"Explore {topics[0]} in-depth")
                suggestions.append(f"Compare {topics[0]} with other topics")
                suggestions.append(f"Find practical applications of {topics[0]}")
        elif engagement_depth == "moderate":
            # User is moderately engaged - provide intermediate suggestions
            if topics:
                suggestions.append(f"Tell me more about {topics[0]}")
                suggestions.append(f"What about {topics[-1] if len(topics) > 1 else 'related topics'}?")
        else:
            # User is surface-level - provide simple suggestions
            if topics:
                suggestions.append(f"Tell me more about {topics[0]}")
            suggestions.append(f"What is {topics[0] if topics else 'Quran'}?")
        
        # Emotional state-based suggestions
        if emotional_state == "curious":
            suggestions.append("Explore related concepts")
            suggestions.append("Ask about applications")
        elif emotional_state == "uncertain":
            suggestions.append("Start with simpler topics")
            suggestions.append("Get basic explanations")
        
        # Family/duty specific suggestions (from existing logic)
        if any(w in text for w in ["father", "parent"]):
            suggestions.append("What does the Quran say about mothers?")
            suggestions.append("What does the Quran say about children?")
        
        if any(w in text for w in ["responsibilities", "duties", "rights"]):
            suggestions.append("What does the Quran say about family?")
        
        # Continue with active topic if it's different
        if state.active_topic and state.active_topic not in topics:
            suggestions.append(f"Continue with {state.active_topic}")
        
        return suggestions[:5]
