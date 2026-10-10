// Running the tests must leave the folder of the user's real reports alone.
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { REPORT_DIR } from '../src/scan/jobs.js';

it('saves test reports outside the project data folder', () => {
  expect(REPORT_DIR.startsWith(join(process.cwd(), 'data'))).toBe(false);
});
