import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { installTransport } from '../lib/transport.js';
import { createPlugin } from '../index.js';
import { fileURLToPath } from 'node:url';
// Provide the HOST pi-ai entry to prove the shim intercepts its actual lazy
// protocol stack. Fetch is mocked: no account secrets, model calls or charges.
const entry = process.env.DSH_PI_AI_MODULE;
test('default plugin loader patches the host adapter’s pi-ai instance, not a second copy', { skip: !entry }, async () => {
  const { createModels } = await import(pathToFileURL(entry).href);
  const prototype = Object.getPrototypeOf(createModels()), original = prototype.streamSimple;
  const effects = [], prior = process.argv[1];
  // The adapter resides in the same host module tree as DSH’s launcher.
  process.argv[1] = fileURLToPath(new URL('../../../@deepseek-ai/dsh-llm-pi-ai/lib/index.js', pathToFileURL(entry)));
  try {
    await createPlugin()({
      credentials: { readRecord: async () => undefined }, llm: {}, on() {},
      effect(fn) { effects.push(fn()); },
      connection: { fetch: { register() { return () => {}; } } },
    }, { stateFile: false });
    assert.notStrictEqual(prototype.streamSimple, original);
  } finally {
    process.argv[1] = prior;
    for (const effect of effects.reverse()) await effect?.();
  }
  assert.strictEqual(prototype.streamSimple, original);
});
test('real pi-ai Codex Responses: Standard/Fast/Ultrafast reach authenticated HTTP JSON', { skip: !entry }, async () => {
  const base = new URL('.', pathToFileURL(entry));
  const { createModels } = await import(pathToFileURL(entry).href);
  const { openaiCodexProvider } = await import(new URL('providers/openai-codex.js', base).href);
  const { InMemoryCredentialStore } = await import(pathToFileURL(entry).href);
  const credentials = new InMemoryCredentialStore();
  const models = createModels({ credentials }); models.setProvider(openaiCodexProvider());
  const model = models.getModels('openai-codex')[0];
  const payload = Buffer.from(JSON.stringify({ 'https://api.openai.com/auth': { chatgpt_account_id: 'test-account' } })).toString('base64url');
  const apiKey = Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url') + '.' + payload + '.signature';
  await credentials.modify('openai-codex', () => ({ type: 'oauth', access: apiKey, refresh: 'test', expires: Date.now() + 3600000 }));
  const shim = installTransport(createModels), bodies = [];
  const fetch = async (url, init) => {
    assert.ok(String(url).startsWith('https://chatgpt.com/backend-api/codex/'));
    const { zstdDecompressSync } = await import('node:zlib');
    const body = new Headers(init.headers).get('content-encoding') === 'zstd'
      ? zstdDecompressSync(init.body).toString('utf8') : init.body;
    bodies.push(JSON.parse(body));
    return new Response('data: '+JSON.stringify({ type: 'response.completed', response: {
      id: 'r', status: 'completed', output: [], usage: { input_tokens: 1, output_tokens: 0 },
    } })+'\n\n', { headers: { 'content-type': 'text/event-stream' } });
  };
  try {
    for (const tier of ['default', 'priority', 'ultrafast']) {
      const stream = shim.scope({ provider: 'openai-codex', model: model.id, tier }, async function* () {
        yield* models.streamSimple(model, { messages: [{ role: 'user', content: 'test', timestamp: 0 }] }, {
          apiKey, fetch, maxRetries: 0, transport: 'sse',
        });
      });
      for await (const event of stream) assert.notEqual(event.type, 'error', event.error?.errorMessage);
      assert.equal(bodies.at(-1).service_tier, tier);
    }
    assert.equal(bodies.length, 3);
  } finally { shim.dispose(); }
});
test('real pi-ai OpenAI Responses: all tiers reach HTTP JSON through streamSimple', { skip: !entry }, async () => {
  const base = new URL('.', pathToFileURL(entry));
  const { createModels } = await import(pathToFileURL(entry).href);
  const { openaiProvider } = await import(new URL('providers/openai.js', base).href);
  const models = createModels(); models.setProvider(openaiProvider());
  const model = models.getModels('openai')[0];
  assert.ok(model);
  const shim = installTransport(createModels), bodies = [];
  const context = { messages: [{ role: 'user', content: 'test', timestamp: 0 }] };
  const fetch = async (url, init) => {
    bodies.push(JSON.parse(init.body));
    return new Response('data: '+JSON.stringify({ type: 'response.completed', response: {
      id: 'r', status: 'completed', output: [], usage: { input_tokens: 1, output_tokens: 0 },
    } })+'\n\n'+'data: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } });
  };
  try {
    for (const tier of ['default', 'priority', 'ultrafast']) {
      const stream = shim.scope({ provider: 'openai', model: model.id, tier }, async function* () {
        yield* models.streamSimple(model, context, { apiKey: 'test-key', fetch, maxRetries: 0 });
      });
      for await (const event of stream) assert.notEqual(event.type, 'error', event.error?.errorMessage);
      assert.equal(bodies.at(-1).service_tier, tier);
    }
    assert.equal(bodies.length, 3);
  } finally { shim.dispose(); }
});
