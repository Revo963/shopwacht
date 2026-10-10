// Multipack formats missed by the strike-price rule.
import { describe, expect, it } from 'vitest';
import { strikePrice } from '../src/rules/pricing.js';
import { product } from './helpers.js';

describe('multipack formats missed by the strike-price rule', () => {
  const reduced = (title: string, price: number, compareAtPrice: number, text = '') =>
    product({ title, text, variants: [{ title: '', price, compareAtPrice }] });

  // shop14 cases: "(4x)" with no digit after x (75,60 € = 4 × 18,90 €)
  it('excuses "(4x)" with no digit after x: Clear Mind (4x)', () => {
    const p = reduced(
      'Clear Mind (4x)',
      56.7,
      75.6,
      'Reinigende und klärende Räuchermischung. Bringt Balance, Klarheit und Fokus.\nBiologische angebaute Heil- und Wildpflanzen aus Deutschland.',
    );
    expect(strikePrice.prepare(p)).toBeNull();
  });

  it('excuses "(4x)" with no digit after x: Fresh Vibes (4x)', () => {
    const p = reduced(
      'Fresh Vibes (4x)',
      56.7,
      75.6,
      'Belebende und aktivierende Räuchermischung. Bringt Schwung in müde Phasen.',
    );
    expect(strikePrice.prepare(p)).toBeNull();
  });

  // shop14 case: "(2 x 370g)" at 2 × 34,90 € = 69,80 €
  it('excuses "(2 x 370g)" at 2 × 34,90 €: Magic Brew', () => {
    const p = reduced(
      'Magic Brew (2 x 370g)',
      52.35,
      69.8,
      'Belebendes Morgenritual. Heimische Wurzeln und Chaga-Vitalpilz aus Nordeuropa für natürlichen Fokus¹.\nFühl dich wacher¹ dank natürlichem Vitamin B12. Supporte mit jedem Schluck deine Nerven¹ & dein Immunsystem¹. Ganz ohne Koffein!',
    );
    expect(strikePrice.prepare(p)).toBeNull();
  });

  // shop13 cases: "4+1" where strike price is 5 × single pack
  it('excuses "4+1" multipack: Limited Edition Microenergy 4+1 Set (5 × 9,99 € = 49,95 €)', () => {
    const p = reduced(
      'Limited Edition Microenergy 4+1 Set',
      39.96,
      49.95,
      'Ein Set, 5 Sorten: Von den sanften Vanillenoten in BLUE VANILLA BOOST bis hin zum beerig fruchtigen Geschmack in BERRY BOOST, genieße 5 Microenergy Sorten mit dem fünften 12-Pack gratis dazu.',
    );
    expect(strikePrice.prepare(p)).toBeNull();
  });

  it('excuses "4+1" multipack: Ultimatives Recharge Set 4+1 (5 × 10,99 € = 54,95 €)', () => {
    const p = reduced(
      'Ultimatives Recharge Set 4+1',
      43.96,
      54.95,
      'Schlürfe ein gratis 12-Pack mit diesem 4+1 Angebot! Stille deine beerigen Gelüste oder verliere dich in zitronigen Genüssen mit diesem Set aus 5 fruchtigen Elektrolytsorten.',
    );
    expect(strikePrice.prepare(p)).toBeNull();
  });

  // shop13 case: "Twin Pack" at 2 × 9,99 € = 19,98 €
  it('excuses "Twin Pack" at 2 × 9,99 €: Limited Edition Microenergy Twin Pack', () => {
    const p = reduced(
      'Limited Edition Microenergy Twin Pack',
      16.99,
      19.98,
      'Gönn dir doppelt mit dem neuen WHITE PEACH BOOST oder freu dich über das Comeback von BLUE VANILLA BOOST. Du kannst dich nicht entscheiden? Kein Problem, hol dir jeweils ein 12-Pack und genieße 24 Portionen Microenergy mit 90mg natürlichem Koffein, 6 Vitaminen, ganz ohne Zucker.',
    );
    expect(strikePrice.prepare(p)).toBeNull();
  });

  // Constraints: must preserve negative controls
  it('keeps ordinary reduction flagged: Bio Kultur-Kraut Probiermix (3 x 330g) at 23,70 € (audit3 P178)', () => {
    const p = reduced(
      'Bio Kultur-Kraut Probiermix (3 x 330g)',
      19.7,
      23.7,
      'Vorhang auf für unser Kultur-Kraut Probierpaket!\nWild fermentiert, ohne Zusatzstoffe und nicht pasteurisiert liefern die Krauts nicht nur eine Menge Vitalstoffe, sondern auch ordentlich probiotische Power.',
    );
    expect(strikePrice.prepare(p)).not.toBeNull();
  });

  it('preserves nested item count multipack: 7x3 Nut Butter Balls Erdnuss at 19,95 € (audit1 P096)', () => {
    const p = reduced(
      '7x3 Nut Butter Balls Erdnuss',
      17.95,
      19.95,
      'süß, absolut nussig & perfekt zum Snacken\n7x3 Nut Butter Balls Erdnuss à 20 Gramm\nmit Kern aus purem Erdnussmus\nganz ohne Zuckerzusatz*\nBio, vegan, glutenfrei\nohne Palmöl',
    );
    expect(strikePrice.prepare(p)).toBeNull();
  });
});
