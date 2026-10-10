// Shelf-life reduction reasons must be assessed in context.
import { describe, expect, it } from 'vitest';
import { strikePrice } from '../src/rules/pricing.js';
import { Answers } from '../src/rules/types.js';
import { productState, runScan } from '../src/scan/engine.js';
import { FakeProvider, product } from './helpers.js';

const reduced = (text: string) => product({ title: 'Bio Fruchtriegel', text,
  url: 'https://shop.test/riegel', variants: [{ title: '', price: 7.99, compareAtPrice: 10.99 }] });

describe('shelf-life reason assessment', () => {
  it('does not silently excuse a bare MHD date at the beginning of the description', () => {
    const prep = strikePrice.prepare(reduced('Mindesthaltbarkeitsdatum: 01.10.2026. Wegen Überbestand reduziert.'));
    expect(prep?.questions).toHaveProperty('shelf_life_reduction');
  });

  // The exact shop24 wording ("weil mein Mindesthaltbarkeitsdatum abgelaufen ist") is now
  // settled without the model (§ 11 Abs. 4 Nr. 2 PAngV, stated reason); a looser late wording still has to reach Jev as context.
  it('carries the late reason even when the normal description is clipped', () => {
    const p = reduced('Zutaten und Produktbeschreibung. '.repeat(300) +
      'Den Preis haben wir gesenkt, denn das Mindesthaltbarkeitsdatum ist bald erreicht. Mindesthaltbarkeitsdatum: 31.10.26.');
    const prep = strikePrice.prepare(p)!;
    const state = { ...productState(p, prep.evidence), ...prep.context };
    expect(state.beschreibung).not.toContain('Den Preis haben wir gesenkt');
    expect(JSON.stringify(prep.context)).toContain('Den Preis haben wir gesenkt, denn das Mindesthaltbarkeitsdatum ist bald erreicht');
    expect(prep.questions).toHaveProperty('shelf_life_reduction');
  });

  it('settles the stated statutory reason without the model', () => {
    const p = reduced('Zutaten und Produktbeschreibung. '.repeat(300) + 'Ich bin gerettet, weil mein Mindesthaltbarkeitsdatum abgelaufen ist.');
    expect(strikePrice.prepare(p)).toBeNull();
  });

  it.each([0, 0.5, 0.89])('keeps a review candidate when the reason is not established (%s)', (score) => {
    expect(strikePrice.judge(new Answers({ shelf_life_reduction: { type: 'noul', noul: score } }), reduced('MHD 01.10.2026'))).toBe(1);
  });

  it('drops a candidate only when the contextual reason is confidently established', () => {
    expect(strikePrice.judge(new Answers({ shelf_life_reduction: { type: 'noul', noul: 0.95 } }), reduced('Wegen kurzer Haltbarkeit reduziert.'))).toBe(0);
  });

  it('adds no model question to an ordinary strike price', () => {
    expect(strikePrice.prepare(reduced('Bio Fruchtriegel mit Hafer.'))?.questions).toEqual({});
    expect(strikePrice.judge(new Answers({}), reduced('Bio Fruchtriegel mit Hafer.'))).toBe(1);
  });

  it('assesses even an explicit short-MHD title instead of bypassing conflicting evidence', () => {
    const p = product({ ...reduced('Nicht wegen der Haltbarkeit reduziert, sondern wegen Überbestand.'), title: 'Riegel mit kurzem MHD' });
    expect(strikePrice.prepare(p)?.questions).toHaveProperty('shelf_life_reduction');
  });

  it('does not let a date next to the price override a different stated reduction reason', () => {
    const p = reduced('Wegen Überbestand reduziert. MHD: 01.10.2026.');
    expect(strikePrice.verifyOnPage!({ html: '', text: '7,99 € statt 10,99 € MHD: 01.10.2026', rendered: true }, p)).toBe(true);
  });

  it('never dismisses on truncated evidence even if the model is confident', () => {
    const text = Array.from({ length: 8 }, (_, i) => `Abschnitt ${i}: MHD Ware. ${'Weitere Details. '.repeat(80)}`).join('\n');
    const p = reduced(text);
    const prep = strikePrice.prepare(p)!;
    expect(JSON.stringify(prep.context)).toContain('"vollständig":false');
    expect(strikePrice.judge(new Answers({ shelf_life_reduction: { type: 'noul', noul: 0.99 } }), p)).toBe(1);
  });

  it('records uncertain shelf-life explanations in a retained review finding', async () => {
    const report = await runScan('mhd-uncertain', {
      origin: 'https://shop.test', platform: 'shopify', products: [reduced('MHD: 01.10.2026. Sonderangebot.')],
      pages: [], homeLinks: [], truncated: false, unreachable: [],
    }, {
      provider: new FakeProvider({ shelf_life_reduction: 0.5 }), riskThreshold: 0.7, reviewThreshold: 0.4,
      concurrency: 1, productRules: [strikePrice], shopRules: [], trace: true,
      loadPage: async () => ({ html: '', text: 'Bio Fruchtriegel 7,99 € statt 10,99 €' }),
    });
    expect(report.findings).toHaveLength(1);
    expect(report.findings[0]?.level).toBe('pruefen');
    expect(report.findings[0]?.note).toMatch(/Haltbarkeit.*Reduktionsgrund/i);
  });

  // Title-level clearance phrases provide product context to angebot
  it('carries product title in angebot context and gives positive demo hint for explicit clearance titles', () => {
    const p = product({ title: 'Surprise Porridge Portionsbecher mit kurzem MHD', text: 'Rette unseren Porridge.',
      variants: [{ title: '', price: 1.93, compareAtPrice: 3.87 }] });
    const prep = strikePrice.prepare(p)!;
    expect(prep.questions).toHaveProperty('shelf_life_reduction');
    expect(prep.hints.shelf_life_reduction).toBe(0.95);
    const ctx = prep.context?.haltbarkeit_und_reduktionsgrund as { angebot?: { produkt?: string } } | undefined;
    expect(ctx?.angebot?.produkt).toBe('Surprise Porridge Portionsbecher mit kurzem MHD');
  });
});
