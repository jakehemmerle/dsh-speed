import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const types = process.env.DSH_TUI_TYPES;
assert.ok(types, 'Set DSH_TUI_TYPES to the patched dsh-tui lib/types directory');
const filter = await import(pathToFileURL(join(types, 'dsh-adapter/schedule-deny-filter.js')).href);
const { SCHEDULE_TOOLS, presetForComposition, scheduleServiceMounted, withoutScheduleDenies } = filter;

const jsExpr = { __jsExpr: "process.platform === 'win32'" };
// The shape of dsh-web-app 0.2.1-alpha.2's standard preset rows that matter here.
const standard = () => ({
  id: 'standard',
  name: 'Standard',
  plugins: [
    { id: 'tool-bash', name: '@deepseek-ai/dsh-tool-bash', disabled: jsExpr },
    { id: 'tool-schedule', name: '@deepseek-ai/dsh-tool-schedule' },
    {
      id: 'delegation',
      name: 'cordis:group',
      group: true,
      isolate: { workflowEngine: true },
      config: [
        { id: 'tool-subagent-control', name: '@deepseek-ai/dsh-tool-subagent-control' },
        {
          id: 'tool-subagent',
          name: '@deepseek-ai/dsh-tool-subagent',
          config: { provider: 'spawn', toolName: 'subagent', modelSelectionSettings: true, toolFilter: { deny: [...SCHEDULE_TOOLS] } },
        },
        {
          id: 'tool-subagent-fork',
          name: '@deepseek-ai/dsh-tool-subagent',
          config: { provider: 'fork', toolName: 'subagent_fork', toolFilter: { deny: [...SCHEDULE_TOOLS] } },
        },
      ],
    },
  ],
});
const delegation = preset => preset.plugins.find(row => row.id === 'delegation').config;
const row = (preset, id) => delegation(preset).find(r => r.id === id);
const loader = entries => ({ entries: () => entries });

test('without the schedule service, subagent rows lose the schedule deny and the emptied filter', () => {
  const preset = presetForComposition(standard(), false);
  assert.deepEqual(row(preset, 'tool-subagent').config, { provider: 'spawn', toolName: 'subagent', modelSelectionSettings: true });
  assert.deepEqual(row(preset, 'tool-subagent-fork').config, { provider: 'fork', toolName: 'subagent_fork' });
  assert.equal(preset.plugins[0].disabled, jsExpr, 'Loader expressions pass through untouched');
  assert.deepEqual(preset.plugins[1], { id: 'tool-schedule', name: '@deepseek-ai/dsh-tool-schedule' });
});

test('with the schedule service mounted, the declaration is registered unchanged', () => {
  const original = standard();
  assert.equal(presetForComposition(original, true), original);
  assert.deepEqual(row(original, 'tool-subagent').config.toolFilter, { deny: SCHEDULE_TOOLS });
});

test('other deny names and allow lists survive, so real mistakes still fail loudly', () => {
  const [out] = withoutScheduleDenies([
    { id: 'tool-subagent', name: '@deepseek-ai/dsh-tool-subagent', config: { toolFilter: { allow: ['bash', 'read'], deny: ['schedule_list', 'bsah'] } } },
  ]);
  assert.deepEqual(out.config.toolFilter, { allow: ['bash', 'read'], deny: ['bsah'] });
  const [allowOnly] = withoutScheduleDenies([{ id: 'x', config: { toolFilter: { allow: ['bash'], deny: ['schedule_create'] } } }]);
  assert.deepEqual(allowOnly.config.toolFilter, { allow: ['bash'] });
});

test('rows without a schedule deny keep their identity', () => {
  const rows = [{ id: 'a', config: { toolFilter: { deny: ['bash'] } } }, { id: 'b', config: jsExpr }, { id: 'c' }];
  const out = withoutScheduleDenies(rows);
  out.forEach((r, i) => assert.equal(r, rows[i]));
});

test('the schedule service counts only as an enabled @deepseek-ai/dsh-schedule row', () => {
  const service = { options: { id: 'schedule', name: '@deepseek-ai/dsh-schedule' } };
  assert.equal(scheduleServiceMounted(loader([service])), true);
  assert.equal(scheduleServiceMounted(loader([{ ...service, disabled: true }])), false);
  assert.equal(scheduleServiceMounted(loader([{ options: { name: '@deepseek-ai/dsh-tool-schedule' } }])), false);
  assert.equal(scheduleServiceMounted(undefined), false);
});

test('bundled presets pass through the filter before registration', async () => {
  const source = await readFile(join(types, 'dsh-adapter/bundled-presets.js'), 'utf8');
  assert.match(source, /const scheduleMounted = scheduleServiceMounted\(loader\);/);
  assert.match(source, /register\(presetForComposition\(readPresetPatch\(path\), scheduleMounted\)\)/);
});
