import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { expect } from 'playwright/test';
import fc from 'fast-check';
import { homedir } from 'node:os';
import { makeProfile, startWeb, startTui } from './rig/rig.mjs';
import { MODEL_CATALOG, lastUserText, startMockProxy } from './mock-proxy.js';

// Always launch the installed release, never a source CLI or Jake's live profile.
// DSH_BIN may point at the implementation lead's checked patched-release wrapper.
// The vendored rig requires DSH_BIN (the flake's pinned, patched dsh).
const PLUGIN = fileURLToPath(new URL('../index.js', import.meta.url));
const BEARER = 'Bearer speed-e2e-mock-key';
const MODELS = [
  { id: 'gpt-6.1-sol', name: 'Sol', reasoningEfforts: { low: 'low', high: 'high' } },
  { id: 'gpt-6-astra', name: 'Astra', reasoningEfforts: { low: 'low', high: 'high' } },
  { id: 'claude-sonnet-4-6', name: 'Claude', reasoningEfforts: false },
  { id: 'unknown-model', name: 'Unknown', reasoningEfforts: false },
].map(model => ({ contextWindow: 128000, maxTokens: 8000, input: ['text'], ...model }));
const TIERS = { Standard: 'default', Fast: 'priority', Ultrafast: 'ultrafast' };
const MENU_NAME = 'Model and reasoning effort';
// Screenshots go to a per-run directory, never a fixed shared /tmp path.
const ARTIFACTS = process.env.DSH_SPEED_ARTIFACTS ?? mkdtempSync(join(tmpdir(), 'dsh-speed-artifacts-'));
mkdirSync(ARTIFACTS, { recursive: true });
let browser;

before(async () => {
  browser = await chromium.launch({ headless: true,
    ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
    args: ['--no-sandbox', '--disable-dev-shm-usage'] });
});
after(async () => { await browser?.close(); });

