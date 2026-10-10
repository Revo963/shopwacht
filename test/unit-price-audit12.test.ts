// Audit-12 P042, a volume-sold cosmetic whose feed omits its size.
import { describe, expect, it } from 'vitest';
import { unitPrice } from '../src/rules/pricing.js';
import { product } from './helpers.js';

describe('audit-12 shaving foam with no quantity in the feed', () => {
  const foam = product({
    title: 'Intimer Rasierschaum',
    tags: ['Shop', 'single_product', 'vorbestellung'],
    variants: [{ title: '', price: 29.95, compareAtPrice: null }],
  });

  it('reaches the quantity-missing consumable check', () => {
    expect(unitPrice.prepare(foam)?.questions).toHaveProperty('consumable_by_quantity');
  });

  it('keeps the finding when its own rendered offer gives 150 ml but no unit price', () => {
    const text = 'Intimer Rasierschaum Angebot 29,95 € inkl. MwSt. 150 ml | 50 Anwendungen Einmalkauf 29,95 €';
    expect(unitPrice.verifyOnPage!({ html: '', text, productText: text, rendered: true }, foam)).toBe(true);
  });
});
