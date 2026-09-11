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


class ConversationMemory:
    """Per-user conversation memory."""
    
    def __init__(self):
        self.sessions: Dict[str, ConversationState] = {}
    
    def get_state(self, user_id: str) -> ConversationState:
        if user_id not in self.sessions:
            self.sessions[user_id] = ConversationState(user_id=user_id)
        return self.sessions[user_id]
    
    def add_user_message(self, user_id: str, text: str):
        state = self.get_state(user_id)
        state.history.append(UserMessage(role="user", text=text))
        state.turn_count += 1
    
    def add_agent_turn(self, user_id: str, turn: AgentTurn):
        state = self.get_state(user_id)
        state.last_turn = turn
        if turn.intent and getattr(turn.intent, 'topics', None):
            state.active_topic = turn.intent.topics[0] if turn.intent.topics else state.active_topic
        if turn.verses:
            state.active_entities = [f"{v.get('chapter')}:{v.get('verse_number')}" for v in turn.verses[:2]]
    
    def get_context(self, user_id: str) -> Dict[str, Any]:
        state = self.get_state(user_id)
        recent_user_texts = [m.text for m in state.history[-6:] if m.role == "user"]
        return {
            "user_id": user_id,
            "turn_count": state.turn_count,
            "active_topic": state.active_topic,
            "active_entities": state.active_entities,
            "recent_queries": recent_user_texts,
            "last_intent_topics": getattr(state.last_turn, 'intent', None) and getattr(state.last_turn.intent, 'topics', []) or []
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
        
        if any(p in text_lower for p in self.pronouns):
            if context.get("active_topic"):
                expanded = f"{context['active_topic']} {text}"
            elif context.get("active_entities"):
                expanded = f"{context['active_entities'][-1]} {text}"
            elif context.get("recent_queries"):
                expanded = f"{context['recent_queries'][-1]} {text}"
        
        if any(p in text_lower for p in self.continuation_phrases) and context.get("active_topic"):
            expanded = f"{context['active_topic']} {text}"
        
        return expanded


class DialogueRouter:
    """Route queries to Quran/Hadith based on intent and topic."""
    
    def __init__(self):
        self.family_duty_keywords = {
            "father", "mother", "parent", "child", "children", "family",
            "marriage", "spouse", "husband", "wife", "responsibilities",
            "duties", "rights", "treatment", "obedience", "kindness",
            "parents", "father", "mother"
        }
        self.duty_keywords = {
            "responsibilities", "duties", "rights", "should", "must",
            "obligations", "requirements", "command", "ordered"
        }
    
    def needs_hadith(self, text: str, intent_topics: List[str]) -> bool:
        text_lower = text.lower()
        topic_match = any(t in text_lower for t in intent_topics)
        family_match = any(w in text_lower for w in self.family_duty_keywords)
        duty_match = any(w in text_lower for w in self.duty_keywords)
        return topic_match or family_match or duty_match
    
    def route(self, text: str, intent_topics: List[str]) -> Dict[str, Any]:
        needs_hadith = self.needs_hadith(text, intent_topics)
        return {
            "search_quran": True,
            "search_hadith": needs_hadith,
            "hadith_collections": ["bukhari", "muslim"] if needs_hadith else [],
            "max_verses": 8,
            "max_hadiths": 3 if needs_hadith else 0,
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
                text = (v.get("text") or "") + " " + (v.get("translation") or "")
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
            parts.append(f"Most relevant verse: {best.get('chapter')}:{best.get('verse_number')}.")
        
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
            "recent_queries": [m.text for m in state.history if m.role == "user"]
        })
        
        # Understand intent
        intent = self.search_engine.query_understanding.analyze_query(expanded_query)
        
        # Route to appropriate sources
        route = self.dialogue_router.route(expanded_query, getattr(intent, 'topics', []))
        
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
            hadiths=[vars(h) for h in hadith_results],
            insights=[],
            suggestions=self._generate_suggestions(message, intent, state),
            summary=summary
        )
        
        # Update memory
        self.memory.add_user_message(user_id, message)
        self.memory.add_agent_turn(user_id, turn)
        
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
        
        for topic in topics[:2]:
            suggestions.append(f"Tell me more about {topic}")
        
        if any(w in text for w in ["father", "parent"]):
            suggestions.append("What does the Quran say about mothers?")
            suggestions.append("What does the Quran say about children?")
        
        if any(w in text for w in ["responsibilities", "duties", "rights"]):
            suggestions.append("What does the Quran say about family?")
        
        if state.active_topic and state.active_topic not in topics:
            suggestions.append(f"Continue with {state.active_topic}")
        
        return suggestions[:5]