async function fixture(t, { native = false, live = false, delegate = false, catalog = MODEL_CATALOG, catalogStatus = 200, viewport = { width: 1200, height: 900 } } = {}) {
  if (live && (process.env.DSH_LIVE_TESTS !== '1' || process.env.DSH_LIVE_AGENTS !== '1')) throw new Error('Real agent tests require both DSH_LIVE_TESTS=1 and DSH_LIVE_AGENTS=1');
  const mock = await startMockProxy({ catalog, catalogStatus, delegate });
  const proxyBase = live ? 'http://gpu.tail47033e.ts.net:4000/v1' : mock.baseURL;
  const profile = makeProfile({ kind: 'web', bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app',
    '@deepseek-ai/dsh-experimental-agent-team-profile'], rows: [
    { id: 'ui-settings-general', config: { welcomeNoticeVersion: '2026-09-28.1' } },
    { id: 'agent-default-model', config: { provider: native ? 'openai-codex' : 'providerproxy', model: 'gpt-6.1-sol' } },
    { id: 'llm-pi-ai', config: { providers: {
      ...(native ? { 'openai-codex': { models: MODELS.slice(0, 2) } } : {}),
      providerproxy: { api: 'openai-responses', baseURL: proxyBase, apiKeyEnv: 'MOCK_KEY', displayName: 'Providerproxy', compat: { supportsMaxOutputTokens: false }, models: native ? [] : MODELS },
      otherproxy: { api: 'openai-responses', baseURL: mock.baseURL, apiKeyEnv: 'MOCK_KEY', displayName: 'Other proxy',
        models: [{ ...MODELS[0], name: 'Sol (other route)' }] },
    } } },
    { id: 'directory-picker', disabled: true },
    { insert: [
      { id: 'directory-picker-browse', name: '@deepseek-ai/dsh-host-directory-picker-browse' },
      { id: 'ui-directory-picker-browse', name: '@deepseek-ai/dsh-client-ui-directory-picker-browse' },
    ] },
  ] });
  profile.env.MOCK_KEY = live && !native ? readFileSync(homedir() + '/.omp/agent/providerproxy-token', 'utf8').trim() : 'speed-e2e-mock-key';
  const config = { proxyProviders: { providerproxy: { baseURL: proxyBase, apiKeyEnv: 'MOCK_KEY' } },
    stateFile: profile.root + '/speed.json', catalogTtlMs: 60000 };
  let plugin = PLUGIN, nativeToken;
  if (native && live) {
    config.codexAuthFile = homedir() + '/.codex/auth.json';
    config.codexCommand = homedir() + '/.local/share/nix-management/bin/codex';
  } else if (native) {
    nativeToken = 'header.' + Buffer.from(JSON.stringify({ exp: Date.now() / 1000 + 3600,
      'https://api.openai.com/auth': { chatgpt_account_id: 'native-test-account' } })).toString('base64url') + '.signature';
    config.codexAuthFile = profile.root + '/auth.json';
    writeFileSync(config.codexAuthFile, JSON.stringify({ auth_mode: 'chatgpt', tokens: { access_token: nativeToken,
      account_id: 'native-test-account', refresh_token: 'unused-refresh' } }), { mode: 0o600 });
    plugin = profile.root + '/native-fixture.mjs';
    writeFileSync(plugin, `export async function apply(ctx, config) {\n const original = globalThis.fetch;\n globalThis.fetch = async (url, init) => {\n  if (String(url).startsWith('https://chatgpt.com/backend-api/codex/models')) {\n   const result = await original(${JSON.stringify(mock.baseURL + '/models')}, init);\n   const catalog = await result.json();\n   return Response.json({models: catalog.data.map(m => ({slug:m.id, additional_speed_tiers:m.service_tiers}))});\n  }\n  if (String(url) === 'https://chatgpt.com/backend-api/codex/responses') return original(${JSON.stringify(mock.baseURL + '/responses')}, init);\n  return original(url, init);\n };\n ctx.effect(() => () => {globalThis.fetch=original;});\n}`);
  }
  appendFileSync(profile.dir + '/cordis.patch.yml', '- ' + JSON.stringify({ insert: [...(native && !live ? [{ id: 'native-test-transport', name: plugin }] : []), { id: 'dsh-speed', name: PLUGIN, config }] }) + '\n');
  let web;
  let context;
  t.after(async () => {
    mock.hold(false);
    if (process.env.DSH_TEST_DEBUG) console.log('mock requests', mock.requests.map(r => ({ model: r.body?.model, user: r.body ? lastUserText(r.body) : '', tools: r.body?.tools?.map(t => t.name), tier: r.body?.service_tier })));
    if (process.env.DSH_TEST_DEBUG) console.log(profile.logs().slice(-5000));
    if (process.env.DSH_TEST_DEBUG && context?.pages()[0]) {
      console.log(await context.pages()[0].locator('body').innerText());
      await context.pages()[0].screenshot({ path: join(ARTIFACTS, 'debug-' + Date.now() + '.png') });
    }
    await context?.close();
    await web?.stop();
    await mock.close();
    profile.dispose();
  });
  web = await startWeb(profile);
  assert.notEqual(new URL(web.origin).port, '3080');
  assert.notEqual(profile.home, '/home/jake');
  assert.equal(profile.env.DSH_HOME, profile.dshHome);
  const connect = async (path, fresh = false) => {
    context = await browser.newContext({ locale: 'en-US', viewport });
    await context.addCookies(web.cookie.split('; ').filter(Boolean).map(cookie => {
      const split = cookie.indexOf('=');
      return { name: cookie.slice(0, split), value: cookie.slice(split + 1), url: web.origin };
    }));
    const page = await context.newPage();
    if (process.env.DSH_TEST_DEBUG) page.on('response', async response => {
      if (response.url().includes('api/dsh-speed')) console.log('speed response', response.url(), response.status(), await response.text());
    });
    page.on('pageerror', error => console.log('browser error:', error.message));
    page.setDefaultTimeout(10000);
    await page.goto(web.origin + (path ?? '/'), { waitUntil: 'domcontentloaded' });
    await page.getByRole('textbox', { name: 'Choose workspace', exact: true }).or(trigger(page)).first().waitFor();
    return page;
  };
  const page = await connect('/', true);
  return { mock, profile, page, nativeToken, get web() { return web; },
    async restart(path = '/') {
      await context.close();
      context = undefined;
      await web.stop();
      web = await startWeb(profile);
      return connect(path);
    },
  };
}

