"""AI-powered semantic search and indexing for Ilm"""

import json
import re
from dataclasses import dataclass, field
from typing import List, Dict, Optional, Set, Tuple
from pathlib import Path
from collections import defaultdict
import hashlib


@dataclass
class SearchResult:
    """Represents a search result with relevance scoring."""
    verse_id: int
    chapter: str
    verse_number: int
    text: str
    translation: Optional[str]
    score: float
    match_type: str  # "exact", "semantic", "keyword", "contextual"
    matched_terms: List[str] = field(default_factory=list)
    context_snippet: str = ""


@dataclass
class QueryIntent:
    """Represents the understood intent of a user query."""
    intent_type: str  # "verse_lookup", "topic_search", "concept_exploration", "comparison", "explanation"
    entities: List[str] = field(default_factory=list)
    topics: List[str] = field(default_factory=list)
    language_preference: str = "ar"
    confidence: float = 0.0
    suggested_filters: Dict = field(default_factory=dict)


class InvertedIndex:
    """Inverted index for fast keyword-based verse lookup."""
    
    def __init__(self):
        self.index: Dict[str, Set[int]] = defaultdict(set)
        self.verse_texts: Dict[int, str] = {}
        self.verse_metadata: Dict[int, Dict] = {}
    
    def add_verse(self, verse_id: int, text: str, metadata: Dict = None):
        """Add a verse to the index."""
        self.verse_texts[verse_id] = text
        self.verse_metadata[verse_id] = metadata or {}
        
        # Tokenize and index
        tokens = self._tokenize(text)
        for token in tokens:
            self.index[token].add(verse_id)
    
    def _tokenize(self, text: str) -> List[str]:
        """Tokenize text into searchable terms."""
        # Remove punctuation, lowercase, split
        text = re.sub(r'[^\w\s]', ' ', text.lower())
        tokens = text.split()
        # Filter stop words (simplified)
        stop_words = {'the', 'and', 'or', 'in', 'of', 'to', 'a', 'is', 'for', 'on', 'with', 'as', 'by', 'at', 'an'}
        return [t for t in tokens if t not in stop_words and len(t) > 1]
    
    def search(self, query: str, limit: int = 50) -> List[int]:
        """Search index for verses matching query terms."""
        tokens = self._tokenize(query)
        if not tokens:
            return []
        
        # Find verses containing all tokens (AND logic)
        matching_verses = None
        for token in tokens:
            if token in self.index:
                if matching_verses is None:
                    matching_verses = self.index[token].copy()
                else:
                    matching_verses &= self.index[token]
            else:
                return []
        
        return list(matching_verses)[:limit] if matching_verses else []
    
    def search_or(self, query: str, limit: int = 50) -> List[int]:
        """Search index for verses matching any query term (OR logic)."""
        tokens = self._tokenize(query)
        if not tokens:
            return []
        
        matching_verses = set()
        for token in tokens:
            if token in self.index:
                matching_verses.update(self.index[token])
        
        return list(matching_verses)[:limit]


