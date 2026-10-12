// Generated real-client property: fast-check command sequences drive a real dsh-TUI (the
// pinned, patched fleet build) in a private tmux socket. Every case gets a fresh isolated
// profile (private HOME/DSH_HOME, private socket) and a loopback mock ProviderProxy.
// Invariants run after each step. A plain restart starts a fresh session (resume is opt-in
// via /resume), so Restart always expects Standard: nothing inherits across sessions (P-04).
// Replay: FC_SEED=<seed> [FC_PATH=<path>] E2E_NUM_RUNS=<n> nix run .#e2e -- test/tui.property.e2e.test.js
// Properties: P-01 P-02 P-04 P-10 P-14 P-30 P-50 P-51 P-52.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import fc from 'fast-check';
import { makeProfile, startTui } from './rig/rig.mjs';
import { lastUserText, startMockProxy } from './mock-proxy.js';

const PLUGIN = fileURLToPath(new URL('../index.js', import.meta.url));
const ARTIFACTS = process.env.DSH_SPEED_ARTIFACTS ?? mkdtempSync(join(tmpdir(), 'dsh-speed-artifacts-'));
mkdirSync(ARTIFACTS, { recursive: true });
const SEED = Number(process.env.FC_SEED ?? Date.now() % 2 ** 31);
const RUNS = Number(process.env.E2E_NUM_RUNS ?? 25);
const PATH = process.env.FC_PATH;
const TIER = { standard: 'default', fast: 'priority', ultrafast: 'ultrafast' };
const PICKER_ROWS = ['standard', 'fast', 'ultrafast'];

// Independent oracle: the catalog this test serves, not the plugin's parser.
const MODELS = {
  sol: { id: 'gpt-6.1-sol', tiers: ['priority', 'ultrafast'] },   // 3 offered speeds -> picker
  luna: { id: 'gpt-6-luna', tiers: ['priority'] },                // 2 offered speeds -> toggle
};
const CATALOG = { object: 'list', data: Object.values(MODELS).map(m => ({ id: m.id, service_tiers: m.tiers })) };
const offered = m => ['standard', ...MODELS[m.model].tiers.map(t => t === 'priority' ? 'fast' : t)];
const base = { contextWindow: 128000, maxTokens: 8000, input: ['text'] };
const PROXY_MODELS = Object.entries(MODELS).map(([, m]) => ({ ...base, id: m.id, name: m.id, reasoningEfforts: false }));

let browserlessGuard;
before(() => { browserlessGuard = process.env.DSH_BIN; assert.ok(browserlessGuard, 'DSH_BIN must be set (nix run .#e2e)'); });
after(() => {});

// Abstract model: saved speed per (session generation, model); never the plugin's code.
const key = m => m.session + '|' + m.model;
const expected = m => m.prefs.get(key(m)) ?? 'standard';
const FOOTER = { standard: /Speed: Standard/, fast: /Speed: ⚡(?!⚡)/, ultrafast: /Speed: ⚡⚡/ };
const footer = m => FOOTER[expected(m)];

async function fixture() {
  const mock = await startMockProxy({ catalog: CATALOG });
  const profile = makeProfile({ kind: 'tui', seedTui: { 'model.json': { provider: 'providerproxy', model: MODELS.sol.id } },
    rows: [
      { id: 'agent-default-model', config: { provider: 'providerproxy', model: MODELS.sol.id } },
      { id: 'llm-pi-ai', config: { providers: { providerproxy: { api: 'openai-responses', baseURL: mock.baseURL,
        apiKeyEnv: 'MOCK_KEY', models: PROXY_MODELS } } } },
    ] });
  profile.env.MOCK_KEY = 'speed-e2e-mock-key';
  // Real durable store (default store shape), like a real deployment: selections land on disk.
  appendFileSync(profile.dir + '/cordis.patch.yml', '- ' + JSON.stringify({ insert: [{ id: 'dsh-speed', name: PLUGIN, config: {
    stateFile: profile.root + '/speed.json',
    proxyProviders: { providerproxy: { baseURL: mock.baseURL, apiKeyEnv: 'MOCK_KEY' } } } }] }) + '\n');
  const tui = startTui(profile, { cols: 110, rows: 40 });
  await tui.waitFor(new RegExp(MODELS.sol.id));   // Launchpad shows the current model
  await tui.waitFor(/Speed: Standard/);           // P-52 footer on the Launchpad parameter row
  return { mock, profile, tui, cols: 110, rows: 40,
    async dispose() { mock.hold(false); await tui.kill(); await mock.close(); profile.dispose(); } };
}