async function connectWorkspace(page, profile) {
  await page.getByRole('textbox', { name: 'Choose workspace', exact: true }).click();
  const picker = page.getByRole('dialog', { name: 'Select Workspace Directory', exact: true });
  await picker.getByRole('button', { name: 'Edit path', exact: true }).click();
  const input = picker.getByRole('textbox', { name: 'Edit path', exact: true });
  await input.fill(profile.work);
  await input.press('Enter');
  await picker.getByRole('button', { name: 'Open', exact: true }).click();
  // The workspace transition briefly renders the old blank-session composer
  // before replacing it. Wait for the navigation's initial requests to settle.
  await page.waitForLoadState('networkidle');
  await page.locator('[data-composer-input][contenteditable="true"]').waitFor();
  await expect(page.locator('[data-composer-input][contenteditable="true"]')).toBeFocused();
}

function trigger(page) { return page.getByRole('button', { name: /^Select model/ }); }
function menu(page) { return page.getByRole('menu', { name: MENU_NAME, exact: true }); }
async function openMenu(page) {
  await trigger(page).click();
  const root = menu(page);
  await expect(root).toBeVisible();
  await expect(root.getByRole('menuitem', { name: /^Model(?:\s|$)/ })).toBeVisible();
  return root;
}
async function speedOptions(page) {
  const root = await openMenu(page);
  const select = root.getByRole('combobox', { name: 'Speed', exact: true });
  await expect(select, 'Speed must be inside the existing Model/Effort menu, not in a toolbar').toBeVisible();
  await expect(select).toBeEnabled();
  return select;
}
async function chooseSpeed(page, label) {
  const select = await speedOptions(page);
  await select.selectOption(label.toLowerCase());
  await expect(select).toBeEnabled();
  await expect(select).toHaveValue(label.toLowerCase());
  await page.keyboard.press('Escape');
  await expect(menu(page)).not.toBeVisible();
}
async function assertSpeed(page, label) {
  const select = await speedOptions(page);
  await expect(select).toHaveValue(label.toLowerCase());
  await page.keyboard.press('Escape');
  await expect(menu(page)).not.toBeVisible();
}
async function chooseModel(page, label) {
  const root = await openMenu(page);
  await root.getByRole('menuitem', { name: /^Model(?:\s|$)/ }).click();
  await page.getByRole('menuitemradio', { name: label, exact: true }).click();
  await expect.poll(() => trigger(page).getAttribute('aria-label')).toContain(label);
}
async function send(page, mock, tag, { held = false } = {}) {
  const prompt = 'speed-e2e:' + tag.replaceAll(/[^\w-]/g, '-');
  const input = page.getByRole('textbox').and(page.locator('[data-composer-input][contenteditable="true"]'));
  await input.fill(prompt);
  await input.press('Enter');
  const wire = await mock.waitFor(request => request.url === '/v1/responses' && lastUserText(request.body) === prompt);
  if (!held) {
    await expect(page.getByText('Speed mock reply: ' + prompt, { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Stop generating', exact: true })).not.toBeVisible();
    await expect(trigger(page)).toBeEnabled();
  }
  return wire;
}
function checkWire(request, model, tier) {
  assert.equal(request.url, '/v1/responses');
  assert.equal(request.body.model, model);
  assert.equal(request.body.service_tier, tier, 'UI choice must reach the real Responses HTTP JSON');
  assert.equal(request.headers.authorization, BEARER, 'Every tier must preserve the same provider bearer');
}
function apiPath(selection) { return '/api/dsh-speed?' + new URLSearchParams(selection); }
async function getSpeed(web, selection) {
  const response = await web.fetch(apiPath(selection));
  assert.equal(response.status, 200);
  return response.json();
}
async function putSpeed(web, selection) {
  return web.fetch('/api/dsh-speed', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(selection) });
}

const options = { timeout: 180000 };

// Explicit opt-in: these consume real account allowance, use an isolated DSH,
// and exercise the model's actual Team tool calls instead of scripted output.
if (process.env.DSH_LIVE_TESTS === '1' && process.env.DSH_LIVE_AGENTS === '1') for (const native of [true, false]) {
  test(`live-account Team agents complete via ${native ? 'native Codex' : 'ProviderProxy'}`, { timeout: 240000 }, async t => {
    const { page, profile } = await fixture(t, { native, live: true });
    await connectWorkspace(page, profile);
    if (!native) await chooseModel(page, 'Astra');
    await chooseSpeed(page, 'Ultrafast');
    await page.locator('[data-composer-input][contenteditable="true"]').fill(
      'Use Agent Teams for this validation. Create exactly one teammate named speed-check. Its sole task: use send_message to send SPEED_CHILD_OK to lead, then finish. Do not run shell commands or modify files. Wait until you receive its actual message, then reply exactly SPEED_PARENT_OK.');
    await page.locator('[data-composer-input][contenteditable="true"]').press('Enter');
    await expect(page.getByText('SPEED_PARENT_OK', { exact: true }).last()).toBeVisible({ timeout: 210000 });
    await expect(page.getByText('speed-check', { exact: true }).first()).toBeVisible();
    await expect(trigger(page)).toBeEnabled();
    console.log('Live Team complete:', native ? 'native Sol' : 'proxy Astra');
  });
}

for (const native of [false, true]) test(`real DSH ${native ? 'native' : 'proxy'} delegation spawns a teammate, receives its result, and isolates parent speed`, options, async t => {
  const { page, profile, mock, web, nativeToken } = await fixture(t, { delegate: true, native });
  await connectWorkspace(page, profile);
  const loaded = page.waitForResponse(r => r.url().includes('/api/dsh-speed?'));
  await trigger(page).click();
  const selection = Object.fromEntries(new URL((await loaded).url()).searchParams);
  assert.equal((await putSpeed(web, { ...selection, mode: 'ultrafast' })).status, 200);
  await page.keyboard.press('Escape');
  const input = page.locator('[data-composer-input][contenteditable="true"]');
  await input.fill('speed-e2e:delegate'); await input.press('Enter');
  const child = await mock.waitFor(r => r.url === '/v1/responses' && lastUserText(r.body) === 'speed-e2e:child', 30000);
  assert.equal(child.headers.authorization, native ? 'Bearer ' + nativeToken : BEARER);
  if (native) assert.equal(child.headers['chatgpt-account-id'], 'native-test-account');
  assert.equal(child.body.model, 'gpt-6.1-sol');
  assert.ok(child.body.service_tier === undefined || child.body.service_tier === 'default', 'Child must not accidentally inherit parent transport context');
  const parent = await mock.waitFor(r => lastUserText(r.body ?? {}) === 'speed-e2e:delegate' && r.body?.input?.some(i => i.type === 'function_call_output'), 30000);
  assert.equal(parent.body.service_tier, 'ultrafast');
  assert.ok(JSON.stringify(parent.body.input).includes('speed-check'), 'Real teammate activation must return its identity');
  const completion = await mock.waitFor(r => lastUserText(r.body ?? {}) === 'speed-e2e:delegate' && JSON.stringify(r.body?.input).includes('SPEED_CHILD_OK'), 30000);
  assert.equal(completion.body.service_tier, 'ultrafast');
  await mock.waitFor(r => lastUserText(r.body ?? {}) === 'speed-e2e:child' && r.body?.input?.some(i => i.type === 'function_call_output'));
  await expect(trigger(page)).toBeEnabled();
});

test('real DSH local Codex auth.json supplies both catalog and all six native model/tier requests', options, async t => {
  const { page, profile, mock, nativeToken } = await fixture(t, { native: true });
  await connectWorkspace(page, profile);
  for (const [label, model] of [['Sol', 'gpt-6.1-sol'], ['Astra', 'gpt-6-astra']]) {
    if (label !== 'Sol') await chooseModel(page, label);
    for (const [mode, tier] of Object.entries(TIERS)) {
      if (process.env.DSH_TEST_DEBUG) console.log('native test selection', label, mode);
      await chooseSpeed(page, mode);
      const wire = await send(page, mock, 'native-' + label + '-' + mode);
      assert.equal(wire.body.model, model); assert.equal(wire.body.service_tier, tier);
      assert.equal(wire.headers.authorization, 'Bearer ' + nativeToken);
      assert.equal(wire.headers['chatgpt-account-id'], 'native-test-account');
      assert.equal(wire.headers['x-codex-routing-hint'], 'model=' + model + (tier === 'default' ? '' : ';tier=' + tier));
    }
  }
  assert.ok(mock.requests.filter(r => r.url === '/v1/models').every(r => r.headers.authorization === 'Bearer ' + nativeToken));
});

test('real dst /speed works before the first prompt and in chat with the proxy bearer', options, async t => {
  const mock = await startMockProxy();
  const profile = makeProfile({ kind: 'tui', seedTui: { 'model.json': { provider: 'providerproxy', model: 'gpt-6.1-sol' } }, rows: [
    { id: 'agent-default-model', config: { provider: 'providerproxy', model: 'gpt-6.1-sol' } },
    { id: 'llm-pi-ai', config: { providers: { providerproxy: { api: 'openai-responses', baseURL: mock.baseURL,
      apiKeyEnv: 'MOCK_KEY', models: MODELS } } } },
  ], plugins: [{ id: 'dsh-speed', name: PLUGIN, config: { stateFile: false, proxyProviders: {
    providerproxy: { baseURL: mock.baseURL, apiKeyEnv: 'MOCK_KEY' } } } }] });
  profile.env.MOCK_KEY = 'speed-e2e-mock-key';
  const tui = startTui(profile);
  t.after(async () => { if (mock.turns().length < 2) console.log(tui.capture()); await tui.kill(); await mock.close(); profile.dispose(); });
  await tui.waitFor(/gpt-6.1-sol/);
  await tui.submit('/speed ultrafast', { until: () => tui.capture().includes('Speed: ⚡⚡') });
  assert.equal(mock.turns().length, 0);
  await tui.submit('speed-e2e:tui-first', { until: () => mock.turns().length === 1 });
  checkWire(mock.turns()[0], 'gpt-6.1-sol', 'ultrafast');
  await tui.waitFor(/Speed mock reply/);
  await tui.submit('/speed fast', { until: () => /Speed: ⚡(?!⚡)/.test(tui.capture()) });
  await tui.submit('speed-e2e:tui-second', { until: () => mock.turns().length === 2 });
  checkWire(mock.turns()[1], 'gpt-6.1-sol', 'priority');
});

test('real DSH blank and chat: Model/Effort/Speed share a menu; Sol and Astra tiers reach HTTP with the same bearer', options, async t => {
  const { page, profile, mock } = await fixture(t);
  await connectWorkspace(page, profile);
  assert.equal(mock.turns().length, 0, 'Initial picker runs before any chat');
  const root = await openMenu(page);
  await expect(root.getByRole('menuitem', { name: /^Effort(?:\s|$)/ })).toBeVisible();
  await expect(root.getByRole('combobox', { name: 'Speed', exact: true }), 'Speed belongs beside Model and Effort').toBeVisible();
  await page.screenshot({ path: join(ARTIFACTS, 'menu-light.png') });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.screenshot({ path: join(ARTIFACTS, 'menu-dark.png') });
  assert.equal(await page.getByRole('button', { name: /^Speed(?:\s|$)/ }).count(), 0, 'No separate Speed toolbar button');
  await page.keyboard.press('Escape');
  for (const [label, id] of [['Sol', 'gpt-6.1-sol'], ['Astra', 'gpt-6-astra']]) {
    if (label !== 'Sol') await chooseModel(page, label);
    // Deterministic property samples exercise differing orders of all three public choices.
    const order = fc.sample(fc.shuffledSubarray(Object.keys(TIERS), { minLength: 3, maxLength: 3 }), { seed: label === 'Sol' ? 20261010 : 20261011, numRuns: 1 })[0];
    for (const mode of order) {
      await chooseSpeed(page, mode);
      await assertSpeed(page, mode);
      checkWire(await send(page, mock, label + '-' + mode), id, TIERS[mode]);
    }
  }
  assert.deepEqual(new Set(mock.turns().map(request => request.body.service_tier)), new Set(Object.values(TIERS)));
  const catalog = mock.requests.filter(request => request.url === '/v1/models');
  assert.ok(catalog.length >= 1, 'Providerproxy capabilities must be loaded from its real HTTP catalog');
  assert.ok(catalog.every(request => request.headers.authorization === BEARER));
});

test('model and effort switching preserve isolated preferences; Claude, unknown and another route stay Standard-only', options, async t => {
  const { page, profile, mock } = await fixture(t);
  await connectWorkspace(page, profile);
  await chooseSpeed(page, 'Fast');
  const root = await openMenu(page);
  await root.getByRole('menuitem', { name: /^Effort(?:\s|$)/ }).click();
  await page.getByRole('menuitemradio', { name: /^(high|High)$/ }).click();
  await assertSpeed(page, 'Fast');
  const high = await send(page, mock, 'effort-independent');
  checkWire(high, 'gpt-6.1-sol', 'priority');
  assert.equal(high.body.reasoning?.effort, 'high');
  await chooseModel(page, 'Astra');
  await assertSpeed(page, 'Standard');
  await chooseSpeed(page, 'Ultrafast');
  await chooseModel(page, 'Sol');
  await assertSpeed(page, 'Fast');
  await chooseModel(page, 'Astra');
  await assertSpeed(page, 'Ultrafast');
  for (const [name, id] of [['Claude', 'claude-sonnet-4-6'], ['Unknown', 'unknown-model'], ['Sol (other route)', 'gpt-6.1-sol']]) {
    await chooseModel(page, name);
    const root = await openMenu(page);
    const speed = root.getByRole('combobox', { name: 'Speed', exact: true });
    if (name === 'Sol (other route)') await expect(speed).toHaveCount(0);
    else { await expect(speed).toBeEnabled(); await expect(speed).toHaveValue('standard'); await expect(speed.getByRole('option')).toHaveCount(1); }
    await page.keyboard.press('Escape');
    const wire = await send(page, mock, 'standard-only-' + name);
    assert.equal(wire.body.model, id);
    assert.ok(wire.body.service_tier === undefined || wire.body.service_tier === 'default');
    assert.equal(wire.headers.authorization, BEARER);
  }
  await chooseModel(page, 'Sol');
  await assertSpeed(page, 'Fast');
});

test('authenticated speed route rejects missing cookies; preferences isolate session/model/provider and survive host restart', options, async t => {
  const env = await fixture(t);
  const sol = { sessionId: 'session-speed-e2e-one', provider: 'providerproxy', model: 'gpt-6.1-sol' };
  for (const method of ['GET', 'PUT']) {
    const response = await fetch(env.web.origin + (method === 'GET' ? apiPath(sol) : '/api/dsh-speed'), {
      method, ...(method === 'PUT' ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...sol, mode: 'fast' }) } : {}),
    });
    assert.equal(response.status, 401, method + ' must reject requests without the host auth cookie');
  }
  const capabilities = await getSpeed(env.web, sol);
  assert.deepEqual(capabilities.modes, ['standard', 'fast', 'ultrafast']);
  assert.equal((await putSpeed(env.web, { ...sol, mode: 'fast' })).status, 200);
  assert.equal((await getSpeed(env.web, sol)).mode, 'fast');
  for (const selection of [{ ...sol, sessionId: 'session-speed-e2e-two' }, { ...sol, model: 'gpt-6-astra' }, { ...sol, provider: 'otherproxy' }]) {
    assert.equal((await getSpeed(env.web, selection)).mode, 'standard');
  }
  await env.restart();
  assert.equal((await getSpeed(env.web, sol)).mode, 'fast', 'Same isolated HOME must restore saved session/model preference');
  assert.equal((await getSpeed(env.web, { ...sol, model: 'gpt-6-astra' })).mode, 'standard');
  assert.equal(env.mock.turns().length, 0, 'Route tests never incur a generation');
});

