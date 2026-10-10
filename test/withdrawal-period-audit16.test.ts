// A withdrawal period longer than the statutory 14 days is a complete
// Belehrung. Real text: shop11.de/policies/refund-policy, audit 16 S8 (labelled no issue; the scanner said incomplete).
import { describe, expect, it } from 'vitest';
import { Answers } from '../src/rules/types.js';
import { withdrawalNotice } from '../src/rules/shop.js';
import type { ShopPage, ShopSnapshot } from '../src/types.js';

const SHOP11_OPENING =
  'Widerrufsrecht Widerrufsbelehrung Widerrufsrecht Sie haben das Recht, binnen dreißig Tagen ohne Angabe von Gründen diesen Vertrag zu widerrufen. Die Widerrufsfrist beträgt dreißig Tage ab dem Tag an dem Sie oder ein von Ihnen benannter Dritter, der nicht der Beförderer ist, die Waren in Besitz genommen haben bzw. hat.';

const home: ShopPage = { kind: 'home', url: 'https://www.shop11.de/', html: '', text: 'Klar Seifen' };
const shopWith = (text: string): ShopSnapshot => ({
  origin: 'https://www.shop11.de',
  platform: 'shopify',
  products: [],
  pages: [home, { kind: 'widerruf', url: 'https://www.shop11.de/policies/refund-policy', html: '', text }],
  homeLinks: [],
  truncated: false,
  unreachable: [],
});

/** The prior the rule hands Jev for "is this a complete Belehrung?". */
async function hintFor(text: string): Promise<number | undefined> {
  let hint: number | undefined;
  await withdrawalNotice.check(shopWith(text), async (_input, _questions, hints) => {
    const h = hints?.is_withdrawal_notice;
    hint = typeof h === 'number' ? h : undefined;
    return new Answers({ is_withdrawal_notice: { type: 'noul' as const, noul: 0.95 } });
  });
  return hint;
}

describe('withdrawal notice with a voluntarily longer period', () => {
  it('reads „binnen dreißig Tagen“ as the model sentence, like „binnen vierzehn Tagen“', async () => {
    expect(await hintFor(SHOP11_OPENING)).toBe(0.9);
    expect(await hintFor(SHOP11_OPENING.replace(/dreißig Tagen/, 'vierzehn Tagen'))).toBe(0.9);
  });

  it('still doubts a return policy that names no period', async () => {
    expect(await hintFor('Rückgabe: Schicken Sie uns die Ware einfach zurück, wir erstatten den Kaufpreis.')).toBe(0.2);
  });
});
