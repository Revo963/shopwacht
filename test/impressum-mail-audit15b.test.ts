// An e-mail address written against bots counts in the Impressum.
import { describe, expect, it } from 'vitest';
import { Answers } from '../src/rules/types.js';
import { impressum } from '../src/rules/shop.js';
import type { ShopPage, ShopSnapshot } from '../src/types.js';

const NO_MAIL = 'Keine E-Mail-Adresse gefunden.';
const ask = async () => new Answers({});
const notes = async (url: string, text: string) => {
  const origin = url.replace(/(https:\/\/[^/]+).*/, '$1');
  const home: ShopPage = { kind: 'home', url: `${origin}/`, html: '', text: '' };
  const shop: ShopSnapshot = { origin, platform: 'shopify', products: [], pages: [home, { kind: 'impressum', url, html: '', text }], homeLinks: [], truncated: false, unreachable: [] };
  return (await impressum.check(shop, ask)).map((f) => f.note);
};

// www.shop3.com/pages/impressum (audit 15B, S2), labelled complete.
const EFFECTIVE_NATURE = (mail: string) =>
  `Impressum\nFair Trade Handels AG\nSeidenhofstrasse 2\nCH-6003 Luzern\nTelefon aus der Schweiz: 041 / 511 85 00\nTelefon weltweit: +41 41 511 85 00\n${mail}\nInternet: www.shop3.com\nEingetragen im Handelsregister des Kantons Luzern\nRegisternummer: CH-020.3.922.074-2\nUID: CHE-107.885.990\nVertretungsberechtigter Vorstand: Tim Muthmann\nUSt-IdNr.: DE 277942401`;
// shop50.eu/policies/legal-notice (audit 9).
const SHARE =
  'Impressum\nshare GmbH\nErkelenzdamm 59-61\n10999 Berlin\nDeutschland\nMail: hello (at) shop50.eu\nGeschäftsführung:\nDaniela Eder & Stephan K. Heinrich\nHandelsregister:\nAG Charlottenburg, HRB 186219 B\nUmsatzsteuer-Identifikationsnummer(n):\nDE311841837';
// www.shop18.com/policies/legal-notice (audit 14): phone and a contact form, no e-mail address.
const SHOP18 =
  'Impressum\nHey Marly GmbH\nVogelsanger Straße 80a\n50823 Köln\nDeutschland\nTelefon: 0221 29294830\nKontakt: https://www.shop18.com/pages/contact\nGeschäftsführer:\nPhilip Neidhart, Paula Neidhart, Andre Poloczek\nHandelsregister: Amtsgericht Köln, HRB 108829\nUmsatzsteuer-Identifikationsnummer: DE 315842351';
// An English privacy text (audit 6): „at“ before a web address is no e-mail.
const GOOGLE = 'review Google’s website, “How Google uses data when you use our partners’ sites or apps” located at www.google.com/policies/privacy/partners/.';

describe('e-mail addresses written against bots in the Impressum', () => {
  it('reads „(at)“ and „(.)“ with spaces (shop3.com) and „(at)“ before a plain domain (shop50.eu)', async () => {
    expect(await notes('https://www.shop3.com/pages/impressum', EFFECTIVE_NATURE('E-Mail: service (at) shop3 (.) com'))).toEqual([]);
    expect(await notes('https://shop50.eu/policies/legal-notice', SHARE)).toEqual([]);
  });

  it('reads „[at]“ (shop32.de writes „support[at]shop32.de“ in its withdrawal form) and a bare „ at “ after an e-mail label', async () => {
    for (const mail of ['E-Mail: service[at]shop3.com', 'E-Mail: service [ at ] shop3 [.] com', 'E-Mail: service at shop3.com', 'E-Mail-Adresse:\nservice at shop3 dot com'])
      expect(await notes('https://www.shop3.com/pages/impressum', EFFECTIVE_NATURE(mail))).toEqual([]);
  });

  it('still reports a missing address: none at all (shop18.com), a bare „at“ without an e-mail label, or a web address', async () => {
    expect(await notes('https://www.shop18.com/policies/legal-notice', SHOP18)).toEqual([NO_MAIL]);
    expect(await notes('https://www.shop3.com/pages/impressum', EFFECTIVE_NATURE(`Kundenservice at shop3.com ${GOOGLE}`))).toEqual([NO_MAIL]);
    expect(await notes('https://www.shop3.com/pages/impressum', EFFECTIVE_NATURE('Kontaktformular at www.shop3.com/pages/kontakt'))).toEqual([NO_MAIL]);
  });
});
