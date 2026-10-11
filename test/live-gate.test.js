import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('live entry refuses before credential access unless explicitly opted in', () => {
  const env = { ...process.env };
  delete env.DSH_LIVE_TESTS;
  delete env.DSH_LIVE_AGENTS;
  delete env.DSH_PI_AI_MODULE;
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('./live.mjs', import.meta.url))], { env, encoding: 'utf8' });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /Live tests are disabled/);
  assert.equal(result.stdout, '');
});
