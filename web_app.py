"""Minimal web interface for Ilm - deployable on Render/Railway/Fly.io"""

from flask import Flask, request, jsonify, render_template_string
from flask_cors import CORS
from app import app as ilm_app

app = Flask(__name__)
CORS(app)

HTML = """<!DOCTYPE html>
<html>
<head>
<title>Ilm - Quran AI</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
* { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
body { background: #0f172a; color: #e2e8f0; min-height: 100vh; display: flex; flex-direction: column; }
header { background: #1e293b; padding: 1rem 2rem; border-bottom: 1px solid #334155; display: flex; align-items: center; justify-content: space-between; }
h1 { font-size: 1.5rem; color: #fbbf24; }
.chat-container { flex: 1; overflow-y: auto; padding: 2rem; max-width: 900px; margin: 0 auto; width: 100%; }
.message { margin-bottom: 1rem; padding: 1rem; border-radius: 0.75rem; max-width: 85%; }
.user { background: #2563eb; color: white; margin-left: auto; }
.ai { background: #1e293b; border: 1px solid #334155; color: #e2e8f0; }
.verse { background: #14532d; border-left: 4px solid #22c55e; padding: 1rem; margin: 0.5rem 0; border-radius: 0.5rem; font-size: 0.95rem; }
.hadith { background: #4c1d95; border-left: 4px solid #a855f7; padding: 1rem; margin: 0.5rem 0; border-radius: 0.5rem; font-size: 0.95rem; }
.controls { background: #1e293b; padding: 1rem 2rem; border-top: 1px solid #334155; display: flex; gap: 0.5rem; max-width: 900px; margin: 0 auto; width: 100%; }
input { flex: 1; padding: 0.75rem 1rem; border-radius: 0.5rem; border: 1px solid #475569; background: #0f172a; color: #e2e8f0; font-size: 1rem; }
input:focus { outline: none; border-color: #3b82f6; }
button { padding: 0.75rem 1.25rem; border-radius: 0.5rem; border: none; background: #fbbf24; color: #0f172a; font-weight: 600; cursor: pointer; }
button:hover { background: #f59e0b; }
.secondary { background: #334155; color: #e2e8f0; }
.suggestions { padding: 0 2rem 1rem; max-width: 900px; margin: 0 auto; width: 100%; display: flex; gap: 0.5rem; flex-wrap: wrap; }
.chip { padding: 0.4rem 0.8rem; background: #1e293b; border: 1px solid #475569; border-radius: 999px; font-size: 0.85rem; cursor: pointer; color: #e2e8f0; }
.chip:hover { border-color: #3b82f6; }
.meta { font-size: 0.8rem; opacity: 0.7; margin-top: 0.3rem; }
.source { font-size: 0.75rem; color: #94a3b8; margin-top: 0.3rem; }
.disclaimer { background: #451a03; border: 1px solid #f97316; color: #ffedd5; padding: 0.75rem 1rem; border-radius: 0.5rem; margin: 0.5rem 0; font-size: 0.85rem; }
.quran-reader { background: #0f172a; border: 1px solid #334155; padding: 1.5rem; border-radius: 0.75rem; margin: 1rem 0; }
.quran-reader h2 { color: #fbbf24; margin-bottom: 0.5rem; }
.quran-arabic { font-size: 1.5rem; line-height: 2; text-align: right; direction: rtl; margin: 1rem 0; color: #fff; }
.quran-translation { margin-top: 0.75rem; color: #cbd5e1; font-style: italic; }
.verse-nav { display: flex; justify-content: space-between; margin-top: 1rem; gap: 0.5rem; }
.hidden { display: none !important; }
</style>
</head>
<body>
<header>
  <h1>Ilm - Quran AI</h1>
  <div>
    <button class="secondary" onclick="toggleHadith()">Toggle Hadith</button>
    <button class="secondary" onclick="toggleQuranReader()">Quran Reader</button>
  </div>
</header>
<div class="suggestions" id="suggestions"></div>
<div class="chat-container" id="chat"></div>
<div id="quran-panel" class="hidden" style="padding: 2rem; max-width: 900px; margin: 0 auto; width: 100%;"></div>
<div class="controls">
  <input id="query" placeholder="Ask about the Quran..." onkeydown="if(event.key==='Enter')send()">
  <button onclick="send()">Ask</button>
</div>
<script>
let showHadith = false;
let showQuranReader = false;
function addMsg(role, html) { const d=document.getElementById('chat'); const m=document.createElement('div'); m.className='message '+role; m.innerHTML=html; d.appendChild(m); d.scrollTop=d.scrollHeight; }
function renderVerses(results) {
  if(!results||!results.length) return '<div>No verses found. Try rephrasing.</div>';
  return results.map(r=>`<div class="verse"><div><b>${r.chapter||''}:${r.verse_number}</b> <span class="meta">Score: ${(r.score||0).toFixed(2)} | ${r.match_type}</span></div><div>${r.text||''}</div>${r.translation?`<div class="quran-translation"><em>${r.translation}</em><div class="disclaimer">Translation disclaimer: This translation is provided as a best-effort interpretation. For authoritative wording, refer to the original Arabic text and established scholarly translations.</div></div>`:''}<div class="source">Source: Quran (api.quran.com)</div></div>`).join('');
}
function renderHadiths(hadiths) {
  if(!hadiths||!hadiths.length) return '<div>No hadiths found.</div>';
  return hadiths.map(h=>`<div class="hadith"><div><b>${h.collection||'Hadith'} ${h.hadith_number||''}</b> <span class="meta">${h.grade||''}</span></div>${h.english_text?`<div>${h.english_text}</div>`:''}${h.arabic_text?`<div dir="rtl" style="margin-top:0.5rem">${h.arabic_text}</div>`:''}<div class="source">Source: ${h.book||h.collection||'Hadith'}</div></div>`).join('');
}
function renderInsights(insights) {
  if(!insights||!insights.length) return '';
  return '<div style="margin-top:1rem;padding:1rem;background:#1e293b;border-radius:0.5rem"><b>Insights</b>' + insights.map(i=>`<div style="margin-top:0.5rem">${i.type}: ${i.message||JSON.stringify(i.concepts||i.topic||i)}</div>`).join('') + '</div>';
}
async function send() {
  const q = document.getElementById('query').value.trim(); if(!q) return;
  addMsg('user', q); document.getElementById('query').value='';
  try {
    const res = await fetch('/api/chat', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({query:q})});
    const data = await res.json();
    let html = renderVerses(data.results) + renderInsights(data.insights);
    if(data.suggestions && data.suggestions.length) {
      html += '<div style="margin-top:1rem"><b>Suggestions:</b><br>' + data.suggestions.map(s=>`<div class="chip" onclick="document.getElementById(\'query\').value='${s}';send()">${s}</div>`).join(' ') + '</div>';
    }
    addMsg('ai', html || '<div>No results.</div>');
    if(showHadith) loadHadith(q);
  } catch(e) { addMsg('ai', 'Error: '+e.message); }
}
async function loadHadith(q) {
  try {
    const res = await fetch(`/api/hadith?q=${encodeURIComponent(q)}`);
    const data = await res.json();
    const hadithHtml = renderHadiths(data);
    if(hadithHtml) addMsg('ai', hadithHtml);
  } catch(e) {}
}
function toggleHadith() { showHadith=!showHadith; }
async function loadQuranReader() {
  const panel = document.getElementById('quran-panel');
  panel.innerHTML = '<div class="quran-reader"><h2>Quran Reader</h2><select id="surah-select" onchange="loadSurah(this.value)"><option value="">Select a Surah</option></select><div id="surah-content"></div></div>';
  const res = await fetch('/api/chapters');
  const chapters = await res.json();
  const select = document.getElementById('surah-select');
  chapters.forEach(ch => {
    const opt = document.createElement('option'); opt.value=ch.id; opt.textContent=ch.name_simple||ch.id;
    select.appendChild(opt);
  });
}
async function loadSurah(chapter) {
  if(!chapter) return;
  const container = document.getElementById('surah-content');
  container.innerHTML = '<div>Loading...</div>';
  try {
    const res = await fetch(`/api/surah/${chapter}?lang=en`);
    const verses = await res.json();
    container.innerHTML = '<div class="disclaimer">Translation disclaimer: This translation is provided as a best-effort interpretation. For authoritative wording, refer to the original Arabic text and established scholarly translations.</div>' + verses.map(v=>`<div class="verse"><div><b>${v.verse_number}</b></div><div>${v.text||''}</div><div class="quran-translation"><em>${v.translation||''}</em></div></div>`).join('');
  } catch(e) { container.innerHTML = '<div>Error loading surah.</div>'; }
}
function toggleQuranReader() {
  showQuranReader = !showQuranReader;
  const panel = document.getElementById('quran-panel');
  const chat = document.getElementById('chat');
  const suggestions = document.getElementById('suggestions');
  if(showQuranReader) {
    panel.classList.remove('hidden');
    chat.classList.add('hidden');
    suggestions.classList.add('hidden');
    loadQuranReader();
  } else {
    panel.classList.add('hidden');
    chat.classList.remove('hidden');
    suggestions.classList.remove('hidden');
  }
}
async function init() {
  const res = await fetch('/api/chapters');
  const chapters = await res.json();
  const sug = document.getElementById('suggestions');
  chapters.slice(0,10).forEach(ch => {
    const btn = document.createElement('div'); btn.className='chip'; btn.textContent=ch.name_simple||ch.id;
    btn.onclick=()=>{ document.getElementById('query').value=`Read ${ch.name_simple} (${ch.id})`; send(); };
    sug.appendChild(btn);
  });
}
init();
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
        "query": query,
        "results": results,
        "insights": insights,
        "suggestions": response.get("suggestions", [])
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
