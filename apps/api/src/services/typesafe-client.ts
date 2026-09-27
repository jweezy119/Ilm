/**
 * TypeSafe Client - Minimal implementation for Jev primitives
 * Replaces @typesafe-ai/sdk which doesn't exist on npm
 */

// TypeSafe/Jev API types
export interface TypeSafeClient {
  score(options: ScoreOptions): Promise<ScoreResult>;
  choice(options: ChoiceOptions): Promise<ChoiceResult>;
  noul(options: NoulOptions): Promise<NoulResult>;
}

export interface ScoreOptions {
  question: string;
  state: Record<string, unknown>;
  criteria: Array<{ level: number; description: string }>;
}

export interface ScoreResult {
  score: number; // 0-5
  confidence: number;
  distribution: Record<number, number>;
}

export interface ChoiceOptions {
  question: string;
  state: Record<string, unknown>;
  criteria: Array<{ level: number; description: string }>;
}

export interface ChoiceResult {
  choice: number;
  confidence: number;
  distribution: Record<number, number>;
}

export interface NoulOptions {
  question: string;
  state: Record<string, unknown>;
}

export interface NoulResult {
  probability: number;
  confidence: number;
}

// Mock client for development - replace with real API calls when TypeSafe SDK is available
export class MockTypeSafeClient implements TypeSafeClient {
  async score(options: ScoreOptions): Promise<ScoreResult> {
    // Mock implementation - returns middle score
    const levels = options.criteria.length;
    return {
      score: Math.floor(levels / 2),
      confidence: 0.7,
      distribution: Object.fromEntries(
        options.criteria.map((_, i) => [i, i === Math.floor(levels / 2) ? 0.5 : 0.1])
      ),
    };
  }

  async choice(options: ChoiceOptions): Promise<ChoiceResult> {
    // Mock implementation - returns first option
    return {
      choice: 0,
      confidence: 0.7,
      distribution: { 0: 0.6, 1: 0.2, 2: 0.1, 3: 0.1 },
    };
  }

  async noul(options: NoulOptions): Promise<NoulResult> {
    // Mock implementation - returns 0.5
    return {
      probability: 0.5,
      confidence: 0.6,
    };
  }
}

// Factory function to create client
export function createTypeSafeClient(apiKey?: string): TypeSafeClient {
  if (!apiKey || apiKey === 'your_typesafe_api_key_here') {
    console.warn('⚠️  TypeSafe API key not configured, using mock client');
    return new MockTypeSafeClient();
  }
  
  // Real implementation would go here when SDK is available
  // For now, return mock
  return new MockTypeSafeClient();
}