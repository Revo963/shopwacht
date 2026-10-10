import type { ShopPage, ShopSnapshot } from '../types.js';
import { clip, evidence, matches, stems, words } from './text.js';
import type { ShopFinding, ShopRule } from './types.js';

function page(shop: ShopSnapshot, kind: ShopPage['kind']): ShopPage | undefined {
  return shop.pages.find((p) => p.kind === kind);
}

/** The page may exist but could not be loaded (rate limit, server error): don't call it missing. */
function unreachable(shop: ShopSnapshot, kind: ShopPage['kind']): boolean {
  return shop.unreachable.some((u) => u.kind === kind);
}

function subject(p: ShopPage | undefined, fallback: string) {
  return p ? { id: `page:${p.kind}`, title: fallback, url: p.url } : { id: 'page:home', title: 'Startseite' };
}

// ---------------------------------------------------------------- Impressum

// Addresses written against bots count – „service (at)
// shop3 (.) com“ (audit 15B), „hello (at) shop50.eu“ (audit 9); a bare „ at “ only after an e-mail label and a colon or
// line break, since English page text says „located at www.google.com“ or „email us at www.…“.
const AT_WRITTEN = String.raw`(?:@|\s*[([{]\s*at\s*[)\]}]\s*)`;
const DOT_WRITTEN = String.raw`(?:\.|\s*[([{]\s*(?:\.|dot|punkt)\s*[)\]}]\s*|\s+(?:dot|punkt)\s+)`;
const MAIL_DOMAIN = String.raw`[\w-]+(?:${DOT_WRITTEN}[\w-]+)*${DOT_WRITTEN}[a-z]{2,}`;
const MAIL_LABEL = String.raw`(?<!\p{L})(?:e-?mail(?:-?adresse)?|mail|kontakt)(?:\s*:\s*|\s*\n\s*)`;
const EMAIL = new RegExp(String.raw`[\w.+-]+${AT_WRITTEN}${MAIL_DOMAIN}|${MAIL_LABEL}[\w.+-]+\s+at\s+${MAIL_DOMAIN}`, 'iu');
const POSTCODE_CITY = /(?<!\d)\d{4,5}\s+\p{Lu}\p{L}+/u;
const COMPANY = /(?<![\p{L}])(?:GmbH|gGmbH|UG|AG|KG|OHG|SE|e\.\s?K\.|mbH)(?![\p{L}])/u;
const REGISTER = words('handelsregister', 'registergericht', 'amtsgericht', 'hrb', 'hra', 'registernummer');
const REPRESENTATIVE = words('geschäftsführ\\p{L}*', 'vertreten durch', 'vertretungsberechtigt\\p{L}*', 'vorstand', 'inhaber\\p{L}*');
const VAT_ID = words('umsatzsteuer-?\\s?(?:identifikations|id)\\p{L}*', 'ust\\.?\\s?-?\\s?id\\p{L}*', 'ust-?idnr\\p{L}*', 'vat', 'de\\s?\\d{3}\\s?\\d{3}\\s?\\d{3}(?!\\d)');

