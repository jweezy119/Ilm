/**
 * Local Neural Cross-Encoder Judge (`source: 'local'`)
 *
 * Plugs directly into `ChainedJudge` in `typesafe-client.ts` right behind the
 * hosted `SdkJudge` (`jev`). Gives Ilm local, offline, LLM-grade semantic
 * question understanding, passage reranking, and calibrated corpus-level
 * silence verdicts ("these texts do not address this") with ZERO generated
 * prose, ZERO hallucinations, and ZERO API keys.
 *
 * Powered by `@xenova/transformers` (already a dependency of `@ilm/api`) using
 * a tiny int8-quantized ONNX cross-encoder (`Xenova/ms-marco-MiniLM-L-6-v2`,
 * ~23 MB) that jointly attends to `(query, passage)` pairs on CPU in ~60-150 ms.
 *
 * Graceful degradation (AGENTS.md):
 *   - Disabled unless `LOCAL_JUDGE_ENABLED=1` (or `true`), so deployments never
 *     unexpectedly download model weights on boot.
 *   - Lazy-loaded on first use and bounded by timeout.
 *   - If disabled, offline, or failing, `ChainedJudge` falls cleanly through to
 *     deterministic `'derived'` scoring — never crashing a search.
 */

import type { EntryType, JevAnswer, JevJudge, JevQuestion, JevVerdict } from './typesafe-client';
import type { ScoreSource } from '@ilm/shared';

export const DEFAULT_LOCAL_JUDGE_MODEL =
  process.env.LOCAL_JUDGE_MODEL ?? 'Xenova/ms-marco-MiniLM-L-6-v2';

/** Function scoring (query, document) pairs and returning raw relevance logits. */
export type CrossEncoderScorer = (pairs: Array<[string, string]>) => Promise<number[]>;

/**
 * Calibrated logistic mapping from MS-MARCO MiniLM cross-encoder raw logits
 * (which typically range from ~ -10 for unrelated to ~ +8 for strong answers)
 * into [0, 1] probabilities matching Ilm's `CORPUS_ADDRESSED` (0.6) /
 * `CORPUS_PARTIAL` (0.3) thresholds.
 *
 *   logit = +4.0  -> ~0.88 (clearly addresses the question)
 *   logit = +1.0  -> ~0.62 (addresses the question)
 *   logit =  0.0  -> ~0.50 (borderline / partial)
 *   logit = -2.0  -> ~0.27 (weak / tangential)
 *   logit = -6.0  -> ~0.05 (unrelated / silent)
 */
export function calibrateCrossEncoderLogit(logit: number, shift = 0, temperature = 2.0): number {
  if (!Number.isFinite(logit)) return 0;
  const z = (logit - shift) / Math.max(0.1, temperature);
  const clamped = Math.max(-20, Math.min(20, z));
  return 1 / (1 + Math.exp(-clamped));
}

/**
 * Derive the corpus-level "do these passages address the query?" probability
 * from the candidate cross-encoder probabilities.
 *
 * Uses a weighted blend of the single strongest passage (0.7) and the mean of
 * the top 3 passages (0.3) so one genuinely direct verse still counts as
 * addressed, while a wall of weak tangential hits stays below `CORPUS_PARTIAL`
 * and honestly reports `'unaddressed'`.
 */
export function corpusAddressedProbability(candidateProbs: number[]): number {
  if (candidateProbs.length === 0) return 0;
  const sorted = [...candidateProbs].sort((a, b) => b - a);
  const top1 = sorted[0];
  const top3 = sorted.slice(0, 3);
  const meanTop3 = top3.reduce((s, v) => s + v, 0) / top3.length;
  return Math.max(0, Math.min(1, 0.7 * top1 + 0.3 * meanTop3));
}

function extractTextFromEntry(entry: unknown): string {
  if (typeof entry === 'string') return entry;
  if (!entry || typeof entry !== 'object') return '';
  const obj = entry as Record<string, unknown>;
  const parts: string[] = [];
  if (typeof obj.translation === 'string') parts.push(obj.translation);
  if (typeof obj.text === 'string') parts.push(obj.text);
  if (typeof obj.original === 'string' && obj.original) parts.push(obj.original);
  if (Array.isArray(obj.themes) && obj.themes.length > 0) {
    parts.push(`themes: ${obj.themes.join(', ')}`);
  }
  if (parts.length > 0) return parts.join(' ');
  if (typeof obj.search === 'string') return obj.search;
  if (typeof obj.query === 'string') return obj.query;
  if (typeof obj.question === 'string') return obj.question;
  return JSON.stringify(obj).slice(0, 400);
}

