import { AsyncLocalStorage } from 'node:async_hooks';
import { isOfficialTransport } from './capabilities.js';
// Audited compatibility seam: pi-ai 0.87.1 and 1.1.0. DSH's builtin adapter
// drops arbitrary options, so scope only its Models.streamSimple transport.
// Re-audit this seam and real wire tests before allowing another version.
const installed = Symbol.for('dsh-speed.transport');
export function installTransport(createModels) {
  const prototype = Object.getPrototypeOf(createModels());
  if (prototype[installed]) throw new Error('dsh-speed is already installed in this process');
  const original = prototype.streamSimple;
  if (typeof original !== 'function') throw new Error('Unsupported pi-ai runtime: missing streamSimple');
  const storage = new AsyncLocalStorage();
  let active = true;
  function wrapped(model, context, options) {
    const selection = active ? storage.getStore() : undefined;
    if (!selection || model.provider !== selection.provider || model.id !== selection.model) return original.call(this, model, context, options);
    if (!isOfficialTransport(model, selection.provider)) throw new Error('dsh-speed only supports the official OpenAI/Codex endpoints');
    if (selection.tier === 'ultrafast' && model.api === 'openai-completions') throw new Error('Ultrafast requires the Responses API');
    const prior = options?.onPayload;
    return original.call(this, model, context, {
      ...options, serviceTier: selection.tier,
      async onPayload(payload, requestModel) {
        const next = await prior?.(payload, requestModel);
        return { ...(next ?? payload), service_tier: selection.tier };
      },
    });
  }
  prototype.streamSimple = wrapped;
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
      delete prototype[installed];
    },
  };
}
