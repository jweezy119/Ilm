"""Views for Ilm - Quran AI App"""

from abc import ABC, abstractmethod


class BaseView(ABC):
    """Base class for all views in the Ilm app."""
    
    @abstractmethod
    def render(self, context: dict) -> str:
        """Render the view with given context."""
        pass


class ChatView(BaseView):
    """Chat interface for AI Q&A about the Quran."""
    
    def render(self, context: dict) -> str:
        """Render the chat interface."""
        # Implementation: display chat UI with message history
        return f"<div class=\"chat-container\">{context.get('messages', [])}</div>"


class SearchView(BaseView):
    """Search interface for finding verses."""
    
    def render(self, context: dict) -> str:
        """Render the search interface."""
        # Implementation: display search form and results
        return "<form class=\"search-form\">..."


class RecommendationView(BaseView):
    """Recommendation interface for AI suggestions."""
    
    def render(self, context: dict) -> str:
        """Render the recommendations interface."""
        # Implementation: display AI recommendations
        return "<div class=\"recommendations\">..."


class HadithInferenceView(BaseView):
    """View for displaying hadith inferences separately from Quran text."""
    
    def render(self, context: dict) -> str:
        """Render the hadith inferences interface."""
        # Implementation: display hadith insights
        return "<div class=\"hadith-inferences\">..."
