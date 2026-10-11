// Opt-in only: real generations using the local Codex login and host pi-ai.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { zstdDecompressSync } from 'node:zlib';
import { createPlugin, assertRuntimeVersion } from '../index.js';
import { TIERS } from '../lib/capabilities.js';

const { values } = parseArgs({ options: {
  'all-tiers': { type: 'boolean', default: false },
  transport: { type: 'string', default: 'sse' },
  provider: { type: 'string', default: 'openai-codex' },
  live: { type: 'boolean', default: false },
  help: { type: 'boolean', default: false },
} });
if (values.help) {
  console.log('DSH_PI_AI_MODULE=/path/to/host/pi-ai/dist/index.js node test/live.mjs --live [--all-tiers] [--provider openai-codex|providerproxy] [--transport sse|auto|websocket]');
  console.log('Makes up to 6 live generations. Native uses Codex auth.json; proxy uses PROVIDERPROXY_API_KEY or ~/.omp/agent/providerproxy-token. Unsupported account tiers are reported as unavailable.');
  process.exit(0);
}
if (!values.live && process.env.DSH_LIVE_TESTS !== '1') {
  console.error('Live tests are disabled. Pass --live (or DSH_LIVE_TESTS=1) to use real credentials and consume account allowance.');
  process.exit(2);
}
assert.ok(['sse', 'auto', 'websocket'].includes(values.transport), 'Invalid transport');
assert.ok(['openai-codex', 'providerproxy'].includes(values.provider), 'Invalid provider');
assert.ok(values.provider === 'openai-codex' || values.transport === 'sse', 'Proxy live test uses SSE');
assert.ok(process.env.DSH_PI_AI_MODULE, 'Set DSH_PI_AI_MODULE to the installed host pi-ai dist/index.js');
const entry = pathToFileURL(process.env.DSH_PI_AI_MODULE);
const base = new URL('.', entry);
const pkg = JSON.parse(await readFile(new URL('../package.json', base), 'utf8'));
assertRuntimeVersion(pkg.version);
const runtime = await import(entry.href);
const { openaiCodexProvider } = await import(new URL('providers/openai-codex.js', base));
const { openaiProvider } = await import(new URL('providers/openai.js', base));
const protocol = await import(new URL('api/openai-codex-responses.js', base));
const credentials = new runtime.InMemoryCredentialStore();
const models = runtime.createModels({ credentials });
const native = values.provider === 'openai-codex';
const proxyUrl = process.env.PROVIDERPROXY_BASE_URL ?? 'http://gpu.tail47033e.ts.net:4000/v1';
if (native) models.setProvider(openaiCodexProvider());
else models.setProvider({ ...openaiProvider(), id: 'providerproxy', baseUrl: proxyUrl });
const modelIds = ['gpt-6.1-sol', 'gpt-6-astra'];
const modes = values['all-tiers'] ? Object.keys(TIERS) : ['ultrafast'];
const effects = [], listeners = {};
let route, secrets = [];
const redact = error => secrets.reduce((text, secret) => text.replaceAll(secret, '[redacted]'), String(error.message ?? error));

