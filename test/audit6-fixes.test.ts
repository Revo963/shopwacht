// Fixes from the sixth blind audit.
// Most wording is taken from the audited shops' pages; short synthetic pages are used where only the structure matters.
import { describe, expect, it } from 'vitest';
import { greenGeneric, healthClaim, testClaim } from '../src/rules/claims.js';
import { pageShowsUnitPrice, strikePrice, unitPrice } from '../src/rules/pricing.js';
import { impressum, withdrawalButton } from '../src/rules/shop.js';
import { Answers } from '../src/rules/types.js';
import { runScan } from '../src/scan/engine.js';
import type { ShopSnapshot } from '../src/types.js';
import { FakeProvider, product } from './helpers.js';

describe('withdrawal button (shop8, shop9, shop10)', () => {
  const shop = (pages: { kind: string; text: string }[], homeLinks: { text: string; href: string }[] = []) => ({
    origin: 'https://shop.test', platform: 'shopify' as const, products: [], truncated: false, unreachable: [],
    homeLinks,
    pages: pages.map((p) => ({ kind: p.kind as 'home' | 'impressum' | 'widerruf' | 'datenschutz' | 'agb', url: `https://shop.test/${p.kind}`, text: p.text, html: '' })),
  });
  const ask = async () => ({}) as never;
  // The statutory Widerrufsbelehrung (Anlage 1 EGBGB) says this in its "Folgen des Widerrufs" part.
  const belehrung =
    'Widerrufsbelehrung Widerrufsrecht Sie haben das Recht, binnen vierzehn Tagen ohne Angabe von Gründen diesen Vertrag zu widerrufen. Folgen des Widerrufs Wenn Sie diesen Vertrag widerrufen, haben wir Ihnen alle Zahlungen, die wir von Ihnen erhalten haben, unverzüglich zurückzuzahlen.';

  it('does not take the consequences sentence of the Widerrufsbelehrung for a button', async () => {
    const found = await withdrawalButton.check(shop([{ kind: 'home', text: 'Startseite' }, { kind: 'widerruf', text: belehrung }]), ask);
    expect(found).toHaveLength(1);
  });

  it('does not take a footer link that only opens the Widerrufsbelehrung for a button', async () => {
    const found = await withdrawalButton.check(
      shop([{ kind: 'home', text: 'Startseite' }, { kind: 'widerruf', text: belehrung }], [{ text: 'Widerruf', href: 'https://shop.test/policies/refund-policy' }]),
      ask,
    );
    expect(found).toHaveLength(1);
  });

  it.each([
    ['Auftrag widerrufen', 'https://shop.test/pages/eu-widerrufsformular'],
    ['zum widerrufsformular', 'https://shop.test/pages/widerrufsformular'],
    ['Vertrag widerrufen', 'https://shop.test/pages/widerruf-formular'],
  ])('accepts the footer link "%s" that leads to a withdrawal form', async (text, href) => {
    const found = await withdrawalButton.check(shop([{ kind: 'home', text: 'Startseite' }, { kind: 'widerruf', text: belehrung }], [{ text, href }]), ask);
    expect(found).toHaveLength(0);
  });

  it('still finds a button label in the homepage text', async () => {
    const found = await withdrawalButton.check(shop([{ kind: 'home', text: 'FAQ (Hä?) Versand und Zahlung Rücksendung Vertrag widerrufen Blog' }]), ask);
    expect(found).toHaveLength(0);
  });
});

describe('best-before markdown written out on the page (shop10)', () => {
  const choco = product({
    title: 'Choco Cherry',
    text: 'Koffein Bites mit Kakao und Guarana.',
    url: 'https://shop.test/choco-cherry',
    variants: [{ title: '', price: 5.99, compareAtPrice: 11.99 }],
  });

  it('dismisses a reduction whose page states the best-before date beside the price', () => {
    const page = { html: '', rendered: true, text: 'Startseite %SALE% Choco Cherry Choco Cherry 4.5 mindestens haltbar bis 01.10.2026 5,99 € 11,99 € (20,80 € / pro kg) inkl. MwSt. zzgl. Versandkosten' };
    expect(strikePrice.verifyOnPage!(page, choco)).toBe(false);
  });

  it('reads the date after the price as well', () => {
    const page = { html: '', rendered: true, text: 'Tropic Ocean 3,00 € 14,99 € (1,00 € / pro l) mindestens haltbar bis 09.09.2026 zzgl. 3,00€ Pfand' };
    const tropic = product({ title: 'Tropic Ocean', url: 'https://shop.test/t', variants: [{ title: '', price: 3, compareAtPrice: 14.99 }] });
    expect(strikePrice.verifyOnPage!(page, tropic)).toBe(false);
  });

  it('does not let a best-before line far from the price excuse a reduction', () => {
    const filler = 'Beschreibung des Produkts und seiner Zutaten. '.repeat(40);
    const page = { html: '', rendered: true, text: `Choco Cherry 5,99 € 11,99 € (20,80 € / pro kg) inkl. MwSt. ${filler} Mindestens haltbar bis 12/2027 (je nach Charge)` };
    expect(strikePrice.verifyOnPage!(page, choco)).toBe(true);
  });
});

