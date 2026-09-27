# Ilm - Sacred Text Comparison & Knowledge Platform

## Vision
**Ilm** (علم) - Arabic for "knowledge, understanding, learning" - is the definitive platform for side-by-side comparison and deep understanding of sacred religious texts. Built with TypeSafe's System One models (Jev) for intelligent semantic indexing, context-aware search, and meaning-based recommendations.

## Core Texts (Phase 1)
| Text | Languages | Structure |
|------|-----------|-----------|
| **Quran** | Arabic (original) + English | 114 Surahs, 6,236 Ayahs |
| **Talmud** | Hebrew/Aramaic + English | Mishnah + Gemara (63 tractates) |
| **Torah** | Hebrew + English | 5 Books (Genesis, Exodus, Leviticus, Numbers, Deuteronomy) |
| **Old Testament** | Hebrew + English | 39 Books (Protestant canon) |
| **New Testament** | Greek + English | 27 Books |

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        Ilm Application                          │
├─────────────────────────────────────────────────────────────────┤
│  Frontend (React/Next.js + TypeScript)                         │
│  ├── Search Interface                                           │
│  ├── Side-by-Side Comparison View                               │
│  ├── Text Reader (per book)                                     │
│  ├── Recommendation Engine UI                                   │
│  └── Settings / Preferences                                     │
├─────────────────────────────────────────────────────────────────┤
│  Backend API (Node.js/TypeScript + TypeSafe SDK)               │
│  ├── Text Indexing Service (Jev-powered)                       │
│  ├── Semantic Search Engine                                     │
│  ├── Context Scoring Engine                                     │
│  ├── Recommendation Engine (scoring-based, no inference)       │
│  ├── Comparison Alignment Service                               │
│  └── Text Repository Manager                                    │
├─────────────────────────────────────────────────────────────────┤
│  Data Layer                                                     │
│  ├── Vector Database (semantic embeddings)                     │
│  ├── Full-Text Search Index (meilisearch/typesense)            │
│  ├── Relational DB (PostgreSQL - metadata, alignments, users)  │
│  └── Raw Text Storage (structured JSON/Parquet)                │
└─────────────────────────────────────────────────────────────────┘
```

## TypeSafe/Jev Integration Points

### 1. Semantic Indexing Pipeline
```
Raw Text → Chunking → Jev Score (semantic density) → Vector Embeddings → Index
```
- Use **Score** primitive to evaluate semantic richness of each verse/passage
- Use **Choice** primitive for topic/theme classification
- Use **Noul** primitive for cross-reference detection

### 2. Context-Aware Search
```
User Query → Jev Choice (intent classification) → Jev Score (relevance per passage) → Ranked Results
```
- Intent: comparison, explanation, thematic study, linguistic analysis
- Score dimensions: textual match, semantic similarity, thematic relevance, cross-textual resonance

### 3. Recommendation Engine (Scoring-Based Only)
```
Current Passage → Jev Score (thematic affinity per candidate text) → Weighted Composite → Ranked Recommendations
```
- **NO INFERENCES** - only scored affinities
- Dimensions: shared terminology, thematic overlap, historical context, linguistic roots, narrative parallels
- Configurable weights per user preference

### 4. Comparison Alignment
```
Passage A + Passage B → Jev Noul (parallel concept?) → Jev Score (alignment strength) → Alignment Map
```
- Detects: direct quotes, allusions, thematic parallels, linguistic cognates, theological echoes

## Data Models

### Text Passage
```typescript
interface Passage {
  id: string;                    // Unique identifier
  textId: string;                // quran, talmud, torah, ot, nt
  book: string;                  // Surah/Book/Tractate name
  chapter: number;               // Chapter/Surah number
  verse: number;                 // Verse number
  originalText: string;          // Arabic/Hebrew/Aramaic/Greek
  translation: string;           // English (primary)
  alternativeTranslations?: Translation[];  // Multiple translations
  metadata: {
    language: string;
    writingSystem: string;
    canonicalOrder: number;
    revelationOrder?: number;    // For Quran
    madhhab?: string;            // For Talmud
  };
  embeddings: number[];          // Semantic vector
  themes: ThemeScore[];          // Jev-scored themes
  crossReferences: CrossRef[];   // Jev-detected parallels
}
```

### Theme Score (Jev-generated)
```typescript
interface ThemeScore {
  theme: string;                 // e.g., "mercy", "covenant", "sacrifice"
  score: number;                 // 0-1 from Jev Score primitive
  confidence: number;            // Jev confidence
  evidence: string[];            // Supporting phrases
}
```

### Cross-Reference (Jev-generated)
```typescript
interface CrossRef {
  targetPassageId: string;
  targetText: string;            // Other text ID
  type: 'quote' | 'allusion' | 'thematic' | 'linguistic' | 'narrative';
  strength: number;              // Jev Score 0-1
  direction: 'bidirectional' | 'source_to_target' | 'target_to_source';
  notes: string;
}
```

### Recommendation Result
```typescript
interface Recommendation {
  passageId: string;
  textId: string;
  book: string;
  chapter: number;
  verse: number;
  preview: string;
  scores: {
    thematic: number;      // Theme overlap
    linguistic: number;    // Shared terminology/roots
    historical: number;    // Historical/contextual connection
    narrative: number;     // Story/character parallels
    theological: number;   // Doctrinal resonance
    composite: number;     // Weighted sum
  };
  reasoning: string;       // Human-readable score breakdown
}
```

## User Flows

### 1. Unified Search
- Single search bar across all texts
- Filter by: text, book, language, theme
- Results ranked by Jev semantic relevance
- Instant preview with highlighted matches

### 2. Side-by-Side Comparison
- Select 2-8 passages from any texts, one column per text
- Synchronized scrolling
- Jev-powered alignment highlights
- Toggle: original / translation / both
- Export comparison (PDF, JSON, markdown)

### 3. Deep Reading Mode
- Single passage view with:
  - Original text (vowelled/unvowelled toggle for Arabic/Hebrew)
  - Multiple translations
  - Jev-identified themes with scores
  - Cross-references to all other texts
  - Linguistic breakdown (roots, morphology)
  - Commentary references (future phase)

### 4. Thematic Exploration
- Enter concept (e.g., "forgiveness", "covenant", "light")
- Jev classifies intent, scores all passages
- Visual theme map across texts
- "Journey" mode: trace concept through texts chronologically

### 5. Recommendation Panel (Context-Aware)
- Always visible during reading
- Updates in real-time as user scrolls
- Scores only - no generated inferences
- "Why this passage?" breakdown per recommendation
- User-adjustable weight sliders

## Technical Stack

### Frontend
- **Framework**: Next.js 14+ (App Router)
- **Language**: TypeScript (strict)
- **State**: Zustand + TanStack Query
- **UI**: Tailwind CSS + Radix UI / shadcn/ui
- **Text Rendering**: Custom component with RTL support
- **Comparison**: Synchronized scroll containers

### Backend
- **Runtime**: Node.js 20+ / Bun
- **Framework**: Fastify or Hono
- **TypeSafe SDK**: Official TypeScript SDK
- **Vector DB**: Qdrant or Pinecone
- **Full-Text Search**: Meilisearch
- **Database**: PostgreSQL (Prisma ORM)
- **Cache**: Redis (Upstash)
- **Queue**: BullMQ for indexing jobs

### TypeSafe Integration
```typescript
// Example: Scoring thematic affinity
import { TypeSafe } from '@typesafe-ai/sdk';

