// Scan one or more shops from the terminal, e.g. for a batch of prospects:
//   npm run scan -- shop-a.de shop-b.de export.csv --max 500

import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { parseArgs } from 'node:util';
import { config, createProvider, createSecondJudge } from './config.js';
import { summarize } from './report/summary.js';
import { newJobId, saveReport } from './scan/jobs.js';
import { loaderFor, pageCheckMode, scannerWith, type Target } from './scan/service.js';
import { createFetcher } from './sources/http.js';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { max: { type: 'string' }, help: { type: 'boolean', short: 'h' } },
});

if (values.help || positionals.length === 0) {
  console.log('Aufruf: npm run scan -- <shop-adresse | export.csv> [weitere …] [--max 500]');
  process.exit(positionals.length === 0 ? 1 : 0);
}

const provider = createProvider();
// On by default, SECOND_JUDGE=off switches it off.
const judge = provider.mode === 'jev' ? createSecondJudge() : undefined;
const fetcher = createFetcher();
const maxProducts = values.max ? Number(values.max) : config.maxProducts;
console.log(`Modus: ${provider.name}${provider.mode === 'demo' ? ' – für echte Ergebnisse OPENROUTER_API_KEY in .env setzen' : ''}`);
console.log(`Produktseiten: ${pageCheckMode() === 'browser' ? 'im Browser (Chrome) geprüft' : 'als HTML geprüft (kein Chrome gefunden)'}\n`);

let failed = false;
for (const arg of positionals) {
  const target: Target = arg.toLowerCase().endsWith('.csv')
    ? { kind: 'csv', name: basename(arg), content: await readFile(arg, 'utf8') }
    : { kind: 'url', url: arg };
  const id = newJobId();
  try {
    process.stdout.write(`${arg}: lade Produkte …`);
    const shop = await loaderFor(target, fetcher, maxProducts)((n) => process.stdout.write(`\r${arg}: ${n} Produkte geladen …`));
    process.stdout.write(`\r${arg}: ${shop.products.length} Produkte${shop.truncated ? ` (auf ${maxProducts} begrenzt)` : ''}, prüfe …\n`);
    const report = await scannerWith(provider, fetcher, undefined, undefined, { judge })(id, shop, (p) => {
      if (process.stdout.isTTY) process.stdout.write(`\r  ${p.phase}: ${p.done}/${p.total}   `);
    });
    await saveReport(report);
    printReport(report);
    console.log(`  Bericht: http://localhost:${config.port}/bericht/${id}  (npm start)\n`);
  } catch (err) {
    failed = true;
    console.log(`\n  Fehler: ${(err as Error).message}\n`);
  }
}
process.exit(failed ? 1 : 0);

function printReport(report: Awaited<ReturnType<ReturnType<typeof scannerWith>>>) {
  const s = summarize(report);
  const { stats } = report;
  console.log(
    `\r  ${s.risiko} Risiken, ${s.pruefen} zu prüfen · ${stats.decisions} Jev-Abfragen · ${(stats.durationMs / 1000).toFixed(1)} s · $${stats.costUsd.toFixed(4)}`,
  );
  for (const g of s.groups) {
    console.log(`  [${g.rule.severity.padEnd(7)}] ${g.rule.title}: ${g.risiko} Risiko, ${g.pruefen} prüfen`);
    for (const f of g.findings.slice(0, 3)) {
      console.log(`      – ${f.subject.title}${f.evidence[0] ? `: „${f.evidence[0].slice(0, 90)}“` : f.note ? `: ${f.note}` : ''}`);
    }
  }
  if (report.secondJudge) {
    const j = report.secondJudge;
    console.log(`  Zweite Prüfung (${j.models.join(' + ')}): ${j.judged}/${j.products} Produkte beurteilt, ${j.dropped} Befunde entfernt (nur im CSV-Export), ${j.downgraded} herabgestuft, ${j.added} ergänzt · ${j.failed} ohne Antwort, ${j.overCap} über dem Limit von $${j.maxUsd} · $${j.costUsd.toFixed(4)}${j.stoppedBy ? ` · abgebrochen: ${j.stoppedBy}` : ''}`);
  }
  for (const e of report.errors.slice(0, 5)) console.log(`  ! ${e}`);
  // Surface coverage even when no finding or exception was emitted.
  if (report.coverage?.incompleteRuleIds.length) {
    console.log(`  ! Prüfung eingeschränkt: ${report.coverage.incompleteProducts}/${report.coverage.products} Produkte; ${report.coverage.incompleteRuleIds.length} Prüfpunkte teilweise nicht prüfbar.`);
  }
}