export const impressum: ShopRule = {
  id: 'impressum',
  title: 'Impressum fehlt oder ist unvollständig',
  severity: 'hoch',
  law: '§ 5 DDG (bis 13.05.2024: § 5 TMG)',
  explain:
    'Geschäftsmäßige Online-Angebote brauchen ein leicht erkennbares, unmittelbar erreichbares Impressum mit Name bzw. Firma inkl. Rechtsform, vollständiger Anschrift, E-Mail-Adresse, bei Gesellschaften Vertretungsberechtigten sowie Registergericht und Registernummer.',
  fix: 'Impressum von jeder Seite aus verlinken (Footer, Link-Text „Impressum“) und alle Pflichtangaben ergänzen. E-Mail-Adresse als Text, nicht nur als Kontaktformular.',
  kind: 'shop',
  async check(shop) {
    const home = page(shop, 'home');
    const imp = page(shop, 'impressum');
    if (!imp) {
      if (!home || unreachable(shop, 'impressum')) return [];
      return [{ ruleId: this.id, confidence: 0.9, evidence: [], note: 'Auf der Startseite wurde kein Link „Impressum“ gefunden.' }];
    }
    const text = imp.text;
    const where = subject(imp, 'Impressum');
    const out: ShopFinding[] = [];
    const missing = (note: string, confidence: number, level?: 'pruefen') =>
      out.push({ ruleId: this.id, page: where, confidence, evidence: [], note, level });

    if (!EMAIL.test(text)) missing('Keine E-Mail-Adresse gefunden.', 0.85);
    if (!POSTCODE_CITY.test(text)) missing('Keine Anschrift mit Postleitzahl und Ort gefunden.', 0.8);
    if (COMPANY.test(text)) {
      if (!matches(text, REGISTER)) missing('Gesellschaft erkannt, aber kein Registergericht / keine Registernummer gefunden.', 0.75, 'pruefen');
      if (!matches(text, REPRESENTATIVE)) missing('Gesellschaft erkannt, aber kein Vertretungsberechtigter (z. B. Geschäftsführer) gefunden.', 0.75, 'pruefen');
      // Mandatory only if the company has one – but a trading company almost always does.
      if (!matches(text, VAT_ID)) missing('Gesellschaft erkannt, aber keine Umsatzsteuer-Identifikationsnummer gefunden (Pflichtangabe, sofern vorhanden).', 0.7, 'pruefen');
    }
    return out;
  },
};

// Shops cite the TMG in the liability part too ("§ 7 Abs. 1 TMG").
const TMG = words('(?<![\\p{L}])tmg(?![\\p{L}])', 'telemediengesetz');

export const outdatedTmg: ShopRule = {
  id: 'impressum-tmg',
  title: 'Veralteter Verweis auf das TMG',
  severity: 'niedrig',
  law: '§ 5 DDG (seit 14.05.2024)',
  explain:
    'Das Telemediengesetz wurde am 14.05.2024 durch das Digitale-Dienste-Gesetz (DDG) ersetzt. Ein Verweis auf „§ 5 TMG“ ist allein kein Abmahngrund, zeigt aber, dass die Rechtstexte länger nicht aktualisiert wurden.',
  fix: '„§ 5 TMG“ durch „§ 5 DDG“ ersetzen und die übrigen Rechtstexte auf Aktualität prüfen.',
  kind: 'shop',
  async check(shop) {
    return onceAcross(this.id, shop.pages.filter((p) => matches(p.text, TMG)), TMG);
  },
};

// ---------------------------------------------------------------- Widerruf

const WITHDRAWAL_START = /widerrufsbelehrung|widerrufsrecht/i;
// The model sentence with a voluntarily longer period – „binnen dreißig Tagen“,
// „binnen 30 Tagen“, „Die Widerrufsfrist beträgt dreißig Tage“ (shop11.de, audit 16).
const LONGER_PERIOD = String.raw`(?:[2-9]\d|1\d\d|einundzwanzig|achtundzwanzig|dreißig|dreissig|vierzig|fünfzig|sechzig|neunzig|hundert)`;
const WITHDRAWAL_PERIOD = new RegExp(String.raw`(?:binnen|innerhalb von)\s+${LONGER_PERIOD}\s+tag|widerrufsfrist\s+beträgt\s+${LONGER_PERIOD}\s+tag`, 'iu');
// Anlage 2 EGBGB: "Hiermit widerrufe(n) ich/wir (*) den von mir/uns (*) abgeschlossenen Vertrag …"
// Anywhere, not only at a word start: page text often glues it to the line before ("…57 420Hiermit widerrufe").
const FORM_TEXT = stems('hiermit widerrufe', 'i/we \\(\\*\\) hereby give notice');

