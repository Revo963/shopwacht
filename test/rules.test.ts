import { describe, expect, it } from 'vitest';
import { greenClimate, greenGeneric, healthClaim, healthDisease, lawAsBenefit, testClaim } from '../src/rules/claims.js';
import { exemptFromUnitPrice, findQuantities, pageShowsUnitPrice, strikePrice, unitPrice } from '../src/rules/pricing.js';
import { evidence, words } from '../src/rules/text.js';
import { statesComposition, textileFibre } from '../src/rules/textile.js';
import { Answers } from '../src/rules/types.js';
import { product } from './helpers.js';

describe('text helpers', () => {
  it('matches words that start with an umlaut', () => {
    const re = words('ökologisch\\p{L}*');
    expect(re.test('Ein ökologisches Produkt')).toBe(true);
    re.lastIndex = 0;
    expect(re.test('unökologisch')).toBe(false);
  });

  it('quotes the sentence around a hit', () => {
    const text = 'Handgemacht in Berlin. Unsere Seife ist besonders umweltfreundlich verpackt. Jetzt bestellen!';
    expect(evidence(text, words('umweltfreundlich'))).toEqual(['Unsere Seife ist besonders umweltfreundlich verpackt.']);
  });
});

describe('claim rules', () => {
  it('only asks about green claims when a trigger word appears', () => {
    expect(greenGeneric.prepare(product({ title: 'Kaffee', text: 'Kräftig und nussig.' }))).toBeNull();
    const prep = greenGeneric.prepare(product({ title: 'Kaffee', text: 'Nachhaltig angebaut und fair gehandelt.' }));
    expect(Object.keys(prep!.questions)).toEqual(['green_generic']);
    expect(prep!.evidence[0]).toContain('Nachhaltig angebaut');
  });

  it('catches climate-neutral claims including CO₂ spelling variants', () => {
    for (const text of ['Klimaneutraler Versand', 'CO₂-neutral produziert', 'co2 kompensiert', 'Für jede Bestellung pflanzen wir einen Baum']) {
      expect(greenClimate.prepare(product({ title: 'X', text })), text).not.toBeNull();
    }
  });

  it('asks the shared product-category question for health rules', () => {
    const p = product({ title: 'Kurkuma Kapseln', text: 'Lindert Gelenkschmerzen und stärkt das Immunsystem.' });
    expect(Object.keys(healthDisease.prepare(p)!.questions)).toContain('product_category');
    expect(Object.keys(healthClaim.prepare(p)!.questions)).toContain('product_category');
  });

  it('does not trigger on look-alike words found in real shops', () => {
    expect(healthClaim.prepare(product({ title: 'Merry Christmas', text: 'Zaubert festliche Stimmung auf den Teller.' }))).toBeNull();
    expect(healthDisease.prepare(product({ title: 'Paella-Gewürz', text: 'Allergene: kann Spuren von Krebstieren enthalten.' }))).toBeNull();
    expect(healthDisease.prepare(product({ title: 'Spray', text: 'Zur Desinfektion von Oberflächen.' }))).toBeNull();
    expect(healthDisease.prepare(product({ title: 'Balsam', text: 'Hilft bei Kopfschmerzen.' }))).not.toBeNull();
  });

  it('caps disease claims on medical devices at review level', () => {
    const answers = new Answers({ product_category: { type: 'choice', choice: 'medical' }, health_disease: { type: 'noul', noul: 0.95 } });
    expect(healthDisease.judge(answers, product({ title: 'x' }))).toBe(0.6);
  });

  it('only judges health claims on food', () => {
    const base = { health_effect: { type: 'noul', noul: 0.9 }, health_authorized_wording: { type: 'noul', noul: 0.1 }, health_unlisted_effect: { type: 'noul', noul: 0.1 } } as const;
    const food = new Answers({ ...base, product_category: { type: 'choice', choice: 'food' } });
    const cosmetic = new Answers({ ...base, product_category: { type: 'choice', choice: 'cosmetic' } });
    expect(healthClaim.judge(food, product({ title: 'x' }))).toBeCloseTo(0.81);
    expect(healthClaim.judge(cosmetic, product({ title: 'x' }))).toBe(0);
  });

  it('triggers on typical test and legal-rights wording', () => {
    expect(testClaim.prepare(product({ title: 'X', text: 'Testsieger 2025!' }))).not.toBeNull();
    expect(testClaim.prepare(product({ title: 'X', text: 'Dermatologisch getestet.' }))).not.toBeNull();
    expect(lawAsBenefit.prepare(product({ title: 'X', text: '✓ 2 Jahre Gewährleistung ✓ Schneller Versand' }))).not.toBeNull();
    expect(lawAsBenefit.prepare(product({ title: 'X', text: 'Schneller Versand' }))).toBeNull();
  });
});

