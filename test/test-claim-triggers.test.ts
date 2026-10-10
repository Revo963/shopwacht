// Test-claim wording the trigger missed (recorded texts, audits 7 and 8).
import { describe, expect, it } from 'vitest';
import { testClaim } from '../src/rules/claims.js';
import { product } from './helpers.js';

const asks = (title: string, text: string) => testClaim.prepare!(product({ title, text }));

describe('test-claim triggers', () => {
  it('a consumer-test percentage (shop28, audit 7 P011)', () => {
    expect(asks('Perioden Badeanzug', '**91% der Testerinnen bestätigen: Die Period Swimwear Panty kann bei leichter Periode beim Schwimmen getragen werden.')).not.toBeNull();
  });

  it('a superlative "am Markt" with several words in between (shop28, audit 7 P053)', () => {
    expect(asks('Extra Strong – Slip – Seamless', 'Die saugstärkste & am schnellsten trockene Seamless Period Panty am Markt: Extra Strong 90% saugstärker als zuvor!')).not.toBeNull();
  });

  it('a Dermatest rating (shop16, audit 8 P096)', () => {
    expect(asks('Hydro Face Paket', '✔ Hautverträglichkeit mit SEHR GUT von Dermatest® bestätigt')).not.toBeNull();
  });

  it('leaves a plain description alone', () => {
    expect(asks('Slip', 'Weicher Slip aus Baumwolle, bequem am Bund.')).toBeNull();
  });
});
