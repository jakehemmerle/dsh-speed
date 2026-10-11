window.__ModuleLoader__.load({
  id: 'dsh-speed',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const { useState, useEffect, useSyncExternalStore, useRef } = React;
    const labels = { standard: 'Standard', fast: 'Fast ⚡', ultrafast: 'Ultrafast ⚡⚡' };
    function createPicker(fetch) {
      return function SpeedPicker({ directory, sessionId }) {
        const state = useSyncExternalStore(fn => directory.subscribe(fn), () => directory.getSnapshot());
        const current = state.pending ?? state.current;
        const key = JSON.stringify([sessionId, current?.provider, current?.model]);
        const supported = ['openai', 'openai-codex'].includes(current?.provider);
        const [report, setReport] = useState(null);
        const [busy, setBusy] = useState(false);
        const [error, setError] = useState('');
        const generation = useRef(0);
        const [refresh, setRefresh] = useState(0);
        function route() {
          return 'api/dsh-speed?' + new URLSearchParams({ sessionId, provider: current.provider, model: current.model });
        }
        async function readResponse(response) {
          const value = await response.json();
          if (!response.ok) throw new Error(value.error ?? 'Speed selection unavailable');
          return value;
        }
        useEffect(() => {
          let live = true;
          const id = ++generation.current;
          setReport(null); setError(''); setBusy(false);
          if (!supported) return () => { live = false; };
          const load = async () => {
            try {
              const value = await readResponse(await fetch(route()));
              if (live && id === generation.current) { setReport({ key, ...value }); setError(''); }
            } catch (e) { if (live && id === generation.current) setError(e.message); }
          };
          void load();
          const timer = setInterval(load, 30_000);
          return () => { live = false; ++generation.current; clearInterval(timer); };
        }, [key, refresh]);
        async function select(mode) {
          const id = ++generation.current;
          setBusy(true); setError('');
          try {
            const value = await readResponse(await fetch('api/dsh-speed', {
              method: 'PUT', headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ sessionId, provider: current.provider, model: current.model, mode }),
            }));
            if (id === generation.current) setReport({ key, ...value });
          } catch (e) { if (id === generation.current) setError(e.message); }
          finally {
            if (id === generation.current) { setBusy(false); setRefresh(x => x + 1); }
          }
        }
        if (!supported) return null;
        const visible = report?.key === key ? report : null;
        return h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, color: 'var(--dsw-alias-label-secondary)' } },
          h('label', null, h('span', { style: { marginRight: 4 } }, 'Speed'),
            h('select', {
              'aria-label': 'OpenAI speed', value: visible?.mode ?? 'standard',
              disabled: busy || !visible || state.status === 'selecting',
              title: visible?.warning ?? visible?.note ?? 'Checking supported speeds…',
              onChange: event => void select(event.target.value),
              style: { background: 'var(--dsw-specific-menu)', color: 'inherit', border: '1px solid var(--dsw-alias-border-l1)', borderRadius: 6, padding: '2px 4px', font: 'inherit' },
            }, (visible ? [...new Set([...visible.modes, visible.mode])] : ['standard']).map(mode =>
              h('option', { key: mode, value: mode, disabled: visible && !visible.modes.includes(mode) }, labels[mode] + (visible && !visible.modes.includes(mode) ? ' (unavailable)' : ''))))),
          error ? h('span', { role: 'alert', title: error }, error) : null,
          visible?.warning ? h('span', { role: 'alert' }, visible.warning) : null,
          h('button', { type: 'button', onClick: () => setRefresh(x => x + 1), disabled: busy,
            'aria-label': 'Refresh speed options', title: 'Refresh speed options',
            style: { color: 'inherit', background: 'none', border: 0, cursor: 'pointer', padding: 2 } }, '↻'));
      };
    }
    return {
      inject: ['slots', 'modelDirectories'],
      apply(ctx) {
        const Picker = createPicker((...args) => window.fetch(...args));
        ctx.slots.inject('conversation.input.right', () => ctx.slots.register({
          name: 'conversation.input.right', id: 'dsh-speed', order: -10,
          inject: sessionId => ({ sessionId, directory: ctx.modelDirectories.directoryFor(sessionId).store }),
        }, Picker));
      },
      createPicker,
    };
  },
});
