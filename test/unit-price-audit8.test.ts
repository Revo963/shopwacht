// Grundpreis misses from audit 8 (development data), with recorded texts.
import { describe, expect, it } from 'vitest';
import { pageShowsUnitPrice, unitPrice } from '../src/rules/pricing.js';
import { product, setScore } from './helpers.js';

describe('a per-piece "Grundpreis" is no Grundpreis (audit 8, shop25)', () => {
  const capsules = product({
    title: 'Spermidin Kapseln',
    text: 'Spermidin Kapseln zur Unterstützung normaler zellulärer Erneuerung und Vitalität\nBis zu 6 mg Spermidin + 4,5 mg Zink pro Tagesdosis',
    variants: [{ title: '', price: 39, compareAtPrice: null }],
  });

  it('flags "Grundpreis 0,33 € / pro Stück" for capsules', () => {
    const text = 'Spermidin Kapseln 5 Bewertungen NEU Normaler Preis 39,00 € Grundpreis 0,33 € / pro Stück inkl. MwSt. exkl. Versand 120 Kapseln';
    expect(unitPrice.verifyOnPage!({ html: '', text, rendered: true }, capsules)).toBe(true);
  });

  it('still accepts a Grundpreis per kilogram or litre', () => {
    expect(pageShowsUnitPrice('Normaler Preis 39,00 € Grundpreis 325,00 € / kg inkl. MwSt.', [39])).toBe(true);
    expect(pageShowsUnitPrice('Normaler Preis 39,00 € Grundpreis: 12,50 € pro 100 ml', [39])).toBe(true);
  });
});

describe('consumables without a quantity in the export are checked (audit 8)', () => {
  it('drink cubes filed under a "Microdrink" category (shop13)', () => {
    const p = product({
      title: 'HIMBEERE',
      category: 'Microdrink',
      text: 'Der angenehm süße Geschmack reifer Himbeeren trifft auf frisch-säuerliche Untertöne. So lässt es sich Schluck für Schluck erfrischend mehr trinken.',
      variants: [{ title: '', price: 8.99, compareAtPrice: null }],
    });
    expect(unitPrice.prepare(p)).not.toBeNull();
  });

  it('an electrolyte drink (shop13)', () => {
    const p = product({
      title: 'GRAPEFRUIT RECHARGE',
      category: 'Microlyte',
      text: 'Genieße unser Elektrolytgetränk mit Grapefruitgeschmack und 4 Elektrolyten, 6 Vitaminen und Zink!',
      variants: [{ title: '', price: 10.99, compareAtPrice: null }],
    });
    expect(unitPrice.prepare(p)).not.toBeNull();
  });

  it('fruit gummies and a supplement named only by its daily dose (shop25)', () => {
    const gummies = product({ title: 'Fokus Fruchtgummis', text: '60 Fruchtgummis für bis zu 2 Monate', variants: [{ title: '', price: 39, compareAtPrice: null }] });
    const magnesium = product({ title: 'Magnesium Komplex', text: '428 mg reines Magnesium pro Tagesdosis\nMagnesiumbisglycinat, -citrat & -taurat', variants: [{ title: '', price: 19, compareAtPrice: null }] });
    expect(unitPrice.prepare(gummies)).not.toBeNull();
    expect(unitPrice.prepare(magnesium)).not.toBeNull();
  });

  it('leaves a drinking bottle and a set of different goods alone', () => {
    const bottle = product({ title: 'All-Purpose Thermo Ombre', category: 'Steel Bottle', text: 'Hol dir diese Limited Edition All-Purpose Thermo Bottle mit pinkem Farbverlauf.', variants: [{ title: '', price: 36.9, compareAtPrice: null }] });
    // Was "Kirsche Cola Hydration Set", which holds cubes only and is labelled a
    // Grundpreis issue in audit 8 (P019) – the expectation contradicted the label. A set with a glass bottle is mixed goods.
    const set = product({ title: 'Sauerkirsche Accessoire Set', category: 'Microdrink', text: 'Genieße deine Erfrischung aus einer dazu passenden Glasflasche.', variants: [{ title: '', price: 49.99, compareAtPrice: 59.96 }] });
    expect(unitPrice.prepare(bottle)).toBeNull();
    // The set is asked about; mixed goods stay under the threshold, cubes only (P019) reach the page check.
    expect(setScore(set, 0.1)).toBeLessThan(0.4);
    const cubes = product({ title: 'Kirsche Cola Hydration Set', category: 'Microdrink', text: 'Zwei Sorten Microdrinks.', variants: [{ title: '', price: 18.98, compareAtPrice: null }] });
    expect(setScore(cubes, 0.9)).toBeGreaterThanOrEqual(0.4);
  });
});
