import { AsyncLocalStorage } from 'node:async_hooks';
import { isOfficialTransport } from './capabilities.js';
import { isProxyTransport } from './proxy-catalog.js';
// Audited compatibility seam: pi-ai 0.87.1 and 1.1.0. DSH's builtin adapter
// drops arbitrary options, so scope only its Models.streamSimple transport.
// Re-audit this seam and real wire tests before allowing another version.
const installed = Symbol.for('dsh-speed.transport');
export function installTransport(createModels, proxyProviders = new Map(), readNativeAuth) {
  const prototype = Object.getPrototypeOf(createModels());
  if (prototype[installed]) throw new Error('dsh-speed is already installed in this process');
  const original = prototype.streamSimple;
  if (typeof original !== 'function') throw new Error('Unsupported pi-ai runtime: missing streamSimple');
  const storage = new AsyncLocalStorage();
  let active = true;
  const originalAuth = prototype.getAuth;
  if (readNativeAuth && typeof originalAuth !== 'function') throw new Error('Unsupported pi-ai runtime: missing getAuth');
  async function nativeAuth(providerOrModel, options) {
    const provider = typeof providerOrModel === 'string' ? providerOrModel : providerOrModel.provider;
    if (!active || provider !== 'openai-codex') return originalAuth.call(this, providerOrModel, options);
    const model = typeof providerOrModel === 'string' ? {
      provider, api: 'openai-codex-responses', baseUrl: this.getProvider(provider)?.baseUrl,
    } : providerOrModel;
    if (!isOfficialTransport(model, provider)) throw new Error('Local Codex authentication requires the official endpoint');
    const { payload } = await readNativeAuth();
    options?.signal?.throwIfAborted();
    return { auth: { apiKey: payload.access, headers: { 'ChatGPT-Account-Id': payload.accountId } }, source: 'OAuth' };
  }
  function wrapped(model, context, options) {
    const selection = active ? storage.getStore() : undefined;
    if (!selection || model.provider !== selection.provider || model.id !== selection.model) return original.call(this, model, context, options);
    if (!isOfficialTransport(model, selection.provider) && !isProxyTransport(model, selection.provider, proxyProviders)) {
      throw new Error('dsh-speed transport requires an official endpoint or an explicitly trusted proxy endpoint');
    }
    if (selection.tier === 'ultrafast' && model.api === 'openai-completions') throw new Error('Ultrafast requires the Responses API');
    const prior = options?.onPayload;
    return original.call(this, model, context, {
      ...options, serviceTier: selection.tier,
      ...(selection.provider === 'openai-codex' ? { headers: { ...options?.headers,
        'x-codex-routing-hint': 'model=' + model.id + (selection.tier === 'default' ? '' : ';tier=' + selection.tier),
      } } : {}),
      async onPayload(payload, requestModel) {
        const next = await prior?.(payload, requestModel);
        return { ...(next ?? payload), service_tier: selection.tier };
      },
    });
  }
  prototype.streamSimple = wrapped;
  if (readNativeAuth) prototype.getAuth = nativeAuth;
  prototype[installed] = true;
  return {
    // Async generators do not execute in the context where they were created.
    // Re-enter ALS for every iterator operation, including cancellation/finally.
    async *scope(selection, next) {
      const iterator = storage.run(selection, () => next()[Symbol.asyncIterator]());
      try {
        while (true) {
          const result = await storage.run(selection, () => iterator.next());
          if (result.done) return result.value;
          yield result.value;
        }
      } finally {
        if (iterator.return) await storage.run(selection, () => iterator.return());
      }
    },
    dispose() {
      active = false;
      if (prototype.streamSimple === wrapped) prototype.streamSimple = original;
      if (prototype.getAuth === nativeAuth) prototype.getAuth = originalAuth;
      delete prototype[installed];
    },
  };
}
