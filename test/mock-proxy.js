import { createServer } from 'node:http';

export const MODEL_CATALOG = {
  object: 'list',
  data: [
    { id: 'gpt-6.1-sol', service_tiers: ['priority', 'ultrafast'] },
    { id: 'gpt-6.1-astra', service_tiers: ['priority', 'ultrafast'] },
    { id: 'claude-sonnet-4-6', service_tiers: ['default'] },
    { id: 'unknown-model', service_tiers: ['default'] },
  ],
};

/** Responses input text, used to distinguish composer turns from title traffic. */
export function lastUserText(body) {
  const item = [...(body.input ?? [])].reverse().find(value => value.role === 'user');
  if (typeof item?.content === 'string') return item.content;
  return (item?.content ?? []).map(part => part.text ?? '').join('');
}

/** A loopback-only providerproxy: real HTTP headers/bodies and pi-ai Responses SSE. */
export async function startMockProxy({ catalog = MODEL_CATALOG, catalogStatus = 200 } = {}) {
  const requests = [];
  const pending = new Set();
  const waiters = new Set();
  let held = false;
  let nextCatalog = catalog;
  let nextCatalogStatus = catalogStatus;
  let sequence = 0;
  const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString('utf8');
    let body;
    try { body = raw ? JSON.parse(raw) : undefined; }
    catch { response.writeHead(400).end('Invalid JSON'); return; }
    const entry = { method: request.method, url: request.url, headers: { ...request.headers }, body };
    requests.push(entry);
    for (const notify of waiters) notify();
    if (request.method === 'GET' && request.url === '/v1/models') {
      response.writeHead(nextCatalogStatus, { 'content-type': 'application/json' });
      response.end(JSON.stringify(nextCatalog));
      return;
    }
    if (request.method !== 'POST' || request.url !== '/v1/responses') {
      response.writeHead(404).end('Only /v1/models and /v1/responses are implemented');
      return;
    }
    const user = lastUserText(body);
    const isTurn = user.startsWith('speed-e2e:');
    const text = isTurn ? 'Speed mock reply: ' + user : 'Speed test conversation';
    const id = 'resp_speed_' + ++sequence;
    const itemId = 'msg_speed_' + sequence;
    const item = { type: 'message', id: itemId, role: 'assistant', status: 'completed',
      content: [{ type: 'output_text', text, annotations: [] }] };
    const result = { id, object: 'response', model: body.model, status: 'completed', output: [item],
      usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15,
        input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } } };
    response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
    const frame = event => response.write('event: ' + event.type + '\ndata: ' + JSON.stringify(event) + '\n\n');
    frame({ type: 'response.created', response: { ...result, status: 'in_progress', output: [] } });
    frame({ type: 'response.output_item.added', output_index: 0,
      item: { ...item, status: 'in_progress', content: [] } });
    frame({ type: 'response.content_part.added', output_index: 0, content_index: 0, item_id: itemId,
      part: { type: 'output_text', text: '', annotations: [] } });
    frame({ type: 'response.output_text.delta', output_index: 0, content_index: 0, item_id: itemId, delta: text });
    const finish = () => {
      pending.delete(finish);
      if (response.destroyed) return;
      frame({ type: 'response.output_text.done', output_index: 0, content_index: 0, item_id: itemId, text });
      frame({ type: 'response.content_part.done', output_index: 0, content_index: 0, item_id: itemId, part: item.content[0] });
      frame({ type: 'response.output_item.done', output_index: 0, item });
      frame({ type: 'response.completed', response: result });
      response.end();
    };
    response.on('close', () => pending.delete(finish));
    if (held && isTurn) pending.add(finish);
    else finish();
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return {
    baseURL: 'http://127.0.0.1:' + server.address().port + '/v1',
    requests,
    turns: () => requests.filter(entry => entry.url === '/v1/responses' && lastUserText(entry.body).startsWith('speed-e2e:')),
    setCatalog(body, status = 200) { nextCatalog = body; nextCatalogStatus = status; },
    hold(value) {
      held = value;
      if (!value) for (const finish of [...pending]) finish();
    },
    async waitFor(predicate, timeout = 15000) {
      const existing = requests.find(predicate);
      if (existing) return existing;
      return new Promise((resolve, reject) => {
        const notify = () => {
          const match = requests.find(predicate);
          if (!match) return;
          clearTimeout(timer);
          waiters.delete(notify);
          resolve(match);
        };
        const timer = setTimeout(() => {
          waiters.delete(notify);
          reject(new Error('Timed out waiting for mock request; captured: ' + requests.map(value => value.method + ' ' + value.url).join(', ')));
        }, timeout);
        waiters.add(notify);
        notify();
      });
    },
    async close() {
      held = false;
      for (const finish of [...pending]) finish();
      const closed = new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
      server.closeAllConnections();
      await closed;
    },
  };
}
