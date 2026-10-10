import type { Answer, DecisionProvider, DecisionRequest, DecisionResult } from './types.js';

/**
 * Offline stand-in for Jev. Answers every question from the keyword hints the
 * rules compute. Good enough to click through the product without an API key;
 * it is also the baseline Jev has to beat in `npm run eval`.
 */
export class DemoProvider implements DecisionProvider {
  readonly mode = 'demo' as const;
  readonly name = 'Demo-Modus (Stichwort-Heuristik)';
  readonly model = 'heuristic';

  async decide(req: DecisionRequest): Promise<DecisionResult> {
    const answers: Record<string, Answer> = {};
    for (const [id, q] of Object.entries(req.questions)) {
      const hint = req.hints?.[id];
      if (q.type === 'noul') {
        answers[id] = { type: 'noul', noul: typeof hint === 'number' ? hint : 0.5 };
      } else if (q.type === 'choice') {
        const keys = Object.keys(q.criteria);
        const choice = typeof hint === 'string' && keys.includes(hint) ? hint : (keys.at(-1) ?? '');
        answers[id] = { type: 'choice', choice, confidence: 0.6 };
      } else {
        const level = typeof hint === 'number' ? hint : 0;
        answers[id] = { type: 'score', score: level, confidence: 0.6 };
      }
    }
    return { answers, model: this.model, inputTokens: 0, costUsd: 0 };
  }
}
