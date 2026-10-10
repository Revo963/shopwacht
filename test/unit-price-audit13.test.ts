// Grundpreis cases from the thirteenth audit (shop31, shop52).
import { describe, expect, it } from 'vitest';
import { pageShowsUnitPrice, unitPrice } from '../src/rules/pricing.js';
import { product } from './helpers.js';

const asks = (title: string, text = '', category?: string) =>
  unitPrice.prepare(product({ title, text, ...(category ? { category } : {}), variants: [{ title: 'Standard', price: 20.9, compareAtPrice: null }] })) !== null;

describe('Grundpreis for supplements without a quantity in the feed', () => {
  it('reads a milligram figure as a dosage, not as a tiny pack', () => {
    expect(asks('Astaxanthin 12 mg', 'Rein pflanzlich aus Blutregen-Mikroalgen.')).toBe(true);
  });

  it.each([
    ['Melatonin Spray', 'Hochkonzentriertes Spray mit reinem Melatonin.'],
    ["Lion's Mane", 'In einfach einzunehmenden Tabletten verbindet Lion\'s Mane den Pilz mit B-Vitaminen.'],
    ['Multi Magnesium', 'Magnesium mit optimaler Bioverfügbarkeit.'],
  ])('asks about "%s"', (title, text) => {
    expect(asks(title, text)).toBe(true);
  });

  it('does not count an empty "(€/kg*)" field as a Grundpreis', () => {
    expect(pageShowsUnitPrice('Gelenk-Komplex 19,90 € /Stück … Schlafkomplex 19,90 € (€/kg*) 4.86/5', [19.9])).toBe(false);
    expect(pageShowsUnitPrice('Kaffee 19,90 € €/kg 39,80', [19.9])).toBe(true);
  });
});

describe('skincare routines are sets', () => {
  it('asks whether a routine holds one kind of goods', () => {
    const prep = unitPrice.prepare(product({ title: 'The Base Routine', text: 'Reinigungsgel, Serum und Sonnenschutzcreme.', variants: [{ title: 'Standard', price: 58.5, compareAtPrice: 65 }] }))!;
    expect(Object.keys(prep.questions)).toContain('set_of_one_kind');
  });
});

// Strike prices and disease words from the thirteenth audit.
import { strikePrice } from '../src/rules/pricing.js';
import { healthDisease } from '../src/rules/claims.js';

describe('strike prices, audit 13', () => {
  it('does not read fabric layers ("Lage 2 + 3") as a 2+3 multipack', () => {
    const panty = product({ title: 'Period Panty - LENE Hipster - Super Strong', text: 'Material:\nLage 1 (innerste): 95% Baumwolle\nLage 2 + 3: 88% Polyester, 12% Polyamid', variants: [{ title: 'S', price: 35.06, compareAtPrice: 38.95 }] });
    expect(strikePrice.prepare(panty)).not.toBeNull();
  });

  it('treats "+ Geschenk" as a free-gift value comparison', () => {
    const toner = product({ title: 'Pore Refining Toner + Geschenk', text: 'Gratis Geschenk: Unser Cleanser in Reisegröße.', variants: [{ title: 'Default Title', price: 28, compareAtPrice: 38 }] });
    expect(strikePrice.prepare(toner)).toBeNull();
  });
});

describe('disease words, audit 13', () => {
  it('asks Jev about menstrual symptoms', () => {
    expect(healthDisease.prepare(product({ title: 'Balance Elixier', text: 'Pflanzenstoffe, die bei Menstruationssymptomen helfen.' }))).not.toBeNull();
  });
});
