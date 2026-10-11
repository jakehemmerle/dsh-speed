// Checks the dsh-omp-keys patch against a built dsh-tui package.
// DSH_TUI_TYPES must point at <dsh-tui>/lib/types; pkgs/dsh-tui.nix runs this
// as its install check, so a dsh-TUI bump that breaks the patch fails the build.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const types = process.env.DSH_TUI_TYPES;
assert.ok(types, 'set DSH_TUI_TYPES to <dsh-tui>/lib/types');
const load = (file) => import(pathToFileURL(join(types, file)).href);
const source = (file) => readFile(join(types, file), 'utf8');

const { nextEffort, cycleEffort } = await load('effortCycle.js');

test('nextEffort walks the ladder and wraps', () => {
  const ladder = ['low', 'medium', 'high', 'max'];
  assert.equal(nextEffort(ladder, 'low'), 'medium');
  assert.equal(nextEffort(ladder, 'high'), 'max');
  assert.equal(nextEffort(ladder, 'max'), 'low');
  assert.equal(nextEffort(ladder, undefined), 'low');
  assert.equal(nextEffort(ladder, 'not-offered'), 'low');
  assert.equal(nextEffort(['only'], 'only'), undefined);
  assert.equal(nextEffort([], undefined), undefined);
});

function fakeChannel({ efforts, current, defaultEffort, setResult = true, listDelay = 0 } = {}) {
  const calls = { set: [], notes: [] };
  return {
    calls,
    reasoningEffort: current,
    async listEfforts() {
      if (listDelay) await new Promise(resolve => setTimeout(resolve, listDelay));
      return { efforts, defaultEffort };
    },
    async setEffort(id) { calls.set.push(id); return setResult; },
    notify(text, options) { calls.notes.push({ text, color: options?.color }); },
  };
}

const ladder = [
  { id: 'low', name: 'Low' }, { id: 'medium', name: 'Medium' },
  { id: 'high', name: 'High' }, { id: 'max', name: 'Max' },
];

test('cycleEffort sets the next level through setEffort and toasts its name', async () => {
  const channel = fakeChannel({ efforts: ladder, current: 'medium' });
  await cycleEffort(channel);
  assert.deepEqual(channel.calls.set, ['high']);
  assert.deepEqual(channel.calls.notes, [{ text: 'Effort: High', color: undefined }]);
});

test('cycleEffort starts from the route default when no level is live', async () => {
  const channel = fakeChannel({ efforts: ladder, current: undefined, defaultEffort: 'high' });
  await cycleEffort(channel);
  assert.deepEqual(channel.calls.set, ['max']);
});

test('cycleEffort does nothing on a route without effort levels', async () => {
  const channel = fakeChannel({ efforts: [] });
  await cycleEffort(channel);
  assert.deepEqual(channel.calls.set, []);
  assert.deepEqual(channel.calls.notes, []);
});

test('a refused setEffort shows no success toast', async () => {
  const channel = fakeChannel({ efforts: ladder, current: 'low', setResult: false });
  await cycleEffort(channel);
  assert.deepEqual(channel.calls.set, ['medium']);
  assert.deepEqual(channel.calls.notes, []);
});

test('presses while a step is pending are dropped, not raced', async () => {
  const channel = fakeChannel({ efforts: ladder, current: 'low', listDelay: 20 });
  await Promise.all([cycleEffort(channel), cycleEffort(channel), cycleEffort(channel)]);
  assert.deepEqual(channel.calls.set, ['medium']);
  await cycleEffort(channel); // the guard releases afterwards
  assert.equal(channel.calls.set.length, 2);
});

test('a failing route is reported, not thrown', async () => {
  const channel = fakeChannel({ efforts: ladder });
  channel.listEfforts = async () => { throw new Error('route gone'); };
  await cycleEffort(channel);
  assert.equal(channel.calls.notes[0].color, 'error');
  assert.match(channel.calls.notes[0].text, /route gone/);
});

test('/permissions is a DSH local command', async () => {
  const commands = await load('commands.js');
  assert.ok(commands.LOCAL_COMMANDS.some(command => command.name === 'permissions'));
  assert.equal(commands.localCommandRequirement('permissions'), 'dsh');
});

test('the key handlers are wired in the chat prompt, first screen and command router', async () => {
  const prompt = await source('components/PromptInput.js');
  assert.match(prompt, /if \(key\.tab && key\.shift\) \{[\s\S]{0,400}void cycleEffort\(channel\);/);
  assert.doesNotMatch(prompt, /channel\.cycleMode\(\)/, 'Shift+Tab must no longer cycle permission modes');
  assert.match(prompt, /input === 'p'\) \{\s+event\.stopImmediatePropagation\(\);\s+onRunCommand\?\.\('model'\);/);

  const launchpad = await source('screens/Launchpad.js');
  assert.match(launchpad, /onBlankClick, onCycleEffort, \}\)/);
  assert.match(launchpad, /key\.tab && key\.shift && onCycleEffort !== undefined\) \{\s+onCycleEffort\(\);/);
  assert.match(launchpad, /input === 'p' && onParamPick !== undefined\) \{\s+onParamPick\('model'\);/);

  const chat = await source('screens/Chat.js');
  assert.match(chat, /onCycleEffort: \(\) => \{ void cycleEffort\(channel\); \}/);
  assert.match(chat, /case 'permissions':\s+return runCommand\('permission', rawInput, images\);/);

  const glyph = await source('components/EffortChargeGlyph.js');
  assert.match(glyph, /const tierIndex = /);
});