describe('Grundpreis', () => {
  it('reads quantities from title and variants but skips dimensions', () => {
    const p = product({ title: 'Bio Espresso 500 g', variants: [{ title: '1 kg Beutel', price: 20, compareAtPrice: null }] });
    expect(findQuantities(p).map((q) => q.raw)).toEqual(['500 g', '1 kg']);
    expect(findQuantities(product({ title: 'Poster 30 x 40 cm' }))).toEqual([]);
    expect(findQuantities(product({ title: 'Olivenöl 0,75 l' }))[0]).toMatchObject({ dim: 'volume', base: 0.75 });
    expect(findQuantities(product({ title: 'Vitamin B12 Tropfen 50ml' }))[0]).toMatchObject({ raw: '50 ml' });
  });

  it('applies the § 4 PAngV exemptions', () => {
    expect(exemptFromUnitPrice({ raw: '1 kg', dim: 'weight', base: 1 })).toBe(true);
    expect(exemptFromUnitPrice({ raw: '5 ml', dim: 'volume', base: 0.005 })).toBe(true);
    expect(exemptFromUnitPrice({ raw: '500 g', dim: 'weight', base: 0.5 })).toBe(false);
    expect(unitPrice.prepare(product({ title: 'Mehl 1 kg' }))).toBeNull();
  });

  it('skips products whose export says the unit price is configured', () => {
    const p = product({ title: 'Tee 100 g', variants: [{ title: '', price: 5, compareAtPrice: null, hasUnitPrice: true }] });
    expect(unitPrice.prepare(p)).toBeNull();
  });

  it('recognises unit prices on product pages', () => {
    expect(pageShowsUnitPrice('6,49 € (86,53 € / 1 kg)')).toBe(true);
    expect(pageShowsUnitPrice('Grundpreis: 12,98 €/kg')).toBe(true);
    expect(pageShowsUnitPrice('86.53 € / 1 kg')).toBe(true);
    expect(pageShowsUnitPrice('Preis 6,49 € inkl. MwSt.')).toBe(false);
    expect(unitPrice.verifyOnPage!({ html: '', text: 'Preis 6,49 €' }, product({ title: 'x' }))).toBe(true);
    // This used to expect false ("configured in Shopify, so the theme shows it").
    // Audit 6 showed themes that never render a configured unit price (shop8), so the shop data alone no longer
    // dismisses: a static page stays open for the browser step, and a rendered page decides (test/audit6-fixes.test.ts).
    expect(unitPrice.verifyOnPage!({ html: '<span class="unit-price"></span>', text: 'Preis 29,95 €', variants: [{ unitPrice: true }] }, product({ title: 'x' }))).toBe('unknown');
  });
});

describe('Streichpreis', () => {
  it('flags real reductions only and accepts pages that mention the 30-day price', () => {
    const same = product({ title: 'A', variants: [{ title: '', price: 6.49, compareAtPrice: 6.49 }] });
    const cut = product({ title: 'B', variants: [{ title: '', price: 39.99, compareAtPrice: 59.99 }] });
    expect(strikePrice.prepare(same)).toBeNull();
    expect(strikePrice.prepare(cut)!.note).toBe('Streichpreis 59,99 € → 39,99 €');
    expect(strikePrice.verifyOnPage!({ html: '', text: 'Niedrigster Preis der letzten 30 Tage: 49,99 €' }, cut)).toBe(false);
    expect(strikePrice.verifyOnPage!({ html: '', text: 'Jetzt nur 39,99 € statt 59,99 €' }, cut)).toBe(true);
  });
});

describe('Textilkennzeichnung', () => {
  it('detects fibre composition in common notations', () => {
    expect(statesComposition('Material: 100% Baumwolle (Bio)')).toBe(true);
    expect(statesComposition('95 % Bio-Baumwolle, 5 % Elasthan')).toBe(true);
    expect(statesComposition('Baumwolle 80%, Polyester 20%')).toBe(true);
    expect(statesComposition('reine Schurwolle')).toBe(true);
    expect(statesComposition('Super weicher Stoff')).toBe(false);
  });

  it('asks only for textile-looking products without a composition', () => {
    expect(textileFibre.prepare(product({ title: 'Hoodie Oversize', text: 'Kuschelig weich.' }))).not.toBeNull();
    expect(textileFibre.prepare(product({ title: 'Hoodie Oversize', text: '80% Baumwolle, 20% Polyester' }))).toBeNull();
    expect(textileFibre.prepare(product({ title: 'Lichtschalter weiß', text: 'Unterputz' }))).toBeNull();
    expect(textileFibre.prepare(product({ title: 'Espresso 500 g' }))).toBeNull();
  });
});
