// Advertising claims in product texts: green claims, health claims, test claims, guarantees.
// Questions are phrased in English (Jev's documented language); the shop text stays German.

import type { Question } from '../decisions/types.js';
import type { Product } from '../types.js';
import { authorisedClaimStems, authorisedClaimsFor, claimStem, isAuthorisedClaimSentence } from './health-register.js';
import { evidence, matches, passage, stems, words } from './text.js';
import type { Answers, ProductRule, RuleMeta } from './types.js';

function productText(p: Product): string {
  return `${p.title}\n${p.text}`;
}

interface TextRuleSpec extends RuleMeta {
  trigger: RegExp;
  questions: Record<string, Question>;
  /** Keyword guesses for demo mode. */
  hints(text: string): Record<string, number | string>;
  judge(a: Answers): number;
  alsoOnHomepage?: boolean;
}

/** A rule that only asks Jev when its keyword trigger fires, and quotes the hits as evidence. */
function textRule(spec: TextRuleSpec): ProductRule {
  const { trigger, questions, hints, judge, ...meta } = spec;
  return {
    ...meta,
    kind: 'product',
    highlight: trigger,
    prepare(p) {
      const text = productText(p);
      if (!matches(text, trigger)) return null;
      return { questions, hints: hints(text), evidence: evidence(text, trigger) };
    },
    judge: (a) => judge(a),
  };
}

// ---------------------------------------------------------------- shared questions

const PRODUCT_CATEGORY: Question = {
  type: 'choice',
  instructions: 'What kind of product is described?',
  criteria: {
    food: 'Food, drink, tea, dietary supplement (Nahrungsergänzungsmittel), superfood, sports nutrition',
    cosmetic: 'Cosmetics and body care: skin care, hair care, make-up, soap, deodorant, oral care',
    medical: 'Medicinal product (Arzneimittel) or medical device (Medizinprodukt) explicitly sold as such',
    other: 'Anything else: clothing, electronics, household goods, toys, pet products, furniture, services',
  },
};

// ---------------------------------------------------------------- green claims

const GREEN_GENERIC = words(
  'umwelt(?:freundlich|schonend|bewusst|verträglich|gerecht)\\p{L}*',
  'nachhaltig\\p{L}*',
  'klima(?:freundlich|schonend|bewusst)\\p{L}*',
  'ökologisch\\p{L}*',
  // Not the organic control body code "DE-ÖKO-039".
  '(?<!de-)öko(?![\\p{L}]|-\\d)',
  '(?<!de-)öko-(?!\\d)',
  'natur(?:freundlich|schonend)\\p{L}*',
  // The shop writes "ressourenschonend" without the c.
  'ressourc?en(?:schonend|sparend)\\p{L}*',
  'planeten(?:freundlich)\\p{L}*',
  'gut für (?:die umwelt|den planeten|das klima)',
  '(?:der umwelt|dem planeten) zuliebe',
  'schont? die umwelt',
  'grüne(?:s|r|n)? (?:wahl|alternative|gewissen|produkt)',
  'eco[- ]?friendly',
  'sustainabl\\p{L}*',
  'environmentally friendly',
  'planet[- ]friendly',
);

const SPECIFIC_GREEN = words('\\d+\\s?%', 'recycel\\p{L}*', 'zertifiziert\\p{L}*', 'blauer engel', 'eu ecolabel', 'gots', 'fsc', 'grs');

// 17 of 26 findings were sentences that carry their own basis
// ("Nachhaltige Geschenktüte aus Papier", "nachhaltig produziert aus rostfreiem Edelstahl", "aus 97 % Fairtrade-
// Baumwolle") or mission statements, although the question already says so: Jev kept answering yes. The convention
// is fixed – a named material, a percentage or a certification in the same sentence explains
// the word – so it is applied here, before Jev is asked, instead of being asked for again in the prompt.
const MATERIAL =
  '\\p{L}*(?:papier|karton|pappe|holz|bambus|kork|glas|edelstahl|stahl|aluminium|baumwolle|leinen|hanf|wolle|seide|kautschuk|latex|zuckerrohr|agave|zellulose|fischernetz|plastikflasche|ozeanplastik|kaffeesatz|altkleider|altglas|keramik|porzellan|kokos)\\p{L}*';
const BASIS_IN_SENTENCE = words(
  '\\d+\\s?%',
  'recycel\\p{L}*',
  'recycled',
  'upcycel\\p{L}*',
  'upcycled',
  'zertifiziert\\p{L}*',
  'gots',
  'fsc',
  'grs',
  'oeko-?tex\\p{L}*',
  'fairtrade\\p{L}*',
  'blauer engel',
  'eu[- ]ecolabel',
  `aus\\s+(?:[\\p{L}-]+\\s+){0,2}${MATERIAL}`,
  // Concrete, checkable properties.
  // Not "biologisch abbaubar" or "kompostierbar": recital 9 of Directive (EU) 2024/825 lists those as generic claims themselves.
  'plastik-?frei\\p{L}*',
  'kunststoff-?frei\\p{L}*',
  'ohne (?:plastik|kunststoff)',
  'wiederverwendbar\\p{L}*',
  'mehrweg\\p{L}*',
  'nachfüllbar\\p{L}*',
  'refill\\p{L}*',
  'frei von (?:herbiziden|pestiziden|chemischen düngern)',
  'ohne (?:pestizide|herbizide|chemische düngemittel)',
  '(?:kontrolliert[- ])?biologische[mn]? anbau',
  'gerettet\\p{L}*',
  'fischernetz\\p{L}*',
);
// "nachhaltig" meaning "lasting" ("unterstützt dich nachhaltig", "das nachhaltig
// begeistert") is no environmental claim at all.
const LASTING_AFTER = /^\s*(?:begeister|wirk|unterstütz|sättig|stärk|verbesser|beeindruck|überzeug|präg|veränder|in erinnerung)/iu;
const LASTING_BEFORE = /(?:unterstützt|begeistert|wirkt|sättigt|stärkt|pflegt|verbessert|überzeugt|beeindruckt|prägt|verändert)\s+(?:\p{L}+\s+)?$/iu;
/** "nachhaltige Mission", "ökologische Vision": a company's self-image, not a claim about its goods. */
const MISSION_STATEMENT = /^\s+(?:mission|vision|philosophie|leitbild)/iu;

/** The sentence around a match, cut at sentence marks and line breaks (and at 200 characters either way, for texts without any). */
function sentenceAt(text: string, index: number, length: number): string {
  const isMark = (c: string | undefined) => c !== undefined && /[.!?\n•|]/.test(c);
  let start = index;
  while (start > 0 && index - start < 200 && !isMark(text[start - 1])) start--;
  let end = index + length;
  while (end < text.length && end - index < 200 && !isMark(text[end])) end++;
  return text.slice(start, end);
}

/**
 * The sentence before, the claim's own and the one after. Drucksache 21/1855 (recital 9
 * of Directive (EU) 2024/825): a claim is "allgemein" only if its specification is not given clearly and prominently on the same
 * medium – for a shop, the product page. Right next to the claim is clearly so; three sentences away is not.
 */
