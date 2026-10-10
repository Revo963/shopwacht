// Supply packs („Jahresvorrat“, „Halbjahresvorrat“) name no count; their crossed-out
// price is n × the current single price (a multipack saving, no strike-price issue). Real titles and prices:
// shop5.de products.json, audit 16 P041, P048, P063, P090, P096 (labelled no issue; the scanner flagged all five).
import { describe, expect, it } from 'vitest';
import { buildCatalogue, multipackFromCatalogue } from '../src/rules/catalogue.js';
import { product } from './helpers.js';

const item = (id: string, title: string, price: number) => ({ id, title, variants: [{ title: 'Default Title', price }] });
const offer = (id: string, title: string, price: number, compareAtPrice: number) =>
  product({ id, title, variants: [{ title: 'Default Title', price, compareAtPrice }] });

const catalogue = buildCatalogue([
  item('1', 'Shop5 Zahnputztabletten Strawberry ohne Fluorid 125 Stk', 7.95),
  item('2', 'Shop5 Zahnputztabletten Strawberry mit Fluorid 125 Stk', 7.95),
  item('3', 'Shop5 Zahnputztabletten Mint mit Fluorid 125 Stk', 7.95),
  item('4', 'Die Grünen Shop5 Probiertüte Mint mit Fluorid', 1),
  item('5', 'Shop5 Strawberry ohne Fluorid Jahresvorrat', 35.5),
  item('6', 'Shop5 Mint mit Fluorid Halbjahresvorrat', 19.9),
]);

describe('supply packs against the shop catalogue', () => {
  it('a yearly supply at 6 × the single pack and a half-year supply at 3 × are multipacks', () => {
    const year = offer('5', 'Shop5 Strawberry ohne Fluorid Jahresvorrat', 35.5, 47.7);
    const half = offer('6', 'Shop5 Mint mit Fluorid Halbjahresvorrat', 19.9, 23.85);
    expect(multipackFromCatalogue(year, year.variants[0]!, catalogue)).toBe(true);
    expect(multipackFromCatalogue(half, half.variants[0]!, catalogue)).toBe(true);
  });

  it('says nothing when the crossed-out price is no multiple of a matching single price', () => {
    const odd = offer('7', 'Shop5 Strawberry ohne Fluorid Jahresvorrat', 35.5, 49.9);
    expect(multipackFromCatalogue(odd, odd.variants[0]!, catalogue)).toBeNull();
  });

  it('does not match a single of another variant („mit“ against „ohne Fluorid“ at another price)', () => {
    const cat = buildCatalogue([item('2', 'Shop5 Zahnputztabletten Strawberry mit Fluorid 125 Stk', 7.95)]);
    const year = offer('5', 'Shop5 Strawberry ohne Fluorid Jahresvorrat', 35.5, 47.7);
    expect(multipackFromCatalogue(year, year.variants[0]!, cat)).toBeNull();
  });
});
