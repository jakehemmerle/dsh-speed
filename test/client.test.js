import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

// Deterministic hook harness: verify the picker wiring and async guards without
// a second web server, a paid request, or altering the live DSH profile.
async function harness(fetch, initial = { provider: 'openai', model: 'gpt-6-astra' }) {
  let exported, cursor = 0, hooks = [], effects = [], pending = [];
  let current = initial;
  const React = {
    createElement(type, props, ...children) { return { type, props: props ?? {}, children: children.flat() }; },
    useState(value) {
      const i = cursor++; if (!(i in hooks)) hooks[i] = value;
      return [hooks[i], value => { hooks[i] = typeof value === 'function' ? value(hooks[i]) : value; }];
    },
    useRef(value) { const i = cursor++; return hooks[i] ??= { current: value }; },
    useSyncExternalStore(subscribe, read) { return read(); },
    useEffect(fn, deps) {
      const i = cursor++, old = effects[i];
      if (!old || deps.some((v, j) => v !== old.deps[j])) pending.push(() => {
        old?.cleanup?.(); effects[i] = { deps, cleanup: fn() };
      });
    },
  };
  vm.runInNewContext(await readFile(new URL('../client.js', import.meta.url), 'utf8'), {
    window: { __ModuleLoader__: { load(module) { exported = module.factory(() => React); } } },
    URLSearchParams, setInterval: () => 1, clearInterval: () => {},
  });
  const Picker = exported.createPicker(fetch);
  const directory = { subscribe() {}, getSnapshot: () => ({ current, pending: null, status: 'ready' }) };
  return {
    render() { cursor = 0; const tree = Picker({ directory, sessionId: 'session' }); for (const fn of pending.splice(0)) fn(); return tree; },
    switchModel(value) { current = value; },
    dispose() { for (const e of effects) e?.cleanup?.(); },
  };
}
function nodes(tree, type) {
  if (!tree || typeof tree !== 'object') return [];
  return [...(tree.type === type ? [tree] : []), ...tree.children.flatMap(child => nodes(child, type))];
}
async function settle() { for (let i = 0; i < 10; i++) await Promise.resolve(); }
const report = { modes: ['standard', 'fast', 'ultrafast'], mode: 'standard', available: true, note: 'Higher cost' };

test('picker shows model-supported options and sends a session/model scoped selection', async () => {
  const requests = [];
  const ui = await harness(async (url, init) => {
    requests.push({ url, init });
    return Response.json(init ? { ...report, mode: JSON.parse(init.body).mode } : report);
  });
  try {
    assert.equal(nodes(ui.render(), 'select')[0].props.disabled, true);
    await settle(); const tree = ui.render();
    const select = nodes(tree, 'select')[0];
    assert.equal(select.props.disabled, false);
    assert.deepEqual(nodes(select, 'option').map(n => n.props.value), ['standard', 'fast', 'ultrafast']);
    select.props.onChange({ target: { value: 'ultrafast' } });
    await settle();
    const put = requests.find(r => r.init?.method === 'PUT');
    assert.deepEqual(JSON.parse(put.init.body), { sessionId: 'session', provider: 'openai', model: 'gpt-6-astra', mode: 'ultrafast' });
  } finally { ui.dispose(); }
});
test('picker ignores stale GET responses after model switches and hides on non-OpenAI routes', async () => {
  let resolve;
  const ui = await harness(async () => new Promise(r => { resolve = r; }));
  try {
    ui.render();
    ui.switchModel({ provider: 'anthropic', model: 'claude' });
    assert.equal(ui.render(), null);
    resolve(Response.json(report)); await settle(); assert.equal(ui.render(), null);
    ui.switchModel({ provider: 'openai', model: 'unknown' });
    assert.equal(nodes(ui.render(), 'select')[0].props.disabled, true);
  } finally { ui.dispose(); }
});
test('picker surfaces revoked saved tier and does not silently display Standard', async () => {
  const ui = await harness(async () => Response.json({ ...report, modes: ['standard'], mode: 'ultrafast', warning: 'Saved speed unavailable' }));
  try {
    ui.render(); await settle(); const tree = ui.render();
    const select = nodes(tree, 'select')[0]; assert.equal(select.props.value, 'ultrafast');
    const unavailable = nodes(select, 'option').find(o => o.props.value === 'ultrafast');
    assert.equal(unavailable.props.disabled, true);
    assert.equal(nodes(tree, 'span').some(n => n.props.role === 'alert'), true);
  } finally { ui.dispose(); }
});

test('proxy picker is report-driven', async () => {
  const ui = await harness(async () => Response.json(report), { provider: 'providerproxy', model: 'gpt-6.1-sol' });
  try { ui.render(); await settle(); const tree = ui.render(); assert.equal(nodes(tree, 'select').length, 1); assert.deepEqual(nodes(tree, 'option').map(n => n.props.value), ['standard', 'fast', 'ultrafast']); }
  finally { ui.dispose(); }
});
