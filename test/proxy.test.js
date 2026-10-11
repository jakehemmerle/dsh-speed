import test from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { createPlugin } from '../index.js';

const baseURL = 'http://127.0.0.1:4123/v1';
const selection = { sessionId: 'session', provider: 'providerproxy', model: 'gpt-6.1-sol' };
async function setup({ tiers = ['priority', 'ultrafast'], fetch, modelBase = baseURL } = {}) {
  const effects = [], listeners = {}, calls = [];
  let route, clock = 0;
  class Models { streamSimple(model, context, options) { return { model, options }; } }
  const models = new Models();
  const model = { provider: selection.provider, id: selection.model, api: 'openai-responses', baseUrl: modelBase };
  await createPlugin({ loadRuntime: async () => ({ createModels: () => new Models() }),
    env: { MOCK_KEY: 'proxy-test-token' }, now: () => clock,
    fetch: fetch ?? (async (url, init) => { calls.push({ url, init }); return Response.json({ object: 'list', data: [
      { id: selection.model, service_tiers: tiers }, { id: 'claude-opus-5-5', service_tiers: ['default'] },
    ] }); }),
  })({ credentials: { readRecord: async () => { throw new Error('must not read local Codex credentials'); } },
    llm: { resolveModelInfo: async () => model }, on(name, fn) { listeners[name] = fn; },
    effect(fn) { effects.push(fn()); }, connection: { fetch: { register(value) { route = value; return () => {}; } } },
  }, { stateFile: false, proxyProviders: { providerproxy: { baseURL, apiKeyEnv: 'MOCK_KEY' } }, catalogTtlMs: 1 });
  return { model, models, calls, listeners, advance: ms => { clock += ms; },
    get: async (s = selection) => route.fetch(new Request('http://localhost/api/dsh-speed?' + new URLSearchParams(s))),
    put: async (mode, s = selection) => route.fetch(new Request('http://localhost/api/dsh-speed', { method: 'PUT', body: JSON.stringify({ ...s, mode }) })),
    dispose: () => { for (const fn of effects.reverse()) fn?.(); },
  };
}
async function collect(stream) { const out = []; for await (const item of stream) out.push(item); return out; }

test('property: public proxy capabilities exactly reflect account-advertised native tiers', async () => {
  const seed = Number(process.env.FC_SEED ?? 61106); console.log('proxy property seed', seed);
  await fc.assert(fc.asyncProperty(fc.array(fc.constantFrom('default', 'priority', 'fast', 'ultrafast', 'flex', 'unknown'), { maxLength: 20 }), async tiers => {
    const app = await setup({ tiers });
    try {
      const response = await app.get(); assert.equal(response.status, 200);
      const report = await response.json();
      assert.equal(report.available, true);
      assert.deepEqual(report.modes, ['standard', ...(tiers.some(t => t === 'priority' || t === 'fast') ? ['fast'] : []), ...(tiers.includes('ultrafast') ? ['ultrafast'] : [])]);
      assert.equal(app.calls[0].url, baseURL + '/models');
      assert.equal(app.calls[0].init.headers.Authorization, 'Bearer proxy-test-token');
      assert.equal(app.calls[0].init.redirect, 'error');
      assert.ok(!JSON.stringify(report).includes('proxy-test-token'));
    } finally { app.dispose(); }
  }), { seed, numRuns: Number(process.env.NUM_RUNS ?? 100) });
});

test('proxy selection forwards the tier at the final payload, without touching auxiliary requests', async () => {
  const app = await setup();
  try {
    for (const [mode, tier] of Object.entries({ standard: 'default', fast: 'priority', ultrafast: 'ultrafast' })) {
      assert.equal((await app.put(mode)).status, 200);
      const request = Object.freeze({ ...selection, messages: Object.freeze([]) });
      const next = async function* () { const result = app.models.streamSimple(app.model, {}, { onPayload: async p => ({ ...p, retained: true }) }); yield await result.options.onPayload({ model: selection.model }, app.model); };
      assert.deepEqual(await collect(app.listeners['llm/stream'](request, next)), [{ model: selection.model, retained: true, service_tier: tier }]);
      const auxiliary = async function* () { yield app.models.streamSimple(app.model, {}, {}).options?.serviceTier; };
      assert.deepEqual(await collect(app.listeners['llm/stream']({ ...selection, purpose: 'session-title' }, auxiliary)), [undefined]);
      assert.deepEqual(await collect(app.listeners['llm/stream']({ ...selection, sessionId: 'unselected' }, auxiliary)), [undefined]);
    }
    assert.equal((await app.put('ultrafast', { ...selection, model: 'claude-opus-5-5' })).status, 400);
    assert.equal((await app.put('fast', { ...selection, model: 'unlisted-gpt' })).status, 400);
    assert.equal((await app.put('fast', { ...selection, provider: 'untrusted' })).status, 400);
  } finally { app.dispose(); }
});

test('revoked or failed proxy catalog rejects saved acceleration instead of silently downgrading', async () => {
  let available = true;
  const app = await setup({ fetch: async () => available ? Response.json({ data: [{ id: selection.model, service_tiers: ['priority'] }] }) : new Response('unauthorized', { status: 401 }) });
  try {
    assert.equal((await app.put('fast')).status, 200);
    available = false;
    const next = async function* () { assert.fail('must not reach inference'); };
    // TTL is advanced deterministically via a separately unavailable catalog in tests below.
    app.advance(2);
    const report = await (await app.get()).json();
    assert.deepEqual(report.modes, ['standard']); assert.equal(report.mode, 'fast'); assert.ok(report.warning);
    await assert.rejects(collect(app.listeners['llm/stream'](selection, next)), /no longer available/);
    assert.equal((await app.put('standard')).status, 200);
  } finally { app.dispose(); }
});

test('explicit proxy trust does not authorize another model endpoint', async () => {
  const app = await setup({ modelBase: 'http://127.0.0.1:4123/v1/other' });
  try {
    assert.equal((await app.put('fast')).status, 200);
    const next = async function* () { yield app.models.streamSimple(app.model, {}, {}); };
    await assert.rejects(collect(app.listeners['llm/stream'](selection, next)), /transport|endpoint|supports/);
  } finally { app.dispose(); }
});

test('malformed catalog fails closed and does not expose authenticated upstream errors', async () => {
  for (const body of [null, {}, { data: 'junk' }, { data: [{ id: selection.model, service_tiers: 'priority' }] }]) {
    const app = await setup({ fetch: async () => Response.json(body) });
    try { const report = await (await app.get()).json(); assert.deepEqual(report.modes, ['standard']); assert.equal((await app.put('fast')).status, 400); }
    finally { app.dispose(); }
  }
});
