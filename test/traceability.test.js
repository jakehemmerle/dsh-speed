// Traceability gate: every property ID defined in SPEC.md must be mapped in TESTING.md
// (TESTING.md's traceability table), and TESTING.md must not name IDs that SPEC.md does not
// define (typo guard). Runs in the sandboxed fast suite: both files are in the flake source.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const ids = text => new Set(text.match(/\bP-\d{2}\b/g) ?? []);

test('every SPEC.md property ID is mapped in TESTING.md, and vice versa', async () => {
  const spec = ids(await readFile(fileURLToPath(new URL('../SPEC.md', import.meta.url)), 'utf8'));
  const testing = ids(await readFile(fileURLToPath(new URL('../TESTING.md', import.meta.url)), 'utf8'));
  assert.ok(spec.size >= 30, 'SPEC.md property extraction found the full ID set (found ' + spec.size + ')');
  const unmapped = [...spec].filter(id => !testing.has(id));
  assert.deepEqual(unmapped, [], 'SPEC properties missing from TESTING.md');
  const phantom = [...testing].filter(id => !spec.has(id));
  assert.deepEqual(phantom, [], 'TESTING.md names IDs that SPEC.md does not define');
});
