// Audit-12 P085 unit price after an in-offer loyalty widget.
import { describe, expect, it } from 'vitest';
import { pageShowsUnitPrice } from '../src/rules/pricing.js';

describe('explicit unit price after an offer-side loyalty message', () => {
  it('recognises Anne Tanne’s displayed “Preis pro Einheit”', () => {
    const text = 'Regulärer Preis 8,99€ Erhalte 89 Schaumtaler Sammle bei jedem Kauf Punkte und sichere dir exklusive Rabatte und Vorteile. Mehr Infos Preis pro Einheit 89,90€/ Pro kg Du erhältst Anne Tanne einzeln oder im Sparset.';
    expect(pageShowsUnitPrice(text, [8.99])).toBe(true);
  });

  it('still excludes a separately headed recommendation', () => {
    const text = 'Anne Tanne Regulärer Preis 8,99€ Wird oft zusammen gekauft: 8,99€ Preis pro Einheit 89,90€/ Pro kg';
    expect(pageShowsUnitPrice(text, [8.99])).toBe(false);
  });
});
