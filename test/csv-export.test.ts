// A spreadsheet must not run a cell of a shop's text as a formula.
import { describe, expect, it } from 'vitest';
import { reportToCsv } from '../src/report/export.js';
import type { ScanReport } from '../src/types.js';

describe('CSV export against formula injection', () => {
  const report = (evidence: string): ScanReport => ({
    id: 'r', origin: 'https://shop.test', platform: 'shopify', createdAt: '2026-10-10T10:00:00Z', mode: 'jev', model: 'm', truncated: false,
    findings: [{ ruleId: 'green-generic', level: 'pruefen', confidence: 0.6, basis: 'modell', subject: { type: 'product', id: '1', title: 'Seife' }, evidence: [evidence] }],
    stats: { products: 1, decisions: 1, inputTokens: 0, costUsd: 0, errors: 0, durationMs: 0 }, errors: [],
  });

  it.each(['=HYPERLINK("https://evil.test","x")', '+1+1', '-2+3', '@SUM(A1)', '\t=1+1', '\r=1+1'])('quotes a cell starting with %j', (evidence) => {
    const csv = reportToCsv(report(evidence));
    // The cell is prefixed with an apostrophe (inside quotes when it holds a separator, quote or line break).
    expect(csv.includes(`'${evidence.replace(/"/g, '""')}`)).toBe(true);
  });
});