// First written for shop8, but shop8's chilled products show no
// price at all (sold in stores only) and stay "inconclusive". The case this change fixes is Shop22 (audit 3): Shopify
// has a unit price configured, the rendered page shows "29,90€ 25,90€" and no Grundpreis – four real misses before.
describe('Grundpreis: what the page shows beats what Shopify has configured (Shop22)', () => {
  const leber = product({
    title: 'Shop22 LeberVital Pro, 120 Kapseln',
    url: 'https://shop.test/lebervital',
    variants: [{ title: '1 Einheit', price: 25.9, compareAtPrice: 29.9 }, { title: '3er-Pack', price: 66.9, compareAtPrice: 89.9 }],
  });
  const configured = [{ unitPrice: true }, { unitPrice: true }];
  const shown = 'Shop22 LeberVital Pro, 120 Kapseln 29,90€ 25,90€ Unterstützung von Leber und Nieren Kaufoptionen Einmalige Lieferung 29,90€ 25,90€ Zweimonatsabo - LeberVital SPARE 6,00€ 29,90€ 23,90€';

  it('reports a missing Grundpreis when the rendered page shows the price but no Grundpreis', () => {
    expect(unitPrice.verifyOnPage!({ html: '', rendered: true, variants: configured, text: shown }, leber)).toBe(true);
  });

  it('does not report it when the rendered page does show the Grundpreis', () => {
    expect(unitPrice.verifyOnPage!({ html: '', rendered: true, variants: configured, text: `${shown} (215,83 € / kg)` }, leber)).toBe(false);
  });

  it('cannot dismiss on the shop data alone: a static page waits for the browser', () => {
    expect(unitPrice.verifyOnPage!({ html: '<span class="unit-price"></span>', variants: configured, text: shown }, leber)).toBe('unknown');
  });

  it('a page that shows no price at all stays inconclusive (shop8, sold in stores only)', () => {
    const ribs = product({ title: 'Pflanzliche Spare Ribs', url: 'https://shop.test/ribs', variants: [{ title: '', price: 3.79, compareAtPrice: null }] });
    const page = { html: '', rendered: true, variants: [{ unitPrice: true }], text: 'PFLANZLICHE SPARE RIBS BESCHREIBUNG ❄️ Unsere Kühlprodukte gibt’s frisch für dich im Handel.' };
    expect(unitPrice.verifyOnPage!(page, ribs)).toBe('unknown');
  });
});

describe('multi-pack quantity that only the description states (shop21)', () => {
  const dates = product({
    title: 'True Dates Cinnamon Roll Box',
    category: 'Dates',
    text: 'Your cup of coffee just found a new best friend. 12 bags (12 x 100g) Product details Pitted dates with taste of cinnamon roll.',
    variants: [{ title: '', price: 24, compareAtPrice: null }],
  });

  it('asks whether the Box is sold by weight, using the quantity from the description', () => {
    const prep = unitPrice.prepare(dates);
    expect(prep?.questions.sold_by_quantity).toBeTruthy();
    expect(prep?.note).toContain('12 × 100 g');
  });

  it('judges on that question, not on the consumables fallback', () => {
    const answers = new Answers({ sold_by_quantity: { type: 'noul', noul: 0.9 }, consumable_by_quantity: { type: 'noul', noul: 0.1 } });
    expect(unitPrice.judge(answers, dates)).toBeCloseTo(0.9);
  });

  it('does not read a dosage as a pack: no quantity, still a set', () => {
    const set = product({ title: 'Geschenk Box', text: 'Ein Geschenk für dich. Einnahme: 2 x täglich 5 g.', variants: [{ title: '', price: 24, compareAtPrice: null }] });
    expect(unitPrice.prepare(set)).toBeNull();
  });
});