function neighbourhood(text: string, index: number, length: number): string {
  const own = sentenceAt(text, index, length);
  const start = text.lastIndexOf(own, index);
  const end = start + own.length;
  const before = start > 1 ? sentenceAt(text, start - 2, 1) : '';
  const after = end < text.length - 1 ? sentenceAt(text, end + 1, 1) : '';
  return `${before} ${own} ${after}`;
}

/** The generic green words, used in the environmental sense, with no basis next to them. */
function unexplainedGreenClaims(text: string): RegExpExecArray[] {
  return [...text.matchAll(GREEN_GENERIC)].filter((m) => {
    const tail = text.slice(m.index + m[0].length, m.index + m[0].length + 40);
    const lasting = /^nachhaltig/iu.test(m[0]) && (LASTING_AFTER.test(tail) || LASTING_BEFORE.test(text.slice(Math.max(0, m.index - 40), m.index)));
    return !lasting && !matches(neighbourhood(text, m.index, m[0].length), BASIS_IN_SENTENCE) && !MISSION_STATEMENT.test(tail.slice(0, 30));
  });
}

const greenGenericBase = textRule({
  id: 'green-generic',
  cite: "a general environmental claim about the product, its packaging or shipping (e.g. \"umweltfreundlich\", \"nachhaltig\", \"klimafreundlich\", \"öko\")",
  title: 'Pauschale Umweltaussage',
  severity: 'hoch',
  since: '2026-09-27',
  law: '§ 5 UWG; UWG-Anhang n. F. (Umsetzung Anhang I Nr. 4a RL (EU) 2024/825), gilt ab 27.09.2026',
  explain:
    'Ab dem 27.09.2026 sind pauschale Umweltaussagen wie „umweltfreundlich“, „nachhaltig“ oder „öko“ verboten, wenn keine anerkannte hervorragende Umweltleistung nachgewiesen werden kann. Schon heute verlangt der BGH (Urt. v. 27.06.2024 – I ZR 98/23), dass mehrdeutige Umweltbegriffe direkt in der Werbung erklärt werden.',
  fix: 'Aussage streichen oder konkret machen: welche Eigenschaft genau (z. B. „Verpackung zu 80 % aus Recyclingkarton“), belegt durch welche Zertifizierung oder Messung – direkt an der Aussage, nicht irgendwo im Kleingedruckten.',
  // Ob ein Wort wie „nachhaltig“ neben der konkreten Eigenschaft steht,
  // ist Auslegungssache, und das Verbot gilt erst ab 27.09.2026. Deshalb nie über „Prüfen“.
  maxLevel: 'pruefen',
  alsoOnHomepage: true,
  trigger: GREEN_GENERIC,
  questions: {
    green_generic: {
      type: 'noul',
      instructions:
        'Does the text make a generic environmental claim: does it call the product, its packaging, its shipping or the company environmentally friendly, sustainable, eco, green, climate-friendly or similar in general terms, WITHOUT stating right there which concrete environmental property is meant and how it is achieved or certified? The explanation counts only in the same sentence, and only if it is a named material the product is made from, a percentage, or a named certification. A concrete detail somewhere else in the text does not explain a generic claim in another sentence.',
      criteria: {
        true: 'A vague environmental benefit is claimed, e.g. "umweltfreundlich", "nachhaltig produziert", "öko", "klimafreundlich", "gut für die Umwelt", without a concrete, verifiable specification in the same sentence – also when the material is named elsewhere in the text ("Dieses nachhaltige Armband bringt die raue Schönheit der Polarregionen an dein Handgelenk", "umweltfreundlich gereinigt", "eine saubere, gesunde und nachhaltige Alternative").',
        false: 'There is no environmental claim, OR every environmental claim is concrete and verifiable (e.g. "Verpackung aus 100 % recyceltem Karton", "GOTS-zertifizierte Bio-Baumwolle"), OR the same sentence states the concrete property it rests on – a named recycled or recovered material, a stated percentage or a named certification all count (e.g. "waschbar und damit wiederverwendbar – eine nachhaltige Alternative zu Einweg-Einlagen", "Dieses nachhaltige Armband besteht aus alten Fischernetzen", "aus 100 % Baumwolle und zertifiziert nach STANDARD 100 by OEKO-TEX®, stehen diese Handtücher für Qualität und Nachhaltigkeit"), OR the words are used in a non-environmental sense (e.g. "nachhaltig" meaning lasting: "unterstützt dich nachhaltig", "nachhaltige Ergebnisse").',
      },
    },
  },
  hints: (text) => ({ green_generic: matches(text, SPECIFIC_GREEN) ? 0.45 : 0.75 }),
  judge: (a) => a.noul('green_generic'),
});

// Only sentences without a basis of their own go to Jev, and only
// those are quoted as evidence.
export const greenGeneric: ProductRule = {
  ...greenGenericBase,
  prepare(p) {
    const text = productText(p);
    const open = unexplainedGreenClaims(text);
    if (open.length === 0) return null;
    const prep = greenGenericBase.prepare(p);
    if (!prep) return null;
    return { ...prep, evidence: [...new Set(open.map((m) => passage(text, m.index, m[0].length)))].slice(0, 3) };
  },
};

const CLIMATE = words(
  'klima[- ]?neutral\\p{L}*',
  'klima[- ]?positiv\\p{L}*',
  'co[2₂][- ]?(?:neutral|frei|kompensiert|ausgeglichen|negativ)\\p{L}*',
  'co[2₂][- ]?(?:ausgleich|kompensation)\\p{L}*',
  'emissionen (?:werden )?(?:kompensiert|ausgeglichen)',
  'klimaschutzprojekt\\p{L}*',
  'bäume (?:gepflanzt|pflanzen)',
  '(?:pflanzen|pflanzt) (?:wir )?(?:einen|1) baum',
  'climate[- ]neutral',
  'carbon[- ]neutral',
  'net[- ]zero',
  'carbon offset\\p{L}*',
);

