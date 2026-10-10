// Set savings named in the description and two-packs (recorded texts).
// Commission Guidance 2021/C 526/02, section 3: combined offers and comparisons with the single items' prices are no
// price reduction under Art. 6a PID unless presented as one.
import { describe, expect, it } from 'vitest';
import { strikePrice } from '../src/rules/pricing.js';
import { product } from './helpers.js';

const offer = (title: string, price: number, compareAtPrice: number, text = '', variant = '') =>
  product({ title, text, variants: [{ title: variant, price, compareAtPrice }] });

describe('packs guessed from a count stay flagged until the single price is known', () => {
  // Reading "2 x <Produkt>" and "Doppelpack" as pack counts excuses boxes listing their contents and packs priced against an
  // old single price. Telling them apart needs the shop's catalogue.
  it('a box listing "2x MammaPads" among its contents (shop28, audit 7 P026)', () => {
    const p = offer('MammaBox MILK - Leo', 189.04, 236.3, '2x MammaPads für die Nacht\n1x Bio-Slipeinlagen – 30 Stück', '34');
    expect(strikePrice.prepare(p)).not.toBeNull();
  });

  it('a bowl set "1x Coconut Bowl + 2x Coconutlöffel" (shop7, audit 6 P139)', () => {
    const p = offer('Coconut Bowl + 2 Löffel', 13.99, 14.9, 'Inhalt: 1 Set bestehend aus 1x Coconut Bowl + 2x Coconutlöffel');
    expect(strikePrice.prepare(p)).not.toBeNull();
  });

  it('"3 x Peanut Rockies" priced against an old single price (shop23, audit 4 P051)', () => {
    expect(strikePrice.prepare(offer('3 x Peanut Rockies (je 150g)', 7.47, 11.97))).not.toBeNull();
  });
});

describe('a set saving named in the product description (shop19, audit 7)', () => {
  it('"sparst dabei sogar 15 % auf alle enthaltenen Produkte" in a collapsed description tab', () => {
    const p = offer('Knochenliebe-Set', 62.03, 72.97, 'Mit diesem Set triffst du sicher die beste Wahl – sparst dabei sogar 15 % auf alle enthaltenen Produkte, wundervoll!', '3 Produkte');
    // The recorded page shows the offer as "Regulärer Preis 62.03 € 72.97 € -15%"; the sentence sits in a collapsed tab.
    const page = { html: '', rendered: true, text: 'Knochenliebe-Set Mehr\nRegulärer Preis\n62.03 €\n72.97 €\n-15%\nAlle Preise inkl. MwSt.' };
    expect(strikePrice.verifyOnPage!(page, p)).toBe(false);
  });

  it('keeps a set whose page and description name no saving', () => {
    const p = offer('Knochenliebe-Set', 62.03, 72.97, 'Drei Produkte für deine Knochen.', '3 Produkte');
    const page = { html: '', rendered: true, text: 'Knochenliebe-Set Regulärer Preis 72,97 € Angebotspreis 62,03 € -15%' };
    expect(strikePrice.verifyOnPage!(page, p)).toBe(true);
  });
});