class SemanticSearchEngine:
    """AI-powered semantic search using vector embeddings."""
    
    def __init__(self, embedding_model=None):
        self.embedding_model = embedding_model
        self.verse_embeddings: Dict[int, List[float]] = {}
        self.verse_texts: Dict[int, str] = {}
    
    def add_verse(self, verse_id: int, text: str, embedding: List[float] = None):
        """Add a verse with its embedding."""
        self.verse_texts[verse_id] = text
        if embedding:
            self.verse_embeddings[verse_id] = embedding
    
    def _compute_embedding(self, text: str) -> List[float]:
        """Compute embedding for text (placeholder for actual model)."""
        if self.embedding_model:
            return self.embedding_model.encode(text)
        # Fallback: simple hash-based pseudo-embedding
        return self._hash_embedding(text)
    
    def _hash_embedding(self, text: str, dim: int = 384) -> List[float]:
        """Generate deterministic pseudo-embedding from text hash."""
        hash_obj = hashlib.md5(text.encode())
        hash_bytes = hash_obj.digest()
        # Expand to desired dimension
        embedding = []
        for i in range(dim):
            byte_idx = i % len(hash_bytes)
            embedding.append((hash_bytes[byte_idx] / 255.0) * 2 - 1)
        return embedding
    
    def search(self, query: str, limit: int = 20, threshold: float = 0.3) -> List[SearchResult]:
        """Semantic search for verses similar to query."""
        query_embedding = self._compute_embedding(query)
        results = []
        
        for verse_id, verse_embedding in self.verse_embeddings.items():
            similarity = self._cosine_similarity(query_embedding, verse_embedding)
            if similarity >= threshold:
                text = self.verse_texts.get(verse_id, "")
                results.append(SearchResult(
                    verse_id=verse_id,
                    chapter="",  # Would be populated from metadata
                    verse_number=0,
                    text=text,
                    translation=None,
                    score=similarity,
                    match_type="semantic"
                ))
        
        results.sort(key=lambda x: x.score, reverse=True)
        return results[:limit]
    
    def _cosine_similarity(self, a: List[float], b: List[float]) -> float:
        """Compute cosine similarity between two vectors."""
        if len(a) != len(b):
            return 0.0
        dot = sum(x * y for x, y in zip(a, b))
        norm_a = sum(x * x for x in a) ** 0.5
        norm_b = sum(y * y for y in b) ** 0.5
        if norm_a == 0 or norm_b == 0:
            return 0.0
        return dot / (norm_a * norm_b)


class QueryUnderstanding:
    """AI-powered query understanding and intent detection."""
    
    def __init__(self):
        self.intent_patterns = {
            "verse_lookup": [
                r"verse\s+\d+", r"ayah\s+\d+", r"surah\s+\d+", r"chapter\s+\d+",
                r"what does.*say", r"quote.*", r"show me.*"
            ],
            "topic_search": [
                r"about\s+", r"on\s+", r"regarding\s+", r"verses about",
                r"what does.*say about", r"teachings on"
            ],
            "concept_exploration": [
                r"explain\s+", r"what is\s+", r"meaning of\s+", r"concept of\s+",
                r"understand\s+", r"interpretation"
            ],
            "comparison": [
                r"compare\s+", r"difference between\s+", r"versus\s+", r"vs\s+",
                r"contrast\s+"
            ],
            "explanation": [
                r"why\s+", r"how\s+", r"reason for\s+", r"significance of\s+",
                r"context of\s+"
            ]
        }
        
        self.topic_keywords = {
            "faith": ["iman", "faith", "belief", "believe", "trust"],
            "prayer": ["salah", "prayer", "salat", "namaz", "worship"],
            "charity": ["zakat", "charity", "sadaqah", "giving", "donation"],
            "fasting": ["sawm", "fasting", "ramadan", "roza"],
            "pilgrimage": ["hajj", "pilgrimage", "umrah", "kaaba"],
            "prophets": ["prophet", "messenger", "nabi", "rasul", "muhammad", "ibrahim", "musa", "isa"],
            "quran": ["quran", "koran", "scripture", "revelation", "ayah", "surah"],
            "hereafter": ["akhirah", "hereafter", "afterlife", "judgment", "paradise", "hell", "jannah", "jahannam"],
            "ethics": ["ethics", "morality", "good", "evil", "right", "wrong", "justice", "adl"],
            "family": ["family", "marriage", "divorce", "children", "parents", "spouse"],
            "knowledge": ["knowledge", "ilm", "learning", "wisdom", "hikmah"]
        }
    
    def analyze_query(self, query: str) -> QueryIntent:
        """Analyze query and determine intent."""
        query_lower = query.lower()
        
        # Detect intent type
        intent_scores = {}
        for intent_type, patterns in self.intent_patterns.items():
            score = 0
            for pattern in patterns:
                if re.search(pattern, query_lower):
                    score += 1
            if score > 0:
                intent_scores[intent_type] = score
        
        intent_type = max(intent_scores, key=intent_scores.get) if intent_scores else "topic_search"
        confidence = min(intent_scores.get(intent_type, 0) / 3.0, 1.0)
        
        # Extract entities and topics
        entities = self._extract_entities(query)
        topics = self._extract_topics(query_lower)
        
        # Detect language preference
        lang_pref = self._detect_language(query)
        
        return QueryIntent(
            intent_type=intent_type,
            entities=entities,
            topics=topics,
            language_preference=lang_pref,
            confidence=confidence
        )
    
    def _extract_entities(self, query: str) -> List[str]:
        """Extract named entities from query."""
        entities = []
        # Surah/chapter references
        surah_matches = re.findall(r'(surah|chapter)\s+(\d+)', query, re.IGNORECASE)
        for match in surah_matches:
            entities.append(f"surah_{match[1]}")
        
        # Verse references
        verse_matches = re.findall(r'(verse|ayah)\s+(\d+)', query, re.IGNORECASE)
        for match in verse_matches:
            entities.append(f"verse_{match[1]}")
        
        # Range references (e.g., "2:255" or "surah 2 verse 255")
        range_matches = re.findall(r'(\d+):(\d+)', query)
        for match in range_matches:
            entities.append(f"ref_{match[0]}_{match[1]}")
        
        return entities
    
    def _extract_topics(self, query: str) -> List[str]:
        """Extract topics from query."""
        topics = []
        for topic, keywords in self.topic_keywords.items():
            if any(keyword in query for keyword in keywords):
                topics.append(topic)
        return topics
    
    def _detect_language(self, query: str) -> str:
        """Detect preferred language from query."""
        # Check for language indicators
        if any(word in query.lower() for word in ['urdu', 'اردو', 'ترجمہ']):
            return "ur"
        elif any(word in query.lower() for word in ['arabic', 'عربي', 'العربية']):
            return "ar"
        elif any(word in query.lower() for word in ['english', 'eng']):
            return "en"
        return "ar"  # Default to Arabic