try {
  const authPath = join(process.env.CODEX_HOME || join(homedir(), '.codex'), 'auth.json');
  const tokens = native ? JSON.parse(await readFile(authPath, 'utf8')).tokens : {};
  secrets = Object.values(tokens ?? {}).filter(value => typeof value === 'string' && value.length > 8);
  const proxyKey = native ? undefined : (process.env.PROVIDERPROXY_API_KEY ?? (await readFile(join(homedir(), '.omp/agent/providerproxy-token'), 'utf8')).trim());
  if (proxyKey) secrets.push(proxyKey);
  await createPlugin({ loadRuntime: async () => runtime, env: { PROVIDERPROXY_API_KEY: proxyKey } })({
    credentials: { readRecord: async () => { throw new Error('Native auth must come from Codex, not the DSH credential store'); } },
    llm: { resolveModelInfo: async (provider, id) => {
      const model = models.getModels(provider).find(model => model.id === id);
      assert.ok(model, 'Model missing from installed host pi-ai');
      return model;
    } },
    on(name, handler) { listeners[name] = handler; },
    effect(fn) { effects.push(fn()); },
    connection: { fetch: { register(value) { route = value; return () => {}; } } },
  }, { stateFile: false, ...(native ? { codexAuthFile: authPath,
    codexCommand: join(homedir(), '.local/share/nix-management/bin/codex') } : {
    proxyProviders: { providerproxy: { baseURL: proxyUrl, apiKeyEnv: 'PROVIDERPROXY_API_KEY' } },
  }) });
  console.log(JSON.stringify({ runtime: pkg.version, transport: values.transport, models: modelIds, modes }));

  for (const modelId of modelIds) {
    const found = models.getModels(values.provider).find(model => model.id === modelId);
    const model = native ? found : { ...found, provider: 'providerproxy', baseUrl: proxyUrl,
      compat: { ...found.compat, supportsMaxOutputTokens: false } };
    assert.ok(model, 'Model missing from installed host pi-ai: ' + modelId);
    for (const mode of modes) {
      const sessionId = randomUUID();
      const selection = { sessionId, provider: values.provider, model: modelId, mode };
      const result = { provider: values.provider, model: modelId, mode, requestedTier: TIERS[mode] };
      try {
        const catalog = await route.fetch(new Request('http://localhost/api/dsh-speed?' + new URLSearchParams(selection)));
        assert.equal(catalog.status, 200);
        const availability = await catalog.json();
        if (!availability.modes.includes(mode)) {
          console.log(JSON.stringify({ ...result, unavailable: true, availableModes: availability.modes, note: availability.note }));
          continue;
        }
        const response = await route.fetch(new Request('http://localhost/api/dsh-speed', {
          method: 'PUT', body: JSON.stringify(selection),
        }));
        assert.equal(response.status, 200, 'Plugin catalog/model validation rejected selection');
        const selected = await response.json();
        assert.equal(selected.mode, mode);
        assert.ok(selected.modes.includes(mode), 'Account catalog does not advertise the requested mode');
        let completed, message, firstTextMs;
        const started = performance.now();
        const stream = listeners['llm/stream'](selection, async function* () {
          yield* models.streamSimple(model, { messages: [{
            role: 'user', content: 'Reply with exactly SPEED_OK and nothing else.', timestamp: Date.now(),
          }] }, {
            ...(native ? {} : { apiKey: proxyKey }), reasoning: 'low', sessionId,
            transport: values.transport, maxRetries: 0,
            signal: AbortSignal.timeout(60_000), timeoutMs: 30_000,
            fetch: async (url, init) => {
              assert.equal(String(url), native ? 'https://chatgpt.com/backend-api/codex/responses' : proxyUrl + '/responses');
              const headers = new Headers(init.headers);
              assert.equal(headers.get('authorization'), 'Bearer ' + (native ? tokens.access_token : proxyKey));
              if (native) {
                assert.equal(headers.get('chatgpt-account-id'), tokens.account_id);
                assert.equal(headers.get('x-codex-routing-hint'), 'model=' + modelId + (mode === 'standard' ? '' : ';tier=' + TIERS[mode]));
              }
              const wire = new Headers(init.headers).get('content-encoding') === 'zstd'
                ? zstdDecompressSync(init.body).toString() : init.body;
              const payload = JSON.parse(wire);
              assert.equal(payload.model, modelId);
              assert.equal(payload.service_tier, TIERS[mode], 'Final wire tier differs from plugin selection');
              result.wireTier = payload.service_tier;
              const upstream = await fetch(url, { ...init, redirect: 'error' });
              result.httpStatus = upstream.status;
              return upstream;
            },
            onProviderStreamEvent(event) {
              if (['response.completed', 'response.done', 'response.incomplete'].includes(event.type)) completed = event.response;
            },
          });
        });
        for await (const event of stream) {
          if (event.type === 'error') throw new Error(event.error?.errorMessage || 'Provider stream failed');
          if (event.type === 'text_delta' && firstTextMs === undefined) firstTextMs = Math.round(performance.now() - started);
          if (event.type === 'done') message = event.message;
        }
        result.elapsedMs = Math.round(performance.now() - started);
        result.firstTextMs = firstTextMs;
        result.servedModel = completed?.model;
        result.servedTier = completed?.service_tier;
        result.status = completed?.status;
        result.outputTokens = completed?.usage?.output_tokens;
        const stats = protocol.getOpenAICodexWebSocketDebugStats(sessionId);
        result.transport = stats?.connectionsCreated && !stats.sseFallbacks ? 'websocket' : 'sse';
        if (stats?.sseFallbacks) result.websocketFallback = true;
        assert.equal(completed?.status, 'completed', 'No successful terminal response');
        assert.equal(completed?.model, modelId, 'Server returned a different model');
        assert.equal(message?.stopReason, 'stop', 'Generation did not stop normally');
        assert.equal(message.content.filter(part => part.type === 'text').map(part => part.text).join('').trim(), 'SPEED_OK');
        // Native Codex itself can return "default" after requesting an
        // accelerated tier. Preserve that evidence without claiming latency.
        result.tierEchoMatches = completed?.service_tier === TIERS[mode];
        if (values.transport === 'websocket') assert.equal(result.transport, 'websocket', 'WebSocket fell back to SSE');
        result.pass = true;
      } catch (error) {
        result.pass = false;
        result.error = redact(error);
        process.exitCode = 1;
      } finally {
        protocol.closeOpenAICodexWebSocketSessions(sessionId);
      }
      console.log(JSON.stringify(result));
    }
  }
} catch (error) {
  console.error(redact(error));
  process.exitCode = 1;
} finally {
  for (const effect of effects.reverse()) await effect?.();
}