function extractPairForNoul(state: EntryType, q: Extract<JevQuestion, { kind: 'noul' }>): [string, string] | null {
  const instr = (typeof q.instructions === 'object' && q.instructions !== null
    ? q.instructions
    : {}) as Record<string, unknown>;
  const st = (typeof state === 'object' && state !== null ? state : {}) as Record<string, unknown>;

  // Search rerank shape: { search, candidate }
  if (typeof instr.search === 'string' && instr.candidate) {
    return [instr.search, extractTextFromEntry(instr.candidate)];
  }
  // Cross-reference / pairwise shape: { source, candidate }
  if (instr.source && instr.candidate) {
    return [extractTextFromEntry(instr.source), extractTextFromEntry(instr.candidate)];
  }
  // Generic fallback: question vs state
  const left = typeof instr.question === 'string' ? instr.question : extractTextFromEntry(q.instructions);
  const right = extractTextFromEntry(st.candidate ?? st.passage ?? st);
  if (!left || !right) return null;
  return [left, right];
}

function softmax(values: number[], temperature = 1.5): number[] {
  if (values.length === 0) return [];
  const invT = 1 / Math.max(0.1, temperature);
  let max = -Infinity;
  for (const v of values) {
    const s = v * invT;
    if (s > max) max = s;
  }
  const exps = values.map((v) => Math.exp(Math.max(-30, v * invT - max)));
  const sum = exps.reduce((a, b) => a + b, 0) || 1;
  return exps.map((e) => e / sum);
}

// Lazy singleton ONNX cross-encoder session
type OnnxCrossEncoder = {
  tokenizer: (
    queries: string[],
    opts: { text_pair: string[]; padding: boolean; truncation: boolean }
  ) => Promise<Record<string, unknown>>;
  model: (inputs: Record<string, unknown>) => Promise<{ logits: { data: Float32Array | number[] } }>;
};

let onnxSession: Promise<OnnxCrossEncoder> | null = null;

async function loadOnnxCrossEncoder(modelName: string): Promise<OnnxCrossEncoder> {
  if (!onnxSession) {
    onnxSession = (async () => {
      const transformers = await import('@xenova/transformers');
      if (process.env.LOCAL_MODEL_CACHE_DIR) {
        transformers.env.cacheDir = process.env.LOCAL_MODEL_CACHE_DIR;
      }
      const [tokenizer, model] = await Promise.all([
        transformers.AutoTokenizer.from_pretrained(modelName),
        transformers.AutoModelForSequenceClassification.from_pretrained(modelName, { quantized: true }),
      ]);
      return {
        tokenizer: tokenizer as unknown as OnnxCrossEncoder['tokenizer'],
        model: model as unknown as OnnxCrossEncoder['model'],
      };
    })().catch((error) => {
      onnxSession = null;
      throw error;
    });
  }
  return onnxSession;
}

export async function runOnnxCrossEncoder(
  pairs: Array<[string, string]>,
  modelName = DEFAULT_LOCAL_JUDGE_MODEL
): Promise<number[]> {
  if (pairs.length === 0) return [];
  const { tokenizer, model } = await loadOnnxCrossEncoder(modelName);
  const queries = pairs.map(([q]) => q.slice(0, 512));
  const docs = pairs.map(([, d]) => d.slice(0, 1200));

  const inputs = await tokenizer(queries, {
    text_pair: docs,
    padding: true,
    truncation: true,
  });
  const output = await model(inputs);
  const logits = output.logits?.data;
  if (!logits) throw new Error('Local cross-encoder returned no logits');

  // Sequence classification returns 1 logit per pair for MS-MARCO (or 2 for binary heads).
  const stride = Math.max(1, Math.floor(logits.length / pairs.length));
  const out: number[] = new Array(pairs.length);
  for (let i = 0; i < pairs.length; i += 1) {
    out[i] = stride === 1 ? Number(logits[i]) : Number(logits[i * stride + (stride - 1)]);
  }
  return out;
}

