import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { apiModes, parseCatalog, isOfficialTransport, TIERS } from '../lib/capabilities.js';
import { createCatalog } from '../lib/catalog.js';
import { createPreferences } from '../lib/preferences.js';
import { installTransport } from '../lib/transport.js';
import { createPlugin } from '../index.js';

const model = { provider: 'openai', id: 'gpt-6-astra', api: 'openai-responses', baseUrl: 'https://api.openai.com/v1' };
const selection = { sessionId: 's', provider: model.provider, model: model.id };
const credential = access => ({ kind: 'grant', payload: { type: 'oauth', access, accountId: 'account', expires: 999999 } });
function runtime() {
  class Models {
    streamSimple(m, c, options) { return { model: m, options }; }
  }
  return { createModels: () => new Models(), Models };
}
async function collect(stream) { const values = []; for await (const value of stream) values.push(value); return values; }

test('API modes are enumerated; future/lookalike models fail closed; preview opt-in', () => {
  assert.deepEqual(apiModes('gpt-6-astra'), ['standard', 'fast', 'ultrafast']);
  assert.deepEqual(apiModes('gpt-6.1-sol'), ['standard', 'fast', 'ultrafast']);
  assert.deepEqual(apiModes('gpt-5.6-sol'), ['standard', 'fast']);
  assert.deepEqual(apiModes('gpt-6-astra-proxy'), ['standard']);
  assert.deepEqual(apiModes('gpt-99'), ['standard']);
  assert.deepEqual(apiModes('gpt-5.6-sol', { apiUltrafastModels: ['gpt-5.6-sol'] }), ['standard', 'fast', 'ultrafast']);
  assert.deepEqual(TIERS, { standard: 'default', fast: 'priority', ultrafast: 'ultrafast' });
});
test('Codex catalog explicitly gates each tier, including ultrafast-only models', () => {
  const result = parseCatalog({ models: [null, { slug: 'a', additional_speed_tiers: ['fast', 'ultrafast'] },
    { slug: 'b', service_tiers: [{ id: 'priority' }] }, { slug: 'c', service_tiers: [{ id: 'ultrafast' }] },
    { slug: 'd', additional_speed_tiers: ['unknown'] }] });
  assert.deepEqual(result.get('a'), ['standard', 'fast', 'ultrafast']);
  assert.deepEqual(result.get('b'), ['standard', 'fast']);
  assert.deepEqual(result.get('c'), ['standard', 'ultrafast']);
  assert.deepEqual(result.get('d'), ['standard']);
  assert.throws(() => parseCatalog({}), /Malformed/);
});
test('endpoint safety rejects proxies, lookalike domains, HTTP and unrelated protocols', () => {
  assert.equal(isOfficialTransport(model, 'openai'), true);
  for (const baseUrl of ['https://api.openai.com.evil/v1', 'http://api.openai.com/v1', 'https://proxy.test/v1']) {
    assert.equal(isOfficialTransport({ ...model, baseUrl }, 'openai'), false);
  }
  assert.equal(isOfficialTransport({ ...model, api: 'anthropic-messages' }, 'openai'), false);
});
test('catalog deduplicates reads, expires, invalidates on credential changes, and never returns secrets', async () => {
  let now = 100, calls = 0, record = credential('secret-one');
  const catalog = createCatalog({ now: () => now, readCredential: async () => record, ttl: 100,
    fetch: async (url, options) => {
      calls++; assert.equal(options.redirect, 'error'); assert.ok(options.headers.Authorization.startsWith('Bearer '));
      assert.equal(new URL(url).searchParams.get('client_version'), '0.160.1');
      assert.equal(options.headers['User-Agent'], 'codex-cli/0.160.1');
      return Response.json({ models: [{ slug: 'a', additional_speed_tiers: ['fast'] }] });
    } });
  const reports = await Promise.all([catalog(), catalog(), catalog()]);
  assert.equal(calls, 1); assert.ok(!JSON.stringify(reports).includes('secret-one'));
  now = 201; await catalog(); assert.equal(calls, 2);
  record = credential('secret-two'); await catalog(); assert.equal(calls, 3);
  record = undefined; assert.equal((await catalog()).models.size, 0);
});
test('catalog supports an explicit compatibility version without URL injection', async () => {
  const version = '0.161.0&other=value';
  const catalog = createCatalog({ clientVersion: version, now: () => 100, readCredential: async () => credential('secret'),
    fetch: async (url, options) => {
      assert.equal(new URL(url).searchParams.get('client_version'), version);
      assert.equal(new URL(url).searchParams.has('other'), false);
      assert.equal(options.headers['User-Agent'], 'codex-cli/' + version);
      return Response.json({ models: [] });
    } });
  await catalog();
});
test('catalog failures/expired sign-in fail closed and raw errors are redacted', async () => {
  let record = credential('SECRET'), calls = 0;
  const catalog = createCatalog({ now: () => 100, readCredential: async () => record,
    fetch: async () => { calls++; throw new Error('SECRET account URL'); } });
  const result = await catalog(); assert.equal(result.models.size, 0); assert.ok(!result.note.includes('SECRET'));
  record.payload.expires = 1; await catalog(); assert.equal(calls, 1);
});
test('preferences persist atomically with private permissions, serialize concurrent writes, isolate sessions/models', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-speed-test-'));
  const file = join(dir, 'preferences.json'); const prefs = await createPreferences(file);
  await Promise.all([prefs.set({ ...selection, mode: 'fast' }), prefs.set({ ...selection, sessionId: 'other', mode: 'ultrafast' })]);
  const loaded = await createPreferences(file);
  assert.equal(loaded.get(selection), 'fast'); assert.equal(loaded.get({ ...selection, sessionId: 'other' }), 'ultrafast');
  assert.equal(loaded.get({ ...selection, model: 'different' }), undefined);
  assert.equal((await stat(file)).mode & 0o777, 0o600);
  assert.equal(JSON.parse(await readFile(file, 'utf8')).length, 2);
  await assert.rejects(prefs.set({ ...selection, mode: 'turbo' }), /Invalid/);
});
test('transport isolates interleaved calls, pins selection, composes payload hooks without mutation', async () => {
  const rt = runtime(), instance = rt.createModels(), shim = installTransport(rt.createModels);
  const originalOptions = Object.freeze({ onPayload: async p => ({ ...p, preserved: true, service_tier: 'wrong' }) });
  async function* stream() {
    await Promise.resolve();
    const result = instance.streamSimple(model, {}, originalOptions);
    yield await result.options.onPayload(Object.freeze({ model: model.id }), model);
    await Promise.resolve(); yield result.options.serviceTier;
  }
  try {
    const [fast, ultra] = await Promise.all([
      collect(shim.scope({ ...selection, tier: 'priority' }, stream)),
      collect(shim.scope({ ...selection, tier: 'ultrafast' }, stream)),
    ]);
    assert.equal(fast[0].service_tier, 'priority'); assert.equal(ultra[0].service_tier, 'ultrafast');
    assert.equal(fast[0].preserved, true); assert.equal(fast[1], 'priority'); assert.equal(ultra[1], 'ultrafast');
    assert.equal(originalOptions.serviceTier, undefined);
    assert.strictEqual(instance.streamSimple(model, {}, originalOptions).options, originalOptions);
  } finally { shim.dispose(); }
});
test('transport rejects nonofficial matching routes, ignores other models, and cleans up on cancellation/disposal', async () => {
  const rt = runtime(), instance = rt.createModels(), original = rt.Models.prototype.streamSimple;
  const shim = installTransport(rt.createModels); let cleanupTier;
  async function* stream() {
    try { yield instance.streamSimple(model, {}, {}).options.serviceTier; }
    finally { cleanupTier = instance.streamSimple(model, {}, {}).options.serviceTier; }
  }
  const iterator = shim.scope({ ...selection, tier: 'default' }, stream)[Symbol.asyncIterator]();
  assert.equal((await iterator.next()).value, 'default'); await iterator.return(); assert.equal(cleanupTier, 'default');
  await assert.rejects(collect(shim.scope({ ...selection, tier: 'priority' }, async function* () {
    yield instance.streamSimple({ ...model, baseUrl: 'https://proxy.test' }, {}, {});
  })), /official/);
  assert.throws(() => installTransport(rt.createModels), /already/);
  shim.dispose(); assert.strictEqual(rt.Models.prototype.streamSimple, original);
  const again = installTransport(rt.createModels); again.dispose();
});

