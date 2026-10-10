// Fixes from the fourth blind audit.
import { describe, expect, it } from 'vitest';
import { healthClaim, healthDisease } from '../src/rules/claims.js';
import { unitPrice } from '../src/rules/pricing.js';
import { product, setScore } from './helpers.js';

describe('health triggers the word boundary used to hide', () => {
  it.each([
    'Coenzym Q10 spielt eine wesentliche Rolle im Energiestoffwechsel',
    'GlyNAC ist ein Mitochondrien-Booster',
  ])('asks Jev about "%s"', (text) => {
    expect(healthClaim.prepare!(product({ title: 'Kapseln', text }))).not.toBeNull();
  });

  it('tells Jev that tags are filter labels, not claims', () => {
    const prep = healthClaim.prepare!(product({ title: 'Kollagen', text: 'Kollagenpulver aus Weidehaltung', tags: ['Haut & Bindegewebe'] }))!;
    expect(prep.questions.health_effect!.instructions).toMatch(/Tags and categories .* not claims/);
  });
});

describe('menopause symptoms as disease claims', () => {
  it.each(['Unterstützt bei Nachtschweiß & Hitzewallungen', 'Salbei hilft bei Hyperhidrose'])('asks Jev about "%s"', (text) => {
    expect(healthDisease.prepare!(product({ title: 'Menobacs', text }))).not.toBeNull();
  });
});

describe('gift and care sets need no single unit price', () => {
  it.each(['Geschenkbox', 'SHOP53 Pflegeset Zahnpasta Deo Duschgel & Lipbalm', 'Unser BODYLAB Adventskalender im gemischten Doppelpack'])('"%s"', (title) => {
    // Asked, not skipped – a set Jev calls mixed goods stays under the threshold.
    expect(setScore(product({ title, text: 'Creme, Shampoo und Protein', variants: [{ title: 'Standard', price: 36.99, compareAtPrice: null }] }), 0.1)).toBeLessThan(0.4);
  });
});

// Second round of fixes from the fourth audit.
describe('grey area: the shop quotes authorised claims itself', () => {
  const corvia = product({
    title: 'CORVIA Herz-Gefäß-Komplex',
    text: 'Vitamin C trägt zu einer normalen Funktion des Immunsystems bei¹ – so unterstützt CORVIA Herz und Gefäße.',
  });

  it('caps that product at "Prüfen" and says why', () => {
    const prep = healthClaim.prepare!(corvia)!;
    expect(prep.maxLevel).toBe('pruefen');
    expect(prep.note).toMatch(/Art\. 10 Abs\. 3 HCVO/);
  });

  it('leaves a claim without authorised wording uncapped', () => {
    expect(healthClaim.prepare!(product({ title: 'Detox Tee', text: 'Entgiftet den Körper und unterstützt beim Abnehmen.' }))!.maxLevel).toBeUndefined();
  });

  it('is applied by the engine for this product only', async () => {
    const { runScan } = await import('../src/scan/engine.js');
    const { FakeProvider } = await import('./helpers.js');
    const provider = new FakeProvider({ product_category: 'food', health_effect: 0.95, health_authorized_wording: 0 });
    const report = await runScan('cap', {
      origin: 'https://shop.test', platform: 'shopify', pages: [], homeLinks: [], unreachable: [], truncated: false,
      products: [corvia, product({ id: 'detox', title: 'Detox Tee', text: 'Entgiftet den Körper und unterstützt beim Abnehmen.' })],
    }, { provider, riskThreshold: 0.7, reviewThreshold: 0.4, concurrency: 1, productRules: [healthClaim], shopRules: [] });
    const levels = Object.fromEntries(report.findings.map((f) => [f.subject.id, f.level]));
    expect(levels).toEqual({ 'CORVIA Herz-Gefäß-Komplex': 'pruefen', detox: 'risiko' });
  });
});

describe('Spanish product texts in a German feed (shop12)', () => {
  it.each([
    'Ayuda contra los sudores nocturnos y los sofocos',
    'ayuda en caso de desequilibrios vaginales',
  ])('asks about the disease claim in "%s"', (text) => {
    expect(healthDisease.prepare!(product({ title: 'Menobacs', text }))).not.toBeNull();
  });
});

describe('a rendered page whose offer block never loaded', () => {
  const brainbacs = product({ title: 'Brainbacs', variants: [{ title: '30 Kapseln', price: 49.95, compareAtPrice: null }] });

  it('does not claim a missing Grundpreis', () => {
    // Still suppress the alert, but preserve the coverage gap.
    expect(unitPrice.verifyOnPage!({ html: '', text: 'Warenkorb · FAQ | Hilfezentrum · Impressum · Datenschutz', rendered: true }, brainbacs)).toBe('unknown');
  });

  it('still reports when the page shows the price but no Grundpreis', () => {
    expect(unitPrice.verifyOnPage!({ html: '', text: 'Brainbacs 30 Kapseln 49,95 € inkl. MwSt. In den Warenkorb', rendered: true }, brainbacs)).toBe(true);
  });

  it('leaves the static page to the browser step', () => {
    expect(unitPrice.verifyOnPage!({ html: '', text: 'Warenkorb', rendered: false }, brainbacs)).toBe(true);
  });
});

describe('Spanish health claims in a German feed (shop12)', () => {
  it.each([
    'bacterias reguladoras del metabolismo de las grasas',
    'para el equilibrio natural en la zona íntima',
  ])('asks about the health claim in "%s"', (text) => {
    expect(healthClaim.prepare!(product({ title: 'Dietbacs', text }))).not.toBeNull();
  });
});
