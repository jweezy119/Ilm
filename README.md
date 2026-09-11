# Ilm - Quran AI App

A Quranic AI assistant with search, recommendations, and multilingual support.

## Features

- **AI Chat Interface**: Ask questions about the Quran and receive intelligent answers with context
- **AI Intuitive Search & Indexing**:
  - Semantic search with vector embeddings
  - Inverted index for fast keyword lookup
  - Multi-strategy ranking (keyword + semantic)
- **Context Intelligence**:
  - User profiling and reading history
  - Topic tracking and knowledge graph
  - Personalized context awareness
- **AI Recommendations**:
  - Interest-based suggestions
  - Time/occasion-based recommendations (morning, evening, Friday)
  - Exploratory recommendations for new topics
  - Complementary verse suggestions
  - 7-day personalized reading plans
- **Online Quran Reader**: View the Quran online with translation options
- **Multilingual Support**: Read the Quran in preferred languages
- **Hadith Inferences**: Separate section for hadith-related insights (separate from Quran text)

## Data Sources

### Quran
- **Primary**: `api.quran.com` (official API, free)
- **Fallback**: `api.alquran.cloud` (Al Quran Cloud, open CDN)
- Features: Arabic text, translations, audio recitations, search

### Hadith
- **Primary**: `UmmahAPI Hadith API` (https://ummahapi.com/api/hadith)
- Collections: Sahih Bukhari, Sahih Muslim, Abu Dawud, Tirmidhi, Nasa'i, Ibn Majah, Muwatta Malik (36,000+ hadiths)
- Free, no API key required
- Includes authenticity grading (Sahih, Hasan, Da'if)

## Structure

- `data_service.py` - API integration with real Quran/Hadith sources
- `search_engine.py` - AI search, indexing, query understanding, context intelligence
- `recommendations.py` - Context-aware recommendation engine
- `app.py` - Main application controller
- `api/quran_api.py` - REST API layer
- `models/quran_model.py` - Data models
- `views/` - Frontend views (chat, search, recommendations, hadith)

## Installation

```bash
cd /home/peesee/Desktop/Ilm
pip install -r requirements.txt
```

## Usage

```python
from app import app

# Get AI response to a question
response = app.get_ai_response("What does the Quran say about mercy?")

# Search verses
results = app.search_verses("patience")

# Get personalized recommendations
recs = app.get_recommendations(user_id="user123")

# Get topic recommendations
recs = app.get_topic_recommendations("charity")

# Generate reading plan
plan = app.get_reading_plan(user_id="user123", days=7)

# Fetch Quran verse
verse = app.get_quran_text("2:255")

# Fetch Hadiths
hadiths = app.load_hadith_inferences(query="prayer", collection="bukhari")

# Update user context for personalization
app.update_user_context("user123", {"interests": ["mercy", "patience"]})
```

