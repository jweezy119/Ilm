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

## Deploy Free on the Web

### Option 1: Render (Recommended, Free tier available)
1. Push this repo to GitHub
2. Go to https://render.com and connect your GitHub account
3. Create a new **Web Service**
4. Select the `Ilm` repo
5. Build command: `pip install -r requirements.txt`
6. Start command: `gunicorn web_app:app --bind 0.0.0.0:$PORT --workers 2 --timeout 120`
7. Add environment variable: `PYTHON_VERSION=3.12`
8. Deploy - your app will be live at `https://ilm.onrender.com`

### Option 2: Railway (Free $5/month credit)
1. Push to GitHub
2. Go to https://railway.app and create a new project from GitHub
3. Select the `Ilm` repo
4. Railway auto-detects Python and deploys
5. Live URL provided after deployment

### Option 3: Fly.io (Free tier with 3 VMs)
1. Install Fly CLI: `curl -L https://fly.io/install.sh | sh`
2. Run: `fly launch` in the Ilm directory
3. Follow prompts to deploy
4. Free VM with 256MB RAM (sufficient for few users)

### Option 4: Hugging Face Spaces (Free)
1. Go to https://huggingface.co/spaces
2. Create new Space, select **Gradio** or **Streamlit** as SDK
3. Upload `web_app.py` and `requirements.txt`
4. Or use Docker with `Dockerfile`

## Local Development

```bash
# Install dependencies
pip install -r requirements.txt

# Run the web app
python web_app.py

# Access at http://localhost:8000
```

## Tech Stack

- **Backend**: Python with Flask
- **Search**: AI-powered semantic + keyword search
- **Data**: Real-time APIs (api.quran.com, UmmahAPI)
- **Context**: User profiling, knowledge graph
- **Deployment**: Render, Railway, Fly.io (all free tiers)