export const greenClimate = textRule({
  id: 'green-climate',
  cite: "a claim that the product, its shipping or the company is climate-neutral, CO₂-neutral or climate-positive",
  title: '„Klimaneutral“ durch CO₂-Kompensation',
  severity: 'hoch',
  since: '2026-09-27',
  law: 'UWG-Anhang n. F. (Umsetzung Anhang I Nr. 4c RL (EU) 2024/825), gilt ab 27.09.2026; BGH, Urt. v. 27.06.2024 – I ZR 98/23',
  explain:
    'Aussagen, ein Produkt, der Versand oder das Unternehmen sei „klimaneutral“, „CO₂-neutral“ oder „klimapositiv“, sind ab dem 27.09.2026 verboten, wenn sie auf CO₂-Kompensation beruhen – auch mit Erklärung. Bis dahin muss mindestens direkt in der Werbung erklärt werden, wie die Neutralität erreicht wird.',
  fix: 'Neutralitätsaussagen entfernen, die auf Kompensation (Zertifikate, Klimaprojekte, Baumpflanzungen) beruhen. Erlaubt bleibt eine sachliche Information, welche Klimaprojekte Sie unterstützen – ohne Versprechen einer neutralen Klimawirkung.',
  alsoOnHomepage: true,
  trigger: CLIMATE,
  questions: {
    green_offset: {
      type: 'noul',
      instructions:
        'Does the text claim that the product, its packaging, its shipping or the company is climate neutral, CO2-neutral, climate positive or has a neutral or reduced climate impact, where this rests on offsetting or compensating emissions (climate projects, certificates, tree planting) or where the text does not say how it is achieved?',
      criteria: {
        true: 'e.g. "klimaneutraler Versand", "CO2-neutral durch Unterstützung von Klimaschutzprojekten", "für jede Bestellung pflanzen wir einen Baum – so ist dein Kauf klimapositiv".',
        false: 'No such claim, or the text only reports measured emission reductions of the product itself without claiming neutrality, or only states that the company supports a project without claiming any neutral or positive climate effect.',
      },
    },
  },
  hints: () => ({ green_offset: 0.8 }),
  judge: (a) => a.noul('green_offset'),
});

const LABEL = words(
  '(?:nachhaltigkeits|öko|umwelt|klima|eco|green|grün)[- ]?(?:siegel|label|zertifikat|standard)\\p{L}*',
  'eigene[mns]? [\\p{L}-]*(?:siegel|label)',
  '(?:siegel|label) für (?:nachhaltigkeit|umweltschutz|klimaschutz)',
);

export const greenLabel = textRule({
  id: 'green-label',
  cite: "a sustainability seal or label",
  title: 'Nachhaltigkeitssiegel ohne anerkanntes Zertifizierungssystem',
  severity: 'mittel',
  since: '2026-09-27',
  law: 'UWG-Anhang n. F. (Umsetzung Anhang I Nr. 2a RL (EU) 2024/825), gilt ab 27.09.2026',
  explain:
    'Nachhaltigkeitssiegel sind ab dem 27.09.2026 nur noch erlaubt, wenn sie auf einem Zertifizierungssystem mit unabhängiger Kontrolle beruhen oder staatlich festgelegt sind. Selbst erfundene „Eco-Siegel“ sind dann per se unzulässig.',
  fix: 'Eigene Siegel und Labels entfernen. Nur anerkannte Zertifizierungen verwenden (z. B. EU Ecolabel, Blauer Engel, GOTS, Fairtrade) und den Zertifizierer nennen.',
  alsoOnHomepage: true,
  trigger: LABEL,
  questions: {
    green_label: {
      type: 'noul',
      instructions:
        'Does the text refer to a sustainability, eco or climate label or seal that is not an established independent certification scheme or official public label — for example a label created by the seller or brand itself, or a seal whose certifying body is not named?',
      criteria: {
        true: 'e.g. "unser eigenes Eco-Siegel", "ausgezeichnet mit dem GreenChoice-Label", "Nachhaltigkeitssiegel" without naming who certifies.',
        false: 'No label is mentioned, or only established independent schemes are mentioned (EU Ecolabel, Blauer Engel, GOTS, Fairtrade, FSC, OEKO-TEX, EU-Bio-Logo).',
      },
    },
  },
  hints: (text) => ({ green_label: matches(text, words('eigene')) ? 0.8 : 0.55 }),
  judge: (a) => a.noul('green_label'),
});

// ---------------------------------------------------------------- health claims

const DISEASE = stems(
  'heil(?:t|en|end\\p{L}*|ung|wirkung|kraft)(?![\\p{L}])',
  'lindert?',
  'linderung',
  'schmerz\\p{L}*',
  'entzünd\\p{L}*',
  // Not the spirulina alga "Arthrospira platensis".
  'arthros(?!pira)\\p{L}*',
  'arthritis',
  'rheuma\\p{L}*',
  'diabet\\p{L}*',
  '(?<![\\p{L}])krebs(?!tier|fleisch|suppe|schw[aä]nz|butter)\\p{L}*',
  'tumor\\p{L}*',
  'depressi\\p{L}*',
  'migräne',
  'allergi\\p{L}*',
  'neurodermitis',
  '(?<![\\p{L}])akne',
  'ekzem\\p{L}*',
  'schuppenflechte',
  'psoriasis',
  'bluthochdruck',
  '(?<!des)infekt\\p{L}*',
  'erkältung\\p{L}*',
  '(?<![\\p{L}])grippe',
  'schlafstörung\\p{L}*',
  'reizdarm',
  'sodbrennen',
  'verstopfung',
  '(?<![\\p{L}])pms(?![\\p{L}])',
  'prämenstruell\\p{L}*',
  'menstruationsbeschwerden',
  'regelschmerz\\p{L}*',
  'wechseljahresbeschwerden',
  // Menopause symptoms and sweating conditions.
  'hitzewallung\\p{L}*',
  'nachtschwei\\p{L}*',
  'schweißausbr\\p{L}*',
  'hyperhidrose',
  // Spanish product texts in a German feed (shop12.com).
  'sofocos?(?![\\p{L}])',
  'sudores?(?![\\p{L}])',
  'desequilibrio\\p{L}*',
  'infeccion\\p{L}*',
  'infecci[óo]n\\p{L}*',
  'dolor(?:es)?(?![\\p{L}])',
  'haarausfall',
  'gestört\\p{L}* (?:darm|scheiden|haut)flora',
  'blasenentzündung\\p{L}*',
  'harnwegs\\p{L}*',
  'antibakteriell',
  'antiviral',
  'corona',
  'covid',
  // "als wirkungsvolle
  // Rachitisprophylaxe", "die Häufigkeit von Knochenbrüchen … reduzieren", "Blähungen spürbar zu reduzieren", "senkt das
  // schlechte LDL-Cholesterin – eine sanfte Alternative zu herkömmlichen Präparaten". Jev still decides.
  'rachitis\\p{L}*',
  // "bei Menstruationssymptomen … zu helfen"
  'menstruationssymptom\\p{L}*',
  'osteoporose',
  'knochenbrüch\\p{L}*',
  'blähung\\p{L}*',
  'blähbauch',
  '(?<![\\p{L}])ldl(?![\\p{L}])',
  '(?:lipid|cholesterin)senk\\p{L}*',
  'thrombose',
  'arterioskleros\\p{L}*',
  'herzinfarkt\\p{L}*',
  'schlaganfall\\p{L}*',
  'demenz',
  'alzheimer',
  'parkinson',
  'asthma',
);

