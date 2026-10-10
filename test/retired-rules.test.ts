// The guarantee rule found 0 real cases in nine labelled samples (7 false alarms, 4 at
// "Risiko", 7 unclear) – money-back banners the labels never counted. It no longer runs; old reports still show their findings.
import { describe, expect, it } from 'vitest';
import { ALL_RULES, PRODUCT_RULES, ruleById } from '../src/rules/index.js';

describe('retired rules', () => {
  it('the guarantee rule no longer runs, but old reports can still name it', () => {
    expect(PRODUCT_RULES.map((r) => r.id)).not.toContain('guarantee-terms');
    expect(ALL_RULES.map((r) => r.id)).not.toContain('guarantee-terms');
    expect(ruleById('guarantee-terms')?.title).toBe('Garantie ohne Garantiebedingungen');
  });
});