class ContextIntelligence:
    """Context intelligence engine for understanding user context and providing relevant insights."""
    
    def __init__(self):
        self.user_contexts: Dict[str, Dict] = {}
        self.session_history: List[Dict] = []
        self.knowledge_graph = KnowledgeGraph()
    
    def update_user_context(self, user_id: str, context: Dict):
        """Update user context with new information."""
        if user_id not in self.user_contexts:
            self.user_contexts[user_id] = {
                "interests": [],
                "language": "ar",
                "reading_level": "intermediate",
                "favorite_topics": [],
                "recent_queries": [],
                "bookmarks": []
            }
        
        self.user_contexts[user_id].update(context)
    
    def get_contextual_recommendations(self, user_id: str, current_query: str = None) -> List[Dict]:
        """Get context-aware recommendations."""
        context = self.user_contexts.get(user_id, {})
        recommendations = []
        
        # Based on interests
        for interest in context.get("interests", []):
            recommendations.append({
                "type": "topic_exploration",
                "topic": interest,
                "reason": f"Based on your interest in {interest}",
                "priority": 0.8
            })
        
        # Based on recent queries
        recent = context.get("recent_queries", [])[-5:]
        for query in recent:
            recommendations.append({
                "type": "follow_up",
                "query": query,
                "reason": "Continue exploring this topic",
                "priority": 0.6
            })
        
        # Based on current query context
        if current_query:
            intent = QueryUnderstanding().analyze_query(current_query)
            for topic in intent.topics:
                recommendations.append({
                    "type": "related_topic",
                    "topic": topic,
                    "reason": f"Related to your question about {topic}",
                    "priority": 0.9
                })
        
        # Sort by priority and deduplicate
        seen = set()
        unique = []
        for rec in sorted(recommendations, key=lambda x: x["priority"], reverse=True):
            key = (rec["type"], rec.get("topic", rec.get("query", "")))
            if key not in seen:
                seen.add(key)
                unique.append(rec)
        
        return unique[:10]
    
    def add_to_history(self, user_id: str, query: str, results: List[SearchResult]):
        """Add interaction to session history."""
        self.session_history.append({
            "user_id": user_id,
            "query": query,
            "timestamp": None,  # Would use datetime
            "result_count": len(results),
            "top_topics": self._extract_topics_from_results(results)
        })
        
        # Update user context
        if user_id in self.user_contexts:
            self.user_contexts[user_id]["recent_queries"].append(query)
            # Keep only last 20
            self.user_contexts[user_id]["recent_queries"] = self.user_contexts[user_id]["recent_queries"][-20:]
    
    def _extract_topics_from_results(self, results: List[SearchResult]) -> List[str]:
        """Extract topics from search results."""
        topics = set()
        for result in results[:5]:
            # Simple topic extraction from text
            text = (result.text + " " + (result.translation or "")).lower()
            for topic, keywords in QueryUnderstanding().topic_keywords.items():
                if any(kw in text for kw in keywords):
                    topics.add(topic)
        return list(topics)


