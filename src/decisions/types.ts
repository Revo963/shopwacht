// Wire format shared by TypeSafe (/v1/systemone) and OpenRouter (/api/alpha/decisions).

export interface NoulQuestion {
  type: 'noul';
  instructions: string;
  criteria?: { true: string; false: string };
}

export interface ChoiceQuestion {
  type: 'choice';
  instructions: string;
  criteria: Record<string, string | null>;
}

export interface ScoreQuestion {
  type: 'score';
  instructions: string;
  criteria: string[];
}

export type Question = NoulQuestion | ChoiceQuestion | ScoreQuestion;

export interface NoulAnswer {
  type: 'noul';
  noul: number;
}

export interface ChoiceAnswer {
  type: 'choice';
  choice: string;
  probabilities?: Record<string, number>;
  confidence?: number;
}

export interface ScoreAnswer {
  type: 'score';
  score: number;
  confidence?: number;
  probabilities?: Record<string, number>;
}

export type Answer = NoulAnswer | ChoiceAnswer | ScoreAnswer;

export interface DecisionRequest {
  state: unknown;
  questions: Record<string, Question>;
  /**
   * Keyword-based guesses per question id, computed locally by the rules.
   * Only the demo provider uses them; they are never sent over the wire.
   */
  hints?: Record<string, number | string>;
}

export interface DecisionResult {
  answers: Record<string, Answer>;
  model: string;
  inputTokens: number;
  costUsd: number;
}

export interface DecisionProvider {
  readonly name: string;
  readonly mode: 'jev' | 'demo';
  readonly model: string;
  decide(req: DecisionRequest, signal?: AbortSignal): Promise<DecisionResult>;
}
