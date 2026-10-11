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
  help: { type: 'boolean', default: false },
} });
if (values.help) {
  console.log('DSH_PI_AI_MODULE=/path/to/host/pi-ai/dist/index.js node test/live.mjs [--all-tiers] [--transport sse|auto|websocket]');
  console.log('Makes 2 live generations (6 with --all-tiers), consuming Codex plan allowance. Reads CODEX_HOME/auth.json or ~/.codex/auth.json without modifying it.');
  process.exit(0);
}
assert.ok(['sse', 'auto', 'websocket'].includes(values.transport), 'Invalid transport');
assert.ok(process.env.DSH_PI_AI_MODULE, 'Set DSH_PI_AI_MODULE to the installed host pi-ai dist/index.js');
const entry = pathToFileURL(process.env.DSH_PI_AI_MODULE);
const base = new URL('.', entry);
const pkg = JSON.parse(await readFile(new URL('../package.json', base), 'utf8'));
assertRuntimeVersion(pkg.version);
const runtime = await import(entry.href);
const { openaiCodexProvider } = await import(new URL('providers/openai-codex.js', base));
const protocol = await import(new URL('api/openai-codex-responses.js', base));
const credentials = new runtime.InMemoryCredentialStore();
const models = runtime.createModels({ credentials });
models.setProvider(openaiCodexProvider());
const modelIds = ['gpt-6.1-sol', 'gpt-6-astra'];
const modes = values['all-tiers'] ? Object.keys(TIERS) : ['ultrafast'];
const effects = [], listeners = {};
let route, secrets = [];
const redact = error => secrets.reduce((text, secret) => text.replaceAll(secret, '[redacted]'), String(error.message ?? error));

try {
  const authPath = join(process.env.CODEX_HOME || join(homedir(), '.codex'), 'auth.json');
  const auth = JSON.parse(await readFile(authPath, 'utf8'));
  const tokens = auth.tokens;
  secrets = Object.values(tokens ?? {}).filter(value => typeof value === 'string' && value.length > 8);
  assert.ok(tokens?.access_token && tokens?.account_id, 'Codex OAuth tokens are missing; sign in with Codex first');
  const claims = JSON.parse(Buffer.from(tokens.access_token.split('.')[1], 'base64url').toString());
  const expires = claims.exp * 1000;
  assert.ok(expires > Date.now() + 600_000, 'Codex access token is expired or expiring; refresh it in Codex first');
  assert.equal(claims['https://api.openai.com/auth']?.chatgpt_account_id, tokens.account_id, 'Codex account mismatch');
  await credentials.modify('openai-codex', () => ({
    type: 'oauth', access: tokens.access_token, expires,
  }));
  const credential = { kind: 'grant', payload: {
    type: 'oauth', access: tokens.access_token, accountId: tokens.account_id, expires,
  } };
  await createPlugin({ loadRuntime: async () => runtime })({
    credentials: { readRecord: async () => credential },
    llm: { resolveModelInfo: async (provider, id) => {
      const model = models.getModels(provider).find(model => model.id === id);
      assert.ok(model, 'Model missing from installed host pi-ai');
      return model;
    } },
    on(name, handler) { listeners[name] = handler; },
    effect(fn) { effects.push(fn()); },
    connection: { fetch: { register(value) { route = value; return () => {}; } } },
  }, { stateFile: false });
  console.log(JSON.stringify({ runtime: pkg.version, transport: values.transport, models: modelIds, modes }));

  for (const modelId of modelIds) {
    const model = models.getModels('openai-codex').find(model => model.id === modelId);
    assert.ok(model, 'Model missing from installed host pi-ai: ' + modelId);
    for (const mode of modes) {
      const sessionId = randomUUID();
      const selection = { sessionId, provider: 'openai-codex', model: modelId, mode };
      const result = { model: modelId, mode, requestedTier: TIERS[mode] };
      try {
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
            apiKey: tokens.access_token, reasoning: 'low', sessionId,
            transport: values.transport, maxRetries: 0,
            signal: AbortSignal.timeout(60_000), timeoutMs: 30_000,
            fetch: async (url, init) => {
              assert.equal(String(url), 'https://chatgpt.com/backend-api/codex/responses');
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
        assert.equal(completed?.service_tier, TIERS[mode], 'Server did not confirm the requested tier');
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
