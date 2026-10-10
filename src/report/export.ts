import { ruleById } from '../rules/index.js';
import { remedyFor } from './remedy.js';
import { SECOND_JUDGE_ADDED } from './summary.js';
import type { ScanReport } from '../types.js';

// The last column says what the second opinion did to a finding; the
// findings it removed follow the others, marked „entfernt“ – the report page does not show them.
const HEADER = ['Prüfpunkt', 'Schwere', 'Stufe', 'Grundlage', 'Sicherheit', 'Betrifft', 'URL', 'Fundstelle', 'Hinweis', 'Rechtsgrundlage', 'Empfehlung', 'Zweite KI-Prüfung'];

// CSV attribution describes the method without identifying the model.
const BASIS = { modell: 'KI-gestützte Prüfung', stichwort: 'Stichwort (Demo)', regel: 'Regelprüfung' } as const;
const SECOND_JUDGE = { added: 'ergänzt', downgraded: 'herabgestuft', removed: 'entfernt' } as const;

/** Semicolon CSV with BOM, so German Excel opens it with umlauts intact. */
export function reportToCsv(report: ScanReport): string {
  const rows = [...report.findings, ...(report.removedFindings ?? [])].map((f) => {
    const rule = ruleById(f.ruleId);
    const added = f.secondJudge === 'added';
    return [
      rule?.title ?? f.ruleId,
      rule?.severity ?? '',
      f.level === 'risiko' ? 'Risiko' : 'Prüfen',
      added ? SECOND_JUDGE_ADDED : BASIS[f.basis ?? 'modell'],
      f.basis === 'regel' || added ? '' : `${Math.round(f.confidence * 100)} %`,
      f.subject.title,
      f.subject.url ?? '',
      f.evidence.join(' | '),
      f.note ?? '',
      rule?.law ?? '',
      remedyFor(rule, f).text,
      f.secondJudge ? SECOND_JUDGE[f.secondJudge] : '',
    ];
  });
  return `﻿${[HEADER, ...rows].map((r) => r.map(cell).join(';')).join('\r\n')}\r\n`;
}

function cell(value: string): string {
  // Leading = + - @ would run as a formula in Excel. So would a tab or a carriage
  // return in front of one (OWASP, CSV injection).
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[;"\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}
