// Two Grundpreis formats the page check missed – 18 false alarms.
import { describe, expect, it } from 'vitest';
import { pageShowsUnitPrice } from '../src/rules/pricing.js';

// www.shop3.com/products/wilde-heidelbeere (P035, 24,99 €), rendered: „/ per kg“ right after the price.
const EFFECTIVE_NATURE =
  'Bio Wilde Heidelbeere Pulver Regulärer Preis 24,99 € Stückpreis (124,95 € / per kg) inkl. MwSt., zzgl. Versand (1 Bewertungen) Die Wilde Heidelbeere besticht sowohl durch ihre tiefblaue Färbung als auch durch ihr intensives Aroma';
// shop2.de/products/baumkuchen-venezuela-43-100g (P077, 9,90 €): the Grundpreis follows a restock notice.
const SHOP2_RESTOCK = (price: string, content: string) =>
  `Kühl gelagert ist der Kuchen nach Versand ca. 3–6 Wochen haltbar. Angebot ${price} € 7 Bewertungen Verfügbarkeit per E-Mail erfahren Wir informieren Sie per E-Mail, sobald dieser Artikel wieder verfügbar ist. BENACHRICHTIGUNG AKTIVIEREN ${content} | Preis inkl. MwSt. zzgl. Versandkosten Kostenfreier Versand innerhalb Deutschlands`;
// shop2.de/products/pralinenkugel-spekulatius-mandel (P002, 1,20 €), served in English: the Grundpreis follows a tier-price table.
const SHOP2_TIERS =
  'Sale price 1,20 € In stock MORE INDULGENCE - MORE VALUE. From 2 Items 1,20 € − 2 + - 2% From 10 Items 1,18 € - 5% From 20 Items 1,15 € - 7% From 30 Items 1,12 € ADD TO CART Content: 12,5 g | 96,00 €/kg | Price includes VAT plus shipping costs';

describe('Grundpreis formats from audit 15B', () => {
  it('reads „Stückpreis (124,95 € / per kg)“ (shop3.com)', () => {
    expect(pageShowsUnitPrice(EFFECTIVE_NATURE, [24.99])).toBe(true);
  });

  it('reads the net quantity with its unit price after a restock notice or a tier-price table (shop2.de)', () => {
    expect(pageShowsUnitPrice(SHOP2_RESTOCK('9,90', 'Inhalt: 100 g | 99,00 €/kg'), [9.9])).toBe(true);
    expect(pageShowsUnitPrice(SHOP2_TIERS, [1.2])).toBe(true);
  });

  it('does not take a line that far from the price whose quantity and unit price give another price, as on a cross-sell card', () => {
    // The 300 g Baumkuchen's line (27,90 €) on the 100 g page; the 100 g line (9,90 €) next to a price of 8,90 €.
    expect(pageShowsUnitPrice(SHOP2_RESTOCK('9,90', 'Inhalt: 300 g | 93,00 €/kg'), [9.9])).toBe(false);
    expect(pageShowsUnitPrice(SHOP2_RESTOCK('8,90', 'Inhalt: 100 g | 99,00 €/kg'), [8.9])).toBe(false);
  });

  it('keeps the other limits: a price per piece, and cards after a cross-sell heading', () => {
    expect(pageShowsUnitPrice('Regulärer Preis 24,99 € Stückpreis (0,21 € / per Stück) inkl. MwSt.', [24.99])).toBe(false);
    expect(pageShowsUnitPrice('Angebot 9,90 € In den Warenkorb Wird oft zusammen gekauft Baumkuchen Venezuela 9,90 € Inhalt: 100 g | 99,00 €/kg', [9.9])).toBe(false);
  });
});