// Warnings and allergen notes name diseases without claiming anything
// ("… kann es bei Personen mit bestimmten Allergien zu Reaktionen kommen … Patch-Test", "nicht geeignet für Personen mit
// Allergien auf Bienenprodukte"), and authorised EU claims are allowed in their wording ("Melatonin trägt dazu bei, … das
// subjektive Jetlag-Empfinden zu lindern") – neutral mentions, warnings and authorised claims are no disease claim.
// Narrow on purpose: "ohne Nebenwirkungen gegen Schmerzen" or "lindert allergische Reaktionen" are claims.
const DISEASE_WARNING = new RegExp(
  [
    'patch-?test',
    'verträglichkeitstest',
    'zu (?:allergischen |unerwünschten )?reaktionen (?:kommen|führen)',
    'reaktionen (?:auftreten|hervorrufen|auslösen)',
    'allergen(?:e|hinweis|informationen?)(?![\\p{L}])',
    'kann spuren',
    'bei (?:bekannter|bestehender) (?:allergie|überempfindlichkeit|unverträglichkeit)',
    'allergiker (?:sollten|müssen|beachten|bitte)',
    'nicht (?:geeignet|empfohlen|anwenden|verwenden|einnehmen|überschritten)',
    'rücksprache mit',
  ].join('|'),
  'iu',
);

function notADiseaseClaim(sentence: string): boolean {
  return DISEASE_WARNING.test(sentence) || isAuthorisedClaimSentence(sentence);
}

export const healthDisease: ProductRule = {
  id: 'health-disease',
  cite: "a statement that the product prevents, relieves or treats a disease or its symptoms",
  citeSkip: notADiseaseClaim,
  title: 'Krankheitsbezogene Aussage (Heilversprechen)',
  severity: 'hoch',
  law: 'Art. 7 Abs. 3 LMIV (VO (EU) 1169/2011); Art. 20 Kosmetik-VO (EG) 1223/2009; §§ 3, 12 HWG; § 5 UWG',
  explain:
    'Lebensmitteln, Nahrungsergänzungsmitteln und Kosmetik dürfen keine Wirkungen gegen Krankheiten oder Beschwerden zugeschrieben werden (vorbeugen, lindern, heilen). Heilversprechen gehören zu den teuersten Abmahnthemen – Verbände und Wettbewerber verfolgen sie aktiv.',
  fix: 'Alle Bezüge auf Krankheiten und Symptome streichen. Bei Lebensmitteln nur zugelassene Health Claims aus dem EU-Register verwenden; bei Medizinprodukten ausschließlich die zertifizierte Zweckbestimmung bewerben.',
  kind: 'product',
  highlight: DISEASE,
  prepare(p) {
    const text = productText(p);
    if (!matches(text, DISEASE)) return null;
    const claims = text.split(/(?<=[.!?])\s+|\n+/).filter((s) => matches(s, DISEASE) && !notADiseaseClaim(s));
    if (claims.length === 0) return null;
    return {
      questions: {
        product_category: PRODUCT_CATEGORY,
        health_disease: {
          type: 'noul',
          instructions:
            'Does the text claim or suggest that the product prevents, relieves, treats or cures an illness, a disease or a medical symptom (e.g. pain, inflammation, infections, colds, arthritis, diabetes, cancer, depression, allergies, acne, sleep disorders)?',
          criteria: {
            true: 'The product is presented as helping against a disease or symptom, e.g. "lindert Gelenkschmerzen", "hilft bei Erkältung", "wirkt entzündungshemmend", "beugt Arthrose vor".',
            false: 'No such claim. Diseases may be mentioned neutrally (allergen information, warnings like "nicht geeignet bei Diabetes"), or only cosmetic or comfort effects are described without naming a disease or symptom. An officially authorised EU health claim in its approved wording is not a disease claim either, e.g. "Melatonin trägt zur Linderung der subjektiven Jetlag-Empfindung bei". The permitted purpose of a cosmetic product is not one: for toothpaste and mouthwash that includes "Kariesprophylaxe", "Schutz gegen Karies und Plaque", "antibakterielle Formel" and gum care, and for skin care "beruhigt gereizte Haut".',
          },
        },
      },
      hints: {
        product_category: guessCategory(text),
        health_disease: matches(text, words('enthält', 'allergene', 'nicht geeignet', 'kann spuren')) ? 0.4 : 0.75,
      },
      evidence: evidence(claims.join('\n'), DISEASE),
    };
  },
  judge(a) {
    const p = a.noul('health_disease');
    const category = a.choice('product_category');
    // The ban covers food, supplements, cosmetics and medical
    // products. A teething ring that "relieves itching" is none of them (LMIV, Kosmetik-VO, HWG).
    if (category === 'other') return 0;
    // Medical devices may advertise their certified purpose; flag for review only.
    return category === 'medical' ? Math.min(p, 0.6) : p;
  },
};

// Word starts only: "Stimmung" must not match "immun".
const HEALTH = words(
  'immun\\p{L}*',
  'abwehrkr\\p{L}*',
  'entgift\\p{L}*',
  'detox\\p{L}*',
  'entschlack\\p{L}*',
  'stoffwechsel\\p{L}*',
  'verdauung\\p{L}*',
  'darmflora',
  'darmgesundheit',
  'fettverbrenn\\p{L}*',
  'fatburn\\p{L}*',
  'abnehm\\p{L}*',
  // Audit11 A021/A070: "Konzentration von 50 PPM" is a measured
  // product property, not a claim about mental concentration. Keep unmeasured cognitive claims.
  'konzentration(?!\\s+(?:von\\s+)?\\d+(?:[,.]\\d+)?\\s*(?:ppm|mg|g|µg|mcg|mol|%)(?![\\p{L}]))\\p{L}*',
  'gedächtnis',
  'müdigkeit',
  'knochen',
  'gelenk\\p{L}*',
  'anti-?oxida\\p{L}*',
  'zellschutz',
  'freie radikale',
  'gesund\\p{L}*',
  'wohlbefinden',
  'vitalität',
  // Claims that name no classic keyword (fresh audit, supplement shop): the verb or the body part carries them.
  'unterstütz\\p{L}*',
  'wirkung\\p{L}*',
  'darm\\p{L}*',
  'mikrobiom\\p{L}*',
  'leber(?:funktion\\p{L}*)?(?![\\p{L}])',
  'haut(?![\\p{L}])',
  'haare?(?![\\p{L}])',
  'kollagen\\p{L}*',
  'knorpel\\p{L}*',
  'bindegewebe',
  'venen\\p{L}*',
  'blutzucker\\p{L}*',
  'cholesterin\\p{L}*',
  'hormon\\p{L}*',
  'glückshormon\\p{L}*',
  'serotonin',
  // Mood effects, not "festliche Stimmung auf dem Teller".
  'stimmungs(?:aufhell|tief|schwank|lage|boost)\\p{L}*',
  'gemüt\\p{L}*',
  'psych\\p{L}*',
  'nerv(?:en|ös)\\p{L}*',
  'angst',
  'unruhe',
  'stress\\p{L}*',
  'schlaf\\p{L}*',
  'libido',
  'leidenschaft\\p{L}*',
  'potenz',
  'prostata\\p{L}*',
  'kinderwunsch\\p{L}*',
  'fruchtbarkeit',
  // Compounds the word boundary hides, and cell-energy claims.
  'energiestoffwechsel',
  'mitochondri\\p{L}*',
  // Spanish product texts in a German feed (shop12.com).
  'metabolismo',
  'equilibrio(?![\\p{L}])',
  'microbiot\\p{L}*',
  'digesti[óo]n',
  'inmun\\p{L}*',
  'intestin\\p{L}*',
  'bienestar',
  'controlar el peso',
  // Sports nutrition (audit 3): muscles, oxygen, hydration and satiety carry the claim.
  'muskel\\p{L}*',
  'regeneration\\p{L}*',
  'sauerstoff\\p{L}*',
  'leistungsfähigkeit',
  'ausdauerleistung',
  'hydration',
  'laktat\\p{L}*',
  'sättigung\\p{L}*',
  // Satiety without the word "Sättigung" (shop45).
  'satt(?![\\p{L}])',
  'sättigend\\p{L}*',
  'magenfreundlich\\p{L}*',
  'hunger(?![\\p{L}])',
  // Caffeine, guarana and energy wording (shop10, shop7). Five
  // of seven missed health claims never reached Jev: "Energie-Kick", "Koffein aus Guarana", "der wach macht",
  // "extra Energie in den Tag", "sättigt richtig gut". "Energie" alone stays out: it heads every nutrition table.
  // "Koffein" and "Guarana" removed again – ingredient names, not claims.
  // On long pages they filled the quoted passages with menu entries ("mit Koffein") and hid the claim from Jev; every
  // audit-6 case is reached by the claim wording below.
  // "Koffein-Kick", "Muntermacher" never reached Jev.
  // A bare "Kick" stays out: deodorant, toothpaste and chili texts use it ("Frische-Kick").
  '(?:energie|koffein)-?(?:kick|schub|boost)\\p{L}*',
  '(?:munter|wach)macher\\p{L}*',
  '(?:extra|mehr|natürliche[rn]?|langanhaltende[rn]?|geballte|pure|neue) energie(?![\\p{L}])',
  'wach(?![\\p{L}])',
  'sättigt',
  // Nine labelled claims never reached Jev – CBD and herb relaxation ("damit Sie sich
  // entspannen können", "für einen ruhigen Geist"), "Körper und Geist … beleben", "für dein Bauchgefühl", "Drive, Fokus und
  // Pump", "supportet dich". Not "im Fokus" (quality statements), not the noun "Support", not "belebtes Design".
  'entspann\\p{L}*',
  'innere[rn]? ruhe',
  'ruhige[nr]? geist',
  'körper und geist',
  'beleb(?:en|end\\p{L}*)',
  'bauchgefühl',
  '(?<!(?:im|in den) )fokus(?![\\p{L}])',
  'support(?:et|en|t)(?![\\p{L}])',
);

