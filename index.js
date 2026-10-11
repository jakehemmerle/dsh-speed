import { createRequire, findPackageJSON } from 'node:module';
import { pathToFileURL } from 'node:url';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { apiModes, TIERS } from './lib/capabilities.js';
import { createCatalog } from './lib/catalog.js';
import { createNativeAuth } from './lib/native-auth.js';
import { createProxyCatalog, normalizeProxyProviders } from './lib/proxy-catalog.js';
import { createPreferences, validSelection } from './lib/preferences.js';
import { installTransport } from './lib/transport.js';

export const inject = ['credentials', 'llm'];
export const SUPPORTED_PI_AI_VERSIONS = Object.freeze(['0.87.1', '1.1.0']);
export function assertRuntimeVersion(version) {
  if (!SUPPORTED_PI_AI_VERSIONS.includes(version)) {
    throw new Error('dsh-speed requires an audited host pi-ai version (0.87.1 or 1.1.0); re-audit the transport shim before upgrading');
  }
}
async function loadRuntime() {
  // Resolve from the HOST adapter, not a second pi-ai copy in this plugin.
  const candidates = [createRequire(import.meta.url)];
  if (process.argv[1]) candidates.push(createRequire(pathToFileURL(process.argv[1])));
  for (const require of candidates) {
    let manifest;
    try {
      const adapter = require.resolve('@deepseek-ai/dsh-llm-pi-ai');
      // pi-ai exposes an import-only root and no package.json subpath. The
      // import resolver finds its actual package from the host adapter’s URL.
      manifest = findPackageJSON('@earendil-works/pi-ai', pathToFileURL(adapter));
    } catch { continue; }
    if (!manifest) continue;
    const pkg = JSON.parse(await readFile(manifest, 'utf8'));
    assertRuntimeVersion(pkg.version);
    return import(new URL('./dist/index.js', pathToFileURL(manifest)).href);
  }
  throw new Error('Cannot resolve host llm-pi-ai; install dsh-speed alongside DSH, not with a separate pi-ai copy');
}
function json(value, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
}
export function createPlugin(deps = {}) {
  return async function apply(ctx, config = {}) {
    let preferences;
    let active = true;
    const listeners = new Set();
    ctx.provide?.('dshSpeed', {
      getMode: selection => active && validSelection({ ...selection, mode: 'standard' })
        ? preferences?.get(selection) ?? 'standard' : undefined,
      subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    });
    ctx.effect(() => () => {
      active = false;
      for (const listener of listeners) listener();
      listeners.clear();
    });
    const { createModels } = await (deps.loadRuntime ?? loadRuntime)();
    preferences = await createPreferences(config.stateFile === false ? undefined :
      config.stateFile ?? join(homedir(), '.dsh', 'dsh-speed.json'));
    for (const listener of listeners) listener();
    const saveSelection = async selection => {
      await preferences.set(selection);
      for (const listener of listeners) listener();
    };
    const lifetime = new AbortController();
    const readNativeAuth = config.codexAuthFile ? createNativeAuth({ file: config.codexAuthFile,
      command: config.codexCommand, now: deps.now, refresh: deps.refreshCodex }) : undefined;
    const catalog = createCatalog({
      readCredential: readNativeAuth ?? (() => ctx.credentials.readRecord('llm-pi-ai/openai-codex')),
      fetch: deps.fetch, now: deps.now, signal: lifetime.signal,
      clientVersion: config.codexClientVersion ?? '0.160.1',
    });
    const proxyProviders = normalizeProxyProviders(config.proxyProviders);
    const proxyCatalog = createProxyCatalog({ providers: proxyProviders, env: deps.env, fetch: deps.fetch,
      readToken: ctx.credentials.resolve ? async ref => (await ctx.credentials.resolve(ref))?.value : undefined,
      now: deps.now, signal: lifetime.signal, ttl: config.catalogTtlMs ?? 60_000 });
    const supported = provider => ['openai', 'openai-codex'].includes(provider) || proxyProviders.has(provider);
    const transport = installTransport(createModels, proxyProviders, readNativeAuth);
    ctx.effect(() => () => { lifetime.abort(); transport.dispose(); }, 'dsh-speed: transport and catalog lifetime');
    async function capabilities(provider, model, refresh = false) {
      if (proxyProviders.has(provider)) {
        const report = await proxyCatalog(provider, refresh);
        return { modes: report.models.get(model) ?? ['standard'], note: report.note };
      }
      if (provider === 'openai') return { modes: apiModes(model, config),
        note: 'Fast and Ultrafast cost more. API access and rate limits are enforced by OpenAI.' };
      if (provider === 'openai-codex') {
        const report = await catalog(refresh);
        return { modes: report.models.get(model) ?? ['standard'], note: report.note + '. Accelerated modes may use more plan allowance.' };
      }
      return { modes: ['standard'], note: 'Speed selection is unavailable for this provider' };
    }
    ctx.on('llm/stream', async function* (options, next) {
      if (!options.sessionId || options.purpose || !supported(options.provider)) {
        yield* next(); return;
      }
      const mode = preferences.get(options);
      if (mode === undefined) { yield* next(); return; }
      if (mode !== 'standard') {
        const report = await capabilities(options.provider, options.model);
        if (!report.modes.includes(mode)) throw new Error('dsh-speed: ' + mode + ' is no longer available; choose Standard or refresh the speed picker');
      }
      options.signal?.throwIfAborted();
      yield* transport.scope({ provider: options.provider, model: options.model, tier: TIERS[mode] }, next);
    });
    const registerEndpoint = (connection, owner = ctx) => owner.effect(() => connection.fetch.register({
      path: '/api/dsh-speed', methods: ['GET', 'PUT'], requestBody: 'buffered',
      fetch: async request => {
        try {
          const url = new URL(request.url);
          const s = request.method === 'PUT' ? await request.json() : {
            sessionId: url.searchParams.get('sessionId'), provider: url.searchParams.get('provider'),
            model: url.searchParams.get('model'), mode: 'standard',
          };
          if (!validSelection(s)) return json({ error: 'Invalid speed selection' }, 400);
          const report = await capabilities(s.provider, s.model, url.searchParams.get('refresh') === '1');
          if (request.method === 'PUT') {
            if (!supported(s.provider) || !report.modes.includes(s.mode)) {
              return json({ error: 'This speed is not available for the selected model/account' }, 400);
            }
            // Verify this is a registered model without making a generation request.
            await ctx.llm.resolveModelInfo(s.provider, s.model, request.signal);
            await saveSelection({ sessionId: s.sessionId, provider: s.provider, model: s.model, mode: s.mode });
          }
          const mode = preferences.get(s) ?? 'standard';
          return json({ ...report, mode, available: supported(s.provider),
            ...(report.modes.includes(mode) ? {} : { warning: 'Saved speed unavailable; choose Standard before sending' }) });
        } catch (e) {
          if (e instanceof SyntaxError) return json({ error: 'Malformed JSON' }, 400);
          // Never expose upstream exceptions, access tokens, account IDs or disk paths.
          return json({ error: 'Could not load or save speed selection' }, 503);
        }
      },
    }), 'dsh-speed: speed endpoint');
    if (ctx.inject) ctx.inject(['connection'], inner => registerEndpoint(inner.connection, inner));
    else registerEndpoint(ctx.connection);
    let dialogs;
    ctx.inject?.(['tuiDialogs'], inner => {
      dialogs = inner.tuiDialogs;
      inner.effect(() => () => { dialogs = undefined; });
    });
    ctx.inject?.(['commands'], inner => inner.effect(() => inner.commands.register({
      name: 'speed', description: 'Choose speed, toggle Standard/Fast, or show status',
      handler: async ({ agent, rawInput, signal }) => {
        const selection = { sessionId: agent.id, provider: agent.options.provider, model: agent.options.model };
        let mode = rawInput.trim().toLowerCase();
        if (!validSelection({ ...selection, mode: 'standard' })) return { kind: 'error', text: 'Select a model before changing speed.' };
        if (agent.status !== 'idle') return { kind: 'error', text: 'Wait for the current turn before changing speed.' };
        try {
          let report = await capabilities(selection.provider, selection.model, true);
          if (!mode && report.modes.length === 2) {
            mode = preferences.get(selection) === report.modes[1] ? 'standard' : report.modes[1];
          } else if (!mode && report.modes.length > 2 && dialogs) {
            const labels = { standard: 'Standard', fast: '⚡ Fast', ultrafast: '⚡⚡ Ultrafast' };
            mode = await dialogs.select({ title: 'Select speed — ' + selection.model, signal,
              options: report.modes.map(id => ({ id, label: labels[id],
                ...(id === (preferences.get(selection) ?? 'standard') ? { description: 'Current speed' } : {}) })),
            });
            if (mode === undefined) return { kind: 'success', text: '' };
            report = await capabilities(selection.provider, selection.model, true);
          }
          if (mode && mode !== 'status') {
            if (agent.status !== 'idle' || agent.id !== selection.sessionId || agent.options.provider !== selection.provider || agent.options.model !== selection.model) {
              return { kind: 'error', text: 'The session changed. Run /speed again.' };
            }
            if (!supported(selection.provider) || !report.modes.includes(mode)) return { kind: 'error', text: 'Available speeds: ' + report.modes.join(', ') };
            signal.throwIfAborted();
            await saveSelection({ ...selection, mode });
          }
          return { kind: 'success', text: 'Speed: ' + (preferences.get(selection) ?? 'standard') + '. Available: ' + report.modes.join(', ') };
        } catch { return { kind: 'error', text: 'Could not check or save speed. Check the provider sign-in.' }; }
      },
    }), 'dsh-speed: command'));
  };
}
export const apply = createPlugin();
