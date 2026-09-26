# Ilm (علم) — Sacred Text Comparison & Knowledge Platform

> **Ilm** (Arabic: علم) means *knowledge, understanding, learning*. This platform enables deep, side-by-side comparison of sacred religious texts with AI-powered semantic search and context-aware recommendations.

## 🎯 Vision

Ilm is the definitive platform for comparative religious study, enabling scholars, students, and seekers to:

- **Compare side-by-side** — Quran, Talmud, Torah, Old Testament, New Testament
- **Search semantically** — Find passages by meaning, not just keywords
- **Discover connections** — AI-detected cross-references, thematic parallels, linguistic cognates
- **Understand context** — Recommendations based on scored affinities (thematic, linguistic, historical, narrative, theological)
- **No inferences** — Only transparent, weighted scoring from TypeSafe's System One models

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Ilm Application                          │
├─────────────────────────────────────────────────────────────────┤
│  Frontend (Next.js 14 + TypeScript + Tailwind)                 │
│  ├── Unified Search Interface                                   │
│  ├── Side-by-Side Comparison View                               │
│  ├── Passage Deep Reading Mode                                  │
│  ├── Thematic Exploration & Journey                             │
│  └── Real-time Recommendation Panel                             │
├─────────────────────────────────────────────────────────────────┤
│  Backend API (Fastify + TypeScript + TypeSafe SDK)             │
│  ├── Semantic Search Engine (Meilisearch + Qdrant)             │
│  ├── TypeSafe/Jev Intelligence Layer                           │
│  │   ├── Theme Classification (Score primitive)                │
│  │   ├── Intent Detection (Choice primitive)                   │
│  │   ├── Cross-Reference Detection (Noul + Score)              │
│  │   ├── Alignment Computation (Noul + Score)                  │
│  │   └── Recommendation Scoring (5-dimension Score)            │
│  ├── Passage Management & Alignment Service                    │
│  └── Data Ingestion Pipeline                                   │
├─────────────────────────────────────────────────────────────────┤
│  Data Layer                                                     │
│  ├── PostgreSQL (Prisma) — Metadata, passages, alignments      │
│  ├── Meilisearch — Full-text search with highlighting          │
│  ├── Qdrant — Vector embeddings for semantic search            │
│  └── Redis (BullMQ) — Background job processing                │
└─────────────────────────────────────────────────────────────────┘
```

## 📚 Supported Texts (Phase 1)

| Text | Language | Structure | Verses | Status |
|------|----------|-----------|--------|--------|
| **Quran** | Arabic + English | 114 Surahs | 6,236 | ✅ Planned |
| **Talmud (Bavli)** | Aramaic + English | 63 Tractates | ~50k | ✅ Planned |
| **Torah** | Hebrew + English | 5 Books | 5,845 | ✅ Planned |
| **Old Testament** | Hebrew + English | 39 Books | 23,145 | ✅ Planned |
| **New Testament** | Greek + English | 27 Books | 7,957 | ✅ Planned |

## 🔑 Core Features

### 1. Unified Semantic Search
- Single search bar across all texts
- Intent classification (comparison, explanation, thematic study, etc.)
- Hybrid search: full-text + vector similarity
- Real-time highlighting and suggestions

### 2. Side-by-Side Comparison
- Select 2-5 passages from any texts
- Synchronized scrolling
- Jev-powered alignment highlights (quotes, allusions, parallels)
- Toggle original/translation/both
- RTL/LTR text direction support

### 3. Deep Reading Mode
- Original text with vowelling options
- Multiple translations
- Jev-identified themes with confidence scores
- Cross-references to all other texts
- Linguistic breakdown (roots, morphology)

### 4. Thematic Exploration
- Enter any concept → trace across all texts
- Theme map showing related concepts
- Chronological "journey" through texts
- Co-occurrence network visualization

### 5. Recommendation Engine (Pure Scoring)
- **No AI-generated inferences** — only transparent weighted scores
- 5 dimensions: Thematic, Linguistic, Historical, Narrative, Theological
- User-adjustable weight sliders
- "Why this passage?" breakdown for every recommendation
- Real-time updates as you read

## 🧠 TypeSafe/Jev Integration

Ilm uses **TypeSafe's System One model (Jev)** for programmable semantic judgments:

```typescript
// Example: Thematic affinity scoring (0-1)
const thematicScore = await jejScore(
  "How strongly do these passages share thematic content?",
  { textA: passageA.translation, textB: passageB.translation },
  [
    { level: 0, description: "No thematic overlap" },
    { level: 3, description: "Clear shared theme, different emphasis" },
    { level: 5, description: "Identical theme with deep resonance" }
  ]
);

// Example: Cross-reference detection
const hasConnection = await jejNoul(
  "Do these passages share a meaningful connection?",
  { sourceText: passageA.translation, targetText: passageB.translation }
);
```

**Primitives Used:**
- **Score** — Graded ranking on defined dimensions
- **Choice** — Classification from defined options
- **Noul** — Binary probability judgments

## 🚀 Quick Start

### Prerequisites
- Node.js 20+
- PostgreSQL 16+
- Redis 7+
- Meilisearch 1.10+
- Qdrant 1.8+
- TypeSafe API key

### Local Development

```bash
# Clone and install
git clone <repo>
cd Ilm
npm install

