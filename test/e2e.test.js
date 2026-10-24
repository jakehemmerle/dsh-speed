import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { expect } from 'playwright/test';
import fc from 'fast-check';
import { makeProfile, startWeb } from '/home/jake/.agents/skills/dsh-plugin/scripts/rig.mjs';
import { MODEL_CATALOG, lastUserText, startMockProxy } from './mock-proxy.js';

// Always launch the installed release, never a source CLI or Jake's live profile.
// DSH_BIN may point at the implementation lead's checked patched-release wrapper.
const INSTALLED_BIN = '/nix/store/cxpaa1drx4spbbdhsaa9inrsiww4y8h0-dsh-0.2.1-alpha.2/bin/dsh';
process.env.DSH_BIN ??= INSTALLED_BIN;
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
let browser;

before(async () => {
  browser = await chromium.launch({ headless: true,
    ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
    args: ['--no-sandbox', '--disable-dev-shm-usage'] });
});
after(async () => { await browser?.close(); });

async function fixture(t, { catalog = MODEL_CATALOG, catalogStatus = 200, viewport = { width: 1200, height: 900 } } = {}) {
  const mock = await startMockProxy({ catalog, catalogStatus });
  const profile = makeProfile({ kind: 'web', rows: [
    { id: 'agent-default-model', config: { provider: 'providerproxy', model: 'gpt-6.1-sol' } },
    { id: 'llm-pi-ai', config: { providers: {
      providerproxy: { api: 'openai-responses', baseURL: mock.baseURL, apiKeyEnv: 'MOCK_KEY', displayName: 'Providerproxy', models: MODELS },
      otherproxy: { api: 'openai-responses', baseURL: mock.baseURL, apiKeyEnv: 'MOCK_KEY', displayName: 'Other proxy',
        models: [{ ...MODELS[0], name: 'Sol (other route)' }] },
    } } },
    { id: 'directory-picker', disabled: true },
    { insert: [
      { id: 'directory-picker-browse', name: '@deepseek-ai/dsh-host-directory-picker-browse' },
      { id: 'ui-directory-picker-browse', name: '@deepseek-ai/dsh-client-ui-directory-picker-browse' },
    ] },
  ] });
  profile.env.MOCK_KEY = 'speed-e2e-mock-key';
  const config = { proxyProviders: { providerproxy: { baseURL: mock.baseURL, apiKeyEnv: 'MOCK_KEY' } },
    stateFile: profile.root + '/speed.json', catalogTtlMs: 60000 };
  appendFileSync(profile.dir + '/cordis.patch.yml', '- ' + JSON.stringify({ insert: [{ id: 'dsh-speed', name: PLUGIN, config }] }) + '\n');
  let web;
  let context;
  t.after(async () => {
    mock.hold(false);
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
    page.setDefaultTimeout(10000);
    await page.goto(web.origin + (path ?? '/'), { waitUntil: 'domcontentloaded' });
    if (fresh) {
      const welcome = page.getByRole('dialog', { name: 'Preview Notice', exact: true });
      await welcome.getByRole('button', { name: 'Continue', exact: true }).click();
      await expect(welcome).not.toBeVisible();
    }
    await page.getByRole('textbox', { name: 'Choose workspace', exact: true }).or(trigger(page)).first().waitFor();
    return page;
  };
  const page = await connect('/', true);
  return { mock, profile, page, get web() { return web; },
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
  await page.locator('[data-composer-input][contenteditable="true"]').waitFor();
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
  const prompt = 'speed-e2e:' + tag;
  const input = page.getByRole('textbox').and(page.locator('[data-composer-input][contenteditable="true"]'));
  await input.fill(prompt);
  await input.press('Enter');
  const wire = await mock.waitFor(request => request.url === '/v1/responses' && lastUserText(request.body) === prompt);
  if (!held) {
    await expect(page.getByText('Speed mock reply: ' + prompt, { exact: true })).toBeVisible();
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

test('real DSH blank and chat: Model/Effort/Speed share a menu; Sol and Astra tiers reach HTTP with the same bearer', options, async t => {
  const { page, profile, mock } = await fixture(t);
  await connectWorkspace(page, profile);
  assert.equal(mock.turns().length, 0, 'Initial picker runs before any chat');
  const root = await openMenu(page);
  await expect(root.getByRole('menuitem', { name: /^Effort(?:\s|$)/ })).toBeVisible();
  await expect(root.getByRole('combobox', { name: 'Speed', exact: true }), 'Speed belongs beside Model and Effort').toBeVisible();
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
    if (name === 'Sol (other route)') {
      const root = await openMenu(page);
      await expect(root.getByRole('combobox', { name: 'Speed', exact: true })).toHaveCount(0);
    } else {
      const speed = await speedOptions(page);
      await expect(speed).toHaveValue('standard');
      for (const label of ['Fast', 'Ultrafast']) {
        const item = speed.getByRole('option', { name: label, exact: true });
        if (await item.count()) await expect(item).toBeDisabled();
      }
    }
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
  const oldPath = new URL(page.url()).pathname + new URL(page.url()).search + new URL(page.url()).hash;
  page = await env.restart(oldPath);
  await assertSpeed(page, 'Ultrafast');
  checkWire(await send(page, env.mock, 'after-restart'), 'gpt-6.1-sol', 'ultrafast');
  await page.getByRole('button', { name: 'New session', exact: true }).first().click();
  await assertSpeed(page, 'Standard');
});

test('streaming locks speed/model controls until held Responses SSE completes', options, async t => {
  const { page, profile, mock } = await fixture(t);
  await connectWorkspace(page, profile);
  await chooseSpeed(page, 'Fast');
  mock.hold(true);
  checkWire(await send(page, mock, 'held-stream', { held: true }), 'gpt-6.1-sol', 'priority');
  await expect(trigger(page), 'Model menu trigger must be locked during a live response').toBeDisabled();
  assert.equal(await page.getByRole('menuitemradio', { name: /^(Fast|Ultrafast)$/ }).count(), 0, 'No usable speed controls leak outside the locked menu');
  mock.hold(false);
  await expect(trigger(page)).toBeEnabled();
  await chooseSpeed(page, 'Ultrafast');
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
  await page.keyboard.press('ArrowDown');
  await expect(speed).toHaveValue('fast');
  await expect(speed).toBeEnabled();
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