// Asked when the text names substances from the EU list (health-register.ts).
// Almost every remaining false alarm was a "Komplex" whose general promise is
// footnoted with authorised nutrient claims – allowed under Art. 10 Abs. 3 HCVO, so the question now says so.
// A footnote mark alone proves no authorised claim: treating it as one dropped 32 of 114 real health claims on the test
// products and moved 25 real ones from "Risiko" to "Prüfen" for 14 fewer false alarms.
const WITH_REGISTER =
  'The field zugelassene_eu_angaben lists the officially authorized EU health claims (Regulation (EU) No 432/2012) for the substances this text names, with their conditions of use. Is EVERY health-related statement in the text covered by that list: one of the listed claims, a paraphrase with the same meaning ("Vitamin C unterstützt dein Immunsystem" for "Vitamin C trägt zu einer normalen Funktion des Immunsystems bei", "Proteine unterstützen den Aufbau und Erhalt von Muskeln"), or a statement about the product or the whole formula ("Komplex für Herz und Gefäße1,2", "So unterstützt METABO den Fettstoffwechsel1-3", "Support für Immunsystem, Muskeln & Knochen¹²³", often with a footnote mark ¹ ² *) where every body function it names has a listed claim for a substance the product contains? That the mixture also contains plant extracts, amino acids or bacterial cultures does not matter as long as no separate effect is claimed for them. Not covered: a specific effect attributed to an ingredient that has no listed claim, a body function no listed claim covers, and promises stronger than the listed wording.';

// The criteria follow the same split as the instructions above.
const WITH_REGISTER_CRITERIA = {
  true: 'Every health statement is a listed claim, a same-meaning paraphrase, or a benefit of the product or formula whose named body functions all have listed claims – usually with a footnote mark or the listed wording nearby, e.g. "Komplex für Herz und Gefäße1,2 … Thiamin trägt zu einer normalen Herzfunktion bei1", "So unterstützt OXIVA Sauerstofftransport und Blutbildung1-4", "Protein unterstützt Muskelaufbau & -erhalt¹".',
  false: 'A specific effect is attributed to an ingredient with no listed claim ("Ashwagandha reduziert Stress", "Kollagen strafft die Haut", "Bakterienkulturen für das Gleichgewicht im Darm", "Nattokinase löst Blutgerinnsel"), OR a body function is named that no listed claim covers ("entgiftet", "Detox", "unterstützt beim Abnehmen", "reduziert Heißhunger", "Libido", "für ein ausgeglichenes Mikrobiom"), OR the wording promises more than the listed claim ("stärkt deine Knochen", "steigert die Leistung", "schützt vor Erkältungen").',
};

// Promises no authorised claim can cover, asked about directly. Thirteen labelled claims
// in the nine samples reached Jev but scored 0.34–0.54: the "is EVERY statement covered" question also saw authorised claims and
// answered in between. The exceptions are the authorised claims that do exist for such effects (caffeine, melatonin, glucomannan).
const HEALTH_UNLISTED: Question = {
  type: 'noul',
  instructions:
    'Does the product name or description promise one of these effects, which no authorised EU health claim covers: (a) satiety or less appetite; (b) easy digestion or good tolerability as a benefit, or a good gut feeling; (c) an energy kick, alertness, drive or a performance boost, other than the authorised caffeine wording "Koffein trägt zur Steigerung der Aufmerksamkeit / Konzentration bei"; (d) relaxation, calm, inner balance or better sleep from plants, CBD, mushrooms, bacterial cultures or the product as a whole (not the authorised melatonin claim); (e) detox, cleansing or purging; (f) weight loss or fat burning, except glucomannan "im Rahmen einer kalorienarmen Ernährung"; (g) anti-ageing, longevity or protection of cells attributed to anything other than vitamins C and E, riboflavin, zinc, selenium, copper or manganese; (h) calling the food healthy or good for the body? Judge only what the text says the product does for the body; ingredients, nutrition facts, use instructions and warnings are no promise.',
  criteria: {
    true: 'At least one such promise, e.g. "Macht lange satt", "sättigt richtig gut", "leicht verdaulich", "für dein Bauchgefühl", "der Milchshake, der wach macht", "dein Energie-Kick", "Für einen ruhigen Geist", "30 Days Detox", "hilft dir beim Abnehmen", "der gesunde Snack", "gut für dich".',
    false: 'None of these promises: only authorised claims or same-meaning paraphrases, taste, ingredients, nutrition facts, use instructions or warnings ("kann abführend wirken", "nicht am Abend einnehmen").',
  },
};

