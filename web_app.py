"""Minimal web interface for Ilm - deployable on Render/Railway/Fly.io"""

from flask import Flask, request, jsonify, render_template_string
from flask_cors import CORS
from app import app as ilm_app
from quran_reader import QuranReader, SurahInfo

app = Flask(__name__)
CORS(app)

HTML = """<!DOCTYPE html>
<html>
<head>
<title>Ilm</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
* { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
:root {
  --bg: #f8fafc;
  --surface: #ffffff;
  --border: #e2e8f0;
  --text: #1e293b;
  --muted: #64748b;
  --primary: #0f766e;
  --primary-strong: #115e59;
  --accent: #fbbf24;
  --verse-accent: #0f766e;
  --hadith-accent: #7c3aed;
}
body { background: var(--bg); color: var(--text); min-height: 100vh; min-height: 100dvh; display: flex; flex-direction: column; }
.app-shell { display: flex; flex-direction: column; min-height: 100vh; min-height: 100dvh; }
.topbar {
  background: var(--surface);
  border-bottom: 1px solid var(--border);
  padding: 0.75rem 1rem;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  position: sticky;
  top: 0;
  z-index: 20;
  flex-shrink: 0;
}
.brand { font-weight: 800; font-size: 1.15rem; color: var(--primary); letter-spacing: 0.2px; display: flex; align-items: center; gap: 0.5rem; }
.brand-arabic { font-family: 'Traditional Arabic', 'Amiri', 'serif'; font-size: 1.4rem; font-weight: 900; color: var(--primary-strong); line-height: 1; direction: rtl; }
.brand-english { font-family: inherit; font-weight: inherit; font-size: inherit; color: inherit; }
.nav { display: flex; gap: 0.5rem; }
.nav-btn {
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--text);
  padding: 0.55rem 0.9rem;
  border-radius: 999px;
  font-size: 0.9rem;
  cursor: pointer;
  font-weight: 600;
}
.nav-btn.active { background: var(--primary); color: #fff; border-color: var(--primary); }
.nav-btn.secondary { background: #f1f5f9; }
.panels { flex: 1; display: flex; flex-direction: column; min-height: 0; }
.panel { display: none; flex: 1; min-height: 0; }
.panel.open { display: flex; flex-direction: column; min-height: 0; }
.pad { padding: 1rem; max-width: 1100px; margin: 0 auto; width: 100%; }
.chat-scroll { flex: 1; overflow-y: auto; padding: 1rem; padding-bottom: max(1rem, env(safe-area-inset-bottom)); }
.bubble {
  margin: 0.5rem 0;
  padding: 0.9rem 1rem;
  border-radius: 1rem;
  max-width: 92%;
  line-height: 1.45;
  font-size: 0.98rem;
}
.bubble.user { background: var(--primary); color: #fff; margin-left: auto; border-bottom-right-radius: 0.25rem; }
.bubble.ai { background: var(--surface); border: 1px solid var(--border); color: var(--text); border-bottom-left-radius: 0.25rem; box-shadow: 0 1px 2px rgba(0,0,0,0.04); }
.card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 0.75rem;
  padding: 1rem;
  margin: 0.6rem 0;
  box-shadow: 0 1px 2px rgba(0,0,0,0.04);
}
.card.verse { border-left: 4px solid var(--verse-accent); }
.card.hadith { border-left: 4px solid var(--hadith-accent); }
.meta { font-size: 0.8rem; color: var(--muted); margin-top: 0.25rem; }
.source { font-size: 0.75rem; color: #94a3b8; margin-top: 0.35rem; }
.disclaimer {
  background: #fffbeb;
  border: 1px solid #fcd34d;
  color: #92400e;
  padding: 0.7rem 0.9rem;
  border-radius: 0.6rem;
  margin: 0.6rem 0;
  font-size: 0.85rem;
}
.arabic { font-size: 1.35rem; line-height: 2; text-align: right; direction: rtl; margin: 0.75rem 0; color: var(--text); }
.translation { margin-top: 0.6rem; color: #475569; font-style: italic; }
.controls {
  background: transparent;
  border-top: none;
  padding: 1.5rem 1rem 2rem 1rem;
  flex-shrink: 0;
  display: flex;
  justify-content: center;
  padding-bottom: max(1.5rem, env(safe-area-inset-bottom));
}

.controls-inner {
  max-width: 800px;
  width: 100%;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 1.5rem;
  padding: 0.75rem;
  display: flex;
  align-items: center;
  gap: 0.75rem;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
  transition: all 0.3s ease;
  position: relative;
}

.controls-inner:focus-within {
  border-color: var(--primary);
  box-shadow: 0 6px 20px rgba(15, 118, 110, 0.15);
  transform: translateY(-2px);
}

#query {
  flex: 1;
  padding: 0.875rem 1.25rem;
  border: none;
  background: transparent;
  color: var(--text);
  font-size: 1rem;
  border-radius: 999px;
  outline: none;
  min-height: 52px;
  width: 100%;
  transition: all 0.3s ease;
}

#query::placeholder {
  color: var(--muted);
}

.controls-inner button.primary {
  background: var(--primary);
  color: white;
  border: none;
  padding: 0.875rem 1.75rem;
  border-radius: 999px;
  font-weight: 600;
  font-size: 0.95rem;
  cursor: pointer;
  transition: all 0.3s ease;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  position: relative;
  overflow: hidden;
  min-width: 100px;
  min-height: 52px;
}

.controls-inner button.primary:hover {
  background: var(--primary-strong);
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(15, 118, 110, 0.3);
}

.controls-inner button.primary:active {
  transform: translateY(0);
}

.controls-inner button.primary::before {
  content: '';
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 0;
  height: 0;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.5);
  transition: width 0.6s, height 0.6s;
}

.controls-inner button.primary:active::before {
  width: 200%;
  height: 200%;
}

.holographic-effect {
  position: relative;
  background: linear-gradient(135deg, rgba(15, 118, 110, 0.1), rgba(15, 118, 110, 0.05));
  backdrop-filter: blur(10px);
  border: 1px solid rgba(15, 118, 110, 0.2);
}

.holographic-effect::before {
  content: '';
  position: absolute;
  top: -2px;
  left: -2px;
  right: -2px;
  bottom: -2px;
  border-radius: inherit;
  background: linear-gradient(135deg, var(--primary), var(--accent));
  opacity: 0.3;
  z-index: -1;
  filter: blur(8px);
  transition: opacity 0.3s ease;
}

.holographic-effect:hover::before {
  opacity: 0.6;
}

.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin: 1rem 0;
  justify-content: center;
  padding: 0 1rem;
}

.chip {
  background: var(--surface);
  border: 1px solid var(--border);
  padding: 0.5rem 1rem;
  border-radius: 999px;
  font-size: 0.875rem;
  cursor: pointer;
  transition: all 0.3s ease;
  font-weight: 500;
  color: var(--text);
  position: relative;
  overflow: hidden;
}

.chip:hover {
  background: var(--primary);
  color: white;
  border-color: var(--primary);
  transform: translateY(-1px);
  box-shadow: 0 2px 8px rgba(15, 118, 110, 0.2);
}

.chip:active {
  transform: translateY(0);
}

@keyframes pulse-ring {
  0% { transform: scale(0.8); opacity: 1; }
  100% { transform: scale(2); opacity: 0; }
}

.chip::after {
  content: '';
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 100%;
  height: 100%;
  border-radius: inherit;
  border: 2px solid var(--primary);
  opacity: 0;
  animation: pulse-ring 2s infinite;
}

@keyframes typing-dots {
  0%, 20% { opacity: 0; }
  50% { opacity: 1; }
  100% { opacity: 0; }
}

.typing-indicator {
  display: inline-flex;
  gap: 0.25rem;
  margin-left: 0.5rem;
}

.typing-indicator span {
  background: var(--muted);
  width: 3px;
  height: 3px;
  border-radius: 50%;
  animation: typing-dots 1.4s infinite;
  opacity: 0;
}

.typing-indicator span:nth-child(2) { animation-delay: 0.2s; }
.typing-indicator span:nth-child(3) { animation-delay: 0.4s; }
  padding: 0.35rem 0.75rem;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 999px;
  font-size: 0.85rem;
  cursor: pointer;
  color: var(--text);
}
.chip:hover { border-color: var(--primary); background: #f0fdfa; }
.insights { margin-top: 0.75rem; padding: 0.9rem; background: #f0fdfa; border-radius: 0.6rem; border: 1px solid #99f6e4; }
.insights b { color: var(--primary); }
.error { color: #dc2626; background: #fef2f2; padding: 0.9rem; border-radius: 0.6rem; border: 1px solid #fecaca; }
.loading { color: var(--muted); font-style: italic; padding: 0.5rem 0; }
.section-title { font-weight: 700; margin: 0.5rem 0 0.35rem; color: var(--text); }
.grid { display: grid; grid-template-columns: 1fr; gap: 0.75rem; }
@media (min-width: 768px) {
  .grid { grid-template-columns: repeat(2, 1fr); }
  .pad { padding: 1.5rem 2rem; }
  .chat-scroll { padding: 1.5rem 2rem; }
  .arabic { font-size: 1.6rem; }
}
@media (min-width: 1024px) {
  .grid { grid-template-columns: repeat(3, 1fr); }
}
.hadith-grid { display: grid; grid-template-columns: 1fr; gap: 0.75rem; }
@media (min-width: 768px) { .hadith-grid { grid-template-columns: repeat(2, 1fr); } }
.collection-btn {
  padding: 0.7rem 0.9rem;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 0.7rem;
  cursor: pointer;
  color: var(--text);
  font-weight: 600;
  text-align: left;
}
.collection-btn:hover { border-color: var(--hadith-accent); background: #f5f3ff; }
.reader-header { display: flex; gap: 0.5rem; align-items: center; flex-wrap: wrap; margin: 0.6rem 0; }
select {
  padding: 0.6rem 0.8rem;
  border-radius: 0.5rem;
  border: 1px solid #cbd5e1;
  background: #f1f5f9;
  color: var(--text);
  font-size: 1rem;
}
.back { padding: 0.5rem 0.8rem; border-radius: 0.5rem; border: 1px solid var(--border); background: #f1f5f9; color: var(--text); cursor: pointer; font-weight: 700; }
</style>
</head>
<body>
<div class="app-shell">
  <header class="topbar">
    <div class="brand" style="cursor:pointer;" onclick="switchTab('chat')">
      <span class="brand-arabic">العلم</span>
      <span class="brand-english">Ilm</span>
    </div>
    <nav class="nav" aria-label="Primary">
      <button class="nav-btn active" id="nav-chat" onclick="switchTab('chat')">Chat</button>
      <button class="nav-btn" id="nav-reader" onclick="switchTab('reader')">Quran Reader</button>
      <button class="nav-btn" id="nav-hadith" onclick="switchTab('hadith')">Hadith</button>
    </nav>
  </header>

  <div class="panels">
    <section id="tab-chat" class="panel open" aria-label="Chat">
      <div class="chips" id="chips"></div>
<br>
<button class="clear-chat" onclick="clearChat()">Clear Chat</button>
      <div class="chat-scroll" id="chat"></div>
      <div class="controls">
        <div class="controls-inner">
          <input id="query" placeholder="Ask about the Quran..." onkeydown="if(event.key==='Enter')send()">
          <button class="primary" onclick="send()">Ask</button>
        </div>
      </div>
    </section>

    <section id="tab-reader" class="panel" aria-label="Quran Reader">
      <div class="pad">
        <div class="reader-header">
          <button class="back" onclick="switchTab('chat')">Back to Chat</button>
          <select id="surah-select" onchange="loadSurah(this.value)" aria-label="Select a Surah">
            <option value="">Select a Surah</option>
          </select>
        </div>
        <div id="reader-content"></div>
      </div>
    </section>

    <section id="tab-hadith" class="panel" aria-label="Hadith">
      <div class="pad">
        <div class="reader-header">
          <button class="back" onclick="switchTab('chat')">Back to Chat</button>
        </div>
        <div id="hadith-content"></div>
      </div>
    </section>
  </div>
</div>

<script>
let currentTab = 'chat';
function switchTab(tab) {
  currentTab = tab;
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('open'));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('tab-' + tab).classList.add('open');
  document.getElementById('nav-' + tab).classList.add('active');
  if(tab === 'reader') loadQuranReader();
  if(tab === 'hadith') loadHadithHome();
}
function addMsg(role, html) {
  const d=document.getElementById('chat');
  const m=document.createElement('div');
  m.className='bubble ' + role;
  m.innerHTML=html;
  d.appendChild(m);
  d.scrollTop = d.scrollHeight;
}
function renderVerses(results) {
  if(!results||!results.length) return '<div class="error">No verses found. Try rephrasing.</div>';
  return results.map(r=>`<div class="card verse"><div><b>${r.chapter||''}:${r.verse_number}</b> <span class="meta">Score: ${(r.score||0).toFixed(2)} | ${r.match_type}</span></div><div>${r.text||''}</div>${r.translation?`<div class="translation"><em>${r.translation}</em><div class="disclaimer">Translation disclaimer: This translation is provided as a best-effort interpretation. For authoritative wording, refer to the original Arabic text and established scholarly translations.</div></div>`:''}<div class="source">Source: Quran</div></div>`).join('');
}
function renderHadiths(hadiths) {
  if(!hadiths||!hadiths.length) return '<div class="error">No hadiths found.</div>';
  return hadiths.map(h=>`<div class="card hadith"><div><b>${h.collection_name||h.collection||'Hadith'} ${h.hadith_number||''}</b> <span class="meta">${h.grade||''}</span></div>${h.english_text?`<div>${h.english_text}</div>`:''}${h.arabic_text?`<div class="arabic">${h.arabic_text}</div>`:''}<div class="source">Source: ${h.book||h.collection||'Hadith'}</div></div>`).join('');
}
function renderInsights(insights) {
  if(!insights||!insights.length) return '';
  return '<div class="insights"><b>Insights</b>' + insights.map(i=>`<div style="margin-top:0.4rem">${i.type}: ${i.message||JSON.stringify(i.concepts||i.topic||i)}</div>`).join('') + '</div>';
}
async function send() {
  const q = document.getElementById('query').value.trim(); if(!q) return;
  addMsg('user', q); document.getElementById('query').value='';
  try {
    const res = await fetch('/api/chat', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({query:q})});
    const data = await res.json();
    let html = renderVerses(data.results) + renderInsights(data.insights);
    if(data.suggestions && data.suggestions.length) {
      html += '<div class="section-title">Suggestions</div><div class="chips">' + data.suggestions.map(s=>`<div class="chip" onclick="document.getElementById(\'query\').value='${s}';send()">${s}</div>`).join('') + '</div>';
    }
    if(data.expanded_query && data.expanded_query !== data.query) {
      html += '<div class="meta">Interpreted as: ' + data.expanded_query + '</div>';
    }
    addMsg('ai', html || '<div class="error">No results.</div>');
    if(data.hadiths && data.hadiths.length) {
      addMsg('ai', renderHadiths(data.hadiths));
    }
  } catch(e) { addMsg('ai', '<div class="error">Error: '+e.message+'</div>'); }
}
async function loadQuranReader() {
  const content = document.getElementById('reader-content');
  const select = document.getElementById('surah-select');
  
  // Always load chapters first
  try {
    const res = await fetch('/api/chapters');
    const chapters = await res.json();
    
    // Populate dropdown if empty
    if(!select || !select.children.length) {
      chapters.forEach(ch => {
        const opt = document.createElement('option'); opt.value=ch.id; opt.textContent=ch.name_simple||ch.id;
        select.appendChild(opt);
      });
    }
    
    // Display all surahs as a list
    content.innerHTML = '<div class="section-title">All Surahs (Chapters)</div><div class="surahs-grid">' + chapters.map(ch => 
      `<div class="surah-card" style="background:var(--surface);border:1px solid var(--border);border-radius:0.5rem;padding:0.75rem;cursor:pointer;transition:all 0.2s;" onclick="loadSurah(${ch.id})">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <span style="font-weight:700;color:var(--primary);">${ch.id}</span>
          <span style="font-weight:600;">${ch.name_simple||ch.id}</span>
          <span style="color:var(--muted);font-size:0.85rem;">${ch.verses||'?'}</span>
        </div>
        ${ch.name_arabic?`<div class="arabic" style="font-size:1.1rem;margin-top:0.25rem;">${ch.name_arabic}</div>`:''}
        ${ch.revelation?`<div class="meta" style="margin-top:0.25rem;">${ch.revelation} order</div>`:''}
      </div>`
    ).join('') + '</div>';
  } catch(e) { content.innerHTML = '<div class="error">Error loading surahs.</div>'; }
  
  // If a surah is selected, load its verses
  if(select && select.value) {
    content.innerHTML = '<div class="loading">Loading...</div>';
    try {
      const res = await fetch(`/api/surah/${select.value}?lang=en`);
      const verses = await res.json();
      if(!verses||!verses.length) { content.innerHTML = '<div class="error">No verses found for this surah.</div>'; return; }
      content.innerHTML = '<div class="disclaimer">Translation disclaimer: This translation is provided as a best-effort interpretation. For authoritative wording, refer to the original Arabic text and established scholarly translations.</div>' + verses.map(v=>`<div class="card verse"><div><b>Verse ${v.verse_number}</b></div><div class="arabic">${v.text||''}</div>${v.translation?`<div class="translation"><em>${v.translation}</em></div>`:''}</div>`).join('');
    } catch(e) { content.innerHTML = '<div class="error">Error loading surah.</div>'; }
  }
}
async function loadHadithHome() {
  const content = document.getElementById('hadith-content');
  content.innerHTML = '<div class="loading">Loading collections...</div>';
  try {
    const res = await fetch('/api/hadith/collections');
    const collections = await res.json();
    if(!collections||!collections.length) { content.innerHTML = '<div class="error">No collections available.</div>'; return; }
    content.innerHTML = '<div class="section-title">Collections</div><div class="hadith-grid">' + collections.map(c=>`<button class="collection-btn" onclick="loadHadithCollection('${c}')">${c}</button>`).join('') + '</div>';
  } catch(e) { content.innerHTML = '<div class="error">Error loading collections.</div>'; }
}
async function loadHadithCollection(collection) {
  const content = document.getElementById('hadith-content');
  content.innerHTML = '<div class="loading">Loading hadiths...</div>';
  try {
    const res = await fetch(`/api/hadith/collection/${encodeURIComponent(collection)}`);
    const hadiths = await res.json();
    if(!hadiths||!hadiths.length) { content.innerHTML = '<div class="error">No hadiths found in this collection.</div>'; return; }
    content.innerHTML = '<div class="section-title">Hadiths from ' + collection + '</div><div class="hadith-grid">' + renderHadiths(hadiths.slice(0,20)) + '</div>';
  } catch(e) { content.innerHTML = '<div class="error">Error loading hadiths.</div>'; }
}
async function init() {
  try {
    const res = await fetch('/api/chapters');
    const chapters = await res.json();
    const chips = document.getElementById('chips');
    chapters.slice(0,12).forEach(ch => {
      const btn = document.createElement('div'); btn.className='chip'; btn.textContent=ch.name_simple||ch.id;
      btn.onclick=()=>{ document.getElementById('query').value=`Read ${ch.name_simple} (${ch.id})`; send(); };
      chips.appendChild(btn);
    });
  } catch(e) {}
}
def init():
    # Initialize Quran reader module
    qr = QuranReader()
    
    # Display surahs on initial page load
    qr.display_surahs()
    
    # Start the Flask app
    app.run(host="0.0.0.0", port=8000, debug=True)

  const chatDiv = document.getElementById('chat');
  if (chatDiv) {
    chatDiv.innerHTML = '';
  }
  // Reset query input
  const queryInput = document.getElementById('query');
  if (queryInput) {
    queryInput.value = '';
  }
}
</script>
</body>
</html>
"""


