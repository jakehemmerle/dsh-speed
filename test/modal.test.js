import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { patchModelModal } from '../scripts/patch-model-modal.mjs';
const bundle = process.env.DSH_MODEL_BUNDLE;
assert.ok(bundle, "Set DSH_MODEL_BUNDLE to the pinned unpatched host bundle");
test('pinned modal patch declares a session child and mounts it only in the Model/Effort root', async () => {
  const source = await readFile(bundle, 'utf8');
  const patched = source.includes('conversation.input.model.controls') ? source : patchModelModal(source);
  assert.equal((patched.match(/renderSlot\("conversation.input.model.controls"/g) ?? []).length, 1);
  assert.ok(patched.includes('children: { "conversation.input.model.controls": { kind: "single", scope: "session" } }'));
  assert.ok(patched.indexOf('renderSlot("conversation.input.model.controls"') > patched.indexOf('children: t("menu.effort")'));
  assert.ok(patched.indexOf('renderSlot("conversation.input.model.controls"') < patched.indexOf('pane === "model" && (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment'));
  assert.ok(patched.includes('renderSlot("conversation.input.model.controls", { locked: busy })'));
  assert.ok(patched.includes('const onBlur = (event) => { if (event.relatedTarget === null) return;'));
  assert.throws(() => patchModelModal(patched), /already|drift/);
});
test('pinned modal patch rejects upstream drift instead of silently shipping no Speed', async () => {
  const source = await readFile(bundle, 'utf8');
  for (const old of ['function ModelSelect(', 'locale: NS,', '})] }),']) assert.throws(() => patchModelModal(source.replaceAll(old, 'changed')), /drift/);
});
