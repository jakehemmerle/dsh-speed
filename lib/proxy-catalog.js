import { createHash } from 'node:crypto';

// A proxy is trusted only when explicitly configured. Never infer trust from
// model names, loopback, HTTP, or a provider name supplied by a browser.
export function normalizeProxyProviders(value = {}) {
  const providers = new Map();
  for (const [provider, config] of Object.entries(value)) {
    if (['openai', 'openai-codex'].includes(provider)) throw new Error('Proxy config cannot override official providers');
    const url = new URL(config.baseURL);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash ||
        typeof config.apiKeyEnv !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(config.apiKeyEnv)) {
      throw new Error('Invalid trusted proxy configuration');
    }
    providers.set(provider, { baseURL: url.href.replace(/\/$/, ''), apiKeyEnv: config.apiKeyEnv });
  }
  return providers;
}
export function isProxyTransport(model, route, providers) {
  const config = providers.get(route);
  try { return Boolean(config) && model.api === 'openai-responses' && new URL(model.baseUrl).href.replace(/\/$/, '') === config.baseURL; }
  catch { return false; }
}
export function parseProxyCatalog(value) {
  if (!value || !Array.isArray(value.data)) throw new Error('Malformed proxy catalog');
  const result = new Map();
  for (const model of value.data) {
    if (!model || typeof model.id !== 'string') continue;
    const tiers = Array.isArray(model.service_tiers) ? model.service_tiers.filter(t => typeof t === 'string') : [];
    result.set(model.id, ['standard', ...(tiers.some(t => t === 'priority' || t === 'fast') ? ['fast'] : []), ...(tiers.includes('ultrafast') ? ['ultrafast'] : [])]);
  }
  return result;
}
export function createProxyCatalog({ providers, env = process.env, fetch = globalThis.fetch, now = Date.now, signal, ttl = 60_000 }) {
  if (!Number.isFinite(ttl) || ttl <= 0) throw new Error('Invalid proxy catalog TTL');
  const cache = new Map();
  const unavailable = note => ({ models: new Map(), note });
  return async function catalog(provider, refresh = false) {
    const config = providers.get(provider);
    const token = config && env[config.apiKeyEnv];
    if (typeof token !== 'string' || !token) return unavailable('Proxy credential unavailable; accelerated modes are disabled');
    const key = createHash('sha256').update(config.baseURL + '\0' + token).digest('hex');
    const prior = cache.get(provider);
    if (!refresh && prior?.key === key && prior.expires > now()) return prior.promise;
    const promise = (async () => {
      try {
        const response = await fetch(config.baseURL + '/models', { headers: { Authorization: 'Bearer ' + token }, redirect: 'error',
          signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(10_000)]) : AbortSignal.timeout(10_000) });
        if (!response.ok) return unavailable('Proxy speed catalog unavailable (HTTP ' + response.status + ')');
        return { models: parseProxyCatalog(await response.json()), note: 'Options reflect the proxy account catalog. Accelerated modes may use more plan allowance' };
      } catch { return unavailable('Proxy speed catalog unavailable; accelerated modes are disabled'); }
    })();
    cache.set(provider, { key, promise, expires: now() + ttl });
    const report = await promise;
    if (!report.models.size && cache.get(provider)?.promise === promise) cache.get(provider).expires = now() + Math.min(ttl, 15_000);
    return report;
  };
}
