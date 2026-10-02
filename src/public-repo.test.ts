// The repository is public and SPEC.md is not (DECISIONS 2026-09-13), so his birth date
// lives only in the spec. It is read from there at run time so that this file never
// carries it, and a failure names the file, never the date. Without the spec, as in CI,
// there is nothing to compare against.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const spec = join(root, 'SPEC.md');

test(
  'ningun archivo publicado lleva su fecha de nacimiento, escrita de ninguna forma',
  { skip: !existsSync(spec) && 'sin SPEC.md no hay con que comparar' },
  () => {
    const born = /^- Born (\d{4})-(\d{2})-(\d{2})\b/m.exec(readFileSync(spec, 'utf8'));
    assert.ok(born, 'spec 1.1 ya no dice la fecha de nacimiento como "- Born AAAA-MM-DD"');
    const [, year, month, day] = born;
    const spellings = [
      `${year}-${month}-${day}`,
      `${year}-${day}-${month}`,
      `${day}-${month}-${year}`,
      `${day}/${month}/${year}`,
      `${month}/${day}/${year}`,
    ];

    const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' })
      .split('\0')
      .filter((file) => file !== '' && existsSync(join(root, file)));
    const leaks = tracked.filter((file) => {
      const text = readFileSync(join(root, file), 'utf8');
      return spellings.some((spelling) => text.includes(spelling));
    });

    assert.deepEqual(leaks, []);
  },
);
