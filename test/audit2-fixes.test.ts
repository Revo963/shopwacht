// Fixes from the fresh error-rate audit on five new shops.
import { describe, expect, it } from 'vitest';
import { Answers } from '../src/rules/types.js';
import { greenGeneric, healthClaim, healthDisease, testClaim } from '../src/rules/claims.js';
import { hasStrikePrice, strikePrice } from '../src/rules/pricing.js';
import { impressum, odrLink, withdrawalNotice } from '../src/rules/shop.js';
import { textileFibre } from '../src/rules/textile.js';
import { productState } from '../src/scan/engine.js';
import type { ShopPage, ShopSnapshot } from '../src/types.js';
import { product } from './helpers.js';

const withAnswers = (a: Record<string, number>) => async () =>
  new Answers(Object.fromEntries(Object.entries(a).map(([k, v]) => [k, { type: 'noul' as const, noul: v }])));

function shopWith(pages: ShopPage[]): ShopSnapshot {
  return { origin: 'https://shop.test', platform: 'shopify', products: [], pages, homeLinks: [], truncated: false, unreachable: [] };
}

describe('strike prices that are not price reductions', () => {
  const mats = product({ title: 'Wickelunterlagen', url: 'https://shop.test/p', variants: [{ title: 'Standard', price: 4.13, compareAtPrice: 5.5 }] });

  it('ignores a subscription price shown next to the current one-off price', () => {
    const page = { html: '', text: 'Am beliebtesten SHOP33+ 5,50 € 4,13 € pro Packung Einzelkauf 5,50 € pro Packung', rendered: true };
    expect(strikePrice.verifyOnPage!(page, mats)).toBe(false);
    const english = { html: '', text: 'Subscription 5,50 € 4,13 € per pack Single Purchase €5.50 per pack', rendered: true };
    expect(strikePrice.verifyOnPage!(english, mats)).toBe(false);
  });

  it('keeps a one-off sale even when the shop also sells subscriptions', () => {
    const page = { html: '', text: 'Schwimmwindeln Normaler Preis 5,50 € Verkaufspreis 4,13 € Sale · Im Einzelkauf IN DEN WARENKORB · oder im Abo sparen', rendered: true };
    expect(strikePrice.verifyOnPage!(page, mats)).toBe(true);
  });

  it('drops the finding when the rendered page shows neither price', () => {
    const page = { html: '', text: 'Drei limitierte Sets für unterwegs! Jetzt entdecken', rendered: true };
    expect(strikePrice.verifyOnPage!(page, mats)).toBe(false);
    // Plain HTML is no proof: prices are often drawn by scripts.
    expect(strikePrice.verifyOnPage!({ html: '', text: 'Drei limitierte Sets' }, mats)).toBe(true);
  });

  it('treats n × the single-pack price as a multi-pack saving', () => {
    expect(hasStrikePrice(product({ title: 'Crunchy Erdbeeren', variants: [{ title: '8 Beutel', price: 22.9, compareAtPrice: 23.92 }] }))).toBe(false);
    expect(hasStrikePrice(product({ title: 'Tafel Mandel', text: 'Inhalt: 10 x 125g', variants: [{ title: 'Standard', price: 36.9, compareAtPrice: 39.9 }] }))).toBe(false);
    // An ordinary reduction on a pack is still a reduction.
    expect(hasStrikePrice(product({ title: 'Kapseln', text: '120 Kapseln', variants: [{ title: '1 Dose', price: 22.99, compareAtPrice: 30.99 }] }))).toBe(true);
  });

  it('does not read a technical tag like "ch_bundle" as a set', () => {
    const p = product({ title: 'Motivationskick', tags: ['ch_bundle', 'nem'], url: 'https://shop.test/p', variants: [{ title: '', price: 19.99, compareAtPrice: 22.99 }] });
    const page = { html: '', text: 'Normaler Preis €22,99 Verkaufspreis €19,99', rendered: true };
    expect(strikePrice.verifyOnPage!(page, p)).toBe(true);
  });
});