describe('caffeine, guarana and energy wording reaches the health question (shop10, shop7)', () => {
  it.each([
    'Fertig ist dein sommerlicher Energie-Kick.',
    'Natürliches Koffein aus Guarana für den besonderen Energiekick, voller natürlicher Energie.',
    'Der Milchshake, der wach macht.',
    'Starte mit extra Energie in den Tag.',
    'Sättigt richtig gut und gibt dir alles, was du brauchst.',
  ])('asks about "%s"', (text) => {
    expect(healthClaim.prepare!(product({ title: 'Drink', text }))).not.toBeNull();
  });

  it('does not ask about the nutrition table', () => {
    expect(healthClaim.prepare!(product({ title: 'Drink', text: 'Nährwerte je 100 g: Energie 1050 kJ (250 kcal), Fett 3 g, Kohlenhydrate 40 g.' }))).toBeNull();
  });
});

describe('generic green claims explained in their own sentence (shop17, shop9, shop10)', () => {
  const asks = (text: string) => greenGeneric.prepare!(product({ title: 'Produkt', text }));

  it.each([
    'Nachhaltige Geschenktüte aus Papier – die umweltfreundliche Verpackungslösung für Trinkflaschen.',
    'Einwandig, extra leicht, plastikfrei und auslaufsicher: nachhaltig produziert aus rostfreiem Edelstahl.',
    'Unsere O-Ringe aus Naturkautschuk sind umweltfreundlich und langlebig.',
    'Die Socken bestehen aus 97 % Fairtrade-Baumwolle aus biologischem Anbau und 3 % umweltverträglichem Elastan.',
    'Dieses nachhaltige Armband besteht aus alten Fischernetzen.',
    'Das Getränk hebt sich durch seine nachhaltige Mission von anderen ab.',
  ])('does not ask when the sentence carries its basis: "%s"', (text) => {
    expect(asks(text)).toBeNull();
  });

  it.each([
    'Dieses nachhaltige Armband bringt die raue Schönheit der Polarregionen an dein Handgelenk.',
    'Die nachhaltige Alternative zur Kunststoffbürste.',
    'Nachhaltig aus Leidenschaft.',
  ])('still asks when it does not: "%s"', (text) => {
    expect(asks(text)).not.toBeNull();
  });

  // Changed from "another sentence does not explain the claim". Under Drucksache 21/1855
  // (recital 9 of Directive (EU) 2024/825) the specification counts on the same medium; the neighbouring sentence is clearly so.
  // The audit-6 label for this shop17 brush already said "no issue".
  it('a basis in the neighbouring sentence explains the claim', () => {
    expect(asks('Die nachhaltige Alternative zur Kunststoffbürste. Die Borsten bestehen aus Agavenfasern.')).toBeNull();
  });

  it('a basis further away does not, and only the unexplained sentence is quoted', () => {
    const prep = asks('Nachhaltige Geschenktüte aus Papier. Schnelle Lieferung. Wir versenden täglich. Unser umweltfreundliches Erlebnis für dich.');
    expect(prep?.evidence).toHaveLength(1);
    expect(prep?.evidence[0]).toMatch(/umweltfreundliches Erlebnis/);
  });
});

describe('test claims that name body and year, or a rating with its count (shop8, shop17)', () => {
  const criteria = () => (testClaim.prepare!(product({ title: 'Startseite', text: 'Testsieger 2024.' }))!.questions.test_no_source!.criteria as Record<string, string>).false!;

  it('lists an award with awarding body and year as a complete source', () => {
    expect(criteria()).toMatch(/Top Marke der Lebensmittelzeitung \(2023 & 2024\)/);
  });

  it('lists a customer rating with the number of reviews as no test claim', () => {
    expect(criteria()).toMatch(/519 Bewertungen/);
  });
});