test('saved browser selection survives restart and a separate fresh session does not inherit it', options, async t => {
  const env = await fixture(t);
  let page = env.page;
  await connectWorkspace(page, env.profile);
  await chooseSpeed(page, 'Ultrafast');
  checkWire(await send(page, env.mock, 'before-restart'), 'gpt-6.1-sol', 'ultrafast');
  // DSH selects chats in client state, not in the URL. Reopen the persisted
  // chat from the sidebar in this entirely new browser context.
  page = await env.restart();
  await page.getByText('Speed test conversation', { exact: true }).click();
  await page.waitForLoadState('networkidle');
  await assertSpeed(page, 'Ultrafast');
  checkWire(await send(page, env.mock, 'after-restart'), 'gpt-6.1-sol', 'ultrafast');
  await page.getByRole('button', { name: 'New session', exact: true }).first().click();
  await expect(page.getByText('Into the Unknown', { exact: true })).toBeVisible();
  await page.waitForLoadState('networkidle');
  await expect(page.locator('[data-composer-input][contenteditable="true"]')).toBeFocused();
  await assertSpeed(page, 'Standard');
});

test('speed changes during streaming affect only subsequent Responses requests', options, async t => {
  const { page, profile, mock } = await fixture(t);
  await connectWorkspace(page, profile);
  await chooseSpeed(page, 'Fast');
  mock.hold(true);
  checkWire(await send(page, mock, 'held-stream', { held: true }), 'gpt-6.1-sol', 'priority');
  await expect(page.getByRole('button', { name: 'Stop generating', exact: true })).toBeVisible();
  await chooseSpeed(page, 'Ultrafast');
  assert.equal(mock.turns()[0].body.service_tier, 'priority', 'Changing the saved choice cannot rewrite the active request');
  mock.hold(false);
  await expect(page.getByRole('button', { name: 'Stop generating', exact: true })).not.toBeVisible();
  checkWire(await send(page, mock, 'after-held-stream'), 'gpt-6.1-sol', 'ultrafast');
});

