// A copy of src/ and the package files must run on its own, so every file the scanner reads relative to its own modules has
// to live under src/ – the second opinion's rulebook, for one.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { judgeSystem, RULEBOOK_URL } from '../src/scan/second-judge.js';

const SRC = resolve('src');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? sourceFiles(path) : /\.(?:ts|tsx)$/.test(name) ? [path] : [];
  });
}

describe('the scanner ships on its own', () => {
  it('reads every module-relative file from inside src/, and each of them exists', () => {
    const outside: string[] = [];
    const missing: string[] = [];
    for (const file of sourceFiles(SRC)) {
      for (const m of readFileSync(file, 'utf8').matchAll(/new URL\(\s*['"`]([^'"`$]+)['"`]\s*,\s*import\.meta\.url\s*\)/g)) {
        const target = resolve(dirname(file), m[1]!);
        const where = `${relative(SRC, file)} → ${m[1]}`;
        if (relative(SRC, target).startsWith('..') || !target.startsWith(SRC + sep)) outside.push(where);
        else if (!existsSync(target)) missing.push(where);
      }
    }
    expect(outside).toEqual([]);
    expect(missing).toEqual([]);
  });

  it('finds the second opinion’s rulebook next to its module', () => {
    expect(fileURLToPath(RULEBOOK_URL).startsWith(SRC + sep)).toBe(true);
    // The rulebook's own sections, then the answer format appended by the module.
    expect(judgeSystem()).toMatch(/## unit-price[\s\S]+## strike-price[\s\S]+## Answer/);
  });
});
