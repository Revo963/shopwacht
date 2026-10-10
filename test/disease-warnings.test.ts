// Disease words in warnings, allergen notes and authorised EU claims are no
// disease claim ("neutral mentions (allergens, warnings); authorised EU claims in their approved wording").
import { describe, expect, it } from 'vitest';
import { healthDisease } from '../src/rules/claims.js';
import { citationFor } from '../src/scan/cite.js';
import { product } from './helpers.js';

describe('disease claims', () => {
  it('are not triggered by the name of the spirulina alga', () => {
    expect(healthDisease.prepare(product({ title: 'Bio Spirulina Presslinge', text: 'Zutaten: Spirulina (Arthrospira platensis)* 100 % aus Deutschland.' }))).toBeNull();
    expect(healthDisease.prepare(product({ title: 'Gelenk Kapseln', text: 'Hilft bei Arthrose.' }))).not.toBeNull();
  });

  it('are not asked about when the disease words only sit in a warning', () => {
    const gel = product({
      title: 'Cleansing Gel',
      text: 'Reinigt sanft. Dennoch kann es bei Personen mit extrem empfindlicher Haut oder bestimmten Allergien zu Reaktionen kommen. Es ist daher ratsam, vor der großflächigen Anwendung einen Patch-Test durchzuführen, um sicherzustellen, dass keine allergischen Reaktionen auftreten.',
    });
    expect(healthDisease.prepare(gel)).toBeNull();
    const drops = product({ title: 'Propolis Tropfen', text: 'Propolis Pure Elixir ist für Personen mit Allergien auf Bienenprodukte sowie Schwangere und stillende Mütter nicht geeignet.' });
    expect(healthDisease.prepare(drops)).toBeNull();
  });

  it('are not asked about when the only one is an authorised EU claim in its wording', () => {
    const melatonin = product({ title: 'Schlaf-Set', text: 'Melatonin trägt dazu bei, die Einschlafzeit zu verkürzen und das subjektive Jetlag-Empfinden zu lindern.' });
    expect(healthDisease.prepare(melatonin)).toBeNull();
  });

  it('are still asked about when another sentence names a disease, and the warning is not quoted', () => {
    const p = product({
      title: 'Allergie-Paket',
      text: 'Ideal während der Allergie-Saison, lindert Heuschnupfen. Nicht geeignet für Personen mit einer Allergie gegen Korbblütler.',
    });
    const prep = healthDisease.prepare(p)!;
    expect(prep).not.toBeNull();
    expect(prep.evidence.join(' ')).not.toContain('Korbblütler');
    expect(Object.values(citationFor(healthDisease, p)!.question.criteria)).not.toContain('Nicht geeignet für Personen mit einer Allergie gegen Korbblütler.');
  });
});
