// Audit7 pricing regressions and false-negative guards.
import { describe, expect, it } from 'vitest';
import { strikePrice, unitPrice } from '../src/rules/pricing.js';
import { product } from './helpers.js';

describe('declared net contents on the product page', () => {
  const cosmetic = product({ title: 'Lip Oil', variants: [{ title: '', price: 28, compareAtPrice: null }] });
  const check = (productText: string, p = cosmetic) => unitPrice.verifyOnPage!({
    html: '', text: `28,00 € ${productText}`, productText, rendered: true,
  }, p);

  it.each(['Inhalt: 8,5 ml', 'Inhalt: 6,5 g', 'Nettofüllmenge: 5 g'])('accepts a small net quantity: %s', (text) => {
    expect(check(text)).toBe(false);
  });

  it.each(['Inhalt: 10 g', 'Inhalt: 10 ml', 'Inhalt: 3 x 5 g', 'Inhalt: 5 g + 20 g', 'Inhalt: 0 g', 'Pro Anwendung 2 g', 'Inhaltsstoffe: 5 g Öl'])('keeps the check for %s', (text) => {
    expect(check(text)).toBe(true);
  });

  it('does not borrow a small quantity from recommendations outside the product scope', () => {
    expect(unitPrice.verifyOnPage!({ html: '', text: '28,00 € Dazu passt: Inhalt: 5 g', productText: 'Lip Oil', rendered: true }, cosmetic)).toBe(true);
  });

  it('does not exempt a larger variant or multipack because a small size is mentioned', () => {
    expect(check('Inhalt: 5 g. Inhalt: 20 g')).toBe(true);
    expect(check('Inhalt: 5 g', product({ ...cosmetic, title: '3 x 5 g Lip Oil' }))).toBe(true);
    expect(check('Inhalt: 5 g', product({ ...cosmetic, title: '3er Pack Lip Oil' }))).toBe(true);
  });

  it('preserves the check when a multipack is offered only as a variant', () => {
    expect(check('Inhalt: 5 g', product({ ...cosmetic, variants: [
      { title: 'Einzelpack', price: 28, compareAtPrice: null },
      { title: '3er Pack', price: 70, compareAtPrice: null },
    ] }))).toBe(true);
  });
});

describe('multipack sums and named set discounts', () => {
  const reduced = (title: string, price: number, compareAtPrice: number) => product({ title, variants: [{ title: '', price, compareAtPrice }] });

  it('accepts a pack count with a single price ending in ,90', () => {
    expect(strikePrice.prepare(reduced('3er Pack Slips', 107.76, 134.7))).toBeNull();
  });

  it('reads the count in "Multipack: 3x Seamless Slip"', () => {
    expect(strikePrice.prepare(reduced('Multipack: 3x Seamless Slip', 107.76, 134.7))).toBeNull();
  });

  it('preserves nested item counts used by existing packs (audit1 P096)', () => {
    expect(strikePrice.prepare(reduced('7x3 Nut Butter Balls Erdnuss', 17.95, 19.95))).toBeNull();
  });

  it.each([
    ['3er Pack Slips', 79.9, 120],
    ['Multipack: 3x Seamless Slip', 79.9, 134.71],
    ['Teppich 3x 90 cm', 79.9, 134.7],
    ['Slip', 29.9, 39.9],
    // The broad ,90 extension lost this labelled finding in audit3 (P178).
    ['Bio Kultur-Kraut Probiermix (3 x 330g)', 19.7, 23.7],
  ])('keeps ordinary reductions: %s', (title, price, compareAt) => {
    expect(strikePrice.prepare(reduced(title, price, compareAt))).not.toBeNull();
  });

  it('recognises "-15% im Set" as the named set discount', () => {
    const p = reduced('-15% im Set: Mascara & Kajal Duo', 37, 44);
    expect(strikePrice.verifyOnPage!({ html: '', text: `${p.title} 37,00 € 44,00 €`, rendered: true }, p)).toBe(false);
  });

  // Variant sets and flexible set-saving phrasings.

  it('recognises German shop phrasing: "sparst dabei sogar 15 % auf alle enthaltenen Produkte"', () => {
    const p = reduced('Knochenliebe-Set', 62.03, 72.97);
    expect(strikePrice.verifyOnPage!({ html: '', text: `${p.title} 62,03 € 72,97 € und sparst dabei sogar 15 % auf alle enthaltenen Produkte`, rendered: true }, p)).toBe(false);
  });

  it('recognises German shop phrasing: "sparst ganz nebenbei stolze 15 % aufs gesamte Set"', () => {
    const p = reduced('Wohlfühlbauch-Set', 65.43, 76.97);
    expect(strikePrice.verifyOnPage!({ html: '', text: `${p.title} 65,43 € 76,97 € und sparst ganz nebenbei stolze 15 % aufs gesamte Set`, rendered: true }, p)).toBe(false);
  });

  it('recognises sets designated in variant titles with set discount on page', () => {
    const p = product({
      title: 'Eco Vibe 3 ProSense',
      variants: [
        { title: 'Set S', price: 89.99, compareAtPrice: 89.99 },
        { title: 'Set M', price: 99.99, compareAtPrice: 104.94 },
      ],
    });
    expect(strikePrice.verifyOnPage!({ html: '', text: 'Eco Vibe 3 ProSense 99,99 € 104,94 € Set-Vorteil', rendered: true }, p)).toBe(false);
  });

  it('does not borrow a named set discount from a distant cross-sell on a single product', () => {
    const p = reduced('Mascara', 37, 44);
    expect(strikePrice.verifyOnPage!({ html: '', text: '37,00 € 44,00 € ' + 'Beschreibung. '.repeat(30) + '-15% im Set', rendered: true }, p)).toBe(true);
  });
});

