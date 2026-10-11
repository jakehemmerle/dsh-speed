import test from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { createPlugin } from '../index.js';

async function setup(tiers = ['priority', 'ultrafast']) {
  const effects = [], commands = new Map(), services = new Map(), dialogs = [];
  let answer = 'fast';
  const agent = { id: 'session', status: 'idle', options: { provider: 'providerproxy', model: 'gpt-6.1-sol' } };
  const ctx = {
    credentials: { readRecord() { assert.fail('Proxy commands must not read Codex auth'); } },
    llm: {}, on() {}, provide(name, service) { services.set(name, service); },
    effect(fn) { effects.push(fn()); },
    inject(names, fn) { fn(this); },
    connection: { fetch: { register() { return () => {}; } } },
    commands: { register(command) { commands.set(command.name, command); return () => {}; } },
    tuiDialogs: { async select(request) { dialogs.push(request); return typeof answer === 'function' ? answer() : answer; } },
  };
  class Models { streamSimple() {} }
  await createPlugin({ loadRuntime: async () => ({ createModels: () => new Models() }),
    env: { MOCK_KEY: 'synthetic' }, fetch: async () => Response.json({ data: [
      { id: agent.options.model, service_tiers: tiers },
    ] }),
  })(ctx, { stateFile: false, proxyProviders: { providerproxy: { baseURL: 'http://localhost:1234/v1', apiKeyEnv: 'MOCK_KEY' } } });
  return { agent, dialogs, services, answer(value) { answer = value; },
    run: (rawInput = '') => commands.get('speed').handler({ agent, rawInput, signal: new AbortController().signal }),
    mode: () => services.get('dshSpeed')?.getMode({ sessionId: agent.id, ...agent.options }),
    dispose() { for (const effect of effects.reverse()) effect?.(); },
  };
}

test('property: bare /speed toggles the two offered speeds and publishes the same saved mode', async () => {
  const seed = Number(process.env.FC_SEED ?? 61120); console.log('TUI property seed', seed, 'numRuns', Number(process.env.NUM_RUNS ?? 100));
  await fc.assert(fc.asyncProperty(fc.array(fc.boolean(), { minLength: 1, maxLength: 25 }), async operations => {
    const app = await setup(['priority']);
    try {
      let expected = 'standard', updates = 0;
      assert.equal(app.mode(), expected);
      const unsubscribe = app.services.get('dshSpeed').subscribe(() => updates++);
      for (const toggle of operations) {
        const result = await app.run(toggle ? '' : 'status');
        if (toggle) expected = expected === 'standard' ? 'fast' : 'standard';
        assert.equal(result.kind, 'success');
        assert.equal(app.mode(), expected);
        assert.match(result.text, new RegExp('Speed: ' + expected));
        assert.equal(app.dialogs.length, 0);
      }
      assert.equal(updates, operations.filter(Boolean).length);
      unsubscribe();
    } finally { app.dispose(); }
  }), { seed, numRuns: Number(process.env.NUM_RUNS ?? 100) });
});

test('three speeds open the managed picker, save the selected row, and cancel without changing', async () => {
  const app = await setup();
  try {
    app.answer('ultrafast');
    assert.equal((await app.run()).kind, 'success');
    assert.equal(app.mode(), 'ultrafast');
    assert.deepEqual(app.dialogs[0].options.map(o => o.id), ['standard', 'fast', 'ultrafast']);
    assert.deepEqual(app.dialogs[0].options.map(o => o.label), ['Standard', '⚡ Fast', '⚡⚡ Ultrafast']);
    app.answer(undefined);
    assert.equal((await app.run()).kind, 'success');
    assert.equal(app.mode(), 'ultrafast');
    app.answer('fast');
    assert.equal((await app.run()).kind, 'success');
    assert.equal(app.mode(), 'fast');
  } finally { app.dispose(); }
});

test('busy, changed-model, and unavailable selections never save an accelerated mode', async () => {
  const app = await setup();
  try {
    app.agent.status = 'running';
    assert.equal((await app.run()).kind, 'error');
    assert.equal(app.dialogs.length, 0);
    app.agent.status = 'idle';
    app.answer(() => { app.agent.options.model = 'gpt-6-astra'; return 'ultrafast'; });
    assert.equal((await app.run()).kind, 'error');
    assert.equal(app.mode(), 'standard');
  } finally { app.dispose(); }
  const limited = await setup(['priority']);
  try {
    assert.equal((await limited.run('ultrafast')).kind, 'error');
    assert.equal(limited.mode(), 'standard');
  } finally { limited.dispose(); }
});

test('unloading removes the speed projection and releases its subscriptions', async () => {
  const app = await setup();
  let updates = 0;
  app.services.get('dshSpeed').subscribe(() => updates++);
  app.dispose();
  assert.equal(app.mode(), undefined);
  assert.equal(updates, 1);
});