/** Keyword guess for demo mode only. */
const UNLISTED_HINT = words('satt', 'sättig\\p{L}*', 'detox\\p{L}*', 'abnehm\\p{L}*', 'energie-?kick', 'gesund(?:e[rsn]?)?(?![\\p{L}])');

// A fragment whose every health word belongs to an authorised claim it states in register
// wording for a substance it names ("Vitamin B6 trägt zur Regulierung der Hormontätigkeit bei").
function onlyAuthorisedClaims(fragment: string): boolean {
  const stems = authorisedClaimStems(fragment);
  if (!stems) return false;
  HEALTH.lastIndex = 0;
  return [...fragment.matchAll(HEALTH)].every((m) => stems.has(claimStem(m[0])));
}
export const healthClaim: ProductRule = {
  id: 'health-claim',
  cite: "a statement that the food or one of its ingredients has an effect on health or on a body function, or is healthy",
  citeSkip: onlyAuthorisedClaims,
  title: 'Nicht zugelassene Gesundheitsaussage bei Lebensmitteln',
  severity: 'hoch',
  law: 'Art. 10 Health-Claims-VO (VO (EG) 1924/2006); § 5 UWG',
  explain:
    'Gesundheitsbezogene Angaben bei Lebensmitteln und Nahrungsergänzungsmitteln sind nur erlaubt, wenn sie im EU-Register zugelassen sind – im zugelassenen Wortlaut und für einen konkret enthaltenen Nährstoff. „Stärkt das Immunsystem“, „entgiftet“ oder „Detox“ sind so nicht zulässig.',
  fix: 'Nur zugelassene Claims verwenden (z. B. „Vitamin C trägt zu einer normalen Funktion des Immunsystems bei“), bezogen auf einen Nährstoff, der in ausreichender Menge enthalten ist. Unspezifische Aussagen („gesund“, „Detox“, „für mehr Vitalität“) streichen oder mit einem zugelassenen Claim verbinden.',
  kind: 'product',
  // Test bench over 600 labelled products (with EU register data): at 0.55 the
  // false alarms fell from 32 to 18 while 58 of 59 real problems stayed; "Risiko" from 0.8 was right in 44 of 48.
  reviewThreshold: 0.55,
  riskThreshold: 0.8,
  // Supplement shops advertise on the homepage too ("unterstützt dein Bindegewebe"). Non-food homepages score 0.
  alsoOnHomepage: true,
  highlight: HEALTH,
  prepare(p) {
    const text = productText(p);
    if (!matches(text, HEALTH)) return null;
    // Sentences that are themselves authorised claims for a substance they name are no
    // evidence. If nothing else speaks of health, there is nothing to ask; Jev still reads the full text (Art. 10 Abs. 3 HCVO).
    const unauthorised = text.split(/(?<=[.!?])\s+|\n+/).filter((s) => matches(s, HEALTH) && !onlyAuthorisedClaims(s));
    if (unauthorised.length === 0) return null;
    // Footnote marks ("Support für Knochen¹²") usually point to the authorized claims below the description.
    // Not "*" – it also marks gender forms ("Kund*innen"), organic
    // ingredients ("Hafer*") and trademarks ("Darm* Balance"), and "Psyche*" capped shop19's Ashwagandha at "Prüfen".
    const authorizedStyle = matches(text, words('trägt zu', 'tragen zu', 'wird für .{3,60} benötigt', 'hat eine funktion bei')) || /\p{L}[¹²³⁴⁵]/u.test(text);
    const register = authorisedClaimsFor(text);
    return {
      questions: {
        product_category: PRODUCT_CATEGORY,
        health_effect: {
          type: 'noul',
          instructions:
            'Does the text claim or suggest that the food or one of its ingredients has a positive effect on health or on body functions (e.g. immune system, digestion, gut flora, liver, metabolism, energy, concentration, mood, stress, sleep, libido, fertility, bones, joints, muscles, physical performance, oxygen supply, hydration, satiety, skin, hair, detox, weight loss), or describe it as healthy? Indirect suggestions count, e.g. pointing to studies on a condition or naming a body function in the product name. Tags and categories are the shop\'s internal filter labels (e.g. "Haut & Bindegewebe", "Herz & Gefäße"), not claims: judge only the product name and the description.',
          criteria: {
            true: 'e.g. "stärkt die Abwehrkräfte", "für eine gesunde Verdauung", "entgiftet den Körper", "der gesunde Snack", "eine praktische, gesunde und leckere Mahlzeit", "macht lange satt", "langanhaltende Sättigung", "für ein ausgeglichenes Mikrobiom", "für Frauen, die ihre leidenschaftliche Seite unterstützen wollen", "wir haben Studien zu Angst und Unruhe herangezogen", "Vitamin C trägt zur normalen Funktion des Immunsystems bei".',
            false: 'Only taste, origin, ingredients, nutrition facts or preparation are described, without any health or body-function effect.',
          },
        },
        health_unlisted_effect: HEALTH_UNLISTED,
        health_authorized_wording: {
          type: 'noul',
          // With register data, Jev compares against the listed wordings.
          instructions: register.length
            ? WITH_REGISTER
            :
            'Is EVERY health-related statement in the text either (a) worded like an officially authorized EU health claim for a named nutrient (vitamin, mineral, protein, fibre) — "trägt zu ... bei", "wird für ... benötigt", "hat eine Funktion bei", "erhöht die Eisenaufnahme" — or a paraphrase with the same meaning ("Vitamin C unterstützt dein Immunsystem", "Proteine unterstützen den Aufbau und Erhalt von Muskeln"), or (b) a general, non-specific benefit ("für dein Immunsystem", "Support für Knochen & Muskeln", "für Haare, Haut & Nägel") that is accompanied by such an authorized claim or carries a footnote mark (¹, ², *) pointing to one, as EU law allows?',
          criteria: register.length ? WITH_REGISTER_CRITERIA : {
            true: 'All health statements are authorized claims or same-meaning paraphrases for a named vitamin, mineral or protein, or general benefits backed by an authorized claim or a footnote mark, e.g. "Vitamin C für dein Immunsystem* – *Vitamin C trägt zu einer normalen Funktion des Immunsystems bei", "Calcium wird für die Erhaltung normaler Knochen benötigt", "Support für Immunsystem, Muskeln & Knochen¹²³", "Protein unterstützt Muskelaufbau & -erhalt¹".',
            false: 'At least one specific effect is claimed without an authorized claim behind it, or an authorized claim is reworded into a stronger promise ("Magnesium stärkt deine Knochen", "steigert die Leistung", "schützt vor Erkältungen"), or the effect is attributed to an ingredient that has no authorized claim (bacterial cultures, plant extracts, amino acids, hyaluronic acid, collagen) — a footnote mark does not change that: e.g. "entgiftet", "Detox", "unterstützt beim Abnehmen", "reduziert Heißhunger", "Kollagen strafft die Haut", "gegen schwere Beine", "Libido", "für ein ausgeglichenes Mikrobiom", "Bakterienkulturen für das Gleichgewicht im Darm", "unterstützt Darm und Leber", "Aminos für idealen Muskelaufbau", "Pflanzenextrakte für bessere Sauerstoffversorgung¹", "die Vorstufe des Glückshormons Serotonin", "Studien zu Angst und Unruhe", or a general benefit with no authorized claim anywhere.',
          },
        },
      },
      hints: {
        product_category: guessCategory(text),
        health_effect: 0.7,
        health_authorized_wording: authorizedStyle ? 0.6 : 0.2,
        health_unlisted_effect: matches(text, UNLISTED_HINT) ? 0.7 : 0.3,
      },
      evidence: evidence(unauthorised.join('\n'), HEALTH),
      // The authorised wordings for the named substances, so Jev compares instead of recalling.
      ...(register.length ? { context: { zugelassene_eu_angaben: register } } : {}),
      // When the shop itself quotes authorised claims for nutrients it
      // contains ("Thiamin trägt zu … bei¹"), whether the promise still belongs to the whole complex is a
      // judgement call (Art. 10 Abs. 3 HCVO). On the bench this group is right in 13 of 22 cases at "Risiko",
      // against 42 of 48 for the rest, so it goes to "Prüfen" instead.
      ...(authorizedStyle && register.length
        ? {
            maxLevel: 'pruefen' as const,
            note: 'Der Text nennt zugelassene EU-Angaben mit Fußnoten – ob sie die beworbene Gesamtwirkung tragen, ist Auslegungssache (Art. 10 Abs. 3 HCVO).',
          }
        : {}),
    };
  },
  judge(a) {
    if (a.choice('product_category') !== 'food') return 0;
    const covered = a.noul('health_effect') * (1 - a.noul('health_authorized_wording'));
    // An unlisted promise lifts the product to review level at most; "Risiko" stays with the first decision. Only a
    // confident answer counts: on the eleven samples (averaged answers) from 0.75 it found 11 more real claims for 2 more false
    // alarms; from the review threshold on it was 13 for 14 – mostly supplements quoting authorised claims.
    const unlisted = a.noul('health_unlisted_effect');
    return Math.max(covered, unlisted >= 0.75 ? Math.min(unlisted, 0.79) : 0);
  },
};