const typesafe = new TypeSafe({ apiKey: process.env.TYPESAFE_API_KEY });

async function scoreThematicAffinity(passageA: string, passageB: string): Promise<number> {
  const result = await typesafe.score({
    question: "How strongly do these two passages share thematic content?",
    state: { passageA, passageB },
    criteria: [
      { level: 0, description: "No thematic overlap" },
      { level: 1, description: "Superficial word overlap only" },
      { level: 2, description: "Related but distinct themes" },
      { level: 3, description: "Clear shared theme with different emphasis" },
      { level: 4, description: "Same core theme, complementary perspectives" },
      { level: 5, description: "Directly addressing identical theme with deep resonance" }
    ]
  });
  return result.score; // 0-5, normalized to 0-1
}
```

## Phase 1 Implementation Plan

### Sprint 1: Foundation (Week 1-2)
- [ ] Project setup (monorepo: apps/web, apps/api, packages/shared)
- [ ] Database schema (Prisma)
- [ ] Text ingestion pipeline (download/parse public domain texts)
- [ ] Basic API structure with TypeSafe client

### Sprint 2: Indexing & Search (Week 2-3)
- [ ] Chunking strategy per text type
- [ ] Jev scoring pipeline (themes, density, cross-refs)
- [ ] Vector embedding generation
- [ ] Meilisearch full-text index
- [ ] Unified search API

### Sprint 3: Comparison Engine (Week 3-4)
- [ ] Passage alignment service (Jev Noul + Score)
- [ ] Side-by-side UI component
- [ ] Synchronized scrolling
- [ ] Alignment highlighting

### Sprint 4: Recommendations & Polish (Week 4-5)
- [ ] Composite scoring engine
- [ ] Real-time recommendation panel
- [ ] Weight configuration UI
- [ ] Theme exploration view
- [ ] Performance optimization

### Sprint 5: Launch Prep (Week 5-6)
- [ ] All 5 texts loaded and indexed
- [ ] End-to-end testing
- [ ] Accessibility audit
- [ ] Deployment (Vercel + Railway/Render)
- [ ] Documentation

## Success Metrics
- Search latency < 200ms (p95)
- Comparison alignment accuracy > 85% (human eval)
- Recommendation relevance > 4/5 (user rating)
- Support 100+ concurrent users
- Sub-second passage loading

## Non-Goals (Phase 1)
- User accounts/auth (anonymous first)
- Commentary integration
- Audio recitation
- Mobile apps (responsive web only)
- Collaborative features
- AI-generated explanations (only scored connections)

## Open Questions
1. Translation sources - which English translations for each text?
2. Talmud structure - which edition (Vilna, Soncino)? Mishnah only or full Gemara?
3. Deuterocanonical books - include in OT?
4. TypeSafe API access - need credentials
5. Hosting budget for vector DB

## Next Steps
1. Confirm text sources and translations
2. Obtain TypeSafe API credentials
3. Initialize monorepo structure
4. Begin text acquisition and parsing