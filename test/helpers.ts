import type { Answer, DecisionProvider, DecisionRequest, DecisionResult } from '../src/decisions/types.js';
import type { Product } from '../src/types.js';
import { unitPrice } from '../src/rules/pricing.js';
import { Answers } from '../src/rules/types.js';

export function product(partial: Partial<Product> & { title: string }): Product {
  return { id: partial.title, tags: [], text: '', variants: [], ...partial };
}

/**
 * Sets are no longer skipped by the Grundpreis rule; Jev says whether they hold one
 * kind of goods. The score for a set of consumables that Jev calls one kind with probability `oneKind`.
 */
export function setScore(p: Product, oneKind: number): number {
  const prep = unitPrice.prepare(p);
  if (!prep) return 0;
  if (!('set_of_one_kind' in prep.questions)) throw new Error(`${p.title}: no set question`);
  return unitPrice.judge(new Answers({ consumable_by_quantity: { type: 'noul', noul: 0.9 }, set_of_one_kind: { type: 'noul', noul: oneKind } }), p);
}

/** Answers every question from a fixed table; records the requests it saw. */
export class FakeProvider implements DecisionProvider {
  readonly name = 'fake';
  readonly mode = 'jev' as const;
  readonly model = 'fake-jev';
  readonly requests: DecisionRequest[] = [];

  constructor(private readonly table: Record<string, number | string> = {}, private readonly fail?: (req: DecisionRequest) => Error | undefined) {}

  async decide(req: DecisionRequest): Promise<DecisionResult> {
    this.requests.push(req);
    const err = this.fail?.(req);
    if (err) throw err;
    const answers: Record<string, Answer> = {};
    for (const [id, q] of Object.entries(req.questions)) {
      const v = this.table[id];
      answers[id] =
        q.type === 'choice'
          ? { type: 'choice', choice: typeof v === 'string' ? v : Object.keys(q.criteria)[0]! }
          : q.type === 'noul'
            ? { type: 'noul', noul: typeof v === 'number' ? v : 0 }
            : { type: 'score', score: typeof v === 'number' ? v : 0 };
    }
    return { answers, model: this.model, inputTokens: 100, costUsd: 0.0000042 };
  }
}