const FOOD_HINT = words('lebensmittel', 'nahrungsergänzung\\p{L}*', 'kapseln', 'pulver', 'tee', 'zutaten', 'nährwert\\p{L}*', 'verzehr\\p{L}*', 'mhd', 'snack', 'riegel', 'drink', 'gewürz\\p{L}*');
const COSMETIC_HINT = words('creme', 'serum', 'shampoo', 'haut', 'haare?', 'pflege\\p{L}*', 'lotion', 'seife', 'kosmetik\\p{L}*', 'inci');
const MEDICAL_HINT = words('medizinprodukt\\p{L}*', 'arzneimittel\\p{L}*', 'pzn');

function guessCategory(text: string): string {
  if (matches(text, MEDICAL_HINT)) return 'medical';
  if (matches(text, FOOD_HINT)) return 'food';
  if (matches(text, COSMETIC_HINT)) return 'cosmetic';
  return 'other';
}

// ---------------------------------------------------------------- tests, awards, studies

const TEST = words(
  'testsieger\\p{L}*',
  'test(?:urteil|ergebnis|note|bericht|gewinner)\\p{L}*',
  'stiftung warentest',
  'öko-?test',
  'im test',
  'ausgezeichnet (?:mit|als)',
  'award\\p{L}*',
  'preisträger\\p{L}*',
  'platz (?:1|eins)(?![\\p{N}])',
  'nr\\.? ?1(?![\\p{N}])',
  'nummer (?:1|eins)(?![\\p{N}])',
  'marktführer\\p{L}*',
  'meistverkauft\\p{L}*',
  'bestverkauft\\p{L}*',
  '(?:klinisch|dermatologisch|wissenschaftlich) (?:getestet|geprüft|bestätigt|belegt|bewiesen|nachgewiesen|untersucht)\\p{L}*',
  'preisgekrönt\\p{L}*',
  'prämiert\\p{L}*',
  'studien (?:belegen|zeigen|beweisen)',
  'laut (?:einer )?studie',
  'von (?:ärzten|experten|dermatologen) empfohlen',
  // Lab and expert confirmations (fresh audit: "… testen lassen … von einem externen Labor bestätigt").
  '(?:testen|prüfen) lassen',
  '(?:labor|institut|prüfinstitut|gutachter)\\p{L}* (?:bestätigt|nachgewiesen|belegt)',
  'wirksamkeit (?:wurde |ist )?(?:\\p{L}+ ){0,4}(?:bestätigt|nachgewiesen|belegt)',
  'nachgewiesene[nrs]? wirk\\p{L}*',
  '(?:ärzt|gynäkolog|dermatolog|hebamm|expert)\\S* (?:bestätig|empfehl)\\p{L}*',
  'als (?:einzige|erste)[nrs]? (?:marke|brand|anbieter|hersteller|unternehmen)',
  // Several words between the superlative and "am Markt" ("die
  // saugstärkste & am schnellsten trockene Seamless Period Panty am Markt"), consumer-test percentages ("91% der Testerinnen
  // bestätigen") and "Dermatest® SEHR GUT". The question still decides whether tester and date are given.
  '\\p{L}+ste[nrs]? (?:[^.!?\\n]{0,80} )?(?:auf dem|am) markt',
  '\\d{1,3}\\s?% (?:der|aller|unserer) (?:tester|anwender|nutzer|kund|befragt|teilnehmer|probband|proband)\\p{L}*',
  'dermatest\\p{L}*',
);

