// Jev does not answer an identical request identically (one product's
// health score 0.549 on one run, 0.588 on the next), and every finding near a threshold flips with that noise. Asking n times and
// averaging the probabilities narrows it; Jev is cheap enough (about $0.04 per shop and pass) for n = 3.

import type { Answer, DecisionProvider, DecisionRequest, DecisionResult } from './types.js';

export class AveragingProvider implements DecisionProvider {
  readonly mode: DecisionProvider['mode'];
  readonly name: string;
  readonly model: string;

  constructor(
    private readonly inner: DecisionProvider,
    readonly n: number,
  ) {
    this.mode = inner.mode;
    this.name = `${inner.name} (Mittel aus ${n})`;
    this.model = inner.model;
  }

  async decide(req: DecisionRequest, signal?: AbortSignal): Promise<DecisionResult> {
    const runs = await Promise.all(Array.from({ length: this.n }, () => this.inner.decide(req, signal)));
    const answers: Record<string, Answer> = {};
    for (const id of Object.keys(req.questions)) answers[id] = average(runs.map((r) => r.answers[id]!));
    return {
      answers,
      model: runs[0]!.model,
      inputTokens: runs.reduce((n, r) => n + r.inputTokens, 0),
      costUsd: runs.reduce((n, r) => n + r.costUsd, 0),
    };
  }
}

/** The mean of several answers to one question: probabilities averaged; a choice is the option with the highest mean. */
export function average(all: Answer[]): Answer {
  const first = all[0]!;
  if (first.type === 'noul') return { type: 'noul', noul: mean(all.map((a) => (a as typeof first).noul)) };
  if (first.type === 'score') {
    const scores = all as (typeof first)[];
    return { type: 'score', score: mean(scores.map((a) => a.score)), ...(scores.every((a) => a.probabilities) ? { probabilities: meanOf(scores.map((a) => a.probabilities!)) } : {}) };
  }
  const choices = all as Extract<Answer, { type: 'choice' }>[];
  // Without probabilities, each answer is one vote.
  const probabilities = meanOf(choices.map((a) => a.probabilities ?? { [a.choice]: 1 }));
  const choice = Object.entries(probabilities).sort((x, y) => y[1] - x[1])[0]![0];
  return { type: 'choice', choice, probabilities };
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

function meanOf(all: Record<string, number>[]): Record<string, number> {
  const keys = new Set(all.flatMap((p) => Object.keys(p)));
  return Object.fromEntries([...keys].map((k) => [k, mean(all.map((p) => p[k] ?? 0))]));
}
