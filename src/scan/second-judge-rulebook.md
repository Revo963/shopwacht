# Rulebook: German online-shop product checks

One section per rule. It says how
the human labels were made; follow it exactly, also where you would judge the law differently.

You get ONE product from a German Shopify shop, as a labeller sees it:
- title, shop, category, tags, variants with prices ("statt" = crossed-out price from the shop data),
- "Browser (gerendert)": excerpts of the rendered product page – Preisblock (text around the product's price),
  Grundpreis-Stellen (anything that could be a unit price), Material-Stellen, Preis-Hinweise. Excerpts may also contain OTHER
  products (cross-sell cards, "Das könnte dir auch gefallen", recently viewed) – only what belongs to THIS offer counts,
- the product description from the shop data, in a code block.

For every rule answer one verdict:
- `violation` – the rulebook says it is an issue and the facts show it clearly;
- `possible` – probably an issue, but a fact is not fully visible or it is a borderline case of the rulebook;
- `unclear` – the rulebook calls this situation unclear, or the facts needed are missing;
- `none` – no issue under this rule (also when the rule does not apply to this kind of product).

Reading the page excerpts (plain text – styling such as strike-through is lost):
- Two prices next to each other for this product ARE a crossed-out price and a current price: "Regulärer Preis 29,90 €
  24,90 €", "Normaler Preis 39,00 € Sonderpreis 29,00 €", "Angebot €49,90 Regulärer Preis €69,90", a bare pair "89 € 79 €",
  "22,80 € 38,00 € -40 %", "Worth 34,90 € Sale price 29,90 €". Check it against the variant list: "(statt 69.9 €)" there means
  the shop has a crossed-out price for that variant.
- "Regulärer Preis", "Normaler Preis", "Verkaufspreis", "Angebotspreis" are theme labels printed on every product. With only
  ONE price of this offer next to them they are just labels, not a reduction.
- A Grundpreis looks like "(19,96 € / kg)", "4,21 €/l", "Grundpreis: 12,98 € / 1 kg", "1 kg = 19,96 €", "€83,06/kg",
  "15,60€ / kg" right after the price. Read the Preisblock and the Grundpreis-Stellen for it before deciding it is missing.
- Older sheets have "Browser-Fakten" instead: "Grundpreis sichtbar: ja „…“" quotes the page text around the price (read it
  like a Preisblock); "Faserangabe" and "30-Tage/UVP-Hinweis" quote the best matching page text, which may be unrelated.
- Buy-box and trust lines that every product page of the shop shows ("Gratis Versand ab 100 €", "14 Tage Rückgaberecht –
  risikofrei bestellen", "Inklusive 14 Tage Geld-zurück-Garantie", "Teste 30 Tage risikofrei") are the page frame.
- The audits were made in September 2026.

General:
- Judge only what the sheet shows. Claims that appear ONLY in page excerpts (badges, banners, the page frame, cross-sell
  cards) and not in the description: `unclear` for claim rules (green, health, disease, test, law-as-benefit). Price rules use
  the page excerpts.
- Hidden products (tags like "hidden", price 0 €, free gifts, "Inventory SKU"): claim rules `unclear`; textile `unclear`.
- Texts in other languages are judged like German ones.
- Shop filter tags and categories ("Haut & Bindegewebe", "Atopische Haut") are navigation, not claims.

## unit-price (Grundpreis fehlt, § 4 PAngV)

Issue: the product is sold by weight, volume, length or area AND no Grundpreis for THIS offer is visible (per kg, 100 g, l,
100 ml, m, m²) next to its price in the page excerpts.
- Consumables count: food, drinks, supplements (capsules, tablets, gummies, powders, drops, sprays), cosmetics, cleaning and
  washing agents, pet food. Capsules or tablets sold by count ("60 Kapseln", "150 Tabletten", "1 Stück" of a 132 g tablet
  pack) still need a Grundpreis by weight. Drink cubes, sticks and pods are sold by weight too: a pack of 12 cubes or more is
  above 10 g even when the sheet states no weight.
- NOT a Grundpreis: a price per portion, piece, capsule, shot, bottle or "Stück" ("2,49 € / Portion", "0,33 € / pro Stück",
  "19,90 € / 10 Stück", "0,80 € pro Shot"); an empty field ("Grundpreis / pro", "0 € /", "(€/kg*)" without an amount); a unit
  price that belongs to another product on the page.
- A visible but arithmetically wrong or implausible Grundpreis ("€0,21/kg" for capsules) still counts as present (no issue).
- Sets: a set made only of packs of the same kind of goods needs a Grundpreis – several flavours of one drink, ginger shots of
  different flavours, three spice mixes, drink-cube packs, a trial box of bars, 5 × toothpaste, spray + refill of the same
  cleaner. A free glass, shaker or tin added to such a set does not change that. A set of different goods needs none: a
  skincare or nail routine (cleanser, serum, cream, oil, polish), shampoo + conditioner, hand cream + foot cream, cleaner + dish
  soap + tabs, a shaker or bottle with samples as the main item, a pan with food.
Always check the pack size first: under 10 g or under 10 ml (a 6,5 g powder, an 8 ml mascara, a 5 g blush) needs NO Grundpreis –
verdict none. Exactly 10 g or 10 ml needs one (§ 4 Abs. 3 Nr. 1 PAngV: „weniger als 10 Gramm oder 10 Milliliter“).
No issue: Grundpreis visible for this offer; the pack is under 10 g/ml; exactly 1 kg / 1 l / 1 m (price = Grundpreis); free
product (0 €); the quantity is the size or capacity of one item (28 cm pan, 1.5 l bottle, 20 l backpack); textiles, devices,
accessories, books, gift cards.
Unclear: the page could not be loaded ("Seite im Browser nicht ladbar"); the page shows no price at all; loyalty rewards bought
with points; B2B-only goods; dishwasher or WC tabs sold by count; the quantity cannot be found anywhere and could be under 10 g/ml.

## strike-price (Streichpreis ohne 30-Tage-Tiefstpreis, § 11 PAngV)

Issue: the page shows a crossed-out higher price presented as THIS product's own former price ("Regulärer Preis 69,90 €
Angebot 49,90 €", "statt", "Worth 34,90 € Sale price 29,90 €", a discount badge such as "-20 %" or "Spare 16 %" in the offer)
AND no 30-day lowest price or UVP note is visible. § 11 PAngV applies to every kind of goods – clothing, shoes, cosmetics,
devices and food alike. A reduction on an item that is sold out but still shown is an issue too. Themes sometimes swap the
labels ("Sonderpreis €42,95 Regulärer Preis €38,66"): the higher price is the crossed-out one. A bare discount badge on a set
("Spare 14 %", "-10 %") is NOT a named set discount: without words that tie the saving to buying the set, a set's reduction is
an issue like any other.
Before calling a multi-size offer an issue, do the arithmetic with the variant list: for each variant with "statt", divide
its crossed-out price by the base variant's CURRENT price. "45 Tage 27,90 · 90 Tage 49,90 (statt 55,80)": 55,80 = 2 × 27,90,
so it is a quantity saving, no issue.
No issue:
- no crossed-out price visible on the page (a "statt" price in the shop data alone is not shown to the customer);
- a 30-day lowest price or UVP note is present – unless the badge or saving is measured from a higher price: a note whose
  lowest price equals today's price under a „-59 %“ badge is an issue (CJEU C-330/23: a percentage is measured from the 30-day
  lowest price);
- subscription price compared with the one-off price;
- multi-packs and quantity offers: the crossed-out price equals n × the CURRENT single price of the same product (check the
  variant list: "1 Riegel 2,25 · 16 Riegel 29,99 statt 39,84" is 16 × 2,49 = the old single price, so NOT n × current 2,25 →
  issue; "2 × 200 ml 18,95 statt 19,90" with single 9,95 → no issue); named quantity offers ("4+1 gratis", "Twin Pack",
  "8x + 2 geschenkt", "Vorteilspack" priced below n × single);
- sets and bundles where the page or the description names a set discount or a saving against single purchase ("Spare 15 %
  im Set", "-15 % im Set", "Set-Rabatt", "Bundle Deal -20 % auf Sets", "Spar-Set", "Preisvorteil: Spare im Set gegenüber dem
  Einzelkauf", "sparst im Vergleich zum Einzelkauf", "im Vorteilsset");
- a free-gift value comparison (the crossed-out price includes a free gift: "Toner + Geschenk", "inkl. gratis Shaker");
- a best-before (MHD) markdown whose reason is stated ("kurzes MHD", "Mindesthaltbarkeitsdatum bald erreicht, daher reduziert",
  "Kürzeres MHD – Letzte Chance", "gerettet, weil nicht genug Restlaufzeit"), or an MHD date in the offer that has passed or
  falls before the end of 2026.
Unclear: a set whose crossed-out price is exactly the sum of its parts' single prices (use `unclear` when the description lists
the parts with prices that add up, or when a set is sold with only the theme's hidden "Normaler Preis/Verkaufspreis" labels and
no badge); a reduction only in a variant that is not shown by default; an MHD date without a stated reason; B2B-only goods.

## textile-fibre (Faserzusammensetzung fehlt, Textilkennzeichnungsverordnung)

Issue: a textile product (clothing, underwear, swimwear, socks, scarves, hats, home textiles, towels, bedding, fabric by the
metre) and no fibre composition with fibre names AND percentages is visible (description or Material-Stellen). "Wolle,
Kunststoff", "Synthetik", "hochwertige Materialien", "100 % Pflanzenfasern" are not a composition. In a bundle of clothing each
item needs its composition.
No issue: composition visible (also when it only appears in the material excerpts); not a textile product (shoes, sandals,
leather or faux-leather goods, jewellery, charms, key rings, metal, porcelain, brushes).
Unclear: bags, backpacks, pouches, wallets, gym bags (soft bags are exempt); the title names a fibre ("aus TENCEL™ Lyocell",
"aus Leinen", "aus Biobaumwolle") but the material tab text was not captured; hidden inventory items; cleaning cloths in a set.

## health-claim (nicht zugelassene Gesundheitsaussage, Art. 10 HCVO) – foods and supplements only

Issue: the description claims or suggests a health or body-function effect that is not an authorised EU claim in its wording
for a named nutrient:
- effects without any authorised claim: detox, weight loss, satiety ("macht lange satt"), digestion or gut health from
  cultures, fibre or plants, relaxation, sleep or stress relief from plants ("Stresstropfen"), joint mobility, "Leistungs-
  fähigkeit steigern", "hormonelle Balance", "strahlende Haut", "Glow" from collagen, energy, wake-up or "Boost" promises
  from ginger, guarana or caffeine without the authorised caffeine wording, "gesund" / "gesunde Zwischenmahlzeit";
- authorised claims made stronger (strict reading since audit 11): "stärkt / schärft das Immunsystem" instead of "trägt zu
  einer normalen Funktion des Immunsystems bei", "gesunde Knochen" instead of "normale Knochen", "Energie im Alltag
  aufrechterhalten", "mentale Fokussierung", "für starke Nerven", "optimale Muskelfunktion", "Erholung" from amino acids.
  Footnotes do not save a strengthened OUTCOME;
- effects attributed to ingredients that have no authorised claim (collagen, hyaluronic acid, plant extracts, amino acids,
  bacterial cultures, mushrooms, enzymes – "Verdauungsenzym-Komplex sorgt für optimale Proteinaufnahme und verbesserte
  Verträglichkeit");
- a product name that promises an effect ("Stresstropfen", "Immun-Elixier", "Darm-Elixier");
- unspecific health benefits (Art. 10 Abs. 3 HCVO) with no authorised claim right next to them or footnoted: "wie eine gute
  Freundin für den weiblichen Organismus", "es gibt wenig, wobei dieses Superfood dich nicht unterstützen kann", "im hohen
  Alter aktiv bleiben", "Erholung nach Anstrengung", "starker antioxidativer Effekt", "für dein Wohlbefinden", "stärkt dich
  von innen", "Superfood für Frauen". Read the whole description – such sentences are often in the middle of long texts.
No issue: only taste, ingredients, origin, nutrition facts ("ballaststoffreich", "Proteinquelle"), preparation; authorised
claims in register wording ("Vitamin C trägt zu einer normalen Funktion des Immunsystems bei"); general benefits with a
footnote to authorised claims ("Support für Knochen, Muskeln & Immunsystem¹²³", "Komplex für Herz und Gefäße¹");
same-meaning paraphrases ("Proteine unterstützen den Aufbau von Muskeln"); anything that is not a food or supplement
(cosmetics, textiles, books, pet products, devices, CBD flowers and hash sold as aroma or decoration).
Unclear: a word like "Power", "Vital", "Kick" or "Powermomente" with no effect stated; vague metaphors ("Öffnet die Augen. Und
den Geist."); claims only on the page, not in the description; health words only in customer reviews.

## health-disease (krankheitsbezogene Aussage) – any product, cosmetics included

Issue: the product is said to prevent, relieve, cure or treat a disease or its symptoms: "gegen Akne", "entzündungshemmend",
"Entzündungen … gemindert", "fördert die Wundheilung", "ideal bei Pilzinfektionen", "hilft, Fußpilz vorzubeugen", "lindert
Periodenschmerzen", "bei Menstruationssymptomen … helfen", "Blähungen reduzieren", "senkt das LDL-Cholesterin", "Rachitis-
prophylaxe", "Heilmittel", a named disease with a treatment promise.
No issue: neutral mentions (allergen notes, warnings "nicht geeignet bei …", "bei Beschwerden Arzt fragen"); suitability
statements without a promise ("besonders geeignet bei sensibler Haut, Neurodermitis oder Allergieneigung", "auch bei
Endometriose geeignet"); authorised EU claims in their wording (melatonin and jet lag); permitted cosmetic purposes
("Kariesprophylaxe", antibacterial toothpaste, "gegen Unreinheiten", "reduziert Rötungen", "beruhigt gereizte Haut", "Pickel"
as a cosmetic concern, "schützt die Haut vor äußeren Einflüssen", "verbessert die Hautstruktur", "Anti-Aging", "gegen
Falten", "stärkt die Hautbarriere", "gegen Haarbruch"); pet products; books and guides. Most cosmetic care promises are not
disease claims – only a named disease or medical symptom (Akne, Neurodermitis-Schübe, Entzündung, Pilz, Schmerzen, Wunden,
Ekzem, Schuppenflechte, Haarausfall as a condition) with a promise to prevent, relieve or treat it is.
Unclear: a disease named without a clear promise ("Eignung für Diabetiker", "therapeutische Eigenschaften"); itching relief
for dry scalp or skin ("kann Juckreiz lindern") in a cosmetic.

## test-claim (Werbung mit Test, Auszeichnung oder Studie ohne Fundstelle)

Issue: a test result, award, study or clinical/dermatological test stated as fact WITHOUT tester AND date or issue:
"Dermatest® SEHR GUT", "dermatologisch mit „sehr gut“ bewertet/bestätigt", "Testsieger", "in unabhängigen Studien auf
Wirksamkeit getestet", "klinisch bestätigt", consumer-test percentages ("91 % der Testerinnen bestätigen …"), a shop's own
test group with results, "Nr. 1" / "Marktführer" as a fact without source.
No issue: the full source is given; subjective praise; a ranking within the shop's own range ("unser Bestseller"); customer
ratings with a count ("4,8/5, 519 Bewertungen"); awards with the awarding body and year ("PETA Vegan Award 2026", "Top Marke
der Lebensmittelzeitung 2024"); "die erste … auf dem Markt" (a first-to-market claim, not a test); a "Testmarkt" (market trial).
Unclear: "klinisch getestet", "dermatologisch getestet", "laborgeprüft" without a stated result or source; "nachweislich
wirksam" without a named study; results only in page badges with footnotes that are not visible ("+50 % Nagelhärte*").

## green-generic (pauschale Umweltaussage, UWG / EmpCo)

Issue: the product, its packaging or shipping is called environmentally friendly, sustainable, eco, "umweltschonend",
"umweltfreundlich", "klimafreundlich", "gut für die Umwelt", "nachhaltig", "biologisch abbaubar", "kompostierbar" in general
terms, WITHOUT a concrete basis in the same or the neighbouring sentence of the description. A basis further away (a material
list three sentences later, another tab) does not count. A template line repeated in every description counts each time.
Concrete bases: a named material the product is made of ("aus 100 % recyceltem PET", "Bio-Baumwolle", "Algenöl statt
Fischöl"), a percentage, a named certification (GOTS, FSC, OEKO-TEX, EU-Bio), "plastikfrei"/"ohne Plastik", "wiederverwendbar",
"Mehrweg", "nachfüllbar"/refill, "frei von Pestiziden", "kontrolliert biologischer Anbau", rescued ingredients, a stated
low dosage with refill. "Biologisch abbaubar" and "kompostierbar" are generic claims themselves, not a basis: a product or packaging simply called
„kompostierbar“ („aus kompostierbarer Folie“, „kompostierbare Gesichtsmaske“) is an issue. "Verzichtet auf
alles Unnötige – das schont die Umwelt" is not a concrete basis. Naming the eco ingredient is not a basis either
("umweltfreundlicher Aktivsauerstoff", "umweltschonende Rezeptur"): it says what is green, not why.
The product title is not a basis: "Armband aus Fischernetz" in the title does not explain "Dieses nachhaltige Armband" in the
description when the recycled net is only described sentences later. Count the sentences.
No issue: no environmental claim; the basis is in the same or neighbouring sentence ("zählt zu den nachhaltigsten Fasern"
right after naming MicroModal); "nachhaltig" meaning "lasting" ("versorgt die Haut nachhaltig mit Feuchtigkeit",
"unterstützt dich nachhaltig"); a mission statement not about the goods; a brand or product name alone ("Eco Vibe").
Unclear: a claim only in the page frame (footer, banner); a very short text where the basis is two sentences away.

## green-climate (klimaneutral durch Kompensation)

Issue: "klimaneutral", "CO₂-neutral", "klimapositiv" for the product or its shipping when it rests on offsetting or is not
explained. No issue: supporting a project without a neutrality claim; measured own reductions; a claim that names the
process or provider behind it ("Klimapositiver Druck durch gugler* DruckSinn"). Unclear: only in the page frame.

## green-label (Nachhaltigkeitssiegel ohne anerkanntes System)

Issue: a sustainability seal of the shop's own making, or a seal whose certifier is not named. No issue: recognised schemes
(EU Ecolabel, Blauer Engel, GOTS, Fairtrade, FSC, OEKO-TEX, Grüner Knopf, EU organic logo, Bio-Kontrollstelle number).

## law-as-benefit (Werbung mit Selbstverständlichkeiten)

Issue: the statutory 2-year warranty or the 14-day right of withdrawal is advertised as a special advantage of this shop or
product ("Bei uns 14 Tage Rückgaberecht!", "2 Jahre Garantie" when it is only the statutory warranty). No issue: neutral legal
information, the mandatory EU notice "Mindestens zwei Jahre gesetzliche Gewährleistung …", "Deine gesetzlichen
Gewährleistungsrechte", return periods longer than the law (30, 60, 100 days); a money-back guarantee (that is a guarantee,
not the withdrawal right). Unclear: only in the page frame or buy box ("14 Tage Rückgaberecht – risikofrei bestellen" next
to the basket button on every product).
