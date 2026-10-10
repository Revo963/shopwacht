// Actionable remedy guidance and copyable snippets
import type { Rule } from '../rules/types.js';
import type { Finding } from '../types.js';

// The snippet used to fill in the crossed-out price as the
// "Niedrigster Gesamtpreis der letzten 30 Tage". The scanner cannot know the shop's price history, and the
// crossed-out price is not that figure whenever the product was cheaper in the 30 days before the reduction
// (an earlier promotion, a price raised just before the sale). A merchant pasting it would publish a false
// price statement, so the snippet is a template the merchant completes, and "UVP" is advised only for a real one.
export function remedyFor(rule: Rule | undefined, f: Finding): { text: string; copySnippet?: string } {
  if (rule?.id === 'strike-price') {
    const shelfLife = /Haltbarkeit/.test(f.note ?? '');
    return {
      text:
        'Neben dem Streichpreis den niedrigsten Gesamtpreis angeben, den der Shop in den 30 Tagen vor Beginn der Ermäßigung verlangt hat (§ 11 Abs. 1 PAngV) – aus der eigenen Preishistorie ermitteln, nicht den gestrichenen Preis übernehmen. ' +
        'Prozent- und „Du sparst“-Angaben müssen sich auf diesen Preis beziehen (EuGH, C-330/23). ' +
        'Ist der gestrichene Preis eine unverbindliche Preisempfehlung des Herstellers, ihn stattdessen eindeutig als „UVP“ kennzeichnen.' +
        (shelfLife ? ' Ist die Ware wegen drohenden Ablaufs der Haltbarkeit reduziert, das beim Angebot deutlich sagen – dann entfällt die Angabe (§ 11 Abs. 4 PAngV).' : ''),
      copySnippet: 'Niedrigster Gesamtpreis der letzten 30 Tage vor der Preisermäßigung: [Betrag] €',
    };
  }
  if (rule?.id === 'unit-price') {
    // A Grundpreis configured in Shopify is not one the customer sees
    // unless the theme renders it (shop8, audit 6) – the check has to be on the product page.
    // This instruction is shared by Shopify and WooCommerce reports.
    return {
      text: 'Für die betroffene Variante Füllmenge und Bezugseinheit (z. B. 1 kg / 1 l) prüfen und den Grundpreis neben dem Gesamtpreis klar erkennbar und gut lesbar anzeigen (§ 4 Abs. 1 PAngV). Anschließend die tatsächlich sichtbare Produktseite prüfen; ein Wert nur im Shopsystem genügt nicht.',
    };
  }
  return { text: rule?.fix ?? '' };
}
