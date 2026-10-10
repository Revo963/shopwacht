// Fixes from the second fresh error-rate audit on five new shops.
import { describe, expect, it } from 'vitest';
import { healthClaim } from '../src/rules/claims.js';
import { pageShowsUnitPrice, strikePrice } from '../src/rules/pricing.js';
import { product } from './helpers.js';

describe('set discounts elsewhere on the page', () => {
  const capsules = product({ title: 'Haar Forte Gold PRO MAN, 60 Kapseln', url: 'https://shop.test/p', variants: [{ title: 'Standard', price: 23.9, compareAtPrice: 29.9 }] });

  it('keeps a single product’s reduction when a cross-sell widget offers a "Paketrabatt"', () => {
    const page = {
      html: '',
      text: 'Haar Forte Gold PRO MAN, 60 Kapseln 29,90€ 23,90€ Effektiv für Männer Kaufoptionen Einmalige Lieferung 29,90€ 23,90€ Monatsabo SPARE 10,00€ 29,90€ 19,90€ Zum Warenkorb hinzufügen Produktbeschreibung Inhaltsstoffe Einnahmeempfehlung Häufig zusammen gekauft Sichere dir deine Favoriten mit 10% Rabatt Jetzt zum Sonderpreis kaufen 95,94€ 129,60€ (10% Paketrabatt beim Bezahlvorgang)',
      rendered: true,
    };
    expect(strikePrice.verifyOnPage!(page, capsules)).toBe(true);
  });

  it('still drops it when the set discount sits next to the product’s own price', () => {
    const page = { html: '', text: 'Haar Forte Gold PRO MAN 29,90 € 23,90 € – 20 % Mengenrabatt im Warenkorb', rendered: true };
    expect(strikePrice.verifyOnPage!(page, capsules)).toBe(false);
  });
});

describe('unit price written with the currency first', () => {
  it('recognises "€83,06/kg"', () => {
    expect(pageShowsUnitPrice('Zucker-, fett- & laktosefrei €29,90 €83,06/kg, inkl. MwSt. zzgl. Versand.')).toBe(true);
    expect(pageShowsUnitPrice('€2,49 / Portion')).toBe(false);
  });
});

describe('health-claim trigger for sports nutrition', () => {
  it.each([
    'Pump Matrix aus Aminos für idealen Muskelaufbau',
    'Die Pflanzenextrakte sorgen für eine bessere Sauerstoffversorgung',
    'Proteine tragen zu einer längeren Sättigung bei',
    'Electrolyte Complex für verbesserte Hydration',
  ])('asks Jev about "%s"', (text) => {
    expect(healthClaim.prepare!(product({ title: 'Pulver', text }))).not.toBeNull();
  });

  it('treats footnote marks as authorised-claim style in the hint', () => {
    const prep = healthClaim.prepare!(product({ title: 'Vitamin D3 Kapseln', text: 'Support für Knochen, Muskeln & Immunsystem¹²³' }))!;
    expect(prep.hints.health_authorized_wording).toBe(0.6);
  });
});

// Recovered page text goes to classifying rules only.
describe('recovered page text and claim rules', () => {
  it('judges an empty-description bundle as textile from the page, but not its shipping tab as a climate claim', async () => {
    const { runScan } = await import('../src/scan/engine.js');
    const { greenClimate } = await import('../src/rules/claims.js');
    const { textileFibre } = await import('../src/rules/textile.js');
    const { FakeProvider } = await import('./helpers.js');
    const provider = new FakeProvider({ is_textile: 0.95, green_offset: 0.95 });
    const report = await runScan('recovered', {
      origin: 'https://shop.test', platform: 'shopify', pages: [], homeLinks: [], unreachable: [], truncated: false,
      products: [product({ title: 'Good Vibes', text: '', url: 'https://shop.test/products/good-vibes' })],
    }, {
      provider, riskThreshold: 0.7, reviewThreshold: 0.4, concurrency: 1,
      productRules: [greenClimate, textileFibre], shopRules: [],
      loadPage: async () => ({
        html: '', text: '',
        productText: 'Good Vibes · 1x Soft-BH & 3x Brazilian Slips · Versand: Im Rahmen des GoGreen-Services gleicht DHL CO₂e-Emissionen über Klimaschutzprojekte aus.',
      }),
    });
    expect(report.findings.map((f) => f.ruleId)).toEqual(['textile-fibre']);
    expect(provider.requests).toHaveLength(1);
  });
});

// The EU list of permitted claims as reference data for Jev.
describe('EU register of permitted health claims', () => {
  it('finds the authorised claims for the substances a text names, including short forms', async () => {
    const { authorisedClaimsFor } = await import('../src/rules/health-register.js');
    const claims = authorisedClaimsFor('Vitamin D3+K2 Mundspray');
    expect(claims).toContain('Vitamin D trägt zur Erhaltung normaler Knochen bei');
    expect(claims.some((c) => c.startsWith('Vitamin K trägt zu einer normalen Blutgerinnung bei'))).toBe(true);
    expect(authorisedClaimsFor('Melatonin Spray').some((c) => /Einschlafzeit.*1 mg Melatonin/.test(c))).toBe(true);
    expect(authorisedClaimsFor('Gusseisen-Pfanne, Kokoswasser')).toEqual([]);
  });

  it('hands the matching claims to Jev and switches the question to comparing against them', () => {
    const prep = healthClaim.prepare!(product({ title: 'Vitamin C Kapseln', text: 'Unterstützt dein Immunsystem.' }))!;
    expect(prep.context?.zugelassene_eu_angaben).toContain('Vitamin C trägt zu einer normalen Funktion des Immunsystems bei');
    expect(prep.questions.health_authorized_wording!.instructions).toMatch(/zugelassene_eu_angaben/);
    const plain = healthClaim.prepare!(product({ title: 'Snack', text: 'Der gesunde Snack.' }))!;
    expect(plain.context).toBeUndefined();
    expect(plain.questions.health_authorized_wording!.instructions).not.toMatch(/zugelassene_eu_angaben/);
  });
});

// A component's composition alone is not the product's.
describe('partial fibre statements', () => {
  it.each([
    ['Zwickel: 100% Bio-Baumwolle', false],
    ['Der Zwickel besteht aus 100 % Bio-Baumwolle.', false],
    ['Futter: 100% Polyester', false],
    ['Spitze: 90% Polyamid, 10% Elasthan', false],
    ['Zwickel (innen): 100% Baumwolle', false],
    ['Obermaterial: 95% Baumwolle, 5% Elasthan; Zwickel: 100% Baumwolle', true],
    ['Futter und Obermaterial aus 100% Baumwolle', true],
    ['Hose mit Bündchen, 100% Baumwolle', true],
    ['1. Lage (innerste): 95% Bio-Baumwolle, 5% Elasthan, 2. Lage: 80% Polyester, 20% Nylon', true],
  ])('"%s" states the composition: %s', async (text, expected) => {
    const { statesComposition } = await import('../src/rules/textile.js');
    expect(statesComposition(text)).toBe(expected);
  });
});