export interface LocalNeuralJudgeOptions {
  enabled?: boolean;
  model?: string;
  timeoutMs?: number;
  /** Optional custom scorer for unit tests or alternative local runtimes. */
  scorer?: CrossEncoderScorer;
}

export class LocalNeuralJudge implements JevJudge {
  readonly id: ScoreSource = 'local';
  readonly label: string;
  readonly available: boolean;
  readonly reason: string;
  private readonly model: string;
  private readonly timeoutMs: number;
  private readonly scorer: CrossEncoderScorer;

  constructor(options: LocalNeuralJudgeOptions = {}) {
    const envEnabled =
      process.env.LOCAL_JUDGE_ENABLED === '1' ||
      process.env.LOCAL_JUDGE_ENABLED?.toLowerCase() === 'true';
    this.available = options.enabled ?? envEnabled;
    this.model = options.model ?? DEFAULT_LOCAL_JUDGE_MODEL;
    this.timeoutMs = options.timeoutMs ?? Number(process.env.LOCAL_JUDGE_TIMEOUT_MS ?? 5000);
    this.label = `Local (${this.model.split('/').pop() ?? this.model})`;
    this.reason = this.available ? `configured (${this.model})` : 'LOCAL_JUDGE_ENABLED is not set';
    this.scorer = options.scorer ?? ((pairs) => runOnnxCrossEncoder(pairs, this.model));
  }

