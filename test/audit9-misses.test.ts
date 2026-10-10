// Two misses of the ninth audit, both lost at the trigger stage; texts are from the recorded feed.
import { describe, expect, it } from 'vitest';
import { greenGeneric, healthClaim } from '../src/rules/claims.js';
import { product } from './helpers.js';

describe('a misspelt generic green claim still triggers (audit 9, shop29 P056)', () => {
  const culotte = product({
    title: 'Culotte JOALINE',
    text: 'Die SHOP29 Damen Hose JOALINE setzt auf faire Produktion und ressourenschonende Materialien.\nHose oder doch lieber Rock? Culotte JOALINE aus 100% LENZING™ ECOVERO™ Viskosefasern ist die Antwort auf beides.',
  });

  it('asks about "ressourenschonende Materialien" (the shop drops the c)', () => {
    const prepared = greenGeneric.prepare(culotte);
    expect(prepared).not.toBeNull();
    expect(prepared!.evidence.join(' ')).toContain('ressourenschonende Materialien');
  });

  it('still asks about the correct spelling', () => {
    const correct = product({ title: 'Top', text: 'Das Top setzt auf ressourcenschonende Materialien.\nEs hat schmale Träger.' });
    expect(greenGeneric.prepare(correct)).not.toBeNull();
  });
});

describe('caffeine effect wording triggers the health-claim rule (audit 9, shop40 P101)', () => {
  const caps = product({
    title: 'Performance Caps Kapseln',
    category: 'Weitere Nährstoffe',
    text: 'Unsere Performance Caps sind dein praktischer Muntermacher zum Mitnehmen für jeden Aktiv-Tag: Vorm Workout, beim Mittagstief im Büro oder auf Reisen. Ein Koffein-Kick von 2 Espressi in nur einer Kapsel – und dabei sanft zum Magen!',
  });

  it('asks about "Muntermacher" and "Koffein-Kick"', () => {
    const prepared = healthClaim.prepare(caps);
    expect(prepared).not.toBeNull();
    const evidence = prepared!.evidence.join(' ');
    expect(evidence).toContain('Muntermacher');
    expect(evidence).toContain('Koffein-Kick');
  });

  it('also "Koffeinkick" written as one word (audit 1) and "Wachmacher"', () => {
    const shake = product({ title: 'Protein Shake Coffee', text: 'Dein Koffeinkick am Morgen.' });
    const drink = product({ title: 'Mate Drink', text: 'Der natürliche Wachmacher für lange Nächte.' });
    expect(healthClaim.prepare(shake)).not.toBeNull();
    expect(healthClaim.prepare(drink)).not.toBeNull();
  });

  it('leaves a bare "Kick" alone: fresh deodorant and spicy food carry no health claim', () => {
    const deo = product({ title: 'Deo Papertube Sensitiv', text: 'Lemon & Lime: Spritzige Zitrusnoten für den Frische-Kick.' });
    const chili = product({ title: 'Spicy Hack', text: 'Seinen besonderen Kick erhält Spicy Hack durch das leicht fruchtige Gochujang.' });
    expect(healthClaim.prepare(deo)).toBeNull();
    expect(healthClaim.prepare(chili)).toBeNull();
  });
});
