// Sentences that are themselves authorised EU claims are no evidence (recorded texts).
import { describe, expect, it } from 'vitest';
import { healthClaim } from '../src/rules/claims.js';
import { isAuthorisedClaimSentence } from '../src/rules/health-register.js';
import { product } from './helpers.js';

describe('authorised claim sentences (EU register wording)', () => {
  it('recognises register wording for a named substance, also for two substances at once', () => {
    expect(isAuthorisedClaimSentence('Vitamin B6 trägt zur Regulierung der Hormontätigkeit bei.')).toBe(true);
    expect(isAuthorisedClaimSentence('Vitamin C und Zink tragen zu einer normalen Funktion des Immunsystems bei.')).toBe(true);
    expect(isAuthorisedClaimSentence('Chrom trägt zur Aufrechterhaltung eines normalen Blutzuckerspiegels bei')).toBe(true);
  });

  it('rejects a wrong pairing, a loose mention, a paraphrase and an added stronger promise', () => {
    // shop47 "Size Zero" (audit 8): muscle claims belong to protein, not to vitamin B12.
    expect(isAuthorisedClaimSentence('*Vitamin B12 trägt zur Zunahme der Muskelmasse bei')).toBe(false);
    // shop19 L-Arginin (audit 7): no claim wording at all.
    expect(isAuthorisedClaimSentence('Proteine sind überall in unserem Körper vorhanden, auch in unseren Muskeln und Knochen.')).toBe(false);
    expect(isAuthorisedClaimSentence('Vitamin C unterstützt dein Immunsystem.')).toBe(false);
    expect(isAuthorisedClaimSentence('Vitamin C trägt zu einer normalen Funktion des Immunsystems bei und schützt vor Erkältungen.')).toBe(false);
  });
});

describe('health-claim rule with authorised sentences only', () => {
  it('asks nothing when every health sentence is an authorised claim (shop36 Nattokinase, audit 4 P173)', () => {
    const p = product({
      title: 'Nattokinase Kapseln',
      text: '100 mg Nattokinase pro Kapsel + Vitamin C – trägt zu einer normalen Kollagenbildung für die normale Funktion der Blutgefäße bei\nVegan und ohne Zusatzstoffe',
    });
    expect(healthClaim.prepare(p)).toBeNull();
  });

  it('still judges an unauthorised effect next to an authorised sentence (shop25 Ashwagandha, audit 8 P120)', () => {
    const p = product({
      title: 'Ashwagandha Kapseln',
      text: 'Unterstützt Entspannung, emotionales Gleichgewicht & geistiges Wohlbefinden*\nMagnesium trägt zu einer normalen Funktion des Nervensystems bei.',
    });
    const prep = healthClaim.prepare(p)!;
    expect(prep).not.toBeNull();
    expect(prep.evidence.join(' ')).not.toMatch(/Magnesium trägt/);
  });
});
