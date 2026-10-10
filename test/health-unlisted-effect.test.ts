// Promises no authorised claim covers (satiety, easy digestion, an energy kick,
// relaxation from plants, detox, weight loss, "gesund") are asked about directly. Thirteen labelled claims in the nine samples
// reached Jev but stayed under the threshold, because the "is EVERY statement covered" question also saw authorised claims.
import { describe, expect, it } from 'vitest';
import { Answers } from '../src/rules/types.js';
import { healthClaim } from '../src/rules/claims.js';
import { product } from './helpers.js';

const judge = (a: Record<string, number | string>) =>
  healthClaim.judge(
    new Answers(Object.fromEntries(Object.entries(a).map(([k, v]) => [k, typeof v === 'string' ? { type: 'choice', choice: v } : { type: 'noul', noul: v }]))),
    product({ title: 'x' }),
  );

describe('unlisted health effects', () => {
  it('are asked about with the other health questions', () => {
    const prep = healthClaim.prepare(product({ title: 'Protein Porridge', text: 'Macht lange satt und unterstützt dich beim Abnehmen.' }))!;
    expect(Object.keys(prep.questions)).toContain('health_unlisted_effect');
  });

  it('lift a food that promises one to review level, never to "Risiko" on their own', () => {
    const score = judge({ product_category: 'food', health_effect: 0.98, health_authorized_wording: 0.6, health_unlisted_effect: 0.95 });
    expect(score).toBeGreaterThanOrEqual(0.55);
    expect(score).toBeLessThan(0.8);
  });

  it('leave the existing decision as it was when no such promise is made', () => {
    expect(judge({ product_category: 'food', health_effect: 0.98, health_authorized_wording: 0.1, health_unlisted_effect: 0.1 })).toBeCloseTo(0.882);
    expect(judge({ product_category: 'food', health_effect: 0.98, health_authorized_wording: 0.6, health_unlisted_effect: 0.2 })).toBeCloseTo(0.392);
  });

  it('count only when Jev is fairly sure (from 0.75)', () => {
    expect(judge({ product_category: 'food', health_effect: 0.98, health_authorized_wording: 0.6, health_unlisted_effect: 0.7 })).toBeCloseTo(0.392);
    expect(judge({ product_category: 'food', health_effect: 0.98, health_authorized_wording: 0.6, health_unlisted_effect: 0.76 })).toBeCloseTo(0.76);
  });

  it('do not apply to anything but food', () => {
    expect(judge({ product_category: 'cosmetic', health_effect: 0.98, health_authorized_wording: 0.1, health_unlisted_effect: 0.95 })).toBe(0);
  });
});
