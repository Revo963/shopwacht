// Nine labelled health claims in the nine samples never reached Jev – relaxation, calm,
// "Körper und Geist", gut feeling, focus and "supportet" wording had no trigger. The trigger only decides that Jev is asked.
import { describe, expect, it } from 'vitest';
import { healthClaim, healthDisease } from '../src/rules/claims.js';
import { product } from './helpers.js';

const asks = (text: string) => healthClaim.prepare(product({ title: 'Produkt', text })) !== null;

describe('health-claim triggers', () => {
  it.each([
    'Für Entspannung und Linderung von allgemeinem Unbehagen.',
    'Entworfen, damit Sie sich entspannen können.',
    'Für einen ruhigen Geist.',
    'Selfcare für innere Ruhe und Erdung.',
    'Eine Tasse voller Balance, die Körper und Geist gleichermaßen beleben kann.',
    'Probiotische Kulturen für dein Bauchgefühl.',
    'Für den ultimativen Drive, Fokus und Pump.',
    'Unser Booster supportet dich bei jeder Session.',
  ])('asks Jev about "%s"', (text) => {
    expect(asks(text)).toBe(true);
  });

  it.each(['Qualität steht bei uns im Fokus.', 'Unser Kundensupport hilft dir gern.', 'Mit belebtem Design.'])('does not ask about "%s"', (text) => {
    expect(asks(text)).toBe(false);
  });
});

// The disease words the tenth audit's labelled disease claims used; the rule still asks Jev.
describe('health-disease triggers', () => {
  const asksDisease = (text: string) => healthDisease.prepare(product({ title: 'Produkt', text })) !== null;

  it.each([
    'Babys bekommen Vitamin D als wirkungsvolle Rachitisprophylaxe.',
    'Calcium kann laut Studien die Häufigkeit von Knochenbrüchen reduzieren.',
    'Hilft dabei, Blähungen spürbar zu reduzieren.',
    'Senkt das schlechte LDL- und fördert das gute HDL-Cholesterin.',
    'Mit lipidsenkendem Artischockenextrakt.',
  ])('asks Jev about "%s"', (text) => {
    expect(asksDisease(text)).toBe(true);
  });
});
