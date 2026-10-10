// Unit-price equals syntax versus shop13's environmental conversion.
import { describe, expect, it } from 'vitest';
import { pageShowsUnitPrice } from '../src/rules/pricing.js';

describe('an equals sign is a unit price only with a currency amount', () => {
  it('rejects shop13 audit-8 P002: “1 kg = 50 Plastikflaschen”', () => {
    expect(pageShowsUnitPrice('1 kg = 50 Plastikflaschen')).toBe(false);
  });

  it('keeps the recorded “1 kg = 19,96 €” offer format', () => {
    expect(pageShowsUnitPrice('Kaffee 500 g 9,98 € (1 kg = 19,96 €) inkl. MwSt.', [9.98])).toBe(true);
  });
});