@app.route("/")
def home():
    return render_template_string(HTML)


@app.route("/api/chat", methods=["POST"])
def chat():
    body = request.get_json(force=True)
    query = body.get("query", "")
    user_id = body.get("user_id", "web-default")
    
    response = ilm_app.get_ai_response(query, user_id=user_id)
    
    results = []
    for r in response.get("results", []):
        results.append({
            "verse_id": r.verse_id,
            "chapter": r.chapter,
            "verse_number": r.verse_number,
            "text": r.text,
            "translation": r.translation,
            "score": r.score,
            "match_type": r.match_type,
            "context_snippet": r.context_snippet
        })
    
    insights = []
    for ins in response.get("insights", []):
        insights.append({
            "type": ins.get("type"),
            "message": ins.get("message"),
            "topic": ins.get("topic"),
            "concepts": ins.get("concepts")
        })
    
    return jsonify({
        "query": response.get("query") or query,
        "expanded_query": response.get("expanded_query"),
        "results": results,
        "hadiths": response.get("hadiths", []),
        "insights": insights,
        "suggestions": response.get("suggestions", [])
    })


@app.route("/api/auth/login", methods=["POST"])
def login():
    """Authenticate a user with Pabandi credentials."""
    body = request.get_json(force=True)
    username = body.get("username")
    password = body.get("password")
    
    # TODO: Implement Pabandi authentication
    # For now, return a success response with a placeholder token
    # In production, this would validate against the Pabandi service
    
    return jsonify({
        "success": True,
        "token": "placeholder-token",
        "message": "Login successful (placeholder - implement Pabandi auth)"
    })