// The model form offered as a linked download or PDF counts –
// shop2.de links „Muster-Widerrufsformular“ (a PDF), shop6.com „PDF herunterladen“ (…/shop6-widerruf-komplett.pdf). A link
// to the Belehrung itself or to an online withdrawal ("Widerruf erklären") is no model form.
const FORM_NAME = /(?:muster[-_\s]?)?widerrufs[-_\s]?formular/iu;

function linksForm(html: string): boolean {
  for (const m of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/giu)) {
    const attrs = m[1]!;
    const href = /\bhref\s*=\s*["']([^"']*)["']/iu.exec(attrs)?.[1] ?? '';
    const title = /\btitle\s*=\s*["']([^"']*)["']/iu.exec(attrs)?.[1] ?? '';
    const named = `${m[2]!.replace(/<[^>]*>/g, ' ')} ${title} ${href}`;
    if (FORM_NAME.test(named)) return true;
    const file = /\.pdf(?:[?#]|$)/iu.test(href) || /(?:^|\s)download(?:[\s=]|$)/iu.test(attrs);
    if (file && /widerruf/iu.test(named)) return true;
  }
  return false;
}

/** Starts the text at the first heading that matters, so the model is not fed menus and banners first. */
function focusOn(text: string, re: RegExp): string {
  const i = text.search(re);
  return i > 0 ? text.slice(i) : text;
}

export const withdrawalNotice: ShopRule = {
  id: 'withdrawal-notice',
  title: 'Widerrufsbelehrung fehlt oder ist unvollständig',
  severity: 'hoch',
  law: '§ 312g BGB; Art. 246a § 1 Abs. 2 EGBGB; Anlagen 1 und 2 zu Art. 246a EGBGB',
  explain:
    'Verbraucher müssen vor dem Kauf über ihr 14-tägiges Widerrufsrecht belehrt werden – mit Bedingungen, Fristen, Verfahren, Anschrift und dem Muster-Widerrufsformular. Fehler in der Belehrung verlängern die Widerrufsfrist auf bis zu 12 Monate und 14 Tage und werden oft abgemahnt.',
  fix: 'Eine vollständige deutsche Widerrufsbelehrung nach dem gesetzlichen Muster (Anlage 1 EGBGB) samt Muster-Widerrufsformular (Anlage 2) veröffentlichen und im Footer verlinken. Englische Standard-„Refund Policy“-Texte ersetzen.',
  kind: 'shop',
  async check(shop, ask) {
    const home = page(shop, 'home');
    const notice = page(shop, 'widerruf');
    if (!notice) {
      if (!home || unreachable(shop, 'widerruf')) return [];
      return [{ ruleId: this.id, confidence: 0.85, evidence: [], note: 'Keine Seite zur Widerrufsbelehrung gefunden.' }];
    }
    const where = subject(notice, 'Widerrufsbelehrung');
    const looksComplete = matches(notice.text, words('widerruf\\p{L}*')) && (matches(notice.text, words('vierzehn tage', '14 tage')) || matches(notice.text, WITHDRAWAL_PERIOD));
    // A longer period the seller grants voluntarily
    // („binnen dreißig Tagen“, shop11.de) is more than the law asks; the question asked about "the 14-day right", and Jev
    // called such a Belehrung incomplete.
    const answers = await ask(
      { seite: notice.url, text: clip(focusOn(notice.text, WITHDRAWAL_START)) },
      {
        is_withdrawal_notice: {
          type: 'noul',
          instructions:
            'Is this text a German consumer withdrawal notice (Widerrufsbelehrung) that explains the right of withdrawal and its period (the statutory 14 days, or a longer period the seller grants voluntarily, such as 30 days), how to exercise it including the seller\'s name and address, and the consequences of withdrawal (refund, return costs)?',
          criteria: {
            true: 'A complete Widerrufsbelehrung, typically starting with "Widerrufsrecht – Sie haben das Recht, binnen vierzehn Tagen ohne Angabe von Gründen diesen Vertrag zu widerrufen"; a longer period ("binnen dreißig Tagen") is just as complete.',
            false: 'Missing, only a short return policy, an English refund policy, a page about something else, or key parts are missing.',
          },
        },
      },
      { is_withdrawal_notice: looksComplete ? 0.9 : 0.2 },
    );
    const out: ShopFinding[] = [];
    const p = answers.noul('is_withdrawal_notice');
    // Many shops put the Widerrufsbelehrung inside their AGB, which is fine.
    const agb = page(shop, 'agb');
    const inAgb = !!agb && matches(agb.text, words('widerrufsbelehrung')) && (matches(agb.text, words('vierzehn tage', '14 tage')) || matches(agb.text, WITHDRAWAL_PERIOD));
    if (p < 0.5 && !inAgb) {
      out.push({
        ruleId: this.id,
        page: where,
        confidence: 1 - p,
        evidence: [],
        note: 'Die verlinkte Seite ist keine vollständige Widerrufsbelehrung.',
        basis: 'modell',
      });
    }
    // The form itself, not a sentence mentioning it ("Sie können dafür ein Muster-Widerrufsformular verwenden").
    // It may sit in the AGB with the rest of the Belehrung.
    const hasForm =
      [notice, agb].some((pg) => !!pg && (matches(pg.text, FORM_TEXT) || linksForm(pg.html))) ||
      shop.homeLinks.some((l) => matches(l.text, words('widerrufsformular')));
    if (!hasForm) {
      out.push({ ruleId: this.id, page: where, confidence: 0.7, evidence: [], note: 'Kein Muster-Widerrufsformular gefunden.', level: 'pruefen' });
    }
    return out;
  },
};

// A link counts when its text or address leads to a withdrawal
// action or form, whatever the wording ("Auftrag widerrufen", "zum widerrufsformular"). "Widerruf", "Widerrufsrecht"
// and a refund-policy address only open the Widerrufsbelehrung.
const WITHDRAW_LINK = words(
  'widerrufen',
  'widerrufs?-?(?:formular|button|funktion)',
  'widerruf (?:hier )?erklären',
  'withdraw from (?:the )?contract',
);

// In a page text, "den Vertrag widerrufen wollen" is the statutory
// sample form (Anlage 2 EGBGB), not a button. Only wording that stands on its own counts there.
const WITHDRAW_BUTTON_ON_PAGE = words(
  'vertr(?:ag|äge) (?:hier )?widerrufen(?!\\s+(?:wollen|möchten|willst|will|und|oder))',
  'widerruf(?:s)?(?:button|funktion)',
  'widerruf (?:hier )?erklären',
);

export const withdrawalButton: ShopRule = {
  id: 'withdrawal-button',
  title: 'Widerrufsbutton nicht gefunden',
  severity: 'mittel',
  since: '2026-06-19',
  law: '§ 356a BGB (Umsetzung RL (EU) 2023/2673), gilt seit 19.06.2026',
  explain:
    'Seit dem 19.06.2026 müssen Online-Shops eine elektronische Widerrufsfunktion anbieten – beschriftet mit „Vertrag widerrufen“ oder gleich eindeutig –, die während der Widerrufsfrist ständig verfügbar, hervorgehoben und leicht zugänglich ist.',
  fix: 'Eine Schaltfläche „Vertrag widerrufen“ gut sichtbar einbauen (z. B. Footer und Kundenkonto), die zu einem Formular mit Bestätigungsschritt führt, und den Eingang des Widerrufs per E-Mail bestätigen.',
  maxLevel: 'pruefen',
  kind: 'shop',
  async check(shop) {
    const home = page(shop, 'home');
    if (!home) return [];
    // Only the homepage text can hold a button. On the legal pages
    // "Wenn Sie diesen Vertrag widerrufen, haben wir Ihnen alle Zahlungen …" is the statutory Folgen-des-Widerrufs
    // sentence; it was taken for a button at shop8, shop9 and shop10.
    const found =
      shop.homeLinks.some((l) => matches(l.text, WITHDRAW_LINK) || matches(l.href, WITHDRAW_LINK)) ||
      matches(home.text, WITHDRAW_BUTTON_ON_PAGE);
    if (found) return [];
    return [
      {
        ruleId: this.id,
        confidence: 0.75,
        evidence: [],
        note: 'Auf Startseite, Footer und Rechtstexten kein „Vertrag widerrufen“ gefunden. Die Funktion kann auch nur im Kundenkonto liegen – bitte dort prüfen.',
      },
    ];
  },
};

// ---------------------------------------------------------------- Datenschutz, OS-Plattform

export const privacyPolicy: ShopRule = {
  id: 'privacy-policy',
  title: 'Datenschutzerklärung nicht gefunden',
  severity: 'hoch',
  law: 'Art. 13 DSGVO',
  explain:
    'Jeder Shop verarbeitet personenbezogene Daten und braucht eine leicht erreichbare Datenschutzerklärung. Fehlt sie, drohen Abmahnungen und Bußgelder.',
  fix: 'Eine vollständige Datenschutzerklärung veröffentlichen und auf jeder Seite im Footer verlinken.',
  kind: 'shop',
  async check(shop) {
    if (!page(shop, 'home') || page(shop, 'datenschutz') || unreachable(shop, 'datenschutz')) return [];
    return [{ ruleId: this.id, confidence: 0.85, evidence: [], note: 'Auf der Startseite kein Link „Datenschutz“ gefunden.' }];
  },
};

const ODR = words(
  '(?:webgate\\.)?ec\\.europa\\.eu/(?:consumers/)?odr',
  'os-plattform',
  'plattform (?:der eu-kommission )?(?:zur|für die) (?:außergerichtliche[nr]? )?online-streitbeilegung',
  'online-streitbeilegungs-?(?:plattform|verordnung)',
);

export const odrLink: ShopRule = {
  id: 'odr-link',
  title: 'Veralteter Hinweis auf die OS-Plattform',
  severity: 'niedrig',
  law: 'VO (EU) 2024/3228 (Aufhebung der ODR-VO); Plattform eingestellt am 20.07.2025',
  explain:
    'Die EU-Plattform zur Online-Streitbeilegung wurde am 20.07.2025 abgeschaltet, die Pflicht zum Link ist entfallen. Der tote Link ist überflüssig und wird teils als irreführend eingestuft.',
  fix: 'Link und Hinweis auf die OS-Plattform aus Impressum, AGB und Footer entfernen. Den Hinweis zur Verbraucherschlichtung nach § 36 VSBG beibehalten, soweit er für Sie Pflicht ist.',
  kind: 'shop',
  async check(shop) {
    return onceAcross(this.id, shop.pages.filter((p) => matches(p.html, ODR) || matches(p.text, ODR)), ODR);
  },
};

function pageTitle(p: ShopPage): string {
  return { home: 'Startseite', impressum: 'Impressum', widerruf: 'Widerrufsbelehrung', datenschutz: 'Datenschutzerklärung', agb: 'AGB' }[p.kind];
}

/** Footer text repeats on every page; report a shop-wide issue once and list where it appears. */
function onceAcross(ruleId: string, hits: ShopPage[], re: RegExp): ShopFinding[] {
  const first = hits[0];
  if (!first) return [];
  const withText = hits.find((p) => evidence(p.text, re, 1).length > 0) ?? first;
  return [
    {
      ruleId,
      page: subject(withText, pageTitle(withText)),
      confidence: 1,
      evidence: evidence(withText.text, re, 1),
      note: hits.length > 1 ? `Gefunden auf: ${hits.map(pageTitle).join(', ')}` : undefined,
    },
  ];
}
