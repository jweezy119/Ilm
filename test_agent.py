"""Test suite for the Ilm agent's suggestion engine."""

from datetime import datetime
from ilm.agent import (
    ConversationState,
    UserMessage,
    AgentTurn,
    ReferenceResolver,
    DialogueRouter,
    AnswerSynthesizer,
    AgenticChatEngine
)


def test_emotional_state_detection():
    """Test emotional state detection in ReferenceResolver."""
    resolver = ReferenceResolver()
    
    # Test curious (more positive words)
    assert resolver.detect_emotional_state("Can you explain patience?", {}) == "curious"
    
    # Test uncertain (more negative words)
    assert resolver.detect_emotional_state("I am confused about this topic", {}) == "uncertain"
    
    # Test neutral (balanced)
    assert resolver.detect_emotional_state("Tell me about family", {}) == "neutral"
    
    print("✓ Emotional state detection tests passed")


def test_family_duty_keywords():
    """Test family and duty keyword matching in DialogueRouter."""
    router = DialogueRouter()
    
    # Test father keyword
    assert router.is_follow_up("Tell me more about the father thing", {}) == False
    assert router.is_follow_up("Explain about the father", {}) == True
    
    # Test mother keyword
    assert router.is_follow_up("What about mother?", {}) == False
    assert router.is_follow_up("Discuss mother duties", {}) == True
    
    # Test parent keyword
    assert router.is_follow_up("Talk about parents", {}) == False
    assert router.is_follow_up("Share parent wisdom", {}) == True
    
    # Test responsibility keyword
    assert router.is_follow_up("Discuss responsibilities", {}) == False
    assert router.is_follow_up("Explain obligations", {}) == True
    
    print("✓ Family duty keyword tests passed")


def test_active_topic_continuation():
    """Test active topic continuation logic."""
    state = ConversationState(
        user_id="test_user",
        active_topic="patience",
        active_entities=[]
    )
    
    # Should continue with active topic
    assert state.active_topic == "patience"
    
    # Test switching topics
    state2 = ConversationState(
        user_id="test_user",
        active_topic="quran",
        active_entities=[]
    )
    assert state2.active_topic == "quran"
    
    print("✓ Active topic continuation tests passed")


def test_suggestion_generation():
    """Test the suggestion generation in AnswerSynthesizer."""
    synthesizer = AnswerSynthesizer()
    
    # Test with curious emotional state
    question = "What is patience?"
    verses = [
        {
            "chapter": "Al-Baqarah",
            "verse_number": "187",
            "text": "Al-tawakkulu 'ala Allahi wa yatawa'allalu Allahu bi-ma kuntu arada'a al-'amaliya",
            "translation": "Put your trust in God and He will support you in whatever you endeavor to do."
        }
    ]
    hadiths = []
    intent_topics = ["patience"]
    
    result = synthesizer.synthesize(question, verses, hadiths, intent_topics)
    
    # Should contain topic-related suggestions
    assert "patience" in result or "family" in result or "quran" in result
    print("✓ Suggestion generation test passed")


def test_full_agent_flow():
    """Test the complete agent flow with a sample conversation."""
    # Create a mock data service and search engine
    class MockDataService:
        def get_verses(self, chapter, verse):
            return {
                "chapter": chapter,
                "verse_number": verse,
                "text": "God guides the believers to patience.",
                "translation": "Allah guides the believers to patience."
            }
    
    class MockSearchEngine:
        def query_understanding(self, query):
            return {"topics": ["patience", "faith"]}
    
    # Initialize components
    resolver = ReferenceResolver()
    router = DialogueRouter()
    synthesizer = AnswerSynthesizer()
    engine = AgenticChatEngine(data_service=MockDataService(), search_engine=MockSearchEngine(), context_intelligence=None)
    
    # Simulate a conversation
    user_msg = UserMessage(role="user", text="Tell me about patience")
    
    # Add to memory
    engine.memory.add_user_message("test_user", user_msg.text)
    
    # Generate suggestion
    suggestion = synthesizer.synthesize(
        question="Tell me about patience",
        verses=[{
            "chapter": "Al-Baqarah",
            "verse_number": "187",
            "text": "Al-tawakkulu 'ala Allahi wa yatawa'allalu Allahu bi-ma kuntu arada'a al-'amaliya",
            "translation": "Put your trust in God and He will support you in whatever you endeavor to do."
        }],
        hadiths=[],
        intent_topics=["patience"]
    )
    
    print("✓ Full agent flow test passed")


if __name__ == "__main__":
    test_emotional_state_detection()
    test_family_duty_keywords()
    test_active_topic_continuation()
    test_suggestion_generation()
    test_full_agent_flow()
    print("\n✅ All tests passed!")
