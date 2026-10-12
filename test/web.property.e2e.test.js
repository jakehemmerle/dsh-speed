// Generated real-client property: Playwright drives the real `dsh web` (pinned, patched as
// installed) through fast-check command sequences. Every case gets a fresh isolated profile
// (private HOME/DSH_HOME, port 0) and a loopback mock ProviderProxy. Invariants run after each step.
// Replay: FC_SEED=<seed> [FC_PATH=<path>] E2E_NUM_RUNS=<n> nix run .#e2e -- test/web.property.e2e.test.js
// Properties: P-01 P-02 P-04 P-08 P-10 P-12 P-14 P-40 P-42 P-44.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, mkdirSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { expect } from 'playwright/test';
import fc from 'fast-check';
import { makeProfile, startWeb } from './rig/rig.mjs';
import { lastUserText, startMockProxy } from './mock-proxy.js';

const PLUGIN = fileURLToPath(new URL('../index.js', import.meta.url));
const ARTIFACTS = process.env.DSH_SPEED_ARTIFACTS ?? mkdtempSync(join(tmpdir(), 'dsh-speed-artifacts-'));
mkdirSync(ARTIFACTS, { recursive: true });
const SEED = Number(process.env.FC_SEED ?? Date.now() % 2 ** 31);
const RUNS = Number(process.env.E2E_NUM_RUNS ?? 25);
const PATH = process.env.FC_PATH;
const MENU_NAME = 'Model and reasoning effort';
const TIER = { standard: 'default', fast: 'priority', ultrafast: 'ultrafast' };

// Independent oracle: the catalog this test serves, not the plugin's parser.
const MODELS = {
  Sol: { id: 'gpt-6.1-sol', provider: 'providerproxy', modes: ['standard', 'fast', 'ultrafast'] },
  Luna: { id: 'gpt-6-luna', provider: 'providerproxy', modes: ['standard', 'fast'] },
  Claude: { id: 'claude-sonnet-4-6', provider: 'providerproxy', modes: ['standard'] },
  'Sol (other route)': { id: 'gpt-6.1-sol', provider: 'otherproxy', modes: null },
};
const CATALOG = { object: 'list', data: [
  { id: 'gpt-6.1-sol', service_tiers: ['priority', 'ultrafast'] },
  { id: 'gpt-6-luna', service_tiers: ['priority'] },
  { id: 'claude-sonnet-4-6', service_tiers: ['default'] },
] };
const base = { contextWindow: 128000, maxTokens: 8000, input: ['text'] };
const PROXY_MODELS = [
  { ...base, id: 'gpt-6.1-sol', name: 'Sol', reasoningEfforts: { low: 'low', high: 'high' } },
  { ...base, id: 'gpt-6-luna', name: 'Luna', reasoningEfforts: false },
  { ...base, id: 'claude-sonnet-4-6', name: 'Claude', reasoningEfforts: false },
];

let browser;
before(async () => {
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
});
after(async () => { await browser?.close(); });

async function fixture() {
  const mock = await startMockProxy({ catalog: CATALOG });
  const profile = makeProfile({ kind: 'web', rows: [
    { id: 'ui-settings-general', config: { welcomeNoticeVersion: '2026-09-28.1' } },
    { id: 'agent-default-model', config: { provider: 'providerproxy', model: 'gpt-6.1-sol' } },
    { id: 'llm-pi-ai', config: { providers: {
      providerproxy: { api: 'openai-responses', baseURL: mock.baseURL, apiKeyEnv: 'MOCK_KEY', displayName: 'Providerproxy',
        compat: { supportsMaxOutputTokens: false }, models: PROXY_MODELS },
      otherproxy: { api: 'openai-responses', baseURL: mock.baseURL, apiKeyEnv: 'MOCK_KEY', displayName: 'Other proxy',
        models: [{ ...PROXY_MODELS[0], name: 'Sol (other route)' }] },
    } } },
    { id: 'directory-picker', disabled: true },
    { insert: [
      { id: 'directory-picker-browse', name: '@deepseek-ai/dsh-host-directory-picker-browse' },
      { id: 'ui-directory-picker-browse', name: '@deepseek-ai/dsh-client-ui-directory-picker-browse' },
    ] },
  ] });
  profile.env.MOCK_KEY = 'speed-e2e-mock-key';
  appendFileSync(profile.dir + '/cordis.patch.yml', '- ' + JSON.stringify({ insert: [{ id: 'dsh-speed', name: PLUGIN, config: {
    proxyProviders: { providerproxy: { baseURL: mock.baseURL, apiKeyEnv: 'MOCK_KEY' } }, stateFile: profile.root + '/speed.json' } }] }) + '\n');
  const web = await startWeb(profile);
  const context = await browser.newContext({ locale: 'en-US', viewport: { width: 1200, height: 900 } });
  await context.addCookies(web.cookie.split('; ').filter(Boolean).map(c => {
    const i = c.indexOf('='); return { name: c.slice(0, i), value: c.slice(i + 1), url: web.origin };
  }));
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(e.message));
  page.setDefaultTimeout(10000);
  await page.goto(web.origin + '/', { waitUntil: 'domcontentloaded' });
  await page.getByRole('textbox', { name: 'Choose workspace', exact: true }).click();
  const picker = page.getByRole('dialog', { name: 'Select Workspace Directory', exact: true });
  await picker.getByRole('button', { name: 'Edit path', exact: true }).click();
  const input = picker.getByRole('textbox', { name: 'Edit path', exact: true });
  await input.fill(profile.work); await input.press('Enter');
  await picker.getByRole('button', { name: 'Open', exact: true }).click();
  await page.waitForLoadState('networkidle');
  await composer(page).waitFor();
  return { mock, profile, web, page, pageErrors,
    async dispose() { mock.hold(false); await context.close(); await web.stop(); await mock.close(); profile.dispose(); } };
}

