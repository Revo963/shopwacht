// Builds src/rules/data/health-claims.json from the official list of
// permitted health claims (annex to Regulation (EU) No 432/2012, consolidated version, German, EUR-Lex).
//
//   npx tsx tools/import-health-claims.ts [CELEX-id]      default: the version below
//
// Re-run when EUR-Lex publishes a new consolidated version and commit the JSON with the new source id.

import { writeFile } from 'node:fs/promises';
import { parse } from 'node-html-parser';

const celex = process.argv[2] ?? '02012R0432-20250820';
const url = `https://eur-lex.europa.eu/legal-content/DE/TXT/HTML/?uri=CELEX:${celex}`;

const res = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 (ShopWacht data import)' } });
if (!res.ok) throw new Error(`EUR-Lex antwortet ${res.status}`);
const root = parse(await res.text());

// Amendment markers ("►M5", "▼M3", "◄") and footnote references are not part of the wording.
const clean = (s: string) =>
  s
    .replace(/[►▼◄]\s*[A-Z]\d*/g, ' ')
    .replace(/[►▼◄]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

interface Claim {
  nutrient: string;
  claim: string;
  conditions: string;
  restrictions: string;
}

const claims: Claim[] = [];
let lastNutrient = '';
for (const row of root.querySelectorAll('tr')) {
  const cells = row.querySelectorAll('td').map((c) => clean(c.text));
  if (cells.length < 5) continue;
  // The amendment table at the top has five cells starting with "M1", "M2" …
  if (cells.length === 5 && /^(?:M\d+|VERORDNUNG)/.test(cells[0]!)) continue;
  if (/Nährstoff, Substanz/.test(cells[0]!)) continue; // header row
  if (/^\(\*\d\)/.test(cells[0]!)) continue; // footnotes below the table
  const [nutrient, claim, conditions, restrictions] = cells.length >= 6 ? cells : [lastNutrient, ...cells];
  if (!claim || !/\p{L}/u.test(claim)) continue;
  lastNutrient = nutrient!;
  claims.push({ nutrient: nutrient!, claim, conditions: conditions ?? '', restrictions: restrictions ?? '' });
}

if (claims.length < 200) throw new Error(`Nur ${claims.length} Angaben gefunden – Tabellenformat geändert?`);
const out = {
  source: `Verordnung (EU) Nr. 432/2012, Anhang (Liste zulässiger gesundheitsbezogener Angaben), konsolidierte Fassung CELEX:${celex}`,
  url,
  importedAt: new Date().toISOString().slice(0, 10),
  claims,
};
await writeFile('src/rules/data/health-claims.json', `${JSON.stringify(out, null, 1)}\n`);
console.log(`${claims.length} zulässige Angaben für ${new Set(claims.map((c) => c.nutrient)).size} Stoffe geschrieben.`);