test('narrow viewport keeps Speed in the native menu and its keyboard choices inside screen bounds', options, async t => {
  const { page, profile, mock } = await fixture(t, { viewport: { width: 390, height: 844 } });
  await connectWorkspace(page, profile);
  const root = await openMenu(page);
  await expect(root.getByRole('menuitem', { name: /^Effort(?:\s|$)/ })).toBeVisible();
  await expect(root.getByRole('combobox', { name: 'Speed', exact: true })).toBeVisible();
  const bounds = await root.boundingBox();
  assert.ok(bounds && bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= 391 && bounds.y + bounds.height <= 845);
  const speed = root.getByRole('combobox', { name: 'Speed', exact: true });
  await expect(speed).toBeEnabled();
  await speed.focus();
  await page.keyboard.press('f');
  await expect(speed).toHaveValue('fast');
  await expect(speed).toBeEnabled();
  // Native select consumes Escape; leave it before closing the enclosing menu.
  await page.keyboard.press('Tab');
  await page.keyboard.press('Escape');
  await expect(menu(page)).not.toBeVisible();
  checkWire(await send(page, mock, 'narrow-keyboard'), 'gpt-6.1-sol', 'priority');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
});

test('proxy catalog HTTP and advertised-capability parse errors fail closed, without leaking upstream text or enabling accelerated tiers', options, async t => {
  const secret = 'mock-catalog-sensitive-diagnostic';
  for (const [catalog, catalogStatus] of [
    [{ error: secret }, 503],
    [{ data: [{ id: 'gpt-6.1-sol', service_tiers: { priority: true, ultrafast: true } }], secret }, 200],
  ]) {
    await t.test('catalog status ' + catalogStatus, async child => {
      const env = await fixture(child, { catalog, catalogStatus });
      const selection = { sessionId: 'session-speed-e2e-catalog', provider: 'providerproxy', model: 'gpt-6.1-sol' };
      const state = await getSpeed(env.web, selection);
      assert.deepEqual(state.modes, ['standard']);
      assert.equal(JSON.stringify(state).includes(secret), false);
      for (const mode of ['fast', 'ultrafast']) {
        const response = await putSpeed(env.web, { ...selection, mode });
        assert.equal(response.status, 400);
        assert.equal((await response.text()).includes(secret), false);
      }
      await connectWorkspace(env.page, env.profile);
      const choices = await speedOptions(env.page);
      for (const label of ['Fast', 'Ultrafast']) {
        const item = choices.getByRole('option', { name: label, exact: true });
        if (await item.count()) await expect(item).toBeDisabled();
      }
      await pageEscape(env.page);
      await chooseSpeed(env.page, 'Standard');
      checkWire(await send(env.page, env.mock, 'failed-catalog-' + catalogStatus), 'gpt-6.1-sol', 'default');
      assert.ok(env.mock.requests.some(request => request.url === '/v1/models'), 'Failure must actually query the proxy catalog');
    });
  }
});

async function pageEscape(page) { await page.keyboard.press('Escape'); }
