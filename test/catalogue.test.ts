// A multipack's crossed-out price checked against the shop's current single price
// ("only if the strike price equals n × the *current* single price"). Cases from the recorded audits.
import { describe, expect, it } from 'vitest';
import { buildCatalogue, multipackFromCatalogue, packName } from '../src/rules/catalogue.js';
import { strikePrice } from '../src/rules/pricing.js';
import { product } from './helpers.js';

const item = (id: string, title: string, ...prices: [string, number][]) => ({ id, title, variants: prices.map(([t, price]) => ({ title: t, price })) });

describe('pack names', () => {
  it.each([
    ['Magic Brew (2 x 370g)', 'magic brew', [2]],
    ['Clear Mind (4x)', 'clear mind', [4]],
    ['3 x Peanut Rockies (je 150g)', 'peanut rockies', [3]],
    ['Ultimatives Recharge Set 4+1', 'ultimatives recharge set', [5]],
    ['Doppelpack BODYLAB Whey Protein Kalender (24x30g)', 'bodylab whey protein kalender', [2, 24]],
  ])('%s', (title, name, counts) => {
    const n = packName(title);
    expect(n.name).toBe(name);
    expect(n.counts).toEqual(counts);
  });
});

describe('multipacks against the catalogue', () => {
  const cat = buildCatalogue([
    item('1', 'Magic Brew', ['75g', 12.9], ['370g', 34.9], ['2x 370g', 62.8]),
    item('2', 'Clear Mind', ['', 18.9]),
    item('3', 'Peanut Rockies', ['', 2.49]),
    item('4', 'Coconut Bowl', ['', 7.45]),
  ]);
  const offer = (id: string, title: string, price: number, compareAtPrice: number, variant = '') =>
    product({ id, title, variants: [{ title: variant, price, compareAtPrice }] });

  it('2 × the current single price is a multipack saving (shop14 Magic Brew)', () => {
    const p = offer('10', 'Magic Brew (2 x 370g)', 52.35, 69.8);
    expect(multipackFromCatalogue(p, p.variants[0]!, cat)).toBe(true);
  });

  it('4 × the current single price (shop14 Clear Mind)', () => {
    const p = offer('11', 'Clear Mind (4x)', 56.7, 75.6);
    expect(multipackFromCatalogue(p, p.variants[0]!, cat)).toBe(true);
  });

  it('an old single price is no multipack saving (shop23 Peanut Rockies)', () => {
    const p = offer('12', '3 x Peanut Rockies (je 150g)', 7.47, 11.97);
    expect(multipackFromCatalogue(p, p.variants[0]!, cat)).toBe(false);
  });

  it('a set of different goods is not the single product (shop7 Coconut Bowl + 2 Löffel)', () => {
    const p = offer('13', 'Coconut Bowl + 2 Löffel', 13.99, 14.9);
    expect(multipackFromCatalogue(p, p.variants[0]!, cat)).toBeNull();
  });

  it('a variant "2x 500ml" at twice the "500ml" variant, without a catalogue (shop14 Oxymel Zyklus)', () => {
    const p = product({ id: '14', title: 'Oxymel Zyklus', variants: [
      { title: '150ml', price: 14.5, compareAtPrice: null },
      { title: '500ml', price: 32.5, compareAtPrice: null },
      { title: '2x 500ml', price: 58.5, compareAtPrice: 65 },
    ] });
    expect(multipackFromCatalogue(p, p.variants[2]!, undefined)).toBe(true);
  });
});

describe('the strike-price rule with a catalogue', () => {
  it('drops a verified multipack and keeps a pack priced against an old single price', () => {
    const cat = buildCatalogue([item('1', 'Magic Brew', ['370g', 34.9]), item('3', 'Peanut Rockies', ['', 2.49])]);
    const brew = product({ id: '10', title: 'Magic Brew (2 x 370g)', variants: [{ title: '', price: 52.35, compareAtPrice: 69.8 }] });
    const rockies = product({ id: '12', title: '3 x Peanut Rockies (je 150g)', variants: [{ title: '', price: 7.47, compareAtPrice: 11.97 }] });
    expect(strikePrice.prepare(brew, { catalogue: cat })).toBeNull();
    expect(strikePrice.prepare(rockies, { catalogue: cat })).not.toBeNull();
  });
});