class KnowledgeGraph:
    """Simple knowledge graph for Quranic concepts and relationships."""
    
    def __init__(self):
        self.nodes: Dict[str, Dict] = {}
        self.edges: Dict[str, List[Tuple[str, str]]] = defaultdict(list)  # node -> [(relation, target)]
        self._initialize_quran_knowledge()
    
    def _initialize_quran_knowledge(self):
        """Initialize with core Quranic concepts and relationships."""
        # Core concepts
        concepts = {
            "tawhid": {"type": "concept", "description": "Oneness of God", "arabic": "توحيد"},
            "salah": {"type": "practice", "description": "Prayer", "arabic": "صلاة"},
            "zakat": {"type": "practice", "description": "Charity", "arabic": "زكاة"},
            "sawm": {"type": "practice", "description": "Fasting", "arabic": "صوم"},
            "hajj": {"type": "practice", "description": "Pilgrimage", "arabic": "حج"},
            "quran": {"type": "scripture", "description": "The Quran", "arabic": "قرآن"},
            "sunnah": {"type": "source", "description": "Prophetic tradition", "arabic": "سنة"},
            "iman": {"type": "concept", "description": "Faith", "arabic": "إيمان"},
            "ihsan": {"type": "concept", "description": "Excellence in worship", "arabic": "إحسان"},
            "akhirah": {"type": "concept", "description": "Hereafter", "arabic": "آخرة"},
            "jannah": {"type": "place", "description": "Paradise", "arabic": "جنة"},
            "jahannam": {"type": "place", "description": "Hell", "arabic": "جهنم"},
            "malaika": {"type": "being", "description": "Angels", "arabic": "ملائكة"},
            "jinn": {"type": "being", "description": "Jinn", "arabic": "جن"},
            "shaytan": {"type": "being", "description": "Satan", "arabic": "شيطان"},
        }
        
        for key, data in concepts.items():
            self.nodes[key] = data
        
        # Relationships
        relationships = [
            ("tawhid", "is_foundation_of", "iman"),
            ("iman", "includes", "salah"),
            ("iman", "includes", "zakat"),
            ("iman", "includes", "sawm"),
            ("iman", "includes", "hajj"),
            ("quran", "teaches", "tawhid"),
            ("quran", "teaches", "salah"),
            ("quran", "teaches", "zakat"),
            ("sunnah", "explains", "quran"),
            ("iman", "leads_to", "ihsan"),
            ("ihsan", "leads_to", "jannah"),
            ("shaytan", "opposes", "iman"),
            ("malaika", "record", "deeds"),
        ]
        
        for source, relation, target in relationships:
            self.edges[source].append((relation, target))
    
    def get_related_concepts(self, concept: str, depth: int = 2) -> List[Dict]:
        """Get concepts related to a given concept."""
        if concept not in self.nodes:
            return []
        
        visited = set()
        results = []
        queue = [(concept, 0)]
        
        while queue and len(results) < 20:
            current, d = queue.pop(0)
            if current in visited or d > depth:
                continue
            visited.add(current)
            
            if current != concept:
                results.append({
                    "concept": current,
                    "data": self.nodes.get(current, {}),
                    "distance": d
                })
            
            for relation, target in self.edges.get(current, []):
                if target not in visited:
                    queue.append((target, d + 1))
        
        return results
    
    def find_path(self, source: str, target: str) -> List[str]:
        """Find relationship path between two concepts."""
        if source not in self.nodes or target not in self.nodes:
            return []
        
        # BFS for shortest path
        queue = [(source, [source])]
        visited = {source}
        
        while queue:
            current, path = queue.pop(0)
            if current == target:
                return path
            
            for _, neighbor in self.edges.get(current, []):
                if neighbor not in visited:
                    visited.add(neighbor)
                    queue.append((neighbor, path + [neighbor]))
        
        return []