describe('a storefront that is not German (shop35.com, shop21.com)', () => {
  const scan = (storefront: ShopSnapshot['storefront']) =>
    runScan('storefront', {
      origin: 'https://shop.test', platform: 'shopify', products: [], homeLinks: [], truncated: false, unreachable: [], storefront,
      pages: [{ kind: 'home', url: 'https://shop.test/', html: '', text: 'Welcome to our store' }],
    }, { provider: new FakeProvider(), riskThreshold: 0.7, reviewThreshold: 0.4, concurrency: 1, productRules: [], shopRules: [impressum] });

  it('says so and marks the legal checks incomplete instead of presenting German-law findings as verdicts', async () => {
    const report = await scan({ language: 'en', currency: 'USD' });
    expect(report.errors.join(' ')).toMatch(/keine deutsche Storefront \(Sprache „en“, Währung USD\)/);
    expect(report.coverage?.incompleteRuleIds).toContain('impressum');
  });

  it('a currency switch alone is enough', async () => {
    const report = await scan({ language: 'de', currency: 'USD' });
    expect(report.errors.join(' ')).toMatch(/Währung USD/);
  });

  it('stays quiet for a German euro storefront and for one that says nothing', async () => {
    for (const storefront of [{ language: 'de', currency: 'EUR' }, undefined]) {
      const report = await scan(storefront);
      expect(report.errors.join(' ')).not.toMatch(/Storefront/);
      expect(report.coverage?.incompleteRuleIds).not.toContain('impressum');
    }
  });
});

// Written after the change, to check the engine's static -> browser flow with the new 'unknown' (not test-first).
describe('through the engine (synthetic product): shop data no longer dismisses before the browser has looked', () => {
  const ribs = () => product({ title: 'Pflanzliche Spare Ribs', text: 'Rauchige Marinade.', url: 'https://shop.test/ribs', variants: [{ title: '190 g', price: 3.79, compareAtPrice: null }] });
  const snapshot: ShopSnapshot = { origin: 'https://shop.test', platform: 'shopify', products: [ribs()], pages: [], homeLinks: [], truncated: false, unreachable: [] };
  const staticPage = { html: '', text: 'Pflanzliche Spare Ribs 3,79 €', variants: [{ unitPrice: true }] };
  const run = (renderPage?: (url: string) => Promise<{ html: string; text: string; rendered: true } | null>) =>
    runScan('shop8', snapshot, {
      provider: new FakeProvider({ sold_by_quantity: 0.95 }), riskThreshold: 0.7, reviewThreshold: 0.4, concurrency: 1,
      productRules: [unitPrice], shopRules: [], trace: true, loadPage: async () => staticPage, renderPage,
    });

  it('reports the missing Grundpreis when the rendered page shows the price but no Grundpreis', async () => {
    const report = await run(async () => ({ html: '', text: 'Pflanzliche Spare Ribs 3,79 € inkl. MwSt. In den Warenkorb', rendered: true }));
    expect(report.findings).toHaveLength(1);
    expect(report.checks![0]).toMatchObject({ outcome: 'finding', page: 'rendered' });
  });

  it('drops it when the rendered page does show the Grundpreis', async () => {
    const report = await run(async () => ({ html: '', text: 'Pflanzliche Spare Ribs 3,79 € (19,95 € / kg) inkl. MwSt.', rendered: true }));
    expect(report.findings).toEqual([]);
    expect(report.checks![0]).toMatchObject({ outcome: 'page-dismissed', page: 'rendered' });
  });

  it('without a browser the shop data alone still keeps the alert quiet, but discloses it as inconclusive', async () => {
    const report = await run(undefined);
    expect(report.findings).toEqual([]);
    expect(report.checks![0]).toMatchObject({ outcome: 'page-inconclusive', incomplete: true });
  });
});

// Found by the bench, not by the audit: once a rendered page outranks the shop data, every display format the detector
// misses becomes a false alarm. shop20.de writes the price first with the currency in front (audit 2, 21 products).
describe('unit price shown as "Grundpreis ( €342,11 / pro kg )" (shop20)', () => {
  const page = 'Nur €0,77 / Tag Normaler Preis €30,99 Verkaufspreis €22,99 Grundpreis ( €342,11 / pro kg ) inkl. MwSt. zzgl. Versand';

  it('recognises a currency-first unit price with "pro"', () => {
    expect(pageShowsUnitPrice(page, [22.99])).toBe(true);
  });

  it('still does not count the per-day price as a unit price', () => {
    expect(pageShowsUnitPrice('Nur €0,77 / Tag Verkaufspreis €22,99 inkl. MwSt. zzgl. Versand', [22.99])).toBe(false);
  });
});

// Same class, found on shop15.com (audit 3): whole-number unit prices written "€730/l" (no decimals, no spaces).
describe('unit price written as a whole number (shop15)', () => {
  it.each([
    ['Cherry, 30ml €21,90 €730/l, inkl. MwSt. zzgl. Versand. IN DEN WARENKORB', 21.9],
    ['Mint NEW 50ml €26,90 €538/l, inkl. MwSt. zzgl. Versand.', 26.9],
    ['Tee 100 g 5,90 € 59 € / kg inkl. MwSt.', 5.9],
  ])('recognises the unit price in "%s"', (page, price) => {
    expect(pageShowsUnitPrice(page, [price])).toBe(true);
  });

  it('does not take a per-portion price for a unit price', () => {
    expect(pageShowsUnitPrice('Cherry, 30ml €21,90 100 Portionen €0,22 / Portion inkl. MwSt.', [21.9])).toBe(false);
  });
});

