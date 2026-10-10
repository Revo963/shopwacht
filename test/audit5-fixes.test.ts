// Fixes from the fifth blind audit.
import { describe, expect, it } from 'vitest';
import { greenGeneric, healthClaim } from '../src/rules/claims.js';
import { strikePrice, unitPrice } from '../src/rules/pricing.js';
import { statesComposition } from '../src/rules/textile.js';
import { outdatedTmg, withdrawalButton } from '../src/rules/shop.js';
import { product } from './helpers.js';

describe('multi-packs written "5er Set"', () => {
  const paste = (title: string, price: number, compareAtPrice: number) =>
    product({ title: 'Superblack Whitening Zahnpasta', text: 'Enthält 75 ml pro Tube.', url: 'https://shop.test/p', variants: [{ title, price, compareAtPrice }] });

  it('treats 19,95 € for a 5er Set as 5 × 3,99 €', () => {
    expect(strikePrice.prepare(paste('5er Set', 17.95, 19.95))).toBeNull();
  });

  it('still reports a real reduction on a single pack', () => {
    expect(strikePrice.prepare(paste('Standard', 14.95, 19.95))).not.toBeNull();
  });
});

describe('dental care is sold by volume', () => {
  it('asks about the Grundpreis for a toothpaste without a stated quantity', () => {
    const prep = unitPrice.prepare(product({ title: 'Superblack Whitening Zahnpasta', text: 'Enthält 75 ml pro Tube.', variants: [{ title: '2er Set', price: 7.98, compareAtPrice: null }] }));
    expect(prep?.questions.consumable_by_quantity).toBeTruthy();
  });

  it('leaves a shaker sold with samples alone', () => {
    expect(unitPrice.prepare(product({ title: 'Shop46 Shaker + 4 Daily Protein Proben', text: 'Dieses Paket enthält vier Sorten.', variants: [{ title: 'klassisch', price: 16.93, compareAtPrice: null }] }))).toBeNull();
  });
});

describe('green claims explained in the same sentence', () => {
  it('still asks Jev, but with the upcycling wording in the criteria', () => {
    // "… besteht aus alten Fischernetzen" no longer reaches Jev at all (its own
    // sentence names the material, test/audit6-fixes.test.ts); the criteria still matter for a sentence that does.
    const prep = greenGeneric.prepare!(product({ title: 'Shop39', text: 'Dieses nachhaltige Armband bringt die raue Schönheit der Polarregionen an dein Handgelenk.' }))!;
    expect(JSON.stringify(prep.questions.green_generic!.criteria)).toMatch(/alten Fischernetzen/);
  });
});

describe('satiety wording', () => {
  it.each(['Macht lange satt, mit 26 Vitaminen', 'vereint Citrus-Geschmack mit langanhaltender Sättigung', 'magenfreundliche Pflanzenextrakte'])('asks about "%s"', (text) => {
    expect(healthClaim.prepare!(product({ title: 'Drink', text }))).not.toBeNull();
  });
});

describe('fibre names as compounds', () => {
  it('reads "100% Baumwoll Musselin (kbA)" as a composition', () => {
    expect(statesComposition('100% Baumwoll Musselin (kbA)')).toBe(true);
  });
});

describe('shop rules from the fifth audit', () => {
  const shop = (pages: { kind: string; text: string }[], homeLinks: { text: string; href: string }[] = []) => ({
    origin: 'https://shop.test', platform: 'shopify' as const, products: [], truncated: false, unreachable: [],
    homeLinks,
    pages: pages.map((p) => ({ kind: p.kind as 'home' | 'impressum' | 'widerruf' | 'datenschutz' | 'agb', url: `https://shop.test/${p.kind}`, text: p.text, html: '' })),
  });
  const ask = async () => ({}) as never;

  it('reports a TMG reference in the liability part', async () => {
    const found = await outdatedTmg.check(shop([{ kind: 'impressum', text: 'Als Diensteanbieter sind wir gemäß § 7 Abs.1 TMG für eigene Inhalte verantwortlich.' }]), ask);
    expect(found).toHaveLength(1);
  });

  it('does not take the sample withdrawal form for a withdrawal button', async () => {
    const found = await withdrawalButton.check(
      shop([
        { kind: 'home', text: 'Startseite' },
        { kind: 'widerruf', text: 'Widerrufsbelehrung … Wenn Sie den Vertrag widerrufen wollen, dann füllen Sie bitte dieses Formular aus.' },
      ]),
      ask,
    );
    expect(found).toHaveLength(1);
  });

  it('accepts a real button in the footer', async () => {
    const found = await withdrawalButton.check(shop([{ kind: 'home', text: 'Startseite' }], [{ text: 'Vertrag widerrufen', href: 'https://shop.test/pages/widerruf-formular' }]), ask);
    expect(found).toHaveLength(0);
  });
});
