import test from 'node:test';
import assert from 'node:assert/strict';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
const { makeProfile, startTui } = await import(process.env.DSH_TEST_RIG ?? homedir() + '/.agents/skills/new-dsh-plugin/scripts/rig.mjs');
import { startMockProxy } from './mock-proxy.js';

async function fixture(t, model, tiers = ['priority', 'ultrafast'], cols = 100) {
  const mock = await startMockProxy({ catalog: { data: [{ id: model, service_tiers: tiers }] } });
  const profile = makeProfile({ kind: 'tui', seedTui: { 'model.json': { provider: 'providerproxy', model } }, rows: [
    { id: 'agent-default-model', config: { provider: 'providerproxy', model } },
    { id: 'llm-pi-ai', config: { providers: { providerproxy: { api: 'openai-responses', baseURL: mock.baseURL,
      apiKeyEnv: 'MOCK_KEY', models: [{ id: model, name: model, contextWindow: 128000, maxTokens: 8000, input: ['text'] }] } } } },
  ], plugins: [{ id: 'dsh-speed', name: fileURLToPath(new URL('../index.js', import.meta.url)), config: {
    stateFile: false, proxyProviders: { providerproxy: { baseURL: mock.baseURL, apiKeyEnv: 'MOCK_KEY' } },
  } }] });
  profile.env.MOCK_KEY = 'speed-e2e-mock-key';
  const tui = startTui(profile, { cols, rows: cols < 80 ? 50 : 40 });
  t.after(async () => { if (t.passed === false) console.log(tui.capture()); await tui.kill(); await mock.close(); profile.dispose(); });
  await tui.waitFor(new RegExp(model));
  return { tui, mock };
}

for (const model of ['gpt-6.1-sol', 'gpt-6-astra']) test('TUI arrow picker and lightning footer: ' + model, { timeout: 90000 }, async t => {
  const { tui, mock } = await fixture(t, model);
  await tui.waitFor(/Speed: Standard/);
  await tui.submit('/speed', { until: /Select speed/ });
  assert.match(tui.capture(), /⚡⚡ Ultrafast/);
  assert.equal(mock.turns().length, 0);
  tui.keys('Down'); tui.keys('Enter');
  await tui.waitFor(/Speed: ⚡(?!⚡)/);
  assert.match(tui.capture(), /Say something/);
  assert.doesNotMatch(tui.capture(), /⌘ \/speed/);
  await tui.submit('/speed', { until: /Select speed/ });
  tui.keys('Down'); tui.keys('Down'); tui.keys('Enter');
  await tui.waitFor(/Speed: ⚡⚡/);
  await tui.submit('/speed', { until: /Select speed/ });
  tui.keys('Escape');
  await tui.waitFor(/Select speed/, { not: true });
  assert.match(tui.capture(), /Speed: ⚡⚡/);
  await tui.submit('speed-e2e:picker', { until: () => mock.turns().length === 1 });
  assert.equal(mock.turns()[0].body.service_tier, 'ultrafast');
  await tui.waitFor(/Speed mock reply/);
  assert.match(tui.capture().split('\n').slice(-7).join('\n'), /Speed: ⚡⚡/);
  await tui.submit('/speed standard', { until: /Speed: Standard/ });
  assert.equal(mock.turns().length, 1);
});

test('TUI two-speed toggle works on the first screen and at narrow width', { timeout: 60000 }, async t => {
  const { tui, mock } = await fixture(t, 'gpt-6.1-sol', ['priority'], 60);
  await tui.waitFor(/Speed: Standard/);
  await tui.submit('/speed', { until: /Speed: ⚡(?!⚡)/ });
  assert.doesNotMatch(tui.capture(), /Select speed/);
  assert.match(tui.capture(), /Say something/);
  await tui.submit('/speed', { until: /Speed: Standard/ });
  assert.equal(mock.turns().length, 0);
});
