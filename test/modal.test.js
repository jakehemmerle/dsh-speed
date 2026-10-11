import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { patchModelModal } from '../scripts/patch-model-modal.mjs';
// P-31 / P-32. DSH_MODEL_BUNDLE must be the pinned UNPATCHED host bundle: patching an
// already-patched bundle would make these tests vacuous, so that is a hard failure.
const bundle = process.env.DSH_MODEL_BUNDLE;
assert.ok(bundle, 'Set DSH_MODEL_BUNDLE to the pinned unpatched host bundle (nix develop sets it)');
const source = await readFile(bundle, 'utf8');

test('P-32 DSH_MODEL_BUNDLE is the unpatched upstream bundle (otherwise these checks are vacuous)', () => {
  assert.equal(source.includes('conversation.input.model.controls'), false,
    DSH_MODEL_BUNDLE_HELP());
});

test('P-31 pinned modal patch declares a session child and mounts it only in the Model/Effort root', () => {
  const patched = patchModelModal(source);
  assert.equal((patched.match(/renderSlot\("conversation.input.model.controls"/g) ?? []).length, 1);
  assert.ok(patched.includes('children: { "conversation.input.model.controls": { kind: "single", scope: "session" } }'));
  assert.ok(patched.indexOf('renderSlot("conversation.input.model.controls"') > patched.indexOf('children: t("menu.effort")'));
  assert.ok(patched.indexOf('renderSlot("conversation.input.model.controls"') < patched.indexOf('pane === "model" && (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment'));
  assert.ok(patched.includes('renderSlot("conversation.input.model.controls", { locked: busy })'));
  assert.ok(patched.includes('const onBlur = (event) => { if (event.relatedTarget === null) return;'));
  assert.throws(() => patchModelModal(patched), /already|drift/);
});

test('P-32 pinned modal patch rejects upstream drift instead of silently shipping no Speed', () => {
  for (const old of ['function ModelSelect(', 'locale: NS,', '})] }),', 'const onBlur = (event) => {']) {
    assert.throws(() => patchModelModal(source.replaceAll(old, 'changed')), /drift/, old);
  }
  // A duplicated anchor is drift too: each anchor must match exactly once.
  assert.throws(() => patchModelModal(source + '\n' + 'function ModelSelect({ locked, available, directory, load, select, t })'), /drift/);
});

test('P-31 the installed (patched) bundle is exactly the patch applied to the pinned upstream bundle', async t => {
  const installed = process.env.DSH_PATCHED_MODEL_BUNDLE;
  if (!installed) {
    // Allowed only outside the flake; the flake check and dev shell always set it.
    if (process.env.DSH_REQUIRE_ALL === '1') assert.fail('DSH_PATCHED_MODEL_BUNDLE is required');
    t.skip('DSH_PATCHED_MODEL_BUNDLE not set');
    return;
  }
  assert.equal(await readFile(installed, 'utf8'), patchModelModal(source));
});

function DSH_MODEL_BUNDLE_HELP() {
  return 'DSH_MODEL_BUNDLE points at an already-patched bundle; use the unpatched dshBase bundle';
}