// Open decision from the pickup, resolved from the labels of all six audits: a set shown with "Normaler Preis" or a
// visible discount badge is a strike price (at "Prüfen"); a bare pair of prices is a bundle saving, and an explicit
// set discount ("Spare 15 % im Set") is one too.
describe('sets with a crossed-out price (shop51, shop7, rosental, shop9)', () => {
  const set = (title: string, price: number, compareAtPrice: number) =>
    product({ title, url: 'https://shop.test/set', variants: [{ title: '', price, compareAtPrice }] });
  const page = (text: string) => ({ html: '', rendered: true, text });

  // This test first expected true. "Normaler Preis" / "Verkaufspreis" are
  // Dawn's visually hidden labels, printed on every price (hidden label only = unclear), and the
  // "Sale" the audit-6 label saw is a menu item. Counting them flagged 18 shop20 Sparpakete in audit 2.
  it('does not take the theme\'s hidden "Normaler Preis" label for a presented reduction (shop51)', () => {
    const text = 'Warenkorb Sale Limited Edition Kondompaket NOSTALGIE DESIGN BIG BUNDLE Glockenförmige Passform, 57mm nominale Breite 4.96 (159) Normaler Preis 58,95 € Verkaufspreis 41,00 € inkl. MwSt In den Warenkorb';
    expect(strikePrice.verifyOnPage!(page(text), set('Nostalgie Design BIG Bundle', 41, 58.95))).toBe(false);
  });

  it('ignores discount badges that belong to something else on the page (shop15 newsletter, shop9 cross-sell)', () => {
    const shop15 = 'Protein Starterkit €16,90 €24,64 inkl. MwSt. zzgl. Versand IN DEN WARENKORB ' + 'Beschreibung. '.repeat(20) + 'Jetzt -15% sichern! Melde dich für unseren Newsletter an';
    expect(strikePrice.verifyOnPage!(page(shop15), set('Protein Starterkit', 16.9, 24.64))).toBe(false);
    const mela = 'BUNDLE FEINSTRICK MÜTZE 72,08 € 84,80 € inkl. MwSt. zzgl. Versand Lieferzeit 1-3 Werktage ' + 'Material und Pflege. '.repeat(10) + 'Bundle Langarmshirt AASTHA + Jersey Shorts JIVIKA 84,83 € 99,80 € -15% In den Warenkorb';
    expect(strikePrice.verifyOnPage!(page(mela), set('Bundle Feinstrick Mütze + Schal', 72.08, 84.8))).toBe(false);
  });

  it('leaves a bundle alone whose badge stands beside a "Bundle Preis" (shop27)', () => {
    const text = 'SHOP27 Pyjama Damen Lounge Bundle 1x Langarmshirt Damen Rippstruktur & 1x Loungehose Damen Rippstruktur -15% Ab 59,49€ Bundle Preis Statt: 69,98€ inkl. MwSt.';
    expect(strikePrice.verifyOnPage!(page(text), set('Lounge Bundle', 59.49, 69.98))).toBe(false);
  });

  it('flags a set with a percentage badge (shop7)', () => {
    const text = 'Verkaufspreis 34,50 € Normaler Preis 45,98 € -25% Du sparst 11,48 € inkl. MwSt. zzgl. Versand';
    expect(strikePrice.verifyOnPage!(page(text), set('Smoothie Bowl Probierpaket', 34.5, 45.98))).toBe(true);
  });

  it('flags a set with a "% OFF" badge and no label (rosental)', () => {
    const text = 'Skin Perfecting Set $138.00 $123.90 10% OFF Choose your tone : Light ADD TO CART';
    expect(strikePrice.verifyOnPage!(page(text), set('Skin Perfecting Set', 123.9, 138))).toBe(true);
  });

  it('leaves a bundle with a bare pair of prices alone (shop9)', () => {
    const text = 'BUNDLE FEINSTRICK MÜTZE KURZ LESH + JACQUARD SCHAL 72,08 € 84,80 € inkl. MwSt. Im Bundle: 100% Bio-Baumwolle Vegan';
    expect(strikePrice.verifyOnPage!(page(text), set('Bundle Feinstrick Mütze kurz LESH + Jacquard Schal', 72.08, 84.8))).toBe(false);
  });

  it('leaves a set alone when the page names the set discount itself (shop9 "Spare 15 % im Set")', () => {
    const text = 'BUNDLE LANGARMSHIRT ANGEBOT 78,46 € REGULÄRER PREIS 92,30 € inkl. MwSt. Spare 15 % im Set';
    expect(strikePrice.verifyOnPage!(page(text), set('Bundle Langarmshirt Style TEJAS + Jeans', 78.46, 92.3))).toBe(false);
  });
});

