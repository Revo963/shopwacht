import { matches, stems } from './text.js';
import type { ProductRule } from './types.js';

// Compounds count as the fibre name ("100 % Baumwoll Musselin (kbA)").
const FIBRES =
  'bio[- ]?baumwoll\\p{L}*|baumwoll\\p{L}*|polyester|elasthan|elastan|viskose|merinowolle|schurwolle|wolle|leinen|seide|polyamid|nylon|polyacryl|acryl|modal|lyocell|tencel|kaschmir|cashmere|alpaka|hanf|polyurethan|elastodien|cupro|jute|mohair|angora|cotton|wool|linen|silk|viscose|elastane';

const COMPOSITION = [
  new RegExp(`\\d{1,3}(?:[.,]\\d)?\\s?%\\s?(?:recycelte[sr]?\\s|organic\\s)?(?:${FIBRES})`, 'iu'),
  new RegExp(`(?:${FIBRES})\\s?:?\\s?\\d{1,3}(?:[.,]\\d)?\\s?%`, 'iu'),
  /(?<![\p{L}])(?:reine?s?|pure)\s(?:baumwolle|schurwolle|wolle|seide|leinen)/iu,
];

// "Zwickel: 100 % Bio-Baumwolle" alone
// is the gusset's composition, not the product's. A percentage counts only if its clause is not about a component.
// The component must label the percentages ("Spitze: 90 % Polyamid, 10 % Elasthan", "Zwickel aus …");
// "mit Bündchen, 100 % Baumwolle" is still the product's own composition.
const COMPONENT_LABEL =
  /(?:zwickel|futter|einlage|einsatz|besatz|bündchen|gummibund|gummiband|kordel|tunnelzug|spitze|applikation|stickerei|taschenbeutel|lining|gusset|trim)\p{L}*\s*(?:\([^)]*\)\s*)?(?::|(?:besteht\s+|ist\s+)?aus(?![\p{L}]))/iu;
const MAIN_FABRIC = /obermaterial|hauptmaterial|oberstoff|außenmaterial|außenstoff|grundstoff|(?<![\p{L}])material(?![\p{L}])|(?<![\p{L}])stoff(?![\p{L}])|shell|main fabric/iu;

export function statesComposition(text: string): boolean {
  for (const re of COMPOSITION) {
    for (const m of text.matchAll(new RegExp(re.source, `${re.flags}g`))) {
      const clause = text.slice(Math.max(0, m.index - 60), m.index).split(/[.;\n]/).at(-1) ?? '';
      if (!COMPONENT_LABEL.test(clause) || MAIN_FABRIC.test(clause)) return true;
    }
  }
  return false;
}

/** The composition as found in the text, with a little context, or null. */
export function compositionSnippet(text: string, radius = 50): string | null {
  for (const re of COMPOSITION) {
    const m = re.exec(text);
    if (m) return text.slice(Math.max(0, m.index - radius), m.index + m[0].length + radius).replace(/\s+/g, ' ').trim();
  }
  return null;
}

const TEXTILE_HINT = stems(
  't-?shirt',
  'shirt',
  'hemd',
  'bluse',
  'pullover',
  'pulli',
  'hoodie',
  'sweatshirt',
  'sweatjacke',
  'jacke',
  'mantel',
  '(?<![\\p{L}])hose',
  'hosen',
  'jeans',
  'leggings',
  'shorts',
  'kleid(?!ung)',
  'kleidung',
  'socke',
  'strumpf',
  'strümpfe',
  'unterwäsche',
  'unterhose',
  'boxershorts',
  'slip(?!per)',
  '(?<![\\p{L}])bh(?![\\p{L}])',
  'schal(?![\\p{L}])',
  'mütze',
  'handschuh',
  'pyjama',
  'schlafanzug',
  'bettwäsche',
  'bettbezug',
  'kissenbezug',
  'spannbettlaken',
  'handtuch',
  'handtücher',
  'bademantel',
  'musselin',
  'spucktuch',
  'mulltuch',
  'wolldecke',
  'kuscheldecke',
  'vorhang',
  'gardine',
  'meterware',
  'textil',
);

export const textileFibre: ProductRule = {
  id: 'textile-fibre',
  title: 'Faserzusammensetzung fehlt',
  severity: 'mittel',
  law: 'Art. 14, 16 Textilkennzeichnungsverordnung (EU) Nr. 1007/2011',
  explain:
    'Bei Textilien muss die Faserzusammensetzung mit Prozentangaben und den gesetzlichen Faserbezeichnungen (z. B. „95 % Baumwolle, 5 % Elasthan“) schon vor dem Kauf im Angebot stehen – ein Etikett am Produkt reicht im Onlinehandel nicht.',
  fix: 'Die Faserzusammensetzung als Text in jede Produktbeschreibung aufnehmen (nicht nur als Bild), mit den Bezeichnungen aus Anhang I der Verordnung – „Elasthan“ statt „Stretch“, „Polyamid“ statt „Microfaser“.',
  // Many themes load the composition with JavaScript after the page renders, which we cannot see.
  maxLevel: 'pruefen',
  kind: 'product',
  prepare(p) {
    const text = [p.title, p.category ?? '', p.tags.join(' '), p.text].join('\n');
    if (statesComposition(text) || !matches(text, TEXTILE_HINT)) return null;
    return {
      questions: {
        is_textile: {
          type: 'noul',
          instructions:
            'Is this product a textile product: clothing, underwear, socks, nightwear, home textiles (bed linen, towels, blankets, curtains), fabric sold by the metre, or another item made of at least 80 % textile fibres by weight?',
          criteria: {
            true: 'e.g. a T-shirt, hoodie, jeans, socks, a duvet cover, a bath towel, cotton fabric by the metre.',
            false: 'Shoes, jewellery, cosmetics, food, electronics, furniture, leather goods, hard toys, printed posters, vouchers, or accessories mainly made of metal or plastic — even if the text mentions clothing words. Bracelets, key rings, lanyards and zipper pulls braided from rope, fishing net or plastic cord are not textile products either.',
          },
        },
      },
      hints: { is_textile: 0.75 },
      evidence: [],
      // Raw attribute data is not a readable fibre declaration.
      note: 'Keine Faserzusammensetzung im geprüften Produkttext gefunden. Bitte die Angaben auf der Produktseite einschließlich Material-Reitern prüfen.',
    };
  },
  judge: (a) => a.noul('is_textile'),
  // A bundle's page section says it is clothing when the feed does not.
  readsPageText: true,
  // Do not accept encoded attributes or other products' descriptions.
  verifyOnPage: (page) => !statesComposition(page.productText || page.text),
};
