window.__ModuleLoader__.load({
  id: 'dsh-speed',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const { useState, useEffect, useSyncExternalStore, useRef } = React;
    const labels = { standard: 'Standard', fast: 'Fast ⚡', ultrafast: 'Ultrafast ⚡⚡' };
    function createPicker(fetch) {
      return function SpeedPicker({ directory, sessionId, locked = false }) {
        const state = useSyncExternalStore(fn => directory.subscribe(fn), () => directory.getSnapshot());
        const current = state.pending ?? state.current;
        const key = JSON.stringify([sessionId, current?.provider, current?.model]);
        const supported = Boolean(current?.provider && current?.model);
        const [report, setReport] = useState(null);
        const [busy, setBusy] = useState(false);
        const [error, setError] = useState('');
        const generation = useRef(0);
        const [refresh, setRefresh] = useState(0);
        function route() {
          return 'api/dsh-speed?' + new URLSearchParams({ sessionId, provider: current.provider, model: current.model, ...(refresh ? { refresh: '1' } : {}) });
        }
        async function readResponse(response) {
          const value = await response.json();
          if (!response.ok) throw new Error(value.error ?? 'Speed selection unavailable');
          return value;
        }
        useEffect(() => {
          let live = true;
          ++generation.current;
          setReport(null); setError(''); setBusy(false);
          if (!supported) return () => { live = false; };
          const load = async () => {
            const id = ++generation.current;
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
            if (id === generation.current) setBusy(false);
          }
        }
        if (!supported) return null;
        const visible = report?.key === key ? report : null;
        if (visible?.available === false) return null;
        return h('div', { 'data-dsh-speed-control': '',
          // A native select popup (or disabling it while saving) can blur to
          // no DOM node. Keep the enclosing model menu open in that case.
          onBlur: event => { if (event.relatedTarget === null) event.stopPropagation(); },
          style: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 5, padding: '6px 7px', fontSize: 12, color: 'var(--dsw-alias-label-secondary)' } },
          h('label', { style: { display: 'flex', flex: 1, alignItems: 'center', justifyContent: 'space-between', gap: 12 } }, h('span', null, 'Speed'),
            h('select', {
              'aria-label': 'Speed', value: visible?.mode ?? 'standard',
              disabled: locked || busy || !visible || state.status === 'selecting',
              title: visible?.warning ?? visible?.note ?? 'Checking supported speeds…',
              onChange: event => void select(event.target.value),
              onKeyDown: event => { if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) event.stopPropagation(); },
              style: { background: 'var(--dsw-specific-menu)', color: 'inherit', border: '1px solid var(--dsw-alias-border-l1)', borderRadius: 6, padding: '2px 4px', font: 'inherit' },
            }, (visible ? [...new Set([...visible.modes, visible.mode])] : ['standard']).map(mode =>
              h('option', { key: mode, value: mode, disabled: visible && !visible.modes.includes(mode) }, labels[mode] + (visible && !visible.modes.includes(mode) ? ' (unavailable)' : ''))))),
          error ? h('span', { role: 'alert', title: error }, error) : null,
          visible?.warning ? h('span', { role: 'alert' }, visible.warning) : null,
          h('button', { type: 'button', onClick: () => setRefresh(x => x + 1), disabled: locked || busy,
            'aria-label': 'Refresh speed options', title: 'Refresh speed options',
            style: { color: 'inherit', background: 'none', border: 0, cursor: 'pointer', padding: 2 } }, '↻'));
      };
    }
    return {
      inject: ['slots', 'modelDirectories'],
      apply(ctx) {
        const Picker = createPicker((...args) => window.fetch(...args));
        ctx.slots.inject('conversation.input.model.controls', () => ctx.slots.register({
          name: 'conversation.input.model.controls', id: 'dsh-speed',
          inject: sessionId => ({ sessionId, directory: ctx.modelDirectories.directoryFor(sessionId).store }),
        }, Picker));
      },
      createPicker,
    };
  },
});