describe('claim triggers from the fresh audit', () => {
  it('asks about lab and expert confirmations', () => {
    const text = 'Gynäkolog*innen bestätigen uns, dass … Als einzige Brand haben wir die bakterienhemmende Wirkung unserer Produkte testen lassen. Die antibakterielle Wirksamkeit wurde von einem externen Labor bestätigt.';
    expect(testClaim.prepare(product({ title: 'Hipster', text }))!.evidence.length).toBeGreaterThan(0);
    expect(testClaim.prepare(product({ title: 'Slip', text: 'Die Saugstärkste auf dem Markt – hält bis zu 10 Tampons.' }))).not.toBeNull();
  });

  it('asks about supplement claims without classic keywords', () => {
    for (const text of [
      '9 hochwertige Bakterienstämme für ein ausgeglichenes Mikrobiom',
      'entwickelt für Frauen, die ihre leidenschaftliche Seite ganzheitlich unterstützen wollen',
      'Liefert dir 5 HTP – die Vorstufe des Glückshormons Serotonin',
      'aktuelle Studien zu den Themen Angst, Unruhe und Stimmungsaufhellung',
    ]) {
      expect(healthClaim.prepare(product({ title: 'Kapseln', text })), text).not.toBeNull();
    }
    expect(healthDisease.prepare(product({ title: 'Paket', text: 'Eine gestörte Scheidenflora kann zu Beschwerden führen.' }))).not.toBeNull();
  });

  it('does not read an organic control body code as a green claim', () => {
    expect(greenGeneric.prepare(product({ title: 'Schokolade', text: 'shop54 GmbH · DE-ÖKO-039' }))).toBeNull();
    expect(greenGeneric.prepare(product({ title: 'Seife', text: 'Öko-Seife aus Olivenöl' }))).not.toBeNull();
  });

  it('knows muslin cloths are textiles', () => {
    expect(textileFibre.prepare(product({ title: 'SHOP33 Musselintuch' }))).not.toBeNull();
  });

  it('shows Jev the trigger passages when a long text is clipped', () => {
    const long = product({ title: 'Startseite', text: `${'Menü '.repeat(2000)} Nachhaltig und fair produziert` });
    expect(productState(long, ['Nachhaltig und fair produziert'])).toHaveProperty('weitere_fundstellen', ['Nachhaltig und fair produziert']);
    expect(productState(product({ title: 'Kurz', text: 'kurz' }), ['kurz'])).not.toHaveProperty('weitere_fundstellen');
  });
});

describe('shop checks from the fresh audit', () => {
  const notice: ShopPage = {
    kind: 'widerruf',
    url: 'https://shop.test/widerruf',
    html: '',
    text: 'Widerrufsrecht Sie haben das Recht, binnen vierzehn Tagen ohne Angabe von Gründen diesen Vertrag zu widerrufen. Sie können dafür ein Muster-Widerrufsformular verwenden.',
  };
  const complete = withAnswers({ is_withdrawal_notice: 0.95 });

  it('requires the model form itself, not a sentence mentioning it', async () => {
    const findings = await withdrawalNotice.check(shopWith([{ kind: 'home', url: 'https://shop.test/', html: '', text: 'Shop' }, notice]), complete);
    expect(findings.map((f) => f.note)).toContain('Kein Muster-Widerrufsformular gefunden.');
  });

  it('finds the model form in the AGB', async () => {
    const agb: ShopPage = { kind: 'agb', url: 'https://shop.test/agb', html: '', text: 'Muster-Widerrufsformular: Hiermit widerrufe(n) ich/wir (*) den von mir/uns (*) abgeschlossenen Vertrag …' };
    expect(await withdrawalNotice.check(shopWith([{ kind: 'home', url: 'https://shop.test/', html: '', text: 'Shop' }, notice, agb]), complete)).toEqual([]);
  });

  it('finds the model form even when page text glues it to the previous line', async () => {
    const agb: ShopPage = { kind: 'agb', url: 'https://shop.test/agb', html: '', text: 'Telefon: +49 69 643 57 420Hiermit widerrufe(n) ich/wir (*) …' };
    expect(await withdrawalNotice.check(shopWith([{ kind: 'home', url: 'https://shop.test/', html: '', text: 'Shop' }, notice, agb]), complete)).toEqual([]);
  });

  it('recognises the ODR notice in other wordings', async () => {
    const imp: ShopPage = {
      kind: 'impressum',
      url: 'https://shop.test/impressum',
      html: '',
      text: 'Die Europäische Kommission stellt eine Plattform für die außergerichtliche Online-Streitbeilegung (OS) bereit die du unter https://ec.europa.eu/odr findest.',
    };
    const noAsk = async () => { throw new Error('unused'); };
    expect(await odrLink.check(shopWith([imp]), noAsk)).toHaveLength(1);
  });

  it('asks for the VAT ID of a company', async () => {
    const imp = (text: string): ShopPage => ({ kind: 'impressum', url: 'https://shop.test/impressum', html: '', text });
    const base = 'ooshi GmbH, Wichertstr. 6, 10439 Berlin, E-Mail: info@shop.test, Vertreten durch: Geschäftsführerin A, Amtsgericht Charlottenburg HRB 198439B';
    const noAsk = async () => { throw new Error('unused'); };
    expect((await impressum.check(shopWith([imp(base)]), noAsk)).map((f) => f.note)).toEqual([expect.stringContaining('Umsatzsteuer')]);
    expect(await impressum.check(shopWith([imp(`${base}, USt-IdNr.: DE309497497`)]), noAsk)).toEqual([]);
  });
});
