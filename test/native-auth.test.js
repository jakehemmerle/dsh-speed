import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import fc from 'fast-check';
import { createPlugin } from '../index.js';
import { createNativeAuth } from '../lib/native-auth.js';

const model = { provider: 'openai-codex', id: 'gpt-6.1-sol', api: 'openai-codex-responses', baseUrl: 'https://chatgpt.com/backend-api' };
function document(account, expires = Date.now() + 3600000) {
  const access = 'header.' + Buffer.from(JSON.stringify({ exp: expires / 1000,
    'https://api.openai.com/auth': { chatgpt_account_id: account } })).toString('base64url') + '.signature';
  return { auth_mode: 'chatgpt', tokens: { access_token: access, refresh_token: 'DO_NOT_COPY_REFRESH', account_id: account } };
}
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-native-auth-'));
  const authFile = join(root, 'auth.json');
  let route;
  const effects = [], requests = [];
  class Models {
    getProvider() { return { baseUrl: model.baseUrl }; }
    async getAuth() { throw new Error('must not read stale DSH OAuth'); }
    streamSimple() {}
  }
  const original = Models.prototype.getAuth;
  const models = new Models();
  await createPlugin({ loadRuntime: async () => ({ createModels: () => new Models() }),
    fetch: async (url, init) => { requests.push(init); return Response.json({ models: [{ slug: model.id, additional_speed_tiers: ['fast', 'ultrafast'] }] }); },
  })({ credentials: { readRecord: async () => { throw new Error('must not read stale DSH OAuth'); } },
    llm: { resolveModelInfo: async () => model }, on() {}, effect(fn) { effects.push(fn()); },
    connection: { fetch: { register(value) { route = value; return () => {}; } } },
  }, { stateFile: false, codexAuthFile: authFile });
  t.after(async () => { for (const fn of effects.reverse()) await fn?.(); assert.equal(Models.prototype.getAuth, original); await rm(root, { recursive: true }); });
  return { models, requests, authFile,
    write: value => writeFile(authFile, JSON.stringify(value), { mode: 0o600 }),
    get: () => route.fetch(new Request('http://localhost/api/dsh-speed?' + new URLSearchParams({ sessionId: 's', provider: model.provider, model: model.id }))),
  };
}
test('property: catalog and real auth seam follow local Codex account changes without copying refresh tokens', async t => {
  const app = await fixture(t);
  const seed = Number(process.env.FC_SEED ?? 61107); console.log('native auth property seed', seed);
  await fc.assert(fc.asyncProperty(fc.stringMatching(/^[a-z][a-z0-9]{1,20}$/), async account => {
    account = "acct-" + account;
    const doc = document(account); await app.write(doc);
    const response = await app.get(); const report = await response.json();
    assert.deepEqual(report.modes, ['standard', 'fast', 'ultrafast']);
    const auth = await app.models.getAuth(model);
    assert.equal(auth.auth.apiKey, doc.tokens.access_token);
    assert.equal(auth.auth.headers['ChatGPT-Account-Id'], account);
    assert.equal(app.requests.at(-1).headers.Authorization, 'Bearer ' + doc.tokens.access_token);
    assert.equal(JSON.stringify(report).includes(account), false);
    assert.equal(JSON.stringify(auth).includes('DO_NOT_COPY_REFRESH'), false);
  }), { seed, numRuns: Number(process.env.NUM_RUNS ?? 50) });
});
test('missing, malformed, mismatched and expired local auth fail closed without falling back to stale DSH credentials', async t => {
  const app = await fixture(t);
  for (const value of [null, {}, document('expired', 1), { ...document('actual'), tokens: { ...document('actual').tokens, account_id: 'wrong' } }]) {
    await app.write(value);
    assert.deepEqual((await (await app.get()).json()).modes, ['standard']);
    await assert.rejects(app.models.getAuth(model), /Codex/);
  }
  await app.write(document('valid'));
  await assert.rejects(app.models.getAuth({ ...model, baseUrl: 'https://evil.test' }), /endpoint/);
});

test('concurrent expiring-token reads delegate one refresh to Codex and reread its file', async t => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-native-refresh-'));
  t.after(() => rm(root, { recursive: true }));
  const file = join(root, 'auth.json');
  await writeFile(file, JSON.stringify(document('account', 1)), { mode: 0o600 });
  let calls = 0;
  const read = createNativeAuth({ file, command: 'codex-fixture', refresh: async (command, target) => {
    calls++; assert.equal(command, 'codex-fixture'); assert.equal(target, file);
    await new Promise(resolve => setTimeout(resolve, 10));
    await writeFile(file, JSON.stringify(document('account')), { mode: 0o600 });
  } });
  const records = await Promise.all([read(), read(), read()]);
  assert.equal(calls, 1);
  assert.ok(records.every(r => r.payload.expires > Date.now()));
  assert.ok(records.every(r => !JSON.stringify(r).includes('DO_NOT_COPY_REFRESH')));
});
