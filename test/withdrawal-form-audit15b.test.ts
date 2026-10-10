// A model withdrawal form offered as a linked download or PDF counts.
import { describe, expect, it } from 'vitest';
import { Answers } from '../src/rules/types.js';
import { withdrawalNotice } from '../src/rules/shop.js';
import type { ShopPage, ShopSnapshot } from '../src/types.js';

const complete = async () => new Answers({ is_withdrawal_notice: { type: 'noul' as const, noul: 0.95 } });
const home: ShopPage = { kind: 'home', url: 'https://shop2.de/', html: '', text: 'Shop2' };
const shopWith = (notice: ShopPage): ShopSnapshot => ({ origin: notice.url.replace(/(https:\/\/[^/]+).*/, '$1'), platform: 'shopify', products: [], pages: [home, notice], homeLinks: [], truncated: false, unreachable: [] });

// shop2.de/policies/refund-policy (audit 15B, S1): the Belehrung names the form and links it at the end, as a PDF.
const SHOP2_TEXT =
  'Widerrufsrecht Als Verbraucher haben Sie ein zweiwöchiges Widerrufsrecht, wenn Sie unsere Produkte über unseren Onlineshop bestellt haben. In unserem Formular können Sie online den Widerruf erklären. … Sie können dafür das beigefügte Muster-Widerrufsformular verwenden, das jedoch nicht vorgeschrieben ist. … – Ende der Widerrufsbelehrung – Sie können das Muster-Widerrufsformular auch auf unserer Website herunterladen: Muster-Widerrufsformular';
const SHOP2_OTHER_LINKS =
  '<p>In unserem Formular können Sie online den <a href="https://shop2.de/pages/formular-widerrufserklaerung">Widerruf erklären</a>.</p><a href="/policies/refund-policy" class="text-sm link-faded">Widerruf</a>';
const SHOP2_FORM_LINK =
  '<p>Sie können das Muster-Widerrufsformular auch auf unserer Website herunterladen: <a href="https://cdn.shopify.com/s/files/1/0586/8037/7432/files/Shop2_Widerrufsformular.pdf?v=1723020924" title="Muster Widerrufsformular" target="_blank">Muster-Widerrufsformular</a></p>';

// shop6.com/pages/widerrufsbelehrung (audit 15B, S6): Belehrung on the page, the form only in the PDF.
const SHOP6_TEXT =
  'Widerrufsbelehrung & Widerrufsformular. Du hast 14 Tage Zeit, einen Kauf zu widerrufen. … PDF — Widerrufsbelehrung & Muster-Widerrufsformular gemäß § 355 BGB Zum Herunterladen & Ausdrucken Das kombinierte Dokument enthält die vollständige Widerrufsbelehrung sowie das Muster-Widerrufsformular. Einfach herunterladen, ausfüllen und per E-Mail oder Post einsenden. PDF herunterladen A Widerrufsbelehrung Widerrufsrecht Sie haben das Recht, binnen vierzehn Tagen ohne Angabe von Gründen diesen Vertrag zu widerrufen.';
const SHOP6_LINK =
  '<a href="https://cdn.shopify.com/s/files/1/0995/6740/3352/files/shop6-widerruf-komplett.pdf?v=1782737501" class="btn-sand" download> <svg width="16" height="16" viewbox="0 0 24 24"><path d="M12 15V3"></path></svg> PDF herunterladen </a><a href="/pages/versand-retour" target="_blank" title="Versand & Retour"><strong>Formular CN 23 </strong></a>';

const notes = async (notice: ShopPage) => (await withdrawalNotice.check(shopWith(notice), complete)).map((f) => f.note);

describe('the model withdrawal form, offered as a download', () => {
  it('counts a linked PDF named as the form (shop2.de) or a download of the Belehrung and form (shop6.com)', async () => {
    expect(await notes({ kind: 'widerruf', url: 'https://shop2.de/policies/refund-policy', text: SHOP2_TEXT, html: SHOP2_OTHER_LINKS + SHOP2_FORM_LINK })).toEqual([]);
    expect(await notes({ kind: 'widerruf', url: 'https://shop6.com/pages/widerrufsbelehrung', text: SHOP6_TEXT, html: SHOP6_LINK })).toEqual([]);
  });

  it('does not count an online withdrawal link, a link back to the Belehrung, or another shop form', async () => {
    expect(await notes({ kind: 'widerruf', url: 'https://shop2.de/policies/refund-policy', text: SHOP2_TEXT, html: SHOP2_OTHER_LINKS })).toEqual(['Kein Muster-Widerrufsformular gefunden.']);
    const ethleticWithoutPdf = SHOP6_LINK.replace(/<a href="https:\/\/cdn[\s\S]*?<\/a>/, '');
    expect(await notes({ kind: 'widerruf', url: 'https://shop6.com/pages/widerrufsbelehrung', text: SHOP6_TEXT, html: ethleticWithoutPdf })).toEqual(['Kein Muster-Widerrufsformular gefunden.']);
  });
});
