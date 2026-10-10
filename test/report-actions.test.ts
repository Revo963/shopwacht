// One supplement shop's scan – 282 findings that are a dozen actions.
import { describe, expect, it } from 'vitest';
import { actionsFor, displayEvidence, summarize } from '../src/report/summary.js';
import { passage } from '../src/rules/text.js';
import type { Finding, ScanReport } from '../src/types.js';

const SLOGAN = '💛 SICHERHEIT DURCH 100 TAGE GELD-ZURÜCK-GARANTIE: Du und Deine Gesundheit stehen im Vordergrund!';
const NOTICE = 'Nahrungsergänzungsmittel sind kein Ersatz für eine ausgewogene und abwechslungsreiche Ernährung sowie gesunde Lebensweise.';
const DERMATEST = '✔ Hautverträglichkeit mit SEHR GUT von Dermatest® bestätigt.';

let n = 0;
function finding(ruleId: string, evidence: string[], level: Finding['level'] = 'pruefen'): Finding {
  n++;
  return { ruleId, level, confidence: 0.9, evidence, subject: { type: 'product', id: String(n), title: `Produkt ${n}`, url: `https://shop.de/products/${n}` } } as Finding;
}
function report(findings: Finding[]): ScanReport {
  return { id: 'r', origin: 'https://shop.de', platform: 'shopify', createdAt: '2026-09-22T19:12:00Z', mode: 'jev', model: 'jev', truncated: false, findings, stats: { products: 237, decisions: 0, durationMs: 0, costUsd: 0 }, errors: [] } as unknown as ScanReport;
}

describe('evidence a shop owner can read', () => {
  it('never quotes the legally required supplement notice', () => {
    const f = finding('health-claim', ['✔ Ganzheitliche Wirkung: Ashwagandha hat adaptogene Eigenschaften.', NOTICE]);
    expect(displayEvidence(report([f])).get(f)).toEqual(['✔ Ganzheitliche Wirkung: Ashwagandha hat adaptogene Eigenschaften.']);
  });

  it('puts a sentence that repeats across the shop behind the product\'s own sentence, and drops it when there is one', () => {
    const own = finding('health-claim', [SLOGAN, 'Trans-Resveratrol ist eines der stärksten Antioxidantien.']);
    const others = Array.from({ length: 6 }, (_, i) => finding('health-claim', [SLOGAN, `${['Ashwagandha', 'Resveratrol', 'Astaxanthin', 'Boswellia', 'Quercetin', 'Spirulina'][i]} für das Wohlbefinden.`]));
    const shown = displayEvidence(report([own, ...others]));
    expect(shown.get(own)).toEqual(['Trans-Resveratrol ist eines der stärksten Antioxidantien.']);
  });

  it('keeps a repeated sentence that is the claim itself, and does not call it generic', () => {
    const only = Array.from({ length: 6 }, () => finding('test-claim', [DERMATEST], 'risiko'));
    const generic = new Set<Finding>();
    expect(displayEvidence(report(only), generic).get(only[0]!)).toEqual([DERMATEST]);
    expect(generic.size).toBe(0);
  });
});

describe('findings grouped into actions', () => {
  it('one action for the same claim written with small variations (Dermatest)', () => {
    const fs = [
      ...Array.from({ length: 11 }, () => finding('test-claim', [DERMATEST], 'risiko')),
      ...Array.from({ length: 6 }, () => finding('test-claim', ['✔ Hautverträglichkeit mit SEHR GUT von Dermatest® bestätigt …'], 'risiko')),
      ...Array.from({ length: 3 }, () => finding('test-claim', ['✔ Hautverträglichkeit SEHR GUT von Dermatest® bestätigt'], 'risiko')),
    ];
    const actions = actionsFor(summarize(report(fs)), report(fs));
    expect(actions).toHaveLength(1);
    expect(actions[0]!.findings).toHaveLength(20);
    expect(actions[0]!.risiko).toBe(20);
  });

  it('one action for all crossed-out prices: the fix is in the shop theme, not per product', () => {
    const fs = [finding('strike-price', ['Streichpreis 24,90 € → 19,92 €']), finding('strike-price', ['Streichpreis 14,90 € → 13,41 €']), finding('strike-price', ['Streichpreis 59,80 € → 29,90 €'])];
    const actions = actionsFor(summarize(report(fs)), report(fs));
    expect(actions).toHaveLength(1);
    expect(actions[0]!.findings).toHaveLength(3);
    expect(actions[0]!.quote).toBeUndefined();
  });

  it('keeps different claims apart and lists the largest risks first ("Risiko" counts double)', () => {
    const checks = Array.from({ length: 4 }, () => finding('health-claim', ['Mönchspfeffer für das weibliche Wohlbefinden.']));
    const risky = Array.from({ length: 3 }, () => finding('health-claim', ['Astaxanthin schützt Dich vor freien Radikalen.'], 'risiko'));
    const single = finding('health-claim', ['Q10 ist in den Energiekraftwerken aller Körperzellen vorhanden.'], 'risiko');
    const r = report([...checks, single, ...risky]);
    const actions = actionsFor(summarize(r), r);
    expect(actions.map((a) => a.findings.length)).toEqual([3, 4, 1]);
    expect(actions[0]!.quote).toContain('Astaxanthin');
  });

  it("a setting that affects many products comes before one product's sentence", () => {
    const prices = Array.from({ length: 8 }, (_, i) => finding('strike-price', [`Streichpreis ${20 + i},90 € → 15,92 €`]));
    const single = finding('health-claim', ['Q10 ist in den Energiekraftwerken aller Körperzellen vorhanden.'], 'risiko');
    const r = report([single, ...prices]);
    expect(actionsFor(summarize(r), r)[0]!.rule.id).toBe('strike-price');
  });

  it('says so when the only quote is a sentence from many product pages', () => {
    const others = Array.from({ length: 6 }, (_, i) => finding('health-claim', [SLOGAN, `${['Ashwagandha', 'Resveratrol', 'Astaxanthin', 'Boswellia', 'Quercetin', 'Spirulina'][i]} für das Wohlbefinden.`]));
    const bare = Array.from({ length: 2 }, () => finding('health-claim', [SLOGAN, NOTICE], 'risiko'));
    const r = report([...others, ...bare]);
    const slogan = actionsFor(summarize(r), r).find((a) => a.findings.includes(bare[0]!))!;
    expect(slogan.generic).toBe(true);
    expect(actionsFor(summarize(r), r).find((a) => a.findings.includes(others[0]!))!.generic).toBe(false);
  });
});

describe('a quote that ends in a colon continues onto the next line', () => {
  it('shows the promise after "✔ Ganzheitliche Wirkung:"', () => {
    const text = 'Beschreibung\n✔ Ganzheitliche Wirkung:\nAshwagandha hat adaptogene Eigenschaften.\n💛 VEGAN';
    const i = text.indexOf('Wirkung');
    expect(passage(text, i, 'Wirkung'.length)).toBe('✔ Ganzheitliche Wirkung: Ashwagandha hat adaptogene Eigenschaften.');
  });
});