const composer = page => page.locator('[data-composer-input][contenteditable="true"]');
const trigger = page => page.getByRole('button', { name: /^Select model/ });
const menu = page => page.getByRole('menu', { name: MENU_NAME, exact: true });
async function openMenu(page) {
  await trigger(page).click();
  await expect(menu(page)).toBeVisible();
  return menu(page);
}
async function closeMenu(page) {
  await page.keyboard.press('Escape');
  if (await menu(page).isVisible()) { await page.keyboard.press('Tab'); await page.keyboard.press('Escape'); }
  await expect(menu(page)).not.toBeVisible();
}
async function currentLabel(page) {
  const label = await trigger(page).getAttribute('aria-label');
  // Longest label first: "Sol (other route)" also contains "Sol".
  return Object.keys(MODELS).sort((a, b) => b.length - a.length).find(name => label.includes(name));
}

// Abstract model: saved speed per (session generation, provider, model); never the plugin's code.
const key = (m, label) => m.session + '|' + MODELS[label].provider + '|' + MODELS[label].id;
const shownMode = (m, label) => m.prefs.get(key(m, label)) ?? 'standard';

async function invariant(m, r, step) {
  const label = await currentLabel(r.page);
  assert.equal(label, m.model, step + ': model trigger');
  const root = await openMenu(r.page);
  const speed = root.getByRole('combobox', { name: 'Speed', exact: true });
  const spec = MODELS[m.model];
  if (spec.modes === null) {
    await expect(speed, step + ': P-12 no control for an unsupported provider').toHaveCount(0);
  } else {
    await expect(speed, step + ': P-40 Speed inside the Model/Effort menu').toBeVisible();
    await expect(speed).toBeEnabled();
    await expect(speed, step + ': P-42 displayed = saved').toHaveValue(shownMode(m, m.model));
    const enabled = await speed.locator('option:not([disabled])').evaluateAll(os => os.map(o => o.value));
    assert.deepEqual(enabled, spec.modes, step + ': P-10 offered speeds = catalog');
  }
  assert.equal(await r.page.getByRole('button', { name: /^Speed(?:\s|$)/ }).count(), 0, 'P-40 no toolbar button');
  await closeMenu(r.page);
  assert.equal(r.mock.turns().length, m.sent, step + ': speed actions never start a generation');
  assert.deepEqual(r.pageErrors, [], step + ': P-44 no page errors');
}