# Start infrastructure
docker-compose up -d postgres redis meilisearch qdrant

# Configure environment
cp apps/api/.env.example apps/api/.env
# Edit .env with your keys

# Setup database
cd apps/api
npm run db:generate
npm run db:push
npm run db:seed

# Start development servers
cd ../..
npm run dev
```

Visit `http://localhost:3000` for the web app, `http://localhost:4000` for the API.

### Environment Variables

```bash
# apps/api/.env
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/ilm
REDIS_URL=redis://localhost:6379
MEILISEARCH_HOST=http://localhost:7700
MEILISEARCH_API_KEY=your_master_key
QDRANT_URL=http://localhost:6333
TYPESAFE_API_KEY=your_typesafe_key
OPENAI_API_KEY=your_openai_key  # For embeddings
CORS_ORIGIN=http://localhost:3000
```

## 📦 Project Structure

```
Ilm/
├── apps/
│   ├── api/                 # Fastify backend
│   │   ├── src/
│   │   │   ├── services/    # Core business logic
│   │   │   │   ├── typesafe.ts      # Jev integration
│   │   │   │   ├── search.ts        # Meilisearch + Qdrant
│   │   │   │   ├── passage.ts       # Passage CRUD
│   │   │   │   ├── recommendation.ts # Scoring engine
│   │   │   │   └── comparison.ts    # Alignment service
│   │   │   ├── routes/      # API endpoints
│   │   │   └── index.ts     # App entry
│   │   ├── prisma/          # Database schema
│   │   └── scripts/         # Ingestion & indexing
│   │
│   └── web/                 # Next.js frontend
│       ├── src/
│       │   ├── app/         # App Router pages
│       │   ├── components/  # React components
│       │   ├── lib/         # Utilities, API client
│       │   ├── hooks/       # Custom React hooks
│       │   ├── store/       # Zustand state
│       │   └── types/       # TypeScript types
│       └── tailwind.config.ts
│
├── packages/
│   └── shared/              # Shared TypeScript types & Zod schemas
│
├── docker-compose.yml       # Infrastructure
└── SPEC.md                  # Full specification
```

## 🔌 API Endpoints

### Search
```
POST   /api/search              # Unified search
GET    /api/search/suggest      # Autocomplete
POST   /api/search/intent       # Classify intent
```

### Passages
```
GET    /api/passages/:id                    # Get passage
GET    /api/passages/by-key/:key            # Get by canonical key
POST   /api/passages/batch                  # Batch fetch
GET    /api/texts/:textId/books             # List books
GET    /api/texts/:textId/books/:bookId     # Book metadata
GET    /api/texts/:textId/books/:bookId/passages
GET    /api/texts/:textId/books/:bookId/chapters/:chapter
GET    /api/texts/:textId/stats
```

### Recommendations
```
POST   /api/recommendations                 # Get recommendations
GET    /api/recommendations/explain/:src/:tgt
GET    /api/themes/:theme/journey           # Thematic journey
GET    /api/themes/:theme/map               # Theme network
GET/PUT /api/users/:userId/weights          # User weights
```

### Comparison
```
POST   /api/compare                         # Compare passages
GET    /api/compare/translations/:textId/:book/:chapter/:verse
```

## 📖 Data Ingestion

```bash
# Ingest all texts
cd apps/api
npx tsx scripts/ingest.ts

# Or individually
npx tsx -e "import { ingestQuran } from './scripts/ingest'; ingestQuran()"
```

## 🔍 Indexing Pipeline

```bash
# Run full indexing (themes, cross-refs, embeddings)
npx tsx scripts/index.ts

# Index to search engines
npx tsx -e "import { indexToMeilisearch, indexToQdrant } from './scripts/index'; indexToMeilisearch(); indexToQdrant()"
```

## 🧪 Testing

```bash
# API tests
cd apps/api && npm run test

# Web tests
cd apps/web && npm run test

# Type checking
npm run typecheck
```

## 📊 Performance Targets

| Metric | Target |
|--------|--------|
| Search latency (p95) | < 200ms |
| Comparison alignment accuracy | > 85% |
| Recommendation relevance (user rating) | > 4/5 |
| Concurrent users | 100+ |
| Passage load time | < 1s |

## 🗺️ Roadmap

### Phase 1 (Current) — Core Platform
- [ ] All 5 texts ingested and indexed
- [ ] Semantic search + comparison
- [ ] Recommendation engine
- [ ] Thematic exploration

### Phase 2 — Enhanced Study
- [ ] Commentary integration (Tafsir, Rashi, Church Fathers)
- [ ] Audio recitation
- [ ] Morphological analysis
- [ ] User accounts & collections

### Phase 3 — Community & AI
- [ ] Collaborative annotations
- [ ] Study groups
- [ ] AI-assisted exegesis (with citations)
- [ ] Mobile apps

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Run tests and typecheck
5. Submit a PR

## 📄 License

MIT License — see LICENSE file for details.

## 🙏 Acknowledgments

- **TypeSafe** — For Jev/System One programmable AI
- **Tanzil.net** — Quran text and translations
- **Sefaria** — Jewish texts API
- **API.Bible / BibleGet.io** — Christian texts
- **Meilisearch & Qdrant** — Search infrastructure

---

**Built with ❤️ for the pursuit of knowledge (Ilm)**