// § 11 Abs. 4 Nr. 2 PAngV – a reduction is exempt from the 30-day rule only if the price
// is reduced because of impending spoilage or expiry and this is made recognisable. The stated reason decides, not the date.
// Texts from shop24.de (audit 7).
import { describe, expect, it } from 'vitest';
import { strikePrice } from '../src/rules/pricing.js';
import { product } from './helpers.js';

const rescued = (title: string, reason: string, price: number, compareAtPrice: number) =>
  product({ title, text: `Füllmenge: 50 g\nIch bin gerettet, weil ${reason}\nMindesthaltbarkeitsdatum: 06.10.2026`, variants: [{ title: '', price, compareAtPrice }] });

describe('the stated reason for a food-rescue markdown', () => {
  it('"nicht genug Restlaufzeit" is the statute\'s case: no finding (Mogyi, P027)', () => {
    expect(strikePrice.prepare(rescued('Mogyi Sonnenblumenkerne Geröstet & Gesalzen, 50g', 'ich nicht genug Restlaufzeit habe', 0.8, 0.9))).toBeNull();
  });

  it('"Restlaufzeit … oder MHD abgelaufen" too (Kinder Riegel, P091)', () => {
    expect(strikePrice.prepare(rescued('Kinder Riegel, 21g', 'ich nicht genug Restlaufzeit habe oder weil mein Mindesthaltbarkeitsdatum abgelaufen ist', 0.49, 0.6))).toBeNull();
  });

  it('overstock is not: the finding stays (Shop41 Flapjack, P015)', () => {
    expect(strikePrice.prepare(rescued('Shop41 Cranberry Cocoa Flapjack - Bio, 60g', 'es von mir aus Versehen zu viele gibt', 0.99, 1.89))).not.toBeNull();
  });
});
