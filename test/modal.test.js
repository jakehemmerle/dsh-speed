import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { patchModelModal } from '../scripts/patch-model-modal.mjs';
const bundle = process.env.DSH_MODEL_BUNDLE ?? '/nix/store/cxpaa1drx4spbbdhsaa9inrsiww4y8h0-dsh-0.2.1-alpha.2/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-ui-model-selection/lib/client.js';
test('pinned modal patch declares a session child and mounts it only in the Model/Effort root', async () => {
  const source = await readFile(bundle, 'utf8'); const patched = patchModelModal(source);
  assert.equal((patched.match(/renderSlot\("conversation.input.model.controls"/g) ?? []).length, 1);
  assert.ok(patched.includes('children: { "conversation.input.model.controls": { kind: "single", scope: "session" } }'));
  assert.ok(patched.indexOf('renderSlot("conversation.input.model.controls"') > patched.indexOf('children: t("menu.effort")'));
  assert.ok(patched.indexOf('renderSlot("conversation.input.model.controls"') < patched.indexOf('pane === "model" && (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment'));
  assert.ok(patched.includes('renderSlot("conversation.input.model.controls", { locked: busy })'));
  assert.throws(() => patchModelModal(patched), /already|drift/);
});
test('pinned modal patch rejects upstream drift instead of silently shipping no Speed', async () => {
  const source = await readFile(bundle, 'utf8');
  for (const old of ['function ModelSelect(', 'locale: NS,', '})] }),']) assert.throws(() => patchModelModal(source.replaceAll(old, 'changed')), /drift/);
});