async function invariant(m, r, step) {
  const screen = r.tui.capture();
  if (process.env.DSH_TEST_DEBUG) console.log('[debug]', step, JSON.stringify(screen.split('\n').filter(l => l.trim()).slice(-4)), 'turns', r.mock.turns().length);
  assert.doesNotMatch(screen, /\[\[exited/, step + ': dsh-TUI process alive');
  assert.match(screen, footer(m), step + ': P-52 footer shows the saved speed of the current session/model');
  assert.equal(r.mock.turns().length, m.sent, step + ': speed actions never start a generation');
  // No stale '/speed' draft may linger in the composer between steps: a draft that survives
  // its command would corrupt the next submission into a literal chat message.
  if (!screen.includes('Select speed')) {
    const composer = screen.split('\n').find(l => l.includes('⌸'));
    if (composer !== undefined) assert.doesNotMatch(composer, /\/speed/, step + ': no leftover /speed draft in the composer');
  }
  if (m.savedKeys.size > 0) {
    // P-30: one file per distinct (session, provider, model) key; re-saving the same key
    // atomically REPLACES its file, so the count compares distinct keys, not save events.
    const entries = readdirSync(r.profile.root + '/speed.json.d');
    assert.ok(entries.length >= m.savedKeys.size, step + ': P-30 every saved selection is a file in the 0700 state directory');
  }
}

// Shared body of a successful save: the footer flip is the observable, the model records it.
async function assertSaved(m, r, mode, step) {
  await r.tui.waitFor(FOOTER[mode]);
  m.prefs.set(key(m), mode);
  m.savedKeys.add(key(m));
  await invariant(m, r, step);
}

class SpeedWord {
  constructor(mode) { this.mode = mode; }
  check() { return true; }
  async run(m, r) {
    const available = offered(m).includes(this.mode);
    const typed = '/speed ' + this.mode;
    // Completion signal: the draft is cleared — that is when the command has executed
    // (the Launchpad renders no command output at all; P-51). Footer/error text can be
    // STALE from an earlier command in the same transcript, so it is never the signal.
    await r.tui.submit(typed, { until: () => !r.tui.capture().includes(typed) });
    if (available) {
      if (this.mode !== expected(m)) await assertSaved(m, r, this.mode, this.toString());
      else await invariant(m, r, this.toString());
    } else {
      // P-14: an unavailable speed is rejected; nothing is saved (invariant: footer unchanged).
      if (m.chat) assert.match(r.tui.capture(), /Available speeds:/, this.toString() + ': chat renders the rejection');
      await invariant(m, r, this.toString());
    }
  }
  toString() { return 'SpeedWord(' + this.mode + ')'; }
}

class SpeedToggle { // bare /speed with exactly two offered speeds toggles (P-50)
  check(m) { return offered(m).length === 2; }
  async run(m, r) {
    const modes = offered(m);
    const next = expected(m) === modes[1] ? 'standard' : modes[1];
    await r.tui.submit('/speed', { until: () => FOOTER[next].test(r.tui.capture()) });
    m.prefs.set(key(m), next);
    m.savedKeys.add(key(m));
    await invariant(m, r, this.toString());
  }
  toString() { return 'SpeedToggle'; }
}

class SpeedPicker { // bare /speed with three offered speeds opens the managed picker (P-50)
  constructor(row) { this.row = row; }
  // Bare /speed only opens the picker when MORE than two speeds are offered; with two it toggles.
  check(m) { return offered(m).length > 2 && offered(m).includes(this.row); }
  async run(m, r) {
    const pick = PICKER_ROWS.indexOf(this.row);
    const mode = this.row;
    await r.tui.submit('/speed', { until: /Select speed/ });
    assert.match(r.tui.capture(), new RegExp('Select speed — ' + MODELS[m.model].id), 'P-50 picker title names the model');
    assert.match(r.tui.capture(), /⚡ Fast/, 'P-50 picker lists labelled speeds');
    assert.match(r.tui.capture(), /Ultrafast/, 'P-50 picker lists labelled speeds');
    for (let i = 0; i < pick; i += 1) r.tui.keys('Down');
    r.tui.keys('Enter');
    await r.tui.waitFor(/Select speed/, { not: true });   // dialog fully closed before state checks
    if (mode !== expected(m)) await assertSaved(m, r, mode, this.toString());
    else { await r.tui.waitFor(FOOTER[mode]); await invariant(m, r, this.toString()); }
  }
  toString() { return 'SpeedPicker(' + this.row + ')'; }
}

class SpeedPickerCancel {
  check(m) { return offered(m).length > 2; }
  async run(m, r) {
    await r.tui.submit('/speed', { until: /Select speed/ });
    r.tui.keys('Escape');
    await r.tui.waitFor(/Select speed/, { not: true });
    await invariant(m, r, this.toString());   // P-50: Escape cancels without change
  }
  toString() { return 'SpeedPickerCancel'; }
}

class SpeedStatus {
  check() { return true; }
  async run(m, r) {
    const typed = '/speed status';
    // Draft cleared = executed (universal; stale 'Available:' text from earlier commands
    // in the transcript must never complete this wait).
    await r.tui.submit(typed, { until: () => !r.tui.capture().includes(typed) });
    if (m.chat) {
      // Chat renders the command result in the transcript (a Restart puts us back on the
      // Launchpad even though earlier sessions sent turns: branch on the CURRENT screen).
      assert.match(r.tui.capture(), new RegExp('Speed: ' + expected(m) + '\\.'), 'P-50 status reports the saved mode');
    }
    await invariant(m, r, this.toString());
  }
  toString() { return 'SpeedStatus'; }
}

async function sendPrompt(m, r, { held = false } = {}) {
  const prompt = 'speed-e2e:p' + (++m.counter);
  const before = m.sent;
  await r.tui.submit(prompt, { until: () => r.mock.turns().length === before + 1 });
  m.sent = before + 1;
  const wire = r.mock.turns().at(-1);
  assert.equal(wire.body.model, MODELS[m.model].id, 'P-04 wire model matches the current session/model key');
  assert.equal(wire.headers.authorization, 'Bearer speed-e2e-mock-key');
  const saved = m.prefs.get(key(m));
  if (saved === undefined) assert.ok(wire.body.service_tier === undefined || wire.body.service_tier === 'default', 'P-02 unselected key is unmodified: ' + wire.body.service_tier);
  else assert.equal(wire.body.service_tier, TIER[saved], 'P-01 tier on the wire');
  m.chat = true;
  if (!held) await waitIdle(r);
  return prompt;
}
async function waitIdle(r) {
  await r.tui.waitFor(/Speed mock reply/);
  await r.tui.waitFor(/Speed: /);
}
class Send {
  check() { return true; }
  async run(m, r) { await sendPrompt(m, r); await invariant(m, r, 'Send'); }
  toString() { return 'Send'; }
}

class BusyRefusal { // P-08: /speed while the turn streams is refused; the turn still completes
  check(m) { return m.chat; }
  async run(m, r) {
    r.mock.hold(true);
    let prompt;
    try { prompt = await sendPrompt(m, r, { held: true }); } catch (e) { r.mock.hold(false); throw e; }
    await r.tui.submit('/speed fast', { until: () => !r.tui.capture().includes('/speed fast') });
    assert.match(r.tui.capture(), /Wait for the current turn/, 'P-08 busy refusal text');
    r.mock.hold(false);
    await waitIdle(r);
    await invariant(m, r, this.toString());
  }
  toString() { return 'BusyRefusal'; }
}

class Restart { // a plain restart starts a fresh session: nothing inherits (P-04); state file survives on disk
  constructor(switchModel) { this.switchModel = switchModel; }
  check() { return true; }
  async run(m, r) {
    await r.tui.kill();
    if (this.switchModel) {
      m.model = m.model === 'sol' ? 'luna' : 'sol';
      writeFileSync(join(r.profile.home, '.dsh-tui', 'model.json'), JSON.stringify({ provider: 'providerproxy', model: MODELS[m.model].id }));
    }
    m.session += 1;
    m.chat = false;   // a plain restart opens the Launchpad: the fresh session sent nothing
    r.tui = startTui(r.profile, { cols: r.cols, rows: r.rows });
    await r.tui.waitFor(new RegExp(MODELS[m.model].id));
    await r.tui.waitFor(footer(m));
    await invariant(m, r, this.toString());
  }
  toString() { return 'Restart(' + (this.switchModel ? 'switch model' : 'same model') + ')'; }
}

const commands = fc.commands([
  fc.constantFrom('standard', 'fast', 'ultrafast').map(x => new SpeedWord(x)),
  fc.constant(new SpeedToggle()),
  fc.constantFrom(...PICKER_ROWS).map(x => new SpeedPicker(x)),
  fc.constant(new SpeedPickerCancel()),
  fc.constant(new SpeedStatus()),
  fc.constant(new Send()),
  fc.constant(new BusyRefusal()),
  fc.boolean().map(x => new Restart(x)),
], { maxCommands: 8 });

test('P-01/P-04/P-50/P-52 generated TUI sequences keep /speed, the footer and the wire in agreement', { timeout: 1200000 }, async () => {
  console.log('tui property seed', SEED, 'runs', RUNS, PATH ? 'path ' + PATH : '', 'dsh-TUI', process.env.DSH_TUI_VERSION_EXPECTED ?? '?');
  let n = 0;
  await fc.assert(fc.asyncProperty(commands, async cmds => {
    const r = await fixture();
    const id = ++n;
    try {
      const m = { session: 0, model: 'sol', prefs: new Map(), sent: 0, counter: 0, savedKeys: new Set(), chat: false };
      await invariant(m, r, 'start');
      await fc.asyncModelRun(() => ({ model: m, real: r }), cmds);
    } catch (error) {
      const shot = join(ARTIFACTS, 'tui-property-' + SEED + '-' + id + '.txt');
      try { writeFileSync(shot, r.tui.capture()); } catch { /* pane gone */ }
      console.log('failure capture', shot, 'trace', String(cmds));
      throw error;
    } finally { await r.dispose(); }
  }), { seed: SEED, numRuns: RUNS, ...(PATH ? { path: PATH } : {}), endOnFailure: process.env.FC_SHRINK !== '1' });
});