test('host fails visibly when saved Codex acceleration is revoked and allows explicit Standard recovery', async () => {
  const rt = runtime(), effects = [], listeners = {}; let route, accelerated = true, now = 100;
  const ctx = {
    credentials: { readRecord: async () => credential('secret') },
    llm: { resolveModelInfo: async () => model }, effect(fn) { effects.push(fn()); },
    on(name, fn) { listeners[name] = fn; },
    connection: { fetch: { register(value) { route = value; return () => {}; } } },
  };
  await createPlugin({ loadRuntime: async () => rt, now: () => now,
    fetch: async () => Response.json({ models: [{ slug: model.id, additional_speed_tiers: accelerated ? ['fast'] : [] }] }),
  })(ctx, { stateFile: false });
  const request = { ...selection, provider: 'openai-codex' };
  const put = mode => route.fetch(new Request('http://localhost/api/dsh-speed', { method: 'PUT', body: JSON.stringify({ ...request, mode }) }));
  let calls = 0;
  const next = async function* () { calls++; yield 'generated'; };
  try {
    assert.equal((await put('fast')).status, 200);
    accelerated = false; now += 300001;
    await assert.rejects(collect(listeners['llm/stream'](request, next)), /no longer available/);
    assert.equal(calls, 0);
    const response = await route.fetch(new Request('http://localhost/api/dsh-speed?'+new URLSearchParams(request)));
    const report = await response.json(); assert.equal(report.mode, 'fast'); assert.ok(report.warning);
    assert.equal((await put('standard')).status, 200);
    assert.deepEqual(await collect(listeners['llm/stream'](request, next)), ['generated']);
  } finally { for (const effect of effects.reverse()) await effect?.(); }
});