// Regressions the bench found in this change, with the recorded page text.
describe('a best-before date only excuses the offer it stands in (shop23, audit 4)', () => {
  it('does not borrow another flavour\'s MHD markdown from the variant picker', () => {
    const whey = product({
      title: 'Whey Protein - SALE (2000g)', url: 'https://shop.test/whey',
      variants: [{ title: 'Popcorn', price: 58.5, compareAtPrice: 109.99 }, { title: 'Banana Bread', price: 48.5, compareAtPrice: 97 }],
    });
    const text = 'Angebot58,50 € Regulärer Preis109,99 € -47% Nur €0,88 Pro Portion €29,25 / kg | inkl. MwSt. zzgl. Versand ' + 'Jetzt schnell sein und Sonderpreis sichern. '.repeat(10) +
      'Menge 1000g €29,50 €29,50 / kg 2000g ab €48,50 €24,25 / kg Geschmack (14 Sorten) Popcorn Geschmack auswählen 14 Optionen Banana Bread -5,00 € MHD 03.10.2026';
    expect(strikePrice.verifyOnPage!({ html: '', text }, whey)).toBe(true);
  });
});

describe('unit prices with a thousands separator or in the classic "1 kg = …" form', () => {
  it.each([
    ['Quercetin Kapseln (24 Reviews) €32,90 €1.154,39 / kg inkl. MwSt.', 32.9],
    ['Nattokinase Kapseln €24,90 €1.238,81 / kg inkl. MwSt.', 24.9],
    ['Kaffee 500 g 9,98 € (1 kg = 19,96 €) inkl. MwSt.', 9.98],
    ['Dates Box €24.00 (€20.00 per kg) incl. VAT', 24],
  ])('recognises the unit price in "%s"', (text, price) => {
    expect(pageShowsUnitPrice(text, [price])).toBe(true);
  });
});

describe('legal findings on a non-German storefront stay at "Prüfen"', () => {
  it('caps a shop-rule finding that would otherwise be "Risiko"', async () => {
    const run = (storefront: ShopSnapshot['storefront']) => runScan('storefront-level', {
      origin: 'https://shop.test', platform: 'shopify', products: [], homeLinks: [], truncated: false, unreachable: [], storefront,
      pages: [{ kind: 'home', url: 'https://shop.test/', html: '', text: 'Welcome to our store' }],
    }, { provider: new FakeProvider(), riskThreshold: 0.7, reviewThreshold: 0.4, concurrency: 1, productRules: [], shopRules: [impressum] });
    expect((await run({ language: 'de', currency: 'EUR' })).findings[0]?.level).toBe('risiko');
    expect((await run({ language: 'en', currency: 'USD' })).findings[0]?.level).toBe('pruefen');
  });
});

// "Koffein" and "Guarana" were added as health triggers. They name an
// ingredient, not a claim, and on shop10's long homepage (clipped for Jev) menu entries like "mit Koffein" took the three
// quoted passages, so Jev never saw "gesunde alternative zu kaffee" / "belebende Wirkung" (0.88 → 0.07, a real issue lost).
describe('ingredient names do not crowd the claim out of the quoted passages (shop10 homepage)', () => {
  it('quotes the claim, not the menu', () => {
    const text = 'leckere Bio und Fairtrade Kakaos mit Guarana aus Berlin Zum Inhalt springen. Filter: mit Koffein. ohne Koffein. ' +
      'Im Gegensatz zum Koffein aus Kaffee, entfaltet Guarana seine belebende Wirkung im Körper magenschonender und verträglicher. gesunde alternative zu kaffee.';
    const prep = healthClaim.prepare!(product({ title: 'Startseite', text }))!;
    expect(prep.evidence.join(' ')).toMatch(/belebende Wirkung/);
    expect(prep.evidence.join(' ')).toMatch(/gesunde alternative/);
  });
});
