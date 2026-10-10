// From the eighth audit: a footnote mark is no authorised claim, and a set saving must be named on the page.
import { describe, expect, it } from 'vitest';
import { healthClaim } from '../src/rules/claims.js';
import { strikePrice } from '../src/rules/pricing.js';
import { product } from './helpers.js';

describe('health-claim footnote marks', () => {
  it('does not cap an Ashwagandha claim at "Prüfen" because of an asterisk (shop19, audit 7 P180)', () => {
    const p = product({
      title: 'Ashwagandha Komplex Kapseln',
      text: 'Ashwagandha für innere Ruhe und Entspannung. Mit Folsäure für deine Psyche*, Vitamin B6 für deine Nerven*.',
    });
    expect(healthClaim.prepare(p)!.maxLevel).toBeUndefined();
  });

  it('does not read gender forms or organic marks as footnotes to authorised claims', () => {
    const p = product({ title: 'Magnesium Pulver', text: 'Für alle Kund*innen: Magnesium mit Hafer* für mehr Energie. *aus kontrolliert biologischem Anbau' });
    expect(healthClaim.prepare(p)!.maxLevel).toBeUndefined();
  });

  it('still caps a superscript-footnoted formula claim at "Prüfen" (Art. 10 Abs. 3 HCVO is a judgement call)', () => {
    const p = product({ title: 'Knochen Komplex', text: 'Support für Knochen¹² mit Vitamin D und Calcium.' });
    expect(healthClaim.prepare(p)!.maxLevel).toBe('pruefen');
  });
});

describe('set savings named on the page', () => {
  const set = (title: string, price: number, compareAt: number) =>
    product({ title, variants: [{ title: '', price, compareAtPrice: compareAt }] });

  it('keeps a set reduction when a site-wide banner says "sparen auf alle Produkte"', () => {
    const p = set('Immun-Set', 49.9, 59.9);
    const text = 'Black Week: Jetzt 20 % sparen auf alle Produkte! Immun-Set Normaler Preis 59,90 € Angebotspreis 49,90 € -17%';
    expect(strikePrice.verifyOnPage!({ html: '', text, rendered: true }, p)).toBe(true);
  });

  it('keeps a set reduction with a badge and the generic "Dein Preisvorteil"', () => {
    const p = set('Herz Bundle', 69.9, 84.8);
    const text = 'Herz Bundle 69,90 € 84,80 € -18% Dein Preisvorteil: 14,90 €';
    expect(strikePrice.verifyOnPage!({ html: '', text, rendered: true }, p)).toBe(true);
  });

  it('still excuses a set whose saving is named against the single items', () => {
    const p = set('Knochenliebe-Set', 62.03, 72.97);
    for (const phrase of ['Preisvorteil gegenüber dem Einzelkauf', 'Set-Preisvorteil', 'sparst dabei sogar 15 % auf alle enthaltenen Produkte']) {
      expect(strikePrice.verifyOnPage!({ html: '', text: `Knochenliebe-Set 62,03 € 72,97 € ${phrase}`, rendered: true }, p)).toBe(false);
    }
  });
});