export const testClaim = textRule({
  id: 'test-claim',
  cite: "a test result, award, study, ranking or \"Nr. 1\" claim",
  title: 'Werbung mit Test, Auszeichnung oder Studie ohne Fundstelle',
  severity: 'mittel',
  law: '§ 5 UWG (Irreführung); st. Rspr. des BGH zur Fundstellenangabe bei Testwerbung',
  explain:
    'Wer mit Testergebnissen, Auszeichnungen, Studien oder einer Spitzenstellung („Nr. 1“, „Marktführer“) wirbt, muss die Fundstelle leicht auffindbar angeben und die Aussage belegen können. Ohne Fundstelle gilt die Werbung als irreführend.',
  fix: 'Fundstelle direkt angeben (Tester, Heft/Datum, Gesamtnote, Anzahl der getesteten Produkte) oder die Aussage entfernen. Spitzenstellungen nur mit belastbarem, aktuellem Nachweis.',
  alsoOnHomepage: true,
  trigger: TEST,
  questions: {
    test_no_source: {
      type: 'noul',
      instructions:
        'Does the text claim, as a verifiable fact, a test result, test win, rating, award, a "No. 1" or market-leader position, a study, or a clinical or dermatological test WITHOUT a complete, checkable source? A source is complete only if it names BOTH who tested or awarded it AND the issue, date or year of the publication. Naming only the tester is not enough. Obvious subjective praise about taste, fun or personal preference is not such a claim.',
      criteria: {
        true: 'e.g. "Testsieger", "Testsieger bei Stiftung Warentest!" (no issue or date), "sehr gut im Test", "klinisch getestet", "Die Nr. 1 in Deutschland", "Marktführer", "meistverkaufte Creme Europas", "Studien belegen die Wirkung", "Als einzige Marke haben wir die Wirkung testen lassen – von einem externen Labor bestätigt" (lab and date not named), "Gynäkologinnen bestätigen uns …", "die saugstärkste auf dem Markt".',
        false: 'No such claim; or the source is named precisely, e.g. "Stiftung Warentest, test 05/2025: gut (2,1), 18 Produkte getestet"; or it is plainly subjective praise that nobody reads as a measured market position, e.g. "Eine echte Nummer 1: süß, wild und lecker", "die Nummer 1 auf jeder Party"; or a ranking inside the seller\'s own range, e.g. "unser Nr. 1 Geschmackspulver", "unser Bestseller", "unsere beliebteste Sorte"; or "Nummer 1" as a figure of speech that ranks no product, e.g. "Das ist der Nummer-1-Grund für Schimmel"; or a market ranking whose footnote names the source and period, e.g. "Deutschlands Nr. 1 Clear Whey¹ – ¹ Quelle: NielsenIQ, Absatz 01–12/2025"; or routine quality control or a named certification rather than a claimed result, e.g. "regelmäßig von unabhängigen Laboren auf Schadstoffe geprüft", "OEKO-TEX® STANDARD 100 (21.0.46579 Hohenstein)"; or an award or audit result whose awarding body and year are named in the same statement, e.g. "zweimal die Top Marke der Lebensmittelzeitung (2023 & 2024), den PETA Vegan Food Award (2021)", "Deutscher Nachhaltigkeitspreis 2025", "2019 Gemeinwohl-Ökonomie-Bilanz: 872 von 1000 Punkten"; or a customer rating that states how many reviews it rests on, e.g. "4.7/5, 519 Bewertungen" (a rating is not a test result).',
      },
    },
  },
  hints: (text) => ({
    test_no_source: matches(text, words('\\d{2}/\\d{4}', 'ausgabe', 'heft')) ? 0.35 : 0.75,
  }),
  judge: (a) => a.noul('test_no_source'),
});

// ---------------------------------------------------------------- legal rights, guarantees

const LEGAL_RIGHTS = words(
  'gewährleistung\\p{L}*',
  'widerrufsrecht',
  'rückgaberecht',
  '(?:14|vierzehn) tage (?:rückgabe|widerruf|umtausch|geld)\\p{L}*',
  'gesetzlich\\p{L}* (?:gewährleistung|garantie|rückgabe)',
  '(?:2|zwei) jahre (?:garantie|gewährleistung)',
);

export const lawAsBenefit = textRule({
  id: 'law-as-benefit',
  cite: "the statutory warranty or withdrawal right presented as a special advantage",
  title: 'Werbung mit Selbstverständlichkeiten',
  severity: 'hoch',
  law: '§ 3 Abs. 3 UWG i. V. m. Anhang Nr. 10 UWG',
  explain:
    'Gesetzliche Rechte – etwa 2 Jahre Gewährleistung oder 14 Tage Widerrufsrecht – als Besonderheit des eigenen Angebots herauszustellen, ist immer unzulässig. Ein Klassiker unter den Abmahnungen, weil er leicht zu finden ist.',
  fix: 'Gesetzliche Rechte nicht als Vorteil bewerben (keine Vorteilslisten, Badges oder Hervorhebungen). Sachlich informieren ist erlaubt. Eine echte Garantie muss über die gesetzlichen Rechte hinausgehen.',
  alsoOnHomepage: true,
  trigger: LEGAL_RIGHTS,
  questions: {
    law_as_benefit: {
      type: 'noul',
      instructions:
        'Does the text present a right that consumers in the EU have by law anyway as if it were a special advantage of this offer? Such rights include the 2-year legal warranty (Gewährleistung) and the 14-day right of withdrawal (Widerrufsrecht).',
      criteria: {
        true: 'e.g. "Ihre Vorteile: 2 Jahre Gewährleistung", "inklusive 14 Tage Widerrufsrecht", "gesetzliche Gewährleistung inklusive", "2 Jahre Garantie" when only the legal warranty is meant.',
        false: 'The rights are only mentioned neutrally (e.g. in a legal notice or FAQ answer), or the seller offers something that clearly goes beyond the law (e.g. "30 Tage Rückgaberecht", "5 Jahre Herstellergarantie").',
      },
    },
  },
  hints: (text) => ({
    law_as_benefit: matches(text, words('vorteil\\p{L}*', 'inklusive', 'inkl\\.', 'gratis', '✓', '✔')) ? 0.8 : 0.5,
  }),
  judge: (a) => a.noul('law_as_benefit'),
});

// The noun only: "Jodler garantiert!" is a figure of speech, not a guarantee offer.
const GUARANTEE = words('garantie(?!r)\\p{L}*', '\\p{L}+garantie(?!r)\\p{L}*', 'guarantee(?!d)\\p{L}*', 'warranty');

export const guaranteeTerms = textRule({
  id: 'guarantee-terms',
  cite: "a guarantee or money-back promise",
  title: 'Garantie ohne Garantiebedingungen',
  severity: 'mittel',
  law: '§ 479 BGB; Art. 246a § 1 Abs. 1 Nr. 9 EGBGB; § 5a UWG',
  explain:
    'Wer mit einer Garantie wirbt, muss die wesentlichen Bedingungen nennen: Garantiegeber mit Anschrift, Dauer, räumlicher Geltungsbereich, Inhalt und Geltendmachung – plus den Hinweis, dass die gesetzlichen Rechte unberührt bleiben. Fehlende Angaben werden regelmäßig abgemahnt.',
  fix: 'Garantiebedingungen direkt am Angebot angeben oder eindeutig verlinken („Garantiebedingungen“). Wenn eigentlich nur die gesetzliche Gewährleistung gemeint ist: das Wort „Garantie“ entfernen.',
  alsoOnHomepage: true,
  trigger: GUARANTEE,
  questions: {
    guarantee_no_terms: {
      type: 'noul',
      instructions:
        'Does the text advertise a guarantee (Garantie, Herstellergarantie, Geld-zurück-Garantie, Zufriedenheitsgarantie, Haltbarkeitsgarantie) without stating its essential terms — who gives it, how long it lasts, what it covers and how to claim it — and without pointing to separate guarantee terms?',
      criteria: {
        true: 'e.g. "Mit 5 Jahren Garantie!", "100 % Zufriedenheitsgarantie", "Geld-zurück-Garantie" with no terms and no link to Garantiebedingungen.',
        false: 'No guarantee is advertised, or the essential terms are stated, or the text refers to separate guarantee terms ("siehe Garantiebedingungen").',
      },
    },
  },
  hints: (text) => ({ guarantee_no_terms: matches(text, words('garantiebedingungen', 'garantiegeber')) ? 0.3 : 0.7 }),
  judge: (a) => a.noul('guarantee_no_terms'),
});
