// Jev picks the sentence it objects to, from the product's own sentences.
import { describe, expect, it } from 'vitest';
import { Answers } from '../src/rules/types.js';
import { healthClaim, testClaim } from '../src/rules/claims.js';
import { MAX_OPTIONS, citationFor, quotesFrom, sentencesOf } from '../src/scan/cite.js';
import { mergeQuestions, runScan } from '../src/scan/engine.js';
import type { ShopSnapshot } from '../src/types.js';
import { FakeProvider, product } from './helpers.js';

const ASHWAGANDHA = product({
  title: 'Ashwagandha Extrakt',
  text: [
    '✔ Ganzheitliche Wirkung:',
    'Ashwagandha hat adaptogene Eigenschaften und hilft Dir, Stress abzubauen.',
    '💛 SICHERHEIT DURCH 100 TAGE GELD-ZURÜCK-GARANTIE: Du und Deine Gesundheit stehen im Vordergrund!',
    'Nahrungsergänzungsmittel sind kein Ersatz für eine ausgewogene und abwechslungsreiche Ernährung sowie gesunde Lebensweise.',
    'Ashwagandha hat adaptogene Eigenschaften und hilft Dir, Stress abzubauen.',
  ].join('\n'),
});

describe('the sentences Jev chooses from', () => {
  it('are the product name and its sentences, without the legally required notice and without repeats', () => {
    const s = sentencesOf(ASHWAGANDHA);
    expect(s[0]).toBe('Ashwagandha Extrakt');
    expect(s).toContain('Ashwagandha hat adaptogene Eigenschaften und hilft Dir, Stress abzubauen.');
    expect(s.filter((x) => x.startsWith('Ashwagandha hat'))).toHaveLength(1);
    expect(s.some((x) => x.includes('kein Ersatz'))).toBe(false);
  });

  it('keep the sentences with the rule\'s trigger words when a long text has to be cut', () => {
    const filler = Array.from({ length: 120 }, (_, i) => `Zutat Nummer ${i} stammt aus kontrolliertem Anbau.`);
    const p = product({ title: 'Kapseln', text: [...filler, 'Stärkt Dein Immunsystem in der kalten Jahreszeit.'].join('\n') });
    const c = citationFor(healthClaim, p)!;
    expect(Object.keys(c.question.criteria)).toHaveLength(MAX_OPTIONS + 1);
    expect(Object.values(c.question.criteria)).toContain('Stärkt Dein Immunsystem in der kalten Jahreszeit.');
    expect(c.question.criteria.none).toBeTruthy();
  });

  it('do not end at abbreviations and do end after footnote marks', () => {
    const p = product({
      title: 'Darmpulver',
      text: 'Deutschlands Nr. 1 Darmpulver mit 16 Mrd. Kulturen, z. B. bspw. in Diätphasen. Mit 1.000 mg Vitamin C pro Tag. Ideal für deinen Energiehaushalt.* Unsere Knollen stammen aus den Anden. Wirkt füllend.4 Das ist ein Ballaststoff.',
    });
    expect(sentencesOf(p)).toEqual([
      'Darmpulver',
      'Deutschlands Nr. 1 Darmpulver mit 16 Mrd. Kulturen, z. B. bspw. in Diätphasen.',
      'Mit 1.000 mg Vitamin C pro Tag.',
      'Ideal für deinen Energiehaushalt.*',
      'Unsere Knollen stammen aus den Anden.',
      'Wirkt füllend.4',
      'Das ist ein Ballaststoff.',
    ]);
  });

  it('leave out what the rule itself does not count, such as authorised nutrient claims', () => {
    const p = product({
      title: 'Ashwagandha Komplex',
      text: 'Vitamin B6 trägt zur Verringerung von Müdigkeit und Ermüdung bei. EPA und DHA tragen zu einer normalen Herzfunktion bei. Vitamin K trägt zu einer normalen Blutgerinnung bei. Ashwagandha hilft Dir, Stress abzubauen.',
    });
    const options = Object.values(citationFor(healthClaim, p)!.question.criteria);
    expect(options).toContain('Ashwagandha hilft Dir, Stress abzubauen.');
    expect(options).not.toContain('Vitamin B6 trägt zur Verringerung von Müdigkeit und Ermüdung bei.');
    // No trigger word in these two; the register wording alone decides.
    expect(options).not.toContain('EPA und DHA tragen zu einer normalen Herzfunktion bei.');
    expect(options).not.toContain('Vitamin K trägt zu einer normalen Blutgerinnung bei.');
    expect(Object.values(citationFor(testClaim, p)!.question.criteria)).toContain('Vitamin B6 trägt zur Verringerung von Müdigkeit und Ermüdung bei.');
  });

  it('keep a template heading together with the promise on the next line', () => {
    const s = sentencesOf(ASHWAGANDHA);
    expect(s).toContain('✔ Ganzheitliche Wirkung: Ashwagandha hat adaptogene Eigenschaften und hilft Dir, Stress abzubauen.');
    expect(s).not.toContain('✔ Ganzheitliche Wirkung:');
  });

  it('only for claim rules', () => {
    expect(citationFor(testClaim, ASHWAGANDHA)).not.toBeNull();
    expect(citationFor({ ...healthClaim, cite: undefined }, ASHWAGANDHA)).toBeNull();
  });
});