  private async scoreWithTimeout(pairs: Array<[string, string]>): Promise<number[]> {
    if (pairs.length === 0) return [];
    let timer: ReturnType<typeof setTimeout> | null = null;
    try {
      return await Promise.race([
        this.scorer(pairs),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error(`Local cross-encoder timed out after ${this.timeoutMs}ms`)),
            this.timeoutMs
          );
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async ask(state: EntryType, questions: JevQuestion[]): Promise<JevVerdict> {
    if (!this.available) {
      throw new Error(`Local judge unavailable: ${this.reason}`);
    }
    if (questions.length === 0) return { answers: {}, source: this.id };

    const answers: Record<string, JevAnswer> = {};

    // 1. Batch all non-corpus `noul` questions into one cross-encoder forward pass.
    const noulQuestions = questions.filter((q): q is Extract<JevQuestion, { kind: 'noul' }> => q.kind === 'noul');
    const corpusQuestion = noulQuestions.find((q) => q.id === 'corpus');
    const itemNouls = noulQuestions.filter((q) => q.id !== 'corpus');

    const candidateProbs: number[] = [];
    if (itemNouls.length > 0) {
      const pairs: Array<[string, string]> = [];
      const indices: number[] = [];
      itemNouls.forEach((q, idx) => {
        const pair = extractPairForNoul(state, q);
        if (pair) {
          pairs.push(pair);
          indices.push(idx);
        }
      });

      const logits = await this.scoreWithTimeout(pairs);
      logits.forEach((logit, i) => {
        const prob = calibrateCrossEncoderLogit(logit);
        candidateProbs.push(prob);
        const q = itemNouls[indices[i]];
        answers[q.id] = {
          value: prob,
          probabilities: { true: prob, false: 1 - prob },
          confidence: Math.abs(prob - 0.5) * 2,
        };
      });
    }

    // 2. Corpus-level silence verdict ("do these passages address the query at all?").
    if (corpusQuestion) {
      let probs = candidateProbs;
      if (probs.length === 0) {
        const instr = (typeof corpusQuestion.instructions === 'object' && corpusQuestion.instructions !== null
          ? corpusQuestion.instructions
          : {}) as Record<string, unknown>;
        const query = typeof instr.search === 'string' ? instr.search : extractTextFromEntry(state);
        const passages = Array.isArray(instr.passages) ? instr.passages : [];
        if (passages.length > 0) {
          const pairs = passages
            .slice(0, 12)
            .map((p): [string, string] => [query, extractTextFromEntry(p)]);
          const logits = await this.scoreWithTimeout(pairs);
          probs = logits.map((l) => calibrateCrossEncoderLogit(l));
        }
      }
      const addressed = corpusAddressedProbability(probs);
      answers[corpusQuestion.id] = {
        value: addressed,
        probabilities: { true: addressed, false: 1 - addressed },
        confidence: Math.abs(addressed - 0.5) * 2,
      };
    }

    // 3. Handle `choice` questions (intent, alignment type, theme expansion).
    const choiceQuestions = questions.filter(
      (q): q is Extract<JevQuestion, { kind: 'choice' }> => q.kind === 'choice'
    );
    for (const q of choiceQuestions) {
      const criteriaEntries = Object.entries(q.criteria as Record<string, unknown>);
      if (criteriaEntries.length === 0) continue;

      // Bound large taxonomies (like 80 themes) to the top 16 lexical candidates + 'none'
      // so CPU inference stays interactive (< 120ms).
      const inputText = extractTextFromEntry(
        typeof q.instructions === 'object' && q.instructions !== null
          ? (q.instructions as Record<string, unknown>).query ??
              (q.instructions as Record<string, unknown>).source ??
              state
          : state
      );

      let candidates = criteriaEntries;
      if (candidates.length > 16) {
        const lower = inputText.toLowerCase();
        const scoredEntries = candidates.map(([key, desc]) => {
          const label = `${key.replace(/_/g, ' ')} ${typeof desc === 'string' ? desc : ''}`.toLowerCase();
          const words = label.split(/\W+/).filter((w) => w.length > 2);
          let overlap = 0;
          for (const w of words) if (lower.includes(w)) overlap += 1;
          return { entry: [key, desc] as [string, unknown], overlap };
        });
        scoredEntries.sort((a, b) => b.overlap - a.overlap);
        candidates = scoredEntries.slice(0, 16).map((s) => s.entry);
      }

      const pairs: Array<[string, string]> = candidates.map(([key, desc]) => [
        inputText,
        typeof desc === 'string' && desc.trim() ? `${key.replace(/_/g, ' ')}: ${desc}` : key.replace(/_/g, ' '),
      ]);

      const logits = await this.scoreWithTimeout(pairs);
      const probs = softmax(logits);
      const probMap: Record<string, number> = {};
      let bestChoice = candidates[0][0];
      let bestProb = -1;

      candidates.forEach(([key], i) => {
        const p = probs[i] ?? 0;
        probMap[key] = p;
        if (p > bestProb) {
          bestProb = p;
          bestChoice = key;
        }
      });

      answers[q.id] = {
        value: bestProb,
        probabilities: probMap,
        confidence: bestProb,
        choice: bestChoice,
      };
    }

    // 4. Handle `score` questions (strength / density rubrics).
    const scoreQuestions = questions.filter(
      (q): q is Extract<JevQuestion, { kind: 'score' }> => q.kind === 'score'
    );
    if (scoreQuestions.length > 0) {
      const pairs: Array<[string, string]> = scoreQuestions.map((q) => {
        const instr = (typeof q.instructions === 'object' && q.instructions !== null
          ? q.instructions
          : {}) as Record<string, unknown>;
        const left =
          typeof q.instructions === 'string'
            ? q.instructions
            : typeof instr.question === 'string'
              ? instr.question
              : q.criteria[q.criteria.length - 1] ?? 'relevant';
        const right =
          instr.source && instr.candidate
            ? `${extractTextFromEntry(instr.source)} | ${extractTextFromEntry(instr.candidate)}`
            : extractTextFromEntry(instr.passage ?? state);
        return [left, right];
      });

      const logits = await this.scoreWithTimeout(pairs);
      scoreQuestions.forEach((q, i) => {
        const value = calibrateCrossEncoderLogit(logits[i] ?? 0);
        answers[q.id] = {
          value,
          probabilities: {},
          confidence: Math.abs(value - 0.5) * 2,
        };
      });
    }

    return { answers, source: this.id };
  }

  async verify(): Promise<{ model: string }> {
    if (!this.available) throw new Error(`Local judge unavailable: ${this.reason}`);
    await this.scoreWithTimeout([['mercy and compassion', 'The Lord is gracious and merciful.']]);
    return { model: this.model };
  }
}