class ChooseSpeed {
  constructor(mode) { this.mode = mode; }
  check() { return true; }
  async run(m, r) {
    const root = await openMenu(r.page);
    const speed = root.getByRole('combobox', { name: 'Speed', exact: true });
    const modes = MODELS[m.model].modes;
    if (modes === null) { await expect(speed).toHaveCount(0); await closeMenu(r.page); }
    else if (modes.includes(this.mode)) {
      await speed.selectOption(this.mode);
      await expect(speed).toBeEnabled();
      await expect(speed).toHaveValue(this.mode);
      m.prefs.set(key(m, m.model), this.mode);
      await closeMenu(r.page);
    } else {
      // P-14: an unavailable speed is not offered (absent or disabled); state is unchanged.
      const option = speed.locator('option[value="' + this.mode + '"]');
      if (await option.count()) await expect(option).toBeDisabled();
      await closeMenu(r.page);
    }
    await invariant(m, r, this.toString());
  }
  toString() { return 'ChooseSpeed(' + this.mode + ')'; }
}
class ChooseModel {
  constructor(label) { this.label = label; }
  check(m) { return m.model !== this.label; }
  async run(m, r) {
    const root = await openMenu(r.page);
    await root.getByRole('menuitem', { name: /^Model(?:\s|$)/ }).click();
    await r.page.getByRole('menuitemradio', { name: this.label, exact: true }).click();
    await expect.poll(() => currentLabel(r.page)).toBe(this.label);
    if (await menu(r.page).isVisible()) await closeMenu(r.page);
    m.model = this.label;
    await invariant(m, r, this.toString());
  }
  toString() { return 'ChooseModel(' + this.label + ')'; }
}
async function sendPrompt(m, r, { held = false } = {}) {
  const prompt = 'speed-e2e:p' + (++m.counter);
  await composer(r.page).fill(prompt);
  await composer(r.page).press('Enter');
  const wire = await r.mock.waitFor(q => q.url === '/v1/responses' && lastUserText(q.body) === prompt);
  m.sent += 1;
  const spec = MODELS[m.model];
  assert.equal(wire.body.model, spec.id);
  const saved = spec.modes === null ? undefined : m.prefs.get(key(m, m.model));
  if (saved === undefined) assert.ok(wire.body.service_tier === undefined || wire.body.service_tier === 'default', 'P-02 unselected key is unmodified: ' + wire.body.service_tier);
  else assert.equal(wire.body.service_tier, TIER[saved], 'P-01 tier on the wire');
  assert.equal(wire.headers.authorization, 'Bearer speed-e2e-mock-key');
  if (!held) await waitIdle(r, prompt);
  return prompt;
}
async function waitIdle(r, prompt) {
  await expect(r.page.getByText('Speed mock reply: ' + prompt, { exact: true })).toBeVisible();
  await expect(r.page.getByRole('button', { name: 'Stop generating', exact: true })).not.toBeVisible();
  await expect(trigger(r.page)).toBeEnabled();
}
class Send {
  check() { return true; }
  async run(m, r) { await sendPrompt(m, r); await invariant(m, r, 'Send'); }
  toString() { return 'Send'; }
}
class ChangeWhileStreaming {
  constructor(mode) { this.mode = mode; }
  check(m) { return MODELS[m.model].modes?.includes(this.mode) ?? false; }
  async run(m, r) {
    r.mock.hold(true);
    let prompt;
    try {
      prompt = await sendPrompt(m, r, { held: true }); // P-08: wire checked against the OLD saved speed
      await expect(r.page.getByRole('button', { name: 'Stop generating', exact: true })).toBeVisible();
      const speed = (await openMenu(r.page)).getByRole('combobox', { name: 'Speed', exact: true });
      await speed.selectOption(this.mode);
      await expect(speed).toHaveValue(this.mode);
      m.prefs.set(key(m, m.model), this.mode);
      await closeMenu(r.page);
    } finally { r.mock.hold(false); }
    await waitIdle(r, prompt);
    await invariant(m, r, this.toString());
  }
  toString() { return 'ChangeWhileStreaming(' + this.mode + ')'; }
}
class OpenCancel {
  check() { return true; }
  async run(m, r) { await openMenu(r.page); await closeMenu(r.page); await invariant(m, r, 'OpenCancel'); }
  toString() { return 'OpenCancel'; }
}
class NewSession {
  check(m) { return m.sent > 0; }
  async run(m, r) {
    await r.page.getByRole('button', { name: 'New session', exact: true }).first().click();
    await expect(r.page.getByText('Into the Unknown', { exact: true })).toBeVisible();
    await r.page.waitForLoadState('networkidle');
    await composer(r.page).waitFor();
    m.session += 1; // P-04: a new session inherits nothing
    m.model = await currentLabel(r.page);
    await invariant(m, r, 'NewSession');
  }
  toString() { return 'NewSession'; }
}

const mode = fc.constantFrom('standard', 'fast', 'ultrafast');
const commands = fc.commands([
  mode.map(x => new ChooseSpeed(x)),
  fc.constantFrom(...Object.keys(MODELS)).map(x => new ChooseModel(x)),
  fc.constant(new Send()),
  mode.map(x => new ChangeWhileStreaming(x)),
  fc.constant(new OpenCancel()),
  fc.constant(new NewSession()),
], { maxCommands: 8 });

test('P-01/P-04/P-42 generated web sequences keep the Speed picker, saved state and wire in agreement', { timeout: 1200000 }, async () => {
  console.log('web property seed', SEED, 'runs', RUNS, PATH ? 'path ' + PATH : '', 'dsh', process.env.DSH_VERSION_EXPECTED ?? '?');
  let n = 0;
  await fc.assert(fc.asyncProperty(commands, async cmds => {
    const r = await fixture();
    const id = ++n;
    try {
      const m = { session: 0, model: 'Sol', prefs: new Map(), sent: 0, counter: 0 };
      await invariant(m, r, 'start');
      await fc.asyncModelRun(() => ({ model: m, real: r }), cmds);
    } catch (error) {
      const shot = join(ARTIFACTS, 'web-property-' + SEED + '-' + id + '.png');
      await r.page.screenshot({ path: shot }).catch(() => {});
      console.log('failure screenshot', shot, 'trace', String(cmds));
      throw error;
    } finally { await r.dispose(); }
  }), { seed: SEED, numRuns: RUNS, ...(PATH ? { path: PATH } : {}), endOnFailure: process.env.FC_SHRINK !== '1' });
});
