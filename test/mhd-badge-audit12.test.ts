// Audit-12 P066 short-MHD reason shown only beside the rendered offer.
import { describe, expect, it } from 'vitest';
import { strikePrice } from '../src/rules/pricing.js';
import { product } from './helpers.js';

describe('short-MHD badge in the offer block', () => {
  it('recognises Bluey’s “Kürzeres MHD Letzte Chance” markdown reason', () => {
    const p = product({
      title: 'Bluey Bio Knuspermüsli – Klassik',
      category: 'Granola',
      text: 'Kinder Bio Knuspermüsli mit Hafer-Vollkornflocken',
      variants: [
        { title: '325g', price: 3.59, compareAtPrice: 5.99 },
        { title: '4x325g', price: 11.99, compareAtPrice: 23.96 },
      ],
    });
    const text = 'Bluey Bio Knuspermüsli – Klassik (9 Bewertungen) Kürzeres MHD Letzte Chance 🔥 Angebot €3,59 Regulärer Preis €5,99 Spare €2,40 (€11,05/kg) inkl. MwSt.';
    expect(strikePrice.verifyOnPage!({ html: '', text, rendered: true }, p)).toBe(false);
  });
});
