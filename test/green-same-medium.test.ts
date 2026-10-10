// Green claims under the EmpCo definition (Drucksache 21/1855, recital 9 of
// Directive (EU) 2024/825): a claim is "allgemein" only if its specification is not given clearly on the same medium.
// Texts are from the recorded audits.
import { describe, expect, it } from 'vitest';
import { greenGeneric } from '../src/rules/claims.js';
import { product } from './helpers.js';

const ask = (title: string, text: string) => greenGeneric.prepare(product({ title, text }));

describe('"nachhaltig" in the sense of "lasting" is no environmental claim', () => {
  it.each([
    ['Moms Still BH lace schwarz', 'Er hat die Funktion einer Stilleinlage eingebaut und unterstützt dich nachhaltig dabei, den Tag und die Nacht sorgenfrei mit deinem Baby zu genießen.'],
    ['Green Dust, BBQ-Rub', 'Green Dust bringt grüne Power auf den Teller und sorgt für ein Geschmackserlebnis, das nachhaltig begeistert.'],
  ])('%s', (title, text) => {
    expect(ask(title, text)).toBeNull();
  });
});

describe('the basis in the same or a neighbouring sentence specifies the claim', () => {
  it('"nachhaltiger Qualität" with GOTS in the next sentence (shop44, audit 4)', () => {
    expect(ask('T-Shirt Regular (GOTS)', 'Dieses zeitlose Herren T-Shirt im Regular Fit vereint höchsten Tragekomfort mit nachhaltiger Qualität. Gefertigt aus 100 % GOTS-zertifizierter Bio-Baumwolle.')).toBeNull();
  });

  it('plastic-free in the same sentence (shop17, audit 6)', () => {
    expect(ask('soulbottle • midnight chill B-Ware', 'Plastikfrei, geschmacksneutral und auslaufsicher: nachhaltig trinken zum reduzierten Preis.')).toBeNull();
  });

  it('ceramic as the material in the same sentence (shop17, audit 6)', () => {
    expect(ask('keramikdeckel • versch. farben', 'Egal ob leuchtend bunt oder dezent, die Deckel aus Keramik sind nicht nur stilvoll, sondern auch nachhaltig und robust.')).toBeNull();
  });

  it('grown without pesticides in the same sentence (shop37, audit 5)', () => {
    expect(ask('Amnesia CBD Blüten (2 g)', 'Amnesia wird im Greenhouse nachhaltig und ökologisch kultiviert, frei von Herbiziden, Pestiziden und chemischen Düngern.')).toBeNull();
  });
});

describe('a claim without any nearby specification stays a finding', () => {
  it('"nachhaltige Armband" with no basis', () => {
    expect(ask('Armband', 'Dieses nachhaltige Armband bringt die raue Schönheit der Polarregionen an dein Handgelenk. Perfekt als Geschenk.')).not.toBeNull();
  });

  it('"umweltfreundlich gereinigt"', () => {
    expect(ask('Handtuch', 'Umweltfreundlich gereinigt und schnell geliefert.')).not.toBeNull();
  });

  it('a basis three sentences away is not "clearly" next to the claim', () => {
    expect(ask('Rucksack', 'Unser nachhaltiger Rucksack für jeden Tag. Er hat viele Fächer. Er ist wasserabweisend. Er passt in jedes Handgepäck. Material: 100 % recyceltes Polyester.')).not.toBeNull();
  });
});