test('host API validates capabilities, stores per-session selections, forwards frozen requests, skips auxiliary calls', async () => {
  const rt = runtime(); const effects = []; const listeners = {}; let route;
  const ctx = {
    credentials: { readRecord: async () => credential('secret') },
    llm: { resolveModelInfo: async () => model },
    effect(fn) { effects.push(fn()); }, on(name, fn) { listeners[name] = fn; },
    connection: { fetch: { register(value) { route = value; return () => {}; } } },
  };
  await createPlugin({ loadRuntime: async () => rt, now: () => 100,
    fetch: async () => Response.json({ models: [{ slug: model.id, additional_speed_tiers: ['fast'] }] }),
  })(ctx, { stateFile: false });
  const put = s => route.fetch(new Request('http://localhost/api/dsh-speed', { method: 'PUT', body: JSON.stringify(s) }));
  try {
    assert.equal((await put({ ...selection, mode: 'ultrafast' })).status, 200);
    assert.equal((await put({ ...selection, provider: 'openai-codex', mode: 'ultrafast' })).status, 400);
    assert.equal((await put({ ...selection, mode: 'invalid' })).status, 400);
    assert.equal((await put({ ...selection, provider: 'anthropic', mode: 'fast' })).status, 400);
    const instance = rt.createModels();
    const next = async function* () { yield instance.streamSimple(model, {}, {}).options.serviceTier; };
    const request = Object.freeze({ ...selection, messages: Object.freeze([]) });
    assert.deepEqual(await collect(listeners['llm/stream'](request, next)), ['ultrafast']);
    assert.deepEqual(await collect(listeners['llm/stream']({ ...request, sessionId: 'other' }, next)), [undefined]);
    assert.deepEqual(await collect(listeners['llm/stream']({ ...request, purpose: 'session-title' }, next)), [undefined]);
    const response = await route.fetch(new Request('http://localhost/api/dsh-speed?'+new URLSearchParams(selection)));
    assert.equal((await response.json()).mode, 'ultrafast');
  } finally { for (const effect of effects.reverse()) await effect?.(); }
});
