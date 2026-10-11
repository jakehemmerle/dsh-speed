import { createHash } from 'node:crypto';
import { parseCatalog } from './capabilities.js';
export function createCatalog({ readCredential, fetch = globalThis.fetch, now = Date.now, signal, ttl = 300_000, clientVersion = '0.160.1' }) {
  let cached;
  const unavailable = note => ({ models: new Map(), note });
  return async function catalog() {
    let record;
    try { record = await readCredential(); } catch { return unavailable('Cannot read Codex sign-in'); }
    const p = record?.kind === 'grant' ? record.payload : undefined;
    if (p?.type !== 'oauth' || typeof p.access !== 'string' || !p.access ||
        typeof p.accountId !== 'string' || !p.accountId) return unavailable('Sign in to Codex to check speed access');
    if (!Number.isFinite(p.expires) || p.expires <= now()) return unavailable('Codex sign-in expired; sign in again');
    const key = createHash('sha256').update(p.access + '\0' + p.accountId).digest('hex');
    if (cached?.key === key && cached.expires > now()) return cached.promise;
    const promise = (async () => {
      try {
        const response = await fetch(`https://chatgpt.com/backend-api/codex/models?client_version=${encodeURIComponent(clientVersion)}`, {
          headers: { Authorization: 'Bearer ' + p.access, 'ChatGPT-Account-Id': p.accountId, 'User-Agent': `codex-cli/${clientVersion}` },
          signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(10_000)]) : AbortSignal.timeout(10_000),
          redirect: 'error',
        });
        if (!response.ok) return unavailable('Codex speed catalog unavailable (HTTP ' + response.status + ')');
        return { models: parseCatalog(await response.json()), note: 'Options reflect this Codex account’s catalog' };
      } catch { return unavailable('Codex speed catalog unavailable; accelerated modes are disabled'); }
    })();
    cached = { key, promise, expires: now() + ttl };
    const result = await promise;
    // Fail closed, and retry failures after a short backoff, not a full catalog TTL.
    if (!result.models.size && cached?.promise === promise) cached.expires = now() + 15_000;
    return result;
  };
}
