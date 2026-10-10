// Averaging repeated Jev answers.
import { describe, expect, it } from 'vitest';
import { AveragingProvider, average } from '../src/decisions/averaging.js';
import type { DecisionProvider, DecisionRequest, DecisionResult } from '../src/decisions/types.js';

describe('averaging answers', () => {
  it('takes the mean probability of a yes/no answer', () => {
    expect(average([{ type: 'noul', noul: 0.5 }, { type: 'noul', noul: 0.6 }, { type: 'noul', noul: 0.7 }])).toEqual({ type: 'noul', noul: expect.closeTo(0.6, 10) });
  });

  it('picks the choice with the highest mean probability, or the most votes', () => {
    const withP = average([
      { type: 'choice', choice: 'food', probabilities: { food: 0.6, other: 0.4 } },
      { type: 'choice', choice: 'other', probabilities: { food: 0.45, other: 0.55 } },
      { type: 'choice', choice: 'food', probabilities: { food: 0.7, other: 0.3 } },
    ]);
    expect(withP).toMatchObject({ choice: 'food' });
    expect(average([{ type: 'choice', choice: 'a' }, { type: 'choice', choice: 'b' }, { type: 'choice', choice: 'b' }])).toMatchObject({ choice: 'b' });
  });

  it('asks the model n times and adds up the cost', async () => {
    let calls = 0;
    const inner: DecisionProvider = {
      name: 'fake',
      mode: 'jev',
      model: 'm',
      async decide(req: DecisionRequest): Promise<DecisionResult> {
        calls++;
        return { answers: { q: { type: 'noul', noul: calls / 10 } }, model: 'm', inputTokens: 100, costUsd: 0.001 };
      },
    };
    const result = await new AveragingProvider(inner, 3).decide({ state: {}, questions: { q: { type: 'noul', instructions: 'x' } } });
    expect(calls).toBe(3);
    expect(result.answers.q).toEqual({ type: 'noul', noul: expect.closeTo(0.2, 10) });
    expect(result.costUsd).toBeCloseTo(0.003);
    expect(result.inputTokens).toBe(300);
  });
});
