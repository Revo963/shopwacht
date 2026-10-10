// The authorised claims for every substance a multi-nutrient text names reach the
// model. With a cap of 80 in register order, a kids' immune bundle on shop16.eu lost all seven vitamin D claims, and the
// second model then wrote that vitamin D had no authorised immune claim.
import { describe, expect, it } from 'vitest';
import { authorisedClaimsFor } from '../src/rules/health-register.js';

const BUNDLE =
  'Abwehr-Kids-Paket mit Vitamin A, Vitamin B6, Vitamin B12, Folsäure, Vitamin C, Zink, Selen, Eisen, Kupfer, Jod, Magnesium, Calcium, Biotin, Niacin, Riboflavin, Thiamin, Pantothensäure und Vitamin D3.';

describe('the authorised claims sent with a product', () => {
  it('include the substances named last in a long list', () => {
    const claims = authorisedClaimsFor(BUNDLE);
    expect(claims.length).toBeGreaterThan(80);
    expect(claims.some((c) => /^Vitamin D trägt zu einer normalen Funktion des Immunsystems/.test(c))).toBe(true);
  });
});