@app.route("/api/auth/register", methods=["POST"])
def register():
    """Register a new user."""
    body = request.get_json(force=True)
    username = body.get("username")
    password = body.get("password")
    
    # TODO: Implement user registration
    # In production, this would create a new user in the database
    
    return jsonify({
        "success": True,
        "message": "Registration successful (placeholder - implement user registration)"
    })


@app.route("/api/search")
def search():
    query = request.args.get("q", "")
    language = request.args.get("lang", "en")
    data = ilm_app.search_verses(query, language=language)
    results = []
    for r in data.get("results", []):
        results.append({
            "verse_id": r.verse_id,
            "chapter": r.chapter,
            "verse_number": r.verse_number,
            "text": r.text,
            "translation": r.translation,
            "score": r.score,
            "match_type": r.match_type,
            "context_snippet": r.context_snippet
        })
    return jsonify({"query": query, "results": results})


@app.route("/api/verses/<verse_key>")
def get_verse(verse_key):
    language = request.args.get("lang", "en")
    verse = ilm_app.get_quran_text(verse_key, language=language)
    if not verse:
        return jsonify({"error": "Verse not found"}), 404
    return jsonify({
        "verse_key": verse_key,
        "text": verse.text,
        "translation": verse.translation,
        "chapter_id": verse.chapter_id,
        "juz_number": verse.juz_number,
        "hizb_number": verse.hizb_number
    })


