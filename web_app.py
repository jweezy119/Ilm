"""Minimal web interface for Ilm - deployable on Render/Railway/Fly.io"""

import os
import threading

from flask import Flask, request, jsonify, render_template_string
from flask_cors import CORS
from app import app as ilm_app
from quran_reader import QuranReader, SurahInfo
from glossary import GLOSSARY

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
[data-theme="dark"] {
  --bg: #0f172a;
  --surface: #1e293b;
  --border: #334155;
  --text: #f8fafc;
  --muted: #94a3b8;
  --primary: #60a5fa;
  --primary-strong: #3b82f6;
  --accent: #fbbf24;
  --verse-accent: #60a5fa;
  --hadith-accent: #a78bfa;
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
.nav-btn.secondary { background: var(--bg); }
[data-theme="dark"] .nav-btn.secondary { background: #1e293b; }
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
.chip.suggestion { cursor: pointer; }
.chip.suggestion:hover { border-color: var(--primary); background: #f0fdfa; }
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
@media (min-width: 768px) { .hadith-grid { grid-template-columns: repeat(2, 1fr); }
}
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
.collection-btn:hover { border-color: var(--hadith-accent); background: var(--bg); }
.reader-header { display: flex; gap: 0.5rem; align-items: center; flex-wrap: wrap; margin: 0.6rem 0; }
select {
  padding: 0.6rem 0.8rem;
  border-radius: 0.5rem;
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--text);
  font-size: 1rem;
}
/* Native <option> elements follow the OS colour scheme, so they need
   explicit colours to stay readable in dark mode. */
select option { background: var(--surface); color: var(--text); }
[data-theme="dark"] select option { background: #1e293b; color: #e2e8f0; }
[data-theme="dark"] select { background: #1e293b; color: #e2e8f0; border-color: #334155; }
.back { padding: 0.5rem 0.8rem; border-radius: 0.5rem; border: 1px solid var(--border); background: var(--bg); color: var(--text); cursor: pointer; font-weight: 700; }
[data-theme="dark"] .back { background: #1e293b; color: #e2e8f0; border-color: #334155; }
.copy-btn {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 0.375rem;
  color: var(--text);
  cursor: pointer;
  font-size: 0.875rem;
  padding: 0.25rem 0.5rem;
  margin-left: 0.5rem;
  transition: all 0.2s;
}
.copy-btn:hover {
  background: var(--primary);
  color: white;
  transform: scale(1.05);
}
.icon-btn:hover { color: var(--text); transform: scale(1.1); }
.bubble.thinking { display: inline-flex; align-items: center; gap: 0.35rem; color: var(--muted); font-style: italic; }
.bubble.error-bubble { background: #fef2f2; border: 1px solid #fecaca; color: #991b1b; }
.card-head { display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; flex-wrap: wrap; }
.verse-ref { font-weight: 700; color: var(--verse-accent); }
.match-badge { font-size: 0.72rem; color: var(--muted); background: var(--bg); border: 1px solid var(--border); border-radius: 999px; padding: 0.1rem 0.5rem; }
.card-actions { display: flex; gap: 0.35rem; margin-top: 0.6rem; }
.expand-btn { margin-top: 0.6rem; background: var(--surface); border: 1px solid var(--border); color: var(--text); border-radius: 999px; padding: 0.4rem 0.9rem; font-size: 0.85rem; font-weight: 600; cursor: pointer; }
.expand-btn:hover { border-color: var(--primary); color: var(--primary); }
button[disabled] { opacity: 0.6; cursor: not-allowed; transform: none !important; }
.visually-hidden { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }

/* ---------- Reading glossary ---------- */
g-term {
  cursor: help;
  border-bottom: 1px dotted var(--muted);
  background: transparent;
  transition: background-color 0.15s ease, border-color 0.15s ease;
}
g-term:hover, g-term:focus, g-term.active {
  background: color-mix(in srgb, var(--primary) 14%, transparent);
  border-bottom-color: var(--primary);
  border-bottom-style: solid;
  outline: none;
}
[data-theme="dark"] g-term { border-bottom-color: var(--muted); }
body.glossing-off g-term { cursor: text; border-bottom: none; background: none; }

.gloss-pop {
  position: fixed;
  z-index: 100;
  max-width: 340px;
  background: var(--surface);
  border: 1px solid var(--primary);
  border-radius: 0.7rem;
  padding: 0.85rem 1rem;
  box-shadow: 0 10px 30px rgba(0,0,0,0.18);
  font-size: 0.88rem;
  line-height: 1.5;
}
.gloss-pop .g-term-name { font-weight: 700; color: var(--primary-strong); font-size: 1rem; }
.gloss-pop .g-term-translit { color: var(--muted); font-size: 0.82rem; margin-left: 0.4rem; }
.gloss-pop .g-term-arabic { font-family: 'Traditional Arabic','Amiri',serif; font-size: 1.5rem; direction: rtl; color: var(--text); margin: 0.3rem 0; line-height: 1.8; }
.gloss-pop .g-term-short { margin: 0.35rem 0; color: var(--text); }
.gloss-pop .g-term-detail { margin: 0.4rem 0 0; color: var(--muted); font-size: 0.83rem; }
.gloss-pop .g-term-refs { margin-top: 0.5rem; display: flex; flex-wrap: wrap; gap: 0.35rem; }
.gloss-pop .g-term-refs button {
  font: inherit; font-size: 0.78rem; padding: 0.15rem 0.55rem; border-radius: 999px;
  border: 1px solid var(--border); background: var(--bg); color: var(--primary); cursor: pointer;
}
.gloss-pop .g-term-refs button:hover { border-color: var(--primary); background: var(--primary); color: #fff; }
.gloss-pop .g-term-close { position: absolute; top: 0.35rem; right: 0.5rem; border: none; background: none; color: var(--muted); font-size: 1rem; cursor: pointer; line-height: 1; }

.gloss-toolbar { display: flex; align-items: center; gap: 0.6rem; flex-wrap: wrap; margin-bottom: 0.75rem; }
.gloss-search {
  flex: 1; min-width: 180px; padding: 0.6rem 0.9rem; border-radius: 0.6rem;
  border: 1px solid var(--border); background: var(--surface); color: var(--text); font-size: 0.95rem;
}
.gloss-search:focus { outline: none; border-color: var(--primary); }
.gloss-cat { padding: 0.5rem 0.7rem; border-radius: 0.6rem; border: 1px solid var(--border); background: var(--surface); color: var(--text); font-size: 0.85rem; }
.gloss-entry {
  border: 1px solid var(--border); border-radius: 0.7rem; padding: 0.85rem 1rem;
  margin-bottom: 0.6rem; background: var(--surface);
}
.gloss-entry-head { display: flex; align-items: baseline; gap: 0.5rem; flex-wrap: wrap; }
.gloss-entry-head .t { font-weight: 700; color: var(--text); }
.gloss-entry-head .tr { color: var(--muted); font-size: 0.85rem; }
.gloss-entry-head .ar { font-family: 'Traditional Arabic','Amiri',serif; font-size: 1.3rem; direction: rtl; color: var(--primary); }
.gloss-entry .short { color: var(--text); font-size: 0.9rem; margin: 0.35rem 0; }
.gloss-entry .detail { color: var(--muted); font-size: 0.85rem; margin: 0.3rem 0 0; }
.gloss-entry .cat-tag { font-size: 0.72rem; color: var(--muted); background: var(--bg); border: 1px solid var(--border); border-radius: 999px; padding: 0.1rem 0.5rem; }
.gloss-empty { color: var(--muted); font-style: italic; padding: 1.5rem 0; text-align: center; }
.legend-note { font-size: 0.82rem; color: var(--muted); margin: 0.5rem 0 0; }
</style>
</head>
<body>
<div class="app-shell">
<header class="topbar">
  <div class="brand" style="cursor:pointer;" onclick="switchTab('chat')">
    <span class="brand-arabic">العلم</span>
    <span class="brand-english">Ilm</span>
  </div>
  <button class="theme-toggle" id="theme-toggle" onclick="toggleTheme()" title="Toggle dark/light theme">
    <span id="theme-toggle-icon">🌙</span>
  </button>
  <nav class="nav" aria-label="Primary">
    <button class="nav-btn active" id="nav-chat" onclick="switchTab('chat')">Chat</button>
    <button class="nav-btn" id="nav-discover" onclick="switchTab('discover')">Discover</button>
    <button class="nav-btn" id="nav-reader" onclick="switchTab('reader')">Quran Reader</button>
    <button class="nav-btn" id="nav-glossary" onclick="switchTab('glossary')">Glossary</button>
    <button class="nav-btn" id="nav-hadith" onclick="switchTab('hadith')">Hadith</button>
  </nav>
  
  <!-- Keyboard shortcuts help -->
  <div class="keyboard-help" style="position:fixed;bottom:1rem;right:1rem;background:var(--surface);border:1px solid var(--border);border-radius:0.5rem;padding:0.5rem;font-size:0.85rem;color:var(--muted);z-index:1000;">
    <div>⌨️ Shortcuts:</div>
    <div>Enter: Send</div>
    <div>Esc: Clear chat</div>
  </div>
</header>

  <div class="panels">
    <section id="tab-chat" class="panel open" aria-label="Chat">
      <div class="chat-scroll" id="chat">
        <div class="welcome-container" id="welcome-screen">
          <div style="text-align:center; padding: 2rem 1rem;">
            <div class="brand-arabic" style="font-size: 3rem; margin-bottom: 0.5rem;">العلم</div>
            <h2 style="margin-bottom: 0.5rem; color: var(--text);">Welcome to Ilm</h2>
            <p style="color: var(--muted); margin-bottom: 2rem;">Your AI companion for Quran and Hadith exploration.</p>
            <div class="chips" id="chips"></div>
          </div>
        </div>
      </div>
      <div class="controls">
        <div class="controls-inner">
          <button class="icon-btn" onclick="clearChat()" title="Clear Chat" style="background:transparent; border:none; cursor:pointer; font-size:1.2rem; padding:0.5rem; color:var(--muted);">🔄</button>
          <input id="query" placeholder="Ask about the Quran or Hadith..." autocomplete="off" aria-label="Ask a question" onkeydown="if(event.key==='Enter'){event.preventDefault();send();}">
          <button class="primary" id="send-btn" onclick="send()">Ask</button>
        </div>
      </div>
    </section>

    <section id="tab-discover" class="panel" aria-label="Discover">
      <div class="pad">
        <div class="reader-header">
          <h2 style="margin: 0; color: var(--text);">Recommended for You</h2>
          <button class="icon-btn" onclick="loadDiscover()" title="Refresh Recommendations" style="background:transparent; border:none; cursor:pointer; font-size:1.2rem; padding:0.5rem; color:var(--muted);">🔄</button>
        </div>
        <p style="color: var(--muted); margin-bottom: 1rem;">Personalized verses and Hadiths based on your interests and time of day.</p>
        <div id="discover-content"></div>
      </div>
    </section>

    <section id="tab-reader" class="panel" aria-label="Quran Reader">
      <div class="pad">
        <div class="reader-header">
          <button class="back" onclick="switchTab('chat')">Back to Chat</button>
          <select id="surah-select" onchange="localStorage.setItem('lastSelectedSurah', this.value); loadQuranReader()" aria-label="Select a Surah">
            <option value="">Select a Surah</option>
          </select>
        </div>
        <div id="reader-content"></div>
      </div>
    </section>

    <section id="tab-glossary" class="panel" aria-label="Glossary">
      <div class="pad">
        <div class="reader-header">
          <h2 style="margin: 0; color: var(--text);">Reading Glossary</h2>
          <button class="nav-btn secondary" id="gloss-toggle" onclick="toggleGlossing()" title="Turn inline definitions on or off">Glossing: on</button>
        </div>
        <p style="color: var(--muted); margin-bottom: 0.75rem;">Quranic terms as they appear in the English translation. In Chat and the Reader, these words are marked with a dotted underline &mdash; tap one for its meaning.</p>
        <div class="gloss-toolbar">
          <input id="gloss-search" class="gloss-search" type="search" placeholder="Search terms, Arabic, or meanings..." oninput="renderGlossary()" aria-label="Search glossary">
          <select id="gloss-cat" class="gloss-cat" onchange="renderGlossary()" aria-label="Filter by category">
            <option value="">All categories</option>
          </select>
        </div>
        <div id="glossary-content"></div>
        <p class="legend-note">Definitions are brief summaries for reading help. For full commentary see a recognised tafsir.</p>
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
  if(tab === 'discover') loadDiscover();
  if(tab === 'glossary') loadGlossary();
}

// ---------------------------------------------------------------- glossary
// The glossary is fetched once and cached, so highlighting a translation
// costs no extra requests. Matching runs locally on the plain text of each
// translation, which is why glossing never interferes with rendering.

let GLOSSARY_ENTRIES = null;
let GLOSSARY_BY_TERM = {};
let GLOSSARY_CATEGORIES = [];
let GLOSS_MATCHERS = [];
let glossingEnabled = localStorage.getItem('glossing') !== 'off';

function escapeRegExp(s) {
  var specials = '\\\\^-.*+?()|[]{}$';
  return String(s).split('').map(function(ch) {
    return specials.indexOf(ch) > -1 ? '\\\\' + ch : ch;
  }).join('');
}

function buildGlossMatchers(entries) {
  return entries.map(e => {
    const variants = (e.variants || []).slice().sort((a,b) => b.length - a.length);
    if (!variants.length) return null;
    // Mirror the server-side matcher: whole-word boundaries, case-insensitive.
    // Note the doubled backslashes: inside a JS string literal a single
    // "\\b" is a backspace character, not a word boundary.
    const re = new RegExp('\\\\b(?:' + variants.map(escapeRegExp).join('|') + ')\\\\b', 'gi');
    return { re, term: e.term };
  }).filter(Boolean);
}

function fillCategoryFilter() {
  const cat = document.getElementById('gloss-cat');
  if (!cat || cat.dataset.filled) return;
  cat.innerHTML = '<option value="">All categories</option>';
  GLOSSARY_CATEGORIES.forEach(c => {
    const o = document.createElement('option');
    o.value = c; o.textContent = c;
    cat.appendChild(o);
  });
  cat.dataset.filled = '1';
}

function loadGlossary() {
  const content = document.getElementById('glossary-content');
  if (GLOSSARY_ENTRIES) { fillCategoryFilter(); renderGlossary(); return; }
  content.innerHTML = '<div class="loading">Loading glossary...</div>';
  fetch('/api/glossary')
    .then(r => r.ok ? r.json() : Promise.reject(new Error('Request failed')))
    .then(data => {
      GLOSSARY_ENTRIES = data.entries || [];
      GLOSSARY_CATEGORIES = data.categories || [];
      GLOSSARY_BY_TERM = {};
      GLOSSARY_ENTRIES.forEach(e => { GLOSSARY_BY_TERM[e.term] = e; });
      GLOSS_MATCHERS = buildGlossMatchers(GLOSSARY_ENTRIES);
      fillCategoryFilter();
      renderGlossary();
    })
    .catch(() => {
      content.innerHTML = '<div class="error">Could not load the glossary.</div>';
    });
}

function renderGlossary() {
  const content = document.getElementById('glossary-content');
  if (!GLOSSARY_ENTRIES) return;
  const q = document.getElementById('gloss-search').value.trim().toLowerCase();
  const cat = document.getElementById('gloss-cat').value;

  const list = GLOSSARY_ENTRIES.filter(e => {
    if (cat && e.category !== cat) return false;
    if (!q) return true;
    return (e.term + ' ' + (e.translit||'') + ' ' + (e.short||'') + ' ' +
            (e.variants||[]).join(' ') + ' ' + (e.category||'')).toLowerCase().includes(q);
  });

  if (!list.length) {
    content.innerHTML = '<div class="gloss-empty">No terms match that search.</div>';
    return;
  }

  let html = '<div class="meta" style="margin-bottom:0.6rem;">' + list.length +
             ' of ' + GLOSSARY_ENTRIES.length + ' terms</div>';
  list.forEach(e => {
    html += `<div class="gloss-entry">
      <div class="gloss-entry-head">
        <span class="t">${escapeHtml(e.term)}</span>
        ${e.translit ? `<span class="tr">${escapeHtml(e.translit)}</span>` : ''}
        ${e.arabic ? `<span class="ar">${escapeHtml(e.arabic)}</span>` : ''}
        <span class="cat-tag">${escapeHtml(e.category)}</span>
      </div>
      <div class="short">${escapeHtml(e.short)}</div>
      ${e.detail ? `<div class="detail">${escapeHtml(e.detail)}</div>` : ''}
      ${(e.refs && e.refs.length) ? `<div class="g-term-refs">${e.refs.map(r =>
        `<button onclick="askAboutRef('${escapeHtml(r)}')">${escapeHtml(r)}</button>`).join('')}</div>` : ''}
    </div>`;
  });
  content.innerHTML = html;
}

function askAboutRef(ref) {
  const input = document.getElementById('query');
  input.value = 'Tell me about ' + ref;
  switchTab('chat');
  send();
}

// Wrap glossary terms found in already-escaped plain text. Input must be
// escaped text with no markup, which is how translations are rendered here.
function glossText(escapedText) {
  if (!glossingEnabled || !escapedText || !GLOSS_MATCHERS.length) return escapedText;

  // Collect non-overlapping spans, preferring the longest match.
  const spans = [];
  GLOSS_MATCHERS.forEach(m => {
    m.re.lastIndex = 0;
    let mm;
    while ((mm = m.re.exec(escapedText)) !== null) {
      if (!mm[0].length) { m.re.lastIndex++; continue; }
      spans.push({ start: mm.index, end: mm.index + mm[0].length, term: m.term });
    }
  });
  if (!spans.length) return escapedText;

  spans.sort((a,b) => (a.start - b.start) || ((b.end - b.start) - (a.end - a.start)));
  const chosen = [];
  let lastEnd = -1;
  spans.forEach(s => { if (s.start >= lastEnd) { chosen.push(s); lastEnd = s.end; } });

  let out = '', cursor = 0;
  chosen.forEach(s => {
    out += escapedText.slice(cursor, s.start);
    out += '<g-term data-term="' + escapeHtml(s.term) + '" tabindex="0" role="button">' +
           escapedText.slice(s.start, s.end) + '</g-term>';
    cursor = s.end;
  });
  out += escapedText.slice(cursor);
  return out;
}

let activeGloss = null;

function closeGloss() {
  if (activeGloss) { activeGloss.remove(); activeGloss = null; }
  document.querySelectorAll('g-term.active').forEach(el => el.classList.remove('active'));
}

function showGloss(el) {
  if (!glossingEnabled) return;
  const term = el.getAttribute('data-term');
  const entry = GLOSSARY_BY_TERM[term];
  if (!entry) return;
  closeGloss();
  el.classList.add('active');

  const pop = document.createElement('div');
  pop.className = 'gloss-pop';
  pop.innerHTML =
    '<button class="g-term-close" aria-label="Close">&times;</button>' +
    '<span class="g-term-name">' + escapeHtml(entry.term) + '</span>' +
    (entry.translit ? '<span class="g-term-translit">' + escapeHtml(entry.translit) + '</span>' : '') +
    (entry.arabic ? '<div class="g-term-arabic">' + escapeHtml(entry.arabic) + '</div>' : '') +
    '<div class="g-term-short">' + escapeHtml(entry.short) + '</div>' +
    (entry.detail ? '<div class="g-term-detail">' + escapeHtml(entry.detail) + '</div>' : '') +
    ((entry.refs && entry.refs.length) ? '<div class="g-term-refs">' + entry.refs.map(r =>
      '<button data-ref="' + escapeHtml(r) + '">' + escapeHtml(r) + '</button>').join('') + '</div>' : '');

  document.body.appendChild(pop);
  activeGloss = pop;

  // Position near the term, kept inside the viewport.
  const rect = el.getBoundingClientRect();
  const pr = pop.getBoundingClientRect();
  let left = rect.left + window.scrollX;
  let top = rect.bottom + window.scrollY + 6;
  if (left + pr.width > window.scrollX + window.innerWidth - 10) {
    left = window.scrollX + window.innerWidth - pr.width - 10;
  }
  if (left < window.scrollX + 8) left = window.scrollX + 8;
  if (rect.bottom + pr.height + 12 > window.innerHeight) {
    top = rect.top + window.scrollY - pr.height - 6;
  }
  pop.style.left = left + 'px';
  pop.style.top = Math.max(top, window.scrollY + 8) + 'px';

  pop.querySelector('.g-term-close').addEventListener('click', closeGloss);
  pop.querySelectorAll('button[data-ref]').forEach(b => {
    b.addEventListener('click', () => { closeGloss(); askAboutRef(b.getAttribute('data-ref')); });
  });
}

function toggleGlossing() {
  glossingEnabled = !glossingEnabled;
  localStorage.setItem('glossing', glossingEnabled ? 'on' : 'off');
  document.body.classList.toggle('glossing-off', !glossingEnabled);
  const btn = document.getElementById('gloss-toggle');
  if (btn) btn.textContent = 'Glossing: ' + (glossingEnabled ? 'on' : 'off');
  closeGloss();
  if (glossingEnabled && !GLOSSARY_ENTRIES) loadGlossary();
}


async function loadDiscover() {
  const content = document.getElementById('discover-content');
  content.innerHTML = '<div class="loading">Loading personalized content...</div>';
  try {
    const [recsRes, planRes] = await Promise.all([
        fetch('/api/recommendations?user_id=web-default'),
        fetch('/api/reading-plan?user_id=web-default&days=7')
    ]);

    const recs = recsRes.ok ? await recsRes.json() : [];
    const plan = planRes.ok ? await planRes.json() : [];

    let html = '';

    if (plan && plan.length) {
        html += '<h3 style="margin: 1.5rem 0 0.5rem 0; color: var(--primary-strong);">Your 7-Day Reading Plan</h3>';
        html += '<div style="display:flex; overflow-x:auto; gap:1rem; padding-bottom:1rem; margin-bottom:1rem; scroll-snap-type: x mandatory;">';

        plan.forEach((p, idx) => {
            const dayText = p.title || `Day ${idx + 1}`;
            const verseKey = (p.content && p.content.verse_key) || '';
            const ask = verseKey ? `Tell me about ${verseKey}` : (p.title || 'this topic');
            html += `
              <div class="card" style="min-width:280px; max-width:300px; flex-shrink:0; border-top:4px solid var(--primary); scroll-snap-align: start; display:flex; flex-direction:column;">
                <div style="font-weight:700; color:var(--primary); margin-bottom:0.25rem;">${escapeHtml(dayText)}</div>
                <div style="font-size:0.85rem; color:var(--muted); margin-bottom:0.75rem;">${escapeHtml(p.reason || '')}</div>
            `;
            if (p.content && p.content.text) {
                html += `<div class="arabic" style="font-size:1.1rem; margin-bottom:0.5rem;">${escapeHtml(String(p.content.text).substring(0, 80))}...</div>`;
                if (p.content.translation) {
                   html += `<div class="translation" style="font-size:0.85rem;">${escapeHtml(String(p.content.translation).substring(0, 100))}...</div>`;
                }
            }
            html += `
                <div style="flex-grow:1;"></div>
                <button class="nav-btn secondary" style="margin-top:1rem; align-self:flex-start;" data-ask="${escapeHtml(ask)}">Explore</button>
              </div>
            `;
        });
        html += '</div>';
    }

    if(!recs || !recs.length) {
      content.innerHTML = html || '<div class="error">No recommendations available at this time.</div>';
      bindExploreButtons(content);
      return;
    }

    html += '<h3 style="margin: 1.5rem 0 0.5rem 0; color: var(--text);">For You</h3>';
    html += '<div style="display:grid; gap:1rem; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));">';
    recs.forEach(r => {
      const icon = r.type === 'verse' ? '📖' : (r.type === 'hadith' ? '📜' : '✨');
      const cardColor = r.type === 'verse' ? 'var(--verse-accent)' : (r.type === 'hadith' ? 'var(--hadith-accent)' : 'var(--primary)');
      const tag = (r.tags && r.tags[0]) || r.type || '';

      html += `
        <div class="card" style="border-top: 4px solid ${cardColor}; display:flex; flex-direction:column;">
          <div class="card-head">
            <span style="font-size:1.5rem;">${icon}</span>
            <span class="match-badge">${escapeHtml(tag)}</span>
          </div>
          <h3 style="margin-bottom:0.5rem; color:var(--text);">${escapeHtml(r.title || '')}</h3>
          <p style="color:var(--muted); font-size:0.9rem; margin-bottom:1rem;">${escapeHtml(r.reason || '')}</p>
          <div style="flex-grow:1;"></div>
      `;

      if (r.type === 'verse' && r.content && r.content.text) {
          html += `
            <div class="arabic" style="font-size:1.2rem; margin-bottom:0.5rem;">${escapeHtml(r.content.text)}</div>
            ${r.content.translation ? `<div class="translation" style="font-size:0.9rem;">${glossText(escapeHtml(r.content.translation))}</div>` : ''}
          `;
      } else if (r.type === 'hadith' && r.content) {
          if(r.content.arabic_text) {
             html += `<div class="arabic" style="font-size:1.1rem; margin-bottom:0.5rem;">${escapeHtml(String(r.content.arabic_text).substring(0, 150))}...</div>`;
          }
          if(r.content.english_text) {
             html += `<div style="font-size:0.9rem; color:var(--text);">${escapeHtml(String(r.content.english_text).substring(0, 150))}...</div>`;
          }
      }

      html += `</div>`;
    });
    html += '</div>';
    content.innerHTML = html;
    bindExploreButtons(content);
  } catch(e) {
    content.innerHTML = '<div class="error">Failed to load recommendations. Please try again.</div>';
  }
}

function bindExploreButtons(root) {
  root.querySelectorAll('button[data-ask]').forEach(btn => {
    btn.addEventListener('click', () => {
      const input = document.getElementById('query');
      input.value = btn.getAttribute('data-ask') || '';
      switchTab('chat');
      send();
    });
  });
}

function addMsg(role, html) {
  const ws = document.getElementById('welcome-screen');
  if(ws) ws.style.display = 'none';
  const d=document.getElementById('chat');
  const m=document.createElement('div');
  m.className='bubble ' + role;
  m.innerHTML=html;
  d.appendChild(m);
  scrollChatToBottom();
  return m;
}

function escapeHtml(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function scrollChatToBottom() {
  const d = document.getElementById('chat');
  if (d) d.scrollTop = d.scrollHeight;
}

// Builds a chip that runs a callback on click. Using data attributes plus a
// listener avoids inline onclick handlers, which previously broke (and threw)
// whenever the label contained an apostrophe or quote.
function makeChip(label, onClick, extraClass) {
  const el = document.createElement('div');
  el.className = 'chip' + (extraClass ? ' ' + extraClass : '');
  el.textContent = label;
  el.setAttribute('role', 'button');
  el.tabIndex = 0;
  el.addEventListener('click', onClick);
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); }
  });
  return el;
}

function renderVerses(results) {
  if(!results || !results.length) return '';
  return results.map(r => {
    const ref = escapeHtml(r.chapter || r.verse_id || '');
    const score = typeof r.score === 'number' ? r.score.toFixed(2) : '';
    const badge = [escapeHtml(r.match_type || ''), score ? 'score ' + score : ''].filter(Boolean).join(' · ');
    return `<div class="card verse">
      <div class="card-head">
        <span class="verse-ref">${ref}:${escapeHtml(r.verse_number)}</span>
        <span class="match-badge">${badge}</span>
      </div>
      <div class="arabic">${escapeHtml(r.text || '')}</div>
      ${r.translation ? `<div class="translation"><em>${glossText(escapeHtml(r.translation))}</em></div>` : ''}
      <div class="card-actions">
        <button class="copy-btn" onclick="copyCard(this)" title="Copy verse">📋 Copy</button>
      </div>
    </div>`;
  }).join('');
}

function renderHadiths(hadiths) {
  if(!hadiths||!hadiths.length) return '';
  return hadiths.map(h=>`<div class="card hadith"><div><b>${escapeHtml(h.collection_name||h.collection||'Hadith')} ${escapeHtml(h.hadith_number||'')}</b> <span class="meta">${escapeHtml(h.grade||'')}</span></div>${h.english_text?`<div>${escapeHtml(h.english_text)}</div>`:''}${h.arabic_text?`<div class="arabic">${escapeHtml(h.arabic_text)}</div>`:''}<div class="source">Source: ${escapeHtml(h.book||h.collection||'Hadith')}</div></div>`).join('');
}

function insightText(insight) {
  if (insight.message) return insight.message;
  if (insight.topic) return insight.topic;
  if (insight.concepts) {
    if (Array.isArray(insight.concepts)) {
      // Entries may be objects (related concepts), so read the label out
      // rather than stringifying the whole thing.
      return insight.concepts
        .map(c => (c && typeof c === 'object' ? (c.concept || c.data?.description || '') : c))
        .filter(Boolean)
        .join(', ');
    }
    return String(insight.concepts);
  }
  return 'No details available';
}

function renderInsights(insights) {
  if (!insights || !insights.length) return '';

  const insightTypes = {
    'answer': '💡', 'context': '📖', 'related_concepts': '🔗', 'relation': '🔗',
    'practical': '🎯', 'reflection': '🤔', 'historical': '🏛️', 'linguistic': '🔤',
    'theological': '🕋', 'general': '✨'
  };

  const grouped = {};
  insights.forEach(insight => {
    const type = (insight && insight.type) || 'general';
    (grouped[type] = grouped[type] || []).push(insight);
  });

  let html = '<div class="insights-container"><div class="insights-header"><b>Insights</b></div>';
  Object.keys(grouped).forEach(type => {
    const icon = insightTypes[type] || insightTypes['general'];
    const label = type.charAt(0).toUpperCase() + type.slice(1).replace(/_/g, ' ');
    html += `<div class="insights-type-section">
      <div class="insights-type-title">${icon} ${escapeHtml(label)}</div>`;
    grouped[type].forEach(insight => {
      html += `<div class="insight-item"><div class="insight-content">${escapeHtml(insightText(insight))}</div></div>`;
    });
    html += '</div>';
  });
  return html + '</div>';
}

let chatRequestId = 0;
let chatInFlight = false;

async function send() {
  const input = document.getElementById('query');
  const q = input.value.trim();
  if(!q || chatInFlight) return;

  chatInFlight = true;
  const sendBtn = document.getElementById('send-btn');
  if (sendBtn) sendBtn.disabled = true;

  addMsg('user', escapeHtml(q));
  input.value = '';

  const requestId = ++chatRequestId;
  const thinking = addMsg('ai thinking', 'Thinking<span class="typing-indicator"><span></span><span></span><span></span></span>');

  try {
    const res = await fetch('/api/chat', {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({query:q})
    });
    const data = await res.json();
    // A newer question was asked while this one was in flight; discard it
    // instead of letting a slow response overwrite the newer answer.
    if (requestId !== chatRequestId) return;

    if (thinking.parentNode) thinking.parentNode.removeChild(thinking);

    if (!res.ok) throw new Error(data.error || ('Request failed (' + res.status + ')'));

    let html = renderVerses(data.results) + renderInsights(data.insights);
    if(data.expanded_query && data.expanded_query !== data.query) {
      html += '<div class="meta">Follow-up — searched: ' + escapeHtml(data.expanded_query) + '</div>';
    }
    if(data.suggestions && data.suggestions.length) {
      html += '<div class="section-title">Suggestions</div><div class="chips" id="suggestion-chips"></div>';
    }

    if(data.hadiths && data.hadiths.length) {
      html += renderHadiths(data.hadiths);
    }

    const body = addMsg('ai', html || '<div class="error">No results found. Try different words, or read a chapter in the Quran Reader tab.</div>');

    if(data.suggestions && data.suggestions.length) {
      const wrap = body.querySelector('#suggestion-chips');
      data.suggestions.forEach(s => {
        wrap.appendChild(makeChip(s, () => { input.value = s; send(); }, 'suggestion'));
      });
    }
  } catch(e) {
    if (requestId !== chatRequestId) return;
    if (thinking.parentNode) thinking.parentNode.removeChild(thinking);
    addMsg('ai error-bubble', 'Error: ' + escapeHtml(e.message) + '<br><span class="meta">Please try again.</span>');
  } finally {
    if (requestId === chatRequestId) {
      chatInFlight = false;
      if (sendBtn) sendBtn.disabled = false;
      input.focus();
    }
  }
}
let readerRequestId = 0;

async function loadQuranReader() {
  const content = document.getElementById('reader-content');
  const select = document.getElementById('surah-select');

  const lastSurah = localStorage.getItem('lastSelectedSurah');
  if (lastSurah && select) select.value = lastSurah;

  const requestId = ++readerRequestId;

  if (!select || select.children.length <= 1) {
    content.innerHTML = '<div class="loading">Loading surahs...</div>';
    try {
      const res = await fetch('/api/chapters');
      const chapters = await res.json();
      if (requestId !== readerRequestId) return;
      if (!chapters || !chapters.length) {
        content.innerHTML = '<div class="error">Could not load the list of surahs.</div>';
        return;
      }
      select.innerHTML = '<option value="">All Surahs</option>';
      chapters.forEach(ch => {
        const opt = document.createElement('option');
        opt.value = ch.id;
        opt.textContent = ch.name_simple || ch.id;
        select.appendChild(opt);
      });
      if (lastSurah) select.value = lastSurah;
    } catch(e) {
      if (requestId !== readerRequestId) return;
      content.innerHTML = '<div class="error">Error loading surahs.</div>';
      return;
    }
  }

  const surah = select ? select.value : '';

  if (!surah) {
    const chapters = await fetch('/api/chapters').then(r => r.json()).catch(() => []);
    if (requestId !== readerRequestId) return;
    const grid = document.createElement('div');
    grid.className = 'surahs-grid';
    grid.style.display = 'grid';
    grid.style.gridTemplateColumns = 'repeat(auto-fill, minmax(180px, 1fr))';
    grid.style.gap = '0.75rem';
    chapters.forEach(ch => {
      const card = document.createElement('div');
      card.className = 'surah-card';
      card.style.cssText = 'background:var(--surface);border:1px solid var(--border);border-radius:0.5rem;padding:0.75rem;cursor:pointer;transition:all 0.2s;';
      card.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center;">
          <span style="font-weight:700;color:var(--primary);">${escapeHtml(ch.id)}</span>
          <span style="font-weight:600;">${escapeHtml(ch.name_simple||ch.id)}</span>
          <span style="color:var(--muted);font-size:0.85rem;">${escapeHtml(ch.verses||'?')} verses</span>
        </div>
        ${ch.name_arabic ? `<div class="arabic" style="font-size:1.1rem;margin-top:0.25rem;">${escapeHtml(ch.name_arabic)}</div>` : ''}`;
      card.addEventListener('click', () => {
        select.value = ch.id;
        localStorage.setItem('lastSelectedSurah', ch.id);
        loadQuranReader();
      });
      grid.appendChild(card);
    });
    content.innerHTML = '<div class="section-title">All Surahs (Chapters)</div>';
    content.appendChild(grid);
    return;
  }

  content.innerHTML = '<div class="loading">Loading surah...</div>';
  try {
    const res = await fetch(`/api/surah/${encodeURIComponent(surah)}?lang=en`);
    if (requestId !== readerRequestId) return;
    if (!res.ok) throw new Error('Request failed');
    const verses = await res.json();
    if (requestId !== readerRequestId) return;
    if(!verses || !verses.length) {
      content.innerHTML = '<div class="error">No verses found for this surah.</div>';
      return;
    }
    content.innerHTML = '<div class="disclaimer">Translation disclaimer: This translation is a best-effort interpretation. For authoritative wording, refer to the original Arabic text and established scholarly translations.</div>'
       + verses.map(v=>`<div class="card verse"><div class="card-head"><span class="verse-ref">Verse ${escapeHtml(v.verse_number)}</span></div><div class="arabic">${escapeHtml(v.text||'')}</div>${v.translation?`<div class="translation"><em>${glossText(escapeHtml(v.translation))}</em></div>`:''}<div class="card-actions"><button class="copy-btn" onclick="copyCard(this)">📋 Copy</button></div></div>`).join('');
  } catch(e) {
    if (requestId !== readerRequestId) return;
    content.innerHTML = '<div class="error">Error loading surah.</div>';
  }
}
let hadithRequestId = 0;

async function loadHadithHome() {
  const content = document.getElementById('hadith-content');
  content.innerHTML = '<div class="loading">Loading collections...</div>';
  const requestId = ++hadithRequestId;
  try {
    const res = await fetch('/api/hadith/collections');
    if (requestId !== hadithRequestId) return;
    const collections = await res.json();
    if (requestId !== hadithRequestId) return;
    if(!collections || !collections.length) { content.innerHTML = '<div class="error">No collections available right now.</div>'; return; }
    const grid = document.createElement('div');
    grid.className = 'hadith-grid';
    collections.forEach(c => {
      grid.appendChild(makeChip(String(c), () => loadHadithCollection(String(c)), 'collection-btn'));
    });
    content.innerHTML = '<div class="section-title">Collections</div>';
    content.appendChild(grid);
  } catch(e) {
    if (requestId === hadithRequestId) content.innerHTML = '<div class="error">Error loading collections.</div>';
  }
}

async function loadHadithCollection(collection) {
  const content = document.getElementById('hadith-content');
  content.innerHTML = '<div class="loading">Loading hadiths...</div>';
  const requestId = ++hadithRequestId;
  try {
    const res = await fetch(`/api/hadith/collection/${encodeURIComponent(collection)}`);
    if (requestId !== hadithRequestId) return;
    if (!res.ok) throw new Error('Request failed (' + res.status + ')');
    const hadiths = await res.json();
    if (requestId !== hadithRequestId) return;
    if(!hadiths || !hadiths.length) { content.innerHTML = '<div class="error">No hadiths found in this collection.</div>'; return; }
    content.innerHTML = '<div class="section-title">Hadiths from ' + escapeHtml(collection) + '</div><div class="hadith-grid">' + renderHadiths(hadiths.slice(0,20)) + '</div>';
  } catch(e) {
    if (requestId === hadithRequestId) content.innerHTML = '<div class="error">Error loading hadiths.</div>';
  }
}
async function init() {
  const chips = document.getElementById('chips');
  const questions = [
    "What does the Quran say about patience?",
    "Show me a hadith about charity.",
    "Verses about mercy and forgiveness",
    "What is the importance of prayer?",
    "How should we treat our parents?",
    "Verses about light and guidance"
  ];

  questions.forEach(q => {
    chips.appendChild(makeChip(q, () => {
      document.getElementById('query').value = q;
      send();
    }));
  });
}
async function clearChat() {
  const chatDiv = document.getElementById('chat');
  if (chatDiv) {
    const bubbles = chatDiv.querySelectorAll('.bubble');
    bubbles.forEach(b => b.remove());
  }
  const ws = document.getElementById('welcome-screen');
  if (ws) ws.style.display = 'block';
  // Reset query input
  const queryInput = document.getElementById('query');
  if (queryInput) {
    queryInput.value = '';
  }
}

function copyCard(button) {
  if (!button) return;
  const card = button.closest('.card') || button.parentElement;
  if (!card) return;
  const arabicDiv = card.querySelector('.arabic');
  const translationDiv = card.querySelector('.translation');
  let text = '';
  if (arabicDiv) text = arabicDiv.textContent.trim();
  if (translationDiv) {
    if (text) text += String.fromCharCode(10);
    text += translationDiv.textContent.trim();
  }
  if (!text) return;

  const originalText = button.textContent;
  const done = (ok) => {
    button.textContent = ok ? 'Copied!' : 'Copy failed';
    setTimeout(() => { button.textContent = originalText; }, 1500);
  };

  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(() => done(true)).catch(() => {
      // Clipboard API needs a secure context; fall back to a temp textarea.
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      document.body.removeChild(ta);
      done(ok);
    });
  } else {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    document.body.removeChild(ta);
    done(ok);
  }
}
function copyToClipboard(button) { return copyCard(button); }
function toggleTheme() {
  const html = document.documentElement;
  const currentTheme = html.getAttribute('data-theme');
  const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
  html.setAttribute('data-theme', newTheme);
  
  // Update icon
  const icon = document.getElementById('theme-toggle-icon');
  icon.textContent = newTheme === 'dark' ? '☀️' : '🌙';
  
  // Save preference
  localStorage.setItem('theme', newTheme);
}

// Initialize theme on page load
document.addEventListener('DOMContentLoaded', () => {
  const savedTheme = localStorage.getItem('theme') || 'light';
  document.documentElement.setAttribute('data-theme', savedTheme);
  document.body.classList.toggle('glossing-off', !glossingEnabled);
  const gt = document.getElementById('gloss-toggle');
  if (gt) gt.textContent = 'Glossing: ' + (glossingEnabled ? 'on' : 'off');
  
  // Set initial icon
  const icon = document.getElementById('theme-toggle-icon');
  if (icon) {
    icon.textContent = savedTheme === 'dark' ? '☀️' : '🌙';
  }
  
  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (activeGloss) { closeGloss(); return; }
      clearChat();
    }
  });

  // Delegated handler so terms highlighted in any panel work without
  // re-binding after each render.
  document.addEventListener('click', (e) => {
    const term = e.target.closest ? e.target.closest('g-term') : null;
    if (term) { if (glossingEnabled) showGloss(term); return; }
    if (activeGloss && !e.target.closest('.gloss-pop')) closeGloss();
  });
  document.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.tagName === 'G-TERM') {
      if (!glossingEnabled) return;
      e.preventDefault();
      showGloss(e.target);
    }
  });

  // Prefetch so the first highlighted verse renders without delay.
  loadGlossary();
});

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
    query = (body.get("query") or "").strip()
    user_id = body.get("user_id") or "web-default"

    if not query:
        return jsonify({"error": "Query is required", "query": "", "results": [],
                        "hadiths": [], "insights": [], "suggestions": []}), 400

    try:
        response = ilm_app.get_ai_response(query, user_id=user_id)
    except Exception as e:
        app.logger.exception("chat failed")
        return jsonify({"error": f"Search failed: {e}"}), 502

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
    query = (request.args.get("q") or "").strip()
    language = request.args.get("lang", "en")
    if not query:
        return jsonify({"error": "Query parameter 'q' is required", "query": "", "results": []}), 400
    try:
        data = ilm_app.search_verses(query, language=language)
    except Exception as e:
        app.logger.exception("search failed")
        return jsonify({"error": f"Search failed: {e}", "query": query, "results": []}), 502
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
    if not 1 <= chapter <= 114:
        return jsonify({"error": "Chapter must be between 1 and 114"}), 400
    language = request.args.get("lang", "en")
    verses = ilm_app.get_quran_surah(chapter, language=language)
    return jsonify([{
        "id": v.verse_key or f"{chapter}:{v.verse_number}",
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
    hadiths = ilm_app.data_service.get_hadiths_by_collection(collection, limit=50)
    return jsonify([vars(h) for h in hadiths] if hadiths else [])


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
    try:
        days = int(request.args.get("days", 7))
    except ValueError:
        return jsonify({"error": "days must be a number"}), 400
    days = max(1, min(days, 30))
    plan = ilm_app.get_reading_plan(user_id=user_id, days=days)
    return jsonify(plan)


# Warm caches on import so the first request is fast under gunicorn too.
# Set ILM_SKIP_WARMUP=1 to disable (useful in tests).
if os.environ.get("ILM_SKIP_WARMUP") != "1":
    threading.Thread(target=ilm_app.warm_up, daemon=True).start()


@app.route("/api/glossary")
def glossary_list():
    """Return glossary entries, optionally filtered by search or category.

    The payload is fetched once by the browser and cached locally, so
    highlighting translations costs no extra round trips.
    """
    query = (request.args.get("q") or "").strip()
    category = (request.args.get("category") or "").strip()
    entries = GLOSSARY.search(query)
    if category:
        entries = [e for e in entries if e.get("category") == category]
    return jsonify({
        "count": len(entries),
        "total": len(GLOSSARY.entries),
        "categories": GLOSSARY.categories,
        "entries": [{
            "term": e["term"],
            "variants": e.get("variants", []),
            "translit": e.get("translit", ""),
            "arabic": e.get("arabic", ""),
            "short": e.get("short", ""),
            "detail": e.get("detail", ""),
            "category": e.get("category", ""),
            "refs": e.get("refs", []),
        } for e in entries]
    })


@app.route("/api/glossary/<term>")
def glossary_entry(term):
    entry = GLOSSARY.get(term)
    if not entry:
        return jsonify({"error": "Term not found", "term": term}), 404
    return jsonify({
        "term": entry["term"],
        "variants": entry.get("variants", []),
        "translit": entry.get("translit", ""),
        "arabic": entry.get("arabic", ""),
        "short": entry.get("short", ""),
        "detail": entry.get("detail", ""),
        "category": entry.get("category", ""),
        "refs": entry.get("refs", []),
    })


@app.route("/api/gloss", methods=["POST"])
def gloss_text():
    """Annotate arbitrary translated text with glossary markers.

    Accepts {"text": "..."} and returns the annotated HTML plus the terms
    that were found, for clients that prefer server-side matching.
    """
    body = request.get_json(silent=True) or {}
    text = body.get("text") or ""
    if not isinstance(text, str) or not text.strip():
        return jsonify({"error": "Provide a non-empty 'text' string"}), 400
    if len(text) > 20000:
        return jsonify({"error": "text too long (limit 20000 characters)"}), 413
    terms = GLOSSARY.find_terms(text)
    return jsonify({
        "terms": terms,
        "annotated": GLOSSARY.annotate(text),
    })


@app.route("/api/verse-gloss/<verse_key>")
def verse_gloss(verse_key):
    """List the glossary terms present in one verse, with its references."""
    verse = ilm_app.get_quran_text(verse_key, language="en")
    if not verse:
        return jsonify({"error": "Verse not found", "verse_key": verse_key}), 404
    return jsonify({
        "verse_key": verse_key,
        "terms": GLOSSARY.find_terms(verse.translation or ""),
    })


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8000, debug=False, threaded=True)