describe('reading Jev\'s choice', () => {
  const c = citationFor(healthClaim, ASHWAGANDHA)!;
  const key = (text: string) => Object.entries(c.question.criteria).find(([, v]) => v === text)![0];

  it('quotes the chosen sentence', () => {
    const k = key('Ashwagandha hat adaptogene Eigenschaften und hilft Dir, Stress abzubauen.');
    const answers = new Answers({ [c.key]: { type: 'choice', choice: k, probabilities: { [k]: 0.8, none: 0.2 } } });
    expect(quotesFrom(answers, c)).toEqual(['Ashwagandha hat adaptogene Eigenschaften und hilft Dir, Stress abzubauen.']);
  });

  it('adds a close second sentence', () => {
    const a = key('Ashwagandha hat adaptogene Eigenschaften und hilft Dir, Stress abzubauen.');
    const b = key('Ashwagandha Extrakt');
    const answers = new Answers({ [c.key]: { type: 'choice', choice: a, probabilities: { [a]: 0.5, [b]: 0.35, none: 0.15 } } });
    expect(quotesFrom(answers, c)).toHaveLength(2);
  });

  it('gives nothing when Jev answers "none", so the keyword quotes stay', () => {
    expect(quotesFrom(new Answers({ [c.key]: { type: 'choice', choice: 'none' } }), c)).toBeNull();
  });
});

describe('in a scan', () => {
  const shop = (products: ShopSnapshot['products']): ShopSnapshot => ({ origin: 'https://shop.test', platform: 'shopify', products, pages: [], homeLinks: [], truncated: false, unreachable: [] });
  const options = { riskThreshold: 0.7, reviewThreshold: 0.4, concurrency: 1 };

  it('asks for the sentence only after a claim finding, in a second request that leaves the verdict request unchanged', async () => {
    const withCite = new FakeProvider({ product_category: 'food', health_effect: 0.9, health_authorized_wording: 0.1 });
    const report = await runScan('t', shop([ASHWAGANDHA]), { provider: withCite, ...options });
    expect(withCite.requests).toHaveLength(2);
    const verdict = withCite.requests[0]!;
    expect(Object.keys(verdict.questions).some((k) => k.startsWith('satz_'))).toBe(false);
    expect(Object.keys(withCite.requests[1]!.questions)).toEqual(['satz_health_claim']);
    const f = report.findings.find((x) => x.ruleId === 'health-claim')!;
    expect(f.quoteBasis).toBe('modell');
    expect(f.evidence).toEqual(['Ashwagandha Extrakt']); // the fake picks the first option
    expect(report.stats.decisions).toBe(2);
  });

  it('asks nothing more when no claim rule found anything', async () => {
    const quiet = new FakeProvider({ product_category: 'food', health_effect: 0.1, health_authorized_wording: 0.9 });
    await runScan('t', shop([ASHWAGANDHA]), { provider: quiet, ...options });
    expect(quiet.requests).toHaveLength(1);
  });

  it('keeps the keyword quotes when the sentence request fails', async () => {
    const flaky = new FakeProvider({ product_category: 'food', health_effect: 0.9, health_authorized_wording: 0.1 }, (req) =>
      Object.keys(req.questions).some((k) => k.startsWith('satz_')) ? new Error('timeout') : undefined,
    );
    const report = await runScan('t', shop([ASHWAGANDHA]), { provider: flaky, ...options });
    const f = report.findings.find((x) => x.ruleId === 'health-claim')!;
    expect(f.quoteBasis).toBeUndefined();
    expect(f.evidence.length).toBeGreaterThan(0);
    expect(report.stats.errors).toBe(0);
  });

  it('never merges a sentence question into the verdict batch', () => {
    expect(() => mergeQuestions([{ satz_health_claim: citationFor(healthClaim, ASHWAGANDHA)!.question }])).not.toThrow();
  });
});

describe('the trigger words', () => {
  it('leave no search position behind for the next product', async () => {
    const provider = new FakeProvider({ green_generic: 0.9 });
    const options = { riskThreshold: 0.7, reviewThreshold: 0.4, concurrency: 1 };
    const shop = (title: string, text: string): ShopSnapshot => ({ origin: 'https://shop.test', platform: 'shopify', products: [product({ title, text })], pages: [], homeLinks: [], truncated: false, unreachable: [] });
    await runScan('a', shop('Lange Seife', 'Diese Seife ist gut für Dich und die Umwelt, denn sie ist ganz und gar umweltfreundlich.'), { provider, ...options });
    const report = await runScan('b', shop('x', 'nachhaltig'), { provider, ...options });
    expect(report.findings.map((f) => f.ruleId)).toEqual(['green-generic']);
  });
});

describe('the sentence request, failures', () => {
  it('aborts the scan when the API key is rejected, like the verdict request', async () => {
    const { JevError } = await import('../src/decisions/jev.js');
    const shop = { origin: 'https://shop.test', platform: 'shopify' as const, products: [ASHWAGANDHA], pages: [], homeLinks: [], truncated: false, unreachable: [] };
    const provider = new FakeProvider({ product_category: 'food', health_effect: 0.9, health_authorized_wording: 0.1 }, (req) =>
      Object.keys(req.questions).some((k) => k.startsWith('satz_')) ? new JevError('invalid key', 401) : undefined,
    );
    await expect(runScan('t', shop, { provider, riskThreshold: 0.7, reviewThreshold: 0.4, concurrency: 1 })).rejects.toThrow(/API-Schlüssel wurde abgelehnt/);
  });
});