@app.route("/api/surah/<int:chapter>")
def get_surah(chapter):
    language = request.args.get("lang", "en")
    verses = ilm_app.get_quran_surah(chapter, language=language)
    return jsonify([{
        "id": v.id,
        "verse_number": v.verse_number,
        "text": v.text,
        "translation": v.translation,
        "audio_url": v.audio_url
    } for v in verses])


@app.route("/api/hadith/collections")
def hadith_collections():
    return jsonify(ilm_app.data_service.hadith_service.get_collections())


@app.route("/api/hadith/collection/<collection>")
def hadith_by_collection(collection):
    hadiths = ilm_app.data_service.hadith_service.search_hadiths("the", [collection])
    return jsonify(hadiths)


@app.route("/api/hadith")
def hadith():
    query = request.args.get("q", "")
    collection = request.args.get("collection", "")
    hadiths = ilm_app.load_hadith_inferences(query=query if query else None, collection=collection if collection else None)
    return jsonify(hadiths)


@app.route("/api/recommendations")
def recommendations():
    user_id = request.args.get("user_id", "web-default")
    recs = ilm_app.get_recommendations(user_id=user_id)
    return jsonify(recs)


@app.route("/api/chapters")
def chapters():
    language = request.args.get("lang", "en")
    return jsonify(ilm_app.get_quran_chapters(language=language))


@app.route("/api/reading-plan")
def reading_plan():
    user_id = request.args.get("user_id", "web-default")
    days = int(request.args.get("days", 7))
    plan = ilm_app.get_reading_plan(user_id=user_id, days=days)
    return jsonify(plan)


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8000, debug=True)
