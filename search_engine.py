"""AI-powered semantic search and indexing for Ilm"""

import json
import re
from dataclasses import dataclass, field
from typing import List, Dict, Optional, Set, Tuple
from pathlib import Path
from collections import defaultdict
import hashlib
import time
from collections import defaultdict, OrderedDict


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
    """Inverted index for fast keyword-based verse lookup with TF-IDF scoring."""

    stop_words = {
        'the', 'and', 'or', 'in', 'of', 'to', 'a', 'is', 'for', 'on', 'with', 'as', 'by',
        'at', 'an', 'it', 'that', 'this', 'are', 'was', 'were', 'be', 'been', 'have', 'has',
        'had', 'will', 'would', 'could', 'should', 'may', 'might', 'must', 'shall', 'can', 'do',
        'does', 'did', 'not', 'no', 'yes', 'but', 'if', 'then', 'else', 'when', 'where', 'who',
        'whom', 'whose', 'why', 'how', 'what', 'which', 'there', 'here', 'all', 'each', 'every',
        'both', 'few', 'more', 'most', 'other', 'some', 'such', 'only', 'own', 'same', 'than',
        'too', 'very', 'just', 'because', 'until', 'while', 'about', 'against', 'between',
        'through', 'during', 'before', 'after', 'above', 'below', 'up', 'down', 'out', 'off',
        'over', 'under', 'again', 'further', 'once', 'shall', 'unto', 'upon', 'am',
    }

    def __init__(self):
        self.index: Dict[str, Dict[int, int]] = defaultdict(dict)  # token -> {verse_id: count}
        self.verse_texts: Dict[int, str] = {}
        self.verse_metadata: Dict[int, Dict] = {}
        self.document_count = 0
        self._idf_cache: Dict[str, float] = {}
        self._token_totals: Dict[str, int] = {}
    
    def add_verse(self, verse_id: int, text: str, metadata: Dict = None, index_text: str = None):
        """Add a verse to the index.

        `text` is what gets shown to the user; `index_text` is what gets
        tokenized for matching. Keeping them separate stops the Arabic and
        the translation from being glued together in the rendered result.
        """
        if verse_id not in self.verse_texts:
            self.document_count += 1
        self.verse_texts[verse_id] = text
        self.verse_metadata[verse_id] = metadata or {}

        tokens = self._tokenize(text if index_text is None else index_text)
        # IDF depends on document_count and per-token doc frequency, so any
        # previously cached value is stale once the corpus changes.
        self._idf_cache.clear()
        self._token_totals.clear()
        for token in tokens:
            self.index[token][verse_id] = self.index[token].get(verse_id, 0) + 1
    
    def _tokenize(self, text: str) -> List[str]:
        """Tokenize text into searchable terms."""
        text = text.lower()
        # Drop apostrophes instead of replacing them with a space, so
        # "Qur'an" indexes as "quran" rather than "qur an". Without this,
        # searching "Quran" returned nothing at all.
        text = re.sub(r"[‘’ʼ'ـ]", "", text)
        text = re.sub(r"[^\w\s]", " ", text)
        tokens = [self._stem(t) for t in text.split()]
        return [t for t in tokens if t not in self.stop_words and len(t) > 1]

    # Transliterations and synonyms mapped onto the word used by the
    # English translation, so an Arabic/Urdu query still matches.
    synonyms = {
        "salah": ["prayer", "pray"],
        "salat": ["prayer", "pray"],
        "namaz": ["prayer", "pray"],
        "dua": ["supplication"],
        "zakat": ["charity", "alms"],
        "sadaqah": ["charity", "alms"],
        "sawm": ["fasting", "fast"],
        "roza": ["fasting", "fast"],
        "hajj": ["pilgrimage"],
        "umrah": ["pilgrimage"],
        "quran": ["quran", "koran", "scripture"],
        "koran": ["quran", "koran"],
        "qibla": ["direction"],
        "jannah": ["paradise", "garden"],
        "jahannam": ["hellfire", "hell"],
        "jihad": ["struggle", "effort"],
        "tawheed": ["oneness", "god"],
        "shirk": ["idolatry", "polytheism"],
        "iman": ["faith", "belief"],
        "akhirah": ["hereafter", "afterlife"],
        "tafsir": ["interpretation", "explanation"],
        "insha": ["allah"],
        "rahman": ["mercy", "merciful"],
        "raheem": ["mercy", "merciful"],
        "quranic": ["quran"],
        "ayah": ["verse", "verses"],
        "ayat": ["verse", "verses"],
        "surah": ["chapter"],
        "nabi": ["prophet"],
        "rasul": ["messenger", "prophet"],
    }

    @classmethod
    def _expand_query_tokens(cls, tokens):
        """Add synonym variants so equivalent words in different scripts match."""
        expanded = list(tokens)
        for token in tokens:
            for extra in cls.synonyms.get(token, ()):
                if extra not in expanded:
                    expanded.append(extra)
        return expanded

    @staticmethod
    def _stem(token: str) -> str:
        """Light suffix stripping so plurals and tenses match a query.

        This gives the recall benefit that a real semantic index would,
        at a fraction of the cost: "charities" now matches "charity".
        """
        if len(token) > 4 and token.endswith("ies"):
            return token[:-3] + "y"
        if len(token) > 4 and token.endswith("ses"):
            return token[:-2]
        if len(token) > 3 and token.endswith("es") and not token.endswith("ses"):
            return token[:-2]
        if len(token) > 3 and token.endswith("s") and not token.endswith("ss"):
            return token[:-1]
        if len(token) > 5 and token.endswith("ing"):
            return token[:-3]
        return token
    
    def search(self, query: str, limit: int = 50) -> List[int]:
        """Search index for verses matching query terms."""
        return self.search_or(query, limit)

    def search_or(self, query: str, limit: int = 50) -> List[int]:
        """Search index for verses matching any query term."""
        tokens = self._expand_query_tokens(self._tokenize(query))
        if not tokens:
            return []

        scores = {}
        for token in tokens:
            postings = self.index.get(token)
            if not postings:
                continue
            idf = self._idf(token)
            # Total occurrences of this token, computed once per token.
            # Previously this was recomputed inside the per-verse loop,
            # which made every search O(postings * corpus) and very slow.
            total = self._token_totals.get(token)
            if total is None:
                total = sum(postings.values()) or 1
                self._token_totals[token] = total
            for verse_id, count in postings.items():
                tf = count / total
                scores[verse_id] = scores.get(verse_id, 0) + tf * idf

        ranked = sorted(scores.items(), key=lambda x: (-x[1], str(x[0])))
        return [vid for vid, _ in ranked[:limit]]
    
    def _idf(self, token: str) -> float:
        """Compute IDF for a token."""
        if token in self._idf_cache:
            return self._idf_cache[token]
        
        doc_freq = len(self.index.get(token, {}))
        if doc_freq == 0:
            idf = 0.0
        else:
            import math
            idf = math.log((self.document_count + 1) / (doc_freq + 1)) + 1
        
        self._idf_cache[token] = idf
        return idf


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
        """Generate a deterministic bag-of-words pseudo-embedding.

        The previous version hashed the raw string with MD5 and cycled the
        16 digest bytes across 384 dimensions. Cosine similarity between
        two such vectors is pure noise, so every "semantic" hit was
        arbitrary and it injected junk into the ranking. This version
        instead projects actual word frequencies, so similarity reflects
        real lexical overlap.
        """
        vector = [0.0] * dim
        tokens = re.findall(r"[a-z0-9']+", text.lower())
        if not tokens:
            return vector
        for token in tokens:
            digest = hashlib.md5(token.encode()).digest()
            bucket = int.from_bytes(digest[:4], "big") % dim
            vector[bucket] += 1.0
        norm = sum(v * v for v in vector) ** 0.5
        if norm == 0:
            return vector
        return [v / norm for v in vector]
    
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

    QUERY_CACHE_TTL = 300  # seconds

    def __init__(self, data_service=None, cache_size: int = 128):
        self.inverted_index = InvertedIndex()
        self.semantic_engine = SemanticSearchEngine()
        self.query_understanding = QueryUnderstanding()
        self.context_intelligence = ContextIntelligence()
        self.data_service = data_service
        self._index_loaded = False
        self._index_loading = False
        self._load_error = None
        self._cache_size = cache_size
        self._query_cache: "OrderedDict[Tuple[str, str, int], Tuple[float, Dict]]" = OrderedDict()
        self._cache_hits = 0
        self._cache_misses = 0
    
    def _ensure_indexed(self):
        """Load the full Quran into the index once, on first use."""
        if self._index_loaded or self._index_loading or not self.data_service:
            return

        self._index_loading = True
        try:
            verses = self.data_service._get_full_quran("en")
            chapters = {
                c.id: c
                for c in self.data_service.get_all_quran_chapters("en")
            }
            for v in verses:
                chapter = chapters.get(v.chapter_id)
                self.index_verse(
                    v.verse_key,
                    v.text or "",
                    v.translation,
                    {
                        "chapter": chapter.name_simple if chapter else str(v.chapter_id or ""),
                        "verse_number": v.verse_number,
                        "verse_key": v.verse_key
                    }
                )
            self._index_loaded = True
        except Exception as e:
            self._load_error = str(e)
            print(f"Quran indexing error: {e}")
        finally:
            self._index_loading = False

    def index_verse(self, verse_key: str, text: str, translation: str = None, metadata: Dict = None):
        """Add a verse to the search index.

        The verse key ("2:255") is the id, not a positional counter, so
        results from different strategies can be merged reliably.
        """
        metadata = dict(metadata or {})
        metadata["translation"] = translation
        searchable = f"{text} {translation or ''}".strip()
        self.inverted_index.add_verse(verse_key, text, metadata, index_text=searchable)
    
    def search(self, query: str, user_id: str = None, limit: int = 20) -> Dict:
        """Perform intelligent multi-strategy search."""
        # Ensure index is loaded
        self._ensure_indexed()

        # Repeated queries (chips, back-navigation, Discover refresh) are
        # common, and the index no longer changes once built, so results
        # are safe to memoize for a short window.
        cache_key = (query.strip().lower(), user_id or "", limit)
        cached = self._query_cache.get(cache_key)
        if cached and (time.time() - cached[0]) < self.QUERY_CACHE_TTL:
            self._query_cache.move_to_end(cache_key)
            self._cache_hits += 1
            return cached[1]
        self._cache_misses += 1

        # Understand query intent
        intent = self.query_understanding.analyze_query(query)
        
        # Get user context
        context = self.context_intelligence.user_contexts.get(user_id, {}) if user_id else {}
        
        # Perform searches
        keyword_results = self._keyword_search(query, limit)

        # Combine and rank results. The old pseudo-embedding "semantic"
        # stage is intentionally not blended in: its similarities were
        # noise, and blending them degraded correct keyword rankings.
        # Stemming in the tokenizer provides the recall it was meant to.
        combined_results = self._combine_results(keyword_results, [], intent, limit)
        
        # Fallback to live API if index is empty
        if not combined_results and self.data_service:
            api_results = self._api_search(query, limit)
            combined_results = api_results
        
        # Add contextual insights
        insights = self._generate_insights(query, combined_results, intent)
        
        # Update context
        if user_id:
            self.context_intelligence.add_to_history(user_id, query, combined_results)

        payload = {
            "query": query,
            "intent": intent,
            "results": combined_results,
            "insights": insights,
            "suggestions": self._generate_suggestions(query, intent, context)
        }

        self._query_cache[cache_key] = (time.time(), payload)
        self._query_cache.move_to_end(cache_key)
        while len(self._query_cache) > self._cache_size:
            self._query_cache.popitem(last=False)

        return payload
    
    def _api_search(self, query: str, limit: int) -> List[SearchResult]:
        """Fallback search using the live Quran search API."""
        results = []
        try:
            api_results = self.data_service.search_quran(query, "en")
            chapters = {
                c.id: c.name_simple
                for c in self.data_service.get_all_quran_chapters("en")
            }
            for r in api_results[:limit]:
                verse_key = r.get("verse_key") or ""
                chapter, _, verse_number = verse_key.partition(":")
                # Use the verse key as the id. The previous code used the
                # loop counter, which collided with indexed verse ids and
                # let unrelated results overwrite each other when merged.
                results.append(SearchResult(
                    verse_id=verse_key,
                    chapter=chapters.get(int(chapter), chapter) if chapter.isdigit() else chapter,
                    verse_number=int(verse_number) if verse_number.isdigit() else 0,
                    text=r.get("text", ""),
                    translation=r.get("translation"),
                    score=float(r.get("score", 0.5)),
                    match_type="api",
                    context_snippet=verse_key
                ))
        except Exception as e:
            print(f"API search fallback error: {e}")
        return results
    
    def _keyword_search(self, query: str, limit: int) -> List[SearchResult]:
        """Keyword-based search using the inverted index."""
        if not self._index_loaded:
            return []

        verse_ids = self.inverted_index.search_or(query, limit * 4)
        results = []

        for verse_id in verse_ids:
            text = self.inverted_index.verse_texts.get(verse_id, "")
            metadata = self.inverted_index.verse_metadata.get(verse_id, {})
            translation = metadata.get("translation")

            score = self._calculate_tfidf_score(query, text, translation)

            results.append(SearchResult(
                verse_id=verse_id,
                chapter=metadata.get("chapter", ""),
                verse_number=metadata.get("verse_number", 0),
                text=text,
                translation=translation,
                score=score,
                match_type="keyword",
                matched_terms=self.inverted_index._tokenize(query),
                context_snippet=f"{metadata.get('chapter', '')}:{metadata.get('verse_number', '')}"
            ))

        results.sort(key=lambda x: x.score, reverse=True)
        return results[:limit]

    def _calculate_tfidf_score(self, query: str, text: str, translation: str = None) -> float:
        """Calculate a TF-IDF score for a query against a verse."""
        base_tokens = self.inverted_index._tokenize(query)
        query_tokens = self.inverted_index._expand_query_tokens(base_tokens)
        if not base_tokens:
            return 0.0

        text_tokens = self.inverted_index._tokenize(f"{text} {translation or ''}")
        if not text_tokens:
            return 0.0

        text_set = set(text_tokens)
        score = 0.0
        matched_weight = 0.0
        for token in query_tokens:
            # Original terms weigh full marks; synonym expansions count for
            # less so an exact match always outranks a translated one.
            weight = 1.0 if token in base_tokens else 0.5
            matched_weight += weight
            if token in text_set:
                tf = text_tokens.count(token) / len(text_tokens)
                score += weight * tf * self.inverted_index._idf(token)

        return score / matched_weight if matched_weight else 0.0
    
    def _combine_results(self, keyword_results: List[SearchResult], 
                        semantic_results: List[SearchResult],
                        intent: QueryIntent, limit: int) -> List[SearchResult]:
        """Combine and re-rank results from different strategies."""
        combined = {}
        
        # Add keyword results with TF-IDF scores
        for result in keyword_results:
            combined[result.verse_id] = result
        
        # Add semantic results as boost
        for result in semantic_results:
            if result.verse_id in combined:
                combined[result.verse_id].score += result.score * 0.2
                combined[result.verse_id].match_type = "hybrid"
            else:
                result.score *= 0.3
                combined[result.verse_id] = result
        
        # Sort by score
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
            insights.append({
                "type": "context",
                "message": f"Found {len(results)} relevant verses",
                "top_match": {
                    "verse": str(top_result.verse_id),
                    "score": round(top_result.score, 4)
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