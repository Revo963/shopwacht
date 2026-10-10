import { describe, expect, it } from 'vitest';
import { JevError } from '../src/decisions/jev.js';
import { mergeQuestions, runScan } from '../src/scan/engine.js';
import type { ShopSnapshot } from '../src/types.js';
import { FakeProvider, product } from './helpers.js';

const options = { riskThreshold: 0.7, reviewThreshold: 0.4, concurrency: 2 };

function shop(products: ShopSnapshot['products']): ShopSnapshot {
  return { origin: 'https://shop.test', platform: 'shopify', products, pages: [], homeLinks: [], truncated: false, unreachable: [] };
}

describe('runScan', () => {
  it('sends one batched request per product and none for products without triggers', async () => {
    const provider = new FakeProvider({ green_generic: 0.9, green_offset: 0.2 });
    const report = await runScan(
      't1',
      shop([
        product({ title: 'Seife', text: 'Umweltfreundlich und klimaneutral verpackt.' }),
        product({ title: 'Kerze', text: 'Duftet nach Vanille.' }),
      ]),
      { provider, ...options },
    );
    // After the finding, one more request asks which sentence makes the claim.
    expect(provider.requests).toHaveLength(2);
    expect(Object.keys(provider.requests[0]!.questions).sort()).toEqual(['green_generic', 'green_offset']);
    expect(Object.keys(provider.requests[1]!.questions)).toEqual(['satz_green_generic']);
    // Green claims never go above "Prüfen" – the ban applies from 27.09.2026.
    expect(report.findings.map((f) => [f.ruleId, f.level])).toEqual([['green-generic', 'pruefen']]);
    expect(report.stats.decisions).toBe(2);
  });

  it('marks borderline answers for review and drops low ones', async () => {
    const provider = new FakeProvider({ green_generic: 0.55 });
    const low = new FakeProvider({ green_generic: 0.2 });
    const p = product({ title: 'Seife', text: 'Nachhaltig.' });
    expect((await runScan('t', shop([p]), { provider, ...options })).findings[0]?.level).toBe('pruefen');
    expect((await runScan('t', shop([p]), { provider: low, ...options })).findings).toEqual([]);
  });

  it('drops "missing" findings when the live page shows the information', async () => {
    const provider = new FakeProvider({ sold_by_quantity: 0.95 });
    const products = [
      product({ id: 'a', title: 'Kaffee 500 g', url: 'https://shop.test/products/a' }),
      product({ id: 'b', title: 'Tee 250 g', url: 'https://shop.test/products/b' }),
    ];
    const loadPage = async (url: string) => ({ html: '', text: url.endsWith('/a') ? '12,99 € (25,98 € / 1 kg)' : '4,99 €' });
    const report = await runScan('t', shop(products), { provider, ...options, loadPage });
    expect(report.findings.map((f) => f.subject.id)).toEqual(['b']);
    expect(report.findings[0]?.level).toBe('risiko');
  });

  it('caps unverifiable "missing" findings at review level', async () => {
    const provider = new FakeProvider({ sold_by_quantity: 0.95 });
    const report = await runScan('t', shop([product({ title: 'Kaffee 500 g' })]), { provider, ...options });
    expect(report.findings[0]?.level).toBe('pruefen');
    expect(report.findings[0]?.note).toContain('nicht überprüfbar');
  });

  it('says so when the product page could not be loaded', async () => {
    const provider = new FakeProvider({ sold_by_quantity: 0.95 });
    const p = product({ title: 'Kaffee 500 g', url: 'https://shop.test/products/k' });
    const report = await runScan('t', shop([p]), { provider, ...options, loadPage: async () => null });
    expect(report.findings[0]).toMatchObject({ level: 'pruefen', note: expect.stringContaining('nicht erreichbar') });
  });

  it('keeps going when one product fails', async () => {
    const provider = new FakeProvider({ green_generic: 0.9 }, (req) =>
      JSON.stringify(req.state).includes('kaputt') ? new JevError('boom', 500) : undefined,
    );
    const report = await runScan(
      't',
      shop([product({ title: 'kaputt', text: 'nachhaltig' }), product({ title: 'ok', text: 'nachhaltig' })]),
      { provider, ...options },
    );
    expect(report.findings).toHaveLength(1);
    expect(report.stats.errors).toBe(1);
    expect(report.errors[0]).toContain('kaputt');
  });

  it('aborts with a clear message when the API key is rejected', async () => {
    const provider = new FakeProvider({}, () => new JevError('invalid key', 401));
    await expect(runScan('t', shop([product({ title: 'x', text: 'nachhaltig' })]), { provider, ...options })).rejects.toThrow(
      /API-Schlüssel wurde abgelehnt/,
    );
  });

  it('runs text rules on the homepage too', async () => {
    const provider = new FakeProvider({ green_offset: 0.9 });
    const snapshot = shop([]);
    snapshot.pages.push({ kind: 'home', url: 'https://shop.test/', html: '', text: 'Klimaneutraler Versand für alle Bestellungen' });
    const report = await runScan('t', snapshot, { provider, ...options, shopRules: [] });
    expect(report.findings[0]).toMatchObject({ ruleId: 'green-climate', subject: { type: 'page', title: 'Startseite' } });
  });
});

describe('mergeQuestions', () => {
  it('refuses two different questions under one key', () => {
    expect(() =>
      mergeQuestions([{ q: { type: 'noul', instructions: 'a' } }, { q: { type: 'noul', instructions: 'b' } }]),
    ).toThrow(/unterschiedlich/);
  });
});

describe('page checks in two steps', () => {
  it('asks the browser only when the HTML still shows a problem, and trusts what it renders', async () => {
    const provider = new FakeProvider({ sold_by_quantity: 0.95 });
    const products = [
      product({ id: 'a', title: 'Kaffee 500 g', url: 'https://shop.test/products/a' }),
      product({ id: 'b', title: 'Tee 250 g', url: 'https://shop.test/products/b' }),
      product({ id: 'c', title: 'Kakao 250 g', url: 'https://shop.test/products/c' }),
    ];
    const rendered: string[] = [];
    const report = await runScan('t', shop(products), {
      provider,
      ...options,
      // a: unit price in the HTML; b and c: not in the HTML
      loadPage: async (url) => ({ html: '', text: url.endsWith('/a') ? '12,99 € (25,98 € / 1 kg)' : '4,99 €' }),
      // b: JavaScript draws the unit price; c: really missing
      renderPage: async (url) => {
        rendered.push(url);
        return { html: '', text: url.endsWith('/b') ? '4,99 € (19,96 € / 1 kg)' : '4,99 €' };
      },
    });
    expect(rendered.sort()).toEqual(['https://shop.test/products/b', 'https://shop.test/products/c']);
    expect(report.findings.map((f) => [f.subject.id, f.level])).toEqual([['c', 'risiko']]);
  });
});