class IntelligentSearchEngine:
    """Main intelligent search engine combining all search strategies."""
    
    def __init__(self, data_service=None):
        self.inverted_index = InvertedIndex()
        self.semantic_engine = SemanticSearchEngine()
        self.query_understanding = QueryUnderstanding()
        self.context_intelligence = ContextIntelligence()
        self.data_service = data_service
    
    def index_verse(self, verse_id: int, text: str, translation: str = None, metadata: Dict = None):
        """Add verse to all search indexes."""
        # Add to inverted index
        full_text = text + " " + (translation or "")
        self.inverted_index.add_verse(verse_id, full_text, metadata)
        
        # Add to semantic index
        self.semantic_engine.add_verse(verse_id, full_text)
    
    def search(self, query: str, user_id: str = None, limit: int = 20) -> Dict:
        """Perform intelligent multi-strategy search."""
        # Understand query intent
        intent = self.query_understanding.analyze_query(query)
        
        # Get user context
        context = self.context_intelligence.user_contexts.get(user_id, {}) if user_id else {}
        
        # Perform searches
        keyword_results = self._keyword_search(query, limit)
        semantic_results = self.semantic_engine.search(query, limit)
        
        # Combine and rank results
        combined_results = self._combine_results(keyword_results, semantic_results, intent, limit)
        
        # Fallback to live API if index is empty
        if not combined_results and self.data_service:
            api_results = self._api_search(query, limit)
            combined_results = api_results
        
        # Add contextual insights
        insights = self._generate_insights(query, combined_results, intent)
        
        # Update context
        if user_id:
            self.context_intelligence.add_to_history(user_id, query, combined_results)
        
        return {
            "query": query,
            "intent": intent,
            "results": combined_results,
            "insights": insights,
            "suggestions": self._generate_suggestions(query, intent, context)
        }
    
    def _api_search(self, query: str, limit: int) -> List[SearchResult]:
        """Fallback search using live Quran API."""
        results = []
        try:
            api_results = self.data_service.search_quran(query, "en")
            for i, r in enumerate(api_results[:limit]):
                results.append(SearchResult(
                    verse_id=i,
                    chapter=r.get("verse_key", "").split(":")[0] if r.get("verse_key") else "",
                    verse_number=int(r.get("verse_key", "").split(":")[1]) if r.get("verse_key") and ":" in r.get("verse_key") else 0,
                    text=r.get("text", ""),
                    translation=r.get("translation"),
                    score=float(r.get("score", 0.5)),
                    match_type="api",
                    context_snippet=r.get("text", "")[:200]
                ))
        except Exception as e:
            print(f"API search fallback error: {e}")
        return results
    
    def _keyword_search(self, query: str, limit: int) -> List[SearchResult]:
        """Keyword-based search using inverted index."""
        verse_ids = self.inverted_index.search_or(query, limit * 2)
        results = []
        
        for verse_id in verse_ids:
            text = self.inverted_index.verse_texts.get(verse_id, "")
            metadata = self.inverted_index.verse_metadata.get(verse_id, {})
            
            # Calculate keyword match score
            score = self._calculate_keyword_score(query, text)
            
            results.append(SearchResult(
                verse_id=verse_id,
                chapter=metadata.get("chapter", ""),
                verse_number=metadata.get("verse_number", 0),
                text=text,
                translation=metadata.get("translation"),
                score=score,
                match_type="keyword",
                matched_terms=self.inverted_index._tokenize(query)
            ))
        
        results.sort(key=lambda x: x.score, reverse=True)
        return results[:limit]
    
    def _calculate_keyword_score(self, query: str, text: str) -> float:
        """Calculate keyword match score."""
        query_tokens = set(self.inverted_index._tokenize(query))
        text_tokens = set(self.inverted_index._tokenize(text))
        
        if not query_tokens:
            return 0.0
        
        intersection = query_tokens & text_tokens
        return len(intersection) / len(query_tokens)
    
    def _combine_results(self, keyword_results: List[SearchResult], 
                        semantic_results: List[SearchResult],
                        intent: QueryIntent, limit: int) -> List[SearchResult]:
        """Combine and re-rank results from different strategies."""
        # Create combined dict by verse_id
        combined = {}
        
        # Weight factors based on intent
        weights = {
            "verse_lookup": {"keyword": 0.8, "semantic": 0.2},
            "topic_search": {"keyword": 0.4, "semantic": 0.6},
            "concept_exploration": {"keyword": 0.3, "semantic": 0.7},
            "comparison": {"keyword": 0.5, "semantic": 0.5},
            "explanation": {"keyword": 0.4, "semantic": 0.6}
        }
        
        intent_weights = weights.get(intent.intent_type, weights["topic_search"])
        
        # Add keyword results
        for result in keyword_results:
            combined[result.verse_id] = result
            result.score *= intent_weights["keyword"]
        
        # Add semantic results
        for result in semantic_results:
            if result.verse_id in combined:
                combined[result.verse_id].score += result.score * intent_weights["semantic"]
                combined[result.verse_id].match_type = "hybrid"
            else:
                result.score *= intent_weights["semantic"]
                combined[result.verse_id] = result
        
        # Sort by combined score
        sorted_results = sorted(combined.values(), key=lambda x: x.score, reverse=True)
        return sorted_results[:limit]
    
    def _generate_insights(self, query: str, results: List[SearchResult], 
                          intent: QueryIntent) -> List[Dict]:
        """Generate contextual insights for results."""
        insights = []
        
        # Topic-based insights
        for topic in intent.topics:
            related = self.context_intelligence.knowledge_graph.get_related_concepts(topic)
            if related:
                insights.append({
                    "type": "related_concepts",
                    "topic": topic,
                    "concepts": related[:5]
                })
        
        # Cross-references
        if results:
            top_result = results[0]
            # Could add tafsir references, related verses, etc.
            insights.append({
                "type": "context",
                "message": f"Found {len(results)} relevant verses",
                "top_match": {
                    "verse": f"{top_result.chapter}:{top_result.verse_number}",
                    "score": top_result.score
                }
            })
        
        return insights
    
    def _generate_suggestions(self, query: str, intent: QueryIntent, 
                            context: Dict) -> List[str]:
        """Generate search suggestions."""
        suggestions = []
        
        # Based on intent
        if intent.intent_type == "topic_search":
            suggestions.append(f"Explain {intent.topics[0] if intent.topics else 'this topic'} in detail")
            suggestions.append(f"Compare verses about {intent.topics[0] if intent.topics else 'this topic'}")
        
        # Based on user context
        for interest in context.get("interests", [])[:3]:
            suggestions.append(f"Explore {interest} further")
        
        return suggestions[:5]