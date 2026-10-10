// Fixes from the error-rate audit.
import { describe, expect, it } from 'vitest';
import { healthDisease, testClaim } from '../src/rules/claims.js';
import { hasStrikePrice, LOWEST_PRICE_NOTE, pageShowsUnitPrice, unitPrice } from '../src/rules/pricing.js';
import { odrLink } from '../src/rules/shop.js';
import { matches } from '../src/rules/text.js';
import type { ShopSnapshot } from '../src/types.js';
import { product, setScore } from './helpers.js';

describe('audit fixes', () => {
  it('does not treat unrelated "30 Tage" as a lowest-price note', () => {
    expect(matches('Bezahle nach 30 Tagen. Teste 30 Tage risikofrei', LOWEST_PRICE_NOTE)).toBe(false);
    expect(matches('30 Tage Zufriedenheitsgarantie', LOWEST_PRICE_NOTE)).toBe(false);
    expect(matches('30-Tage-Bestpreis*: 23,65 €', LOWEST_PRICE_NOTE)).toBe(true);
    expect(matches('Niedrigster Preis der letzten 30 Tage: 49,99 €', LOWEST_PRICE_NOTE)).toBe(true);
  });

  it('treats multi-pack prices as quantity discounts, not reductions', () => {
    const packs = product({
      title: 'Vitamin Gummies',
      variants: [
        { title: '45 Tage', price: 27.9, compareAtPrice: null },
        { title: '90 Tage', price: 49.9, compareAtPrice: 55.8 },
        { title: '180 Tage', price: 89.9, compareAtPrice: 111.6 },
      ],
    });
    expect(hasStrikePrice(packs)).toBe(false);
    const sale = product({ title: 'Magnesium', variants: [{ title: '60 Tage', price: 34.9, compareAtPrice: 39.9 }] });
    expect(hasStrikePrice(sale)).toBe(true);
  });

  it('checks consumables without a stated quantity', () => {
    const powder = product({ title: 'Dragon Fruit Dragon', category: 'Energy Bundle', text: 'SHOP49 Energy mit Drachenfrucht', variants: [{ title: '50 Portionen', price: 39.99, compareAtPrice: null }] });
    expect(Object.keys(unitPrice.prepare(powder)!.questions)).toEqual(['consumable_by_quantity']);
    expect(unitPrice.prepare(product({ title: 'Thermo Shaker', text: 'Aus Edelstahl' }))).toBeNull();
  });

  it('recognises more unit-price formats', () => {
    expect(pageShowsUnitPrice('9,95 € 22,52 € / pro kg')).toBe(true);
    expect(pageShowsUnitPrice('Angebot 27,90€ 22,96€/100g')).toBe(true);
  });

  it('catches award, study and PMS wording seen in real shops', () => {
    expect(testClaim.prepare(product({ title: 'Spiel', text: 'das preisgekrönte Wimmelbildspiel' }))).not.toBeNull();
    expect(testClaim.prepare(product({ title: 'Sticks', text: 'mit dem klinisch untersuchten Markenrohstoff KSM-66' }))).not.toBeNull();
    expect(healthDisease.prepare(product({ title: 'Femtastic', text: 'Natürliche Unterstützung bei PMS' }))).not.toBeNull();
  });

  it('finds the ODR notice in its long form', async () => {
    const shop: ShopSnapshot = {
      origin: 'https://shop.test',
      platform: 'shopify',
      products: [],
      pages: [{ kind: 'impressum', url: 'https://shop.test/impressum', html: '', text: 'Hinweis gemäß Online-Streitbeilegungs-Verordnung: …' }],
      homeLinks: [],
      truncated: false,
      unreachable: [],
    };
    expect(await odrLink.check(shop, async () => { throw new Error('unused'); })).toHaveLength(1);
  });
});

describe('audit fixes, round 2', () => {
  it('does not treat set savings, free gifts or best-before markdowns as price reductions', async () => {
    const { strikePrice } = await import('../src/rules/pricing.js');
    const set = product({ title: 'Set Poren verfeinern', tags: ['app.rabatt15set'], variants: [{ title: '', price: 88.15, compareAtPrice: 103.7 }] });
    expect(strikePrice.verifyOnPage!({ html: '', text: '15% Set-Rabatt 88,15 € 103,70 €' }, set)).toBe(false);
    const regularSet = product({ title: 'Starter Set Sensitive', variants: [{ title: 'Set', price: 40.95, compareAtPrice: 47.8 }] });
    expect(strikePrice.verifyOnPage!({ html: '', text: 'Angebot 40.95 € Regulärer Preis 47.80 € Spare 14%' }, regularSet)).toBe(true);
    const gift = product({ title: 'Dragon Fruit', variants: [{ title: '50 Portionen', price: 39.99, compareAtPrice: null }, { title: '50 Portionen mit gratis Shaker', price: 39.99, compareAtPrice: 49.98 }] });
    expect(hasStrikePrice(gift)).toBe(false);
    const mhd = product({ title: 'Surprise Portionsbecher mit kurzem MHD', variants: [{ title: '', price: 2.85, compareAtPrice: 5.97 }] });
    // Assess the MHD reason in context rather than bypassing all other evidence.
    expect(strikePrice.prepare(mhd)?.questions).toHaveProperty('shelf_life_reduction');
  });

  // No longer skipped – Jev says the set mixes kinds of goods.
  it('leaves sets of different goods out of the Grundpreis consumables path', () => {
    expect(setScore(product({ title: 'KENNENLERN SET Bestseller', text: 'Reinigungsgel, Seren & Creme' }), 0.1)).toBeLessThan(0.4);
  });
});
