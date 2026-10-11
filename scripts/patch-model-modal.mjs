import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Script } from 'node:vm';

// Pinned dsh 0.2.1-alpha.2 does not expose a child seat inside ModelSelect.
// This build-time patch adds a declared seam, not DOM mutation or a shadow
// selector. Each anchor must match exactly once; upstream drift fails the build.
export function patchModelModal(source) {
  if (source.includes('conversation.input.model.controls')) throw new Error('Model modal already patched or upstream drift');
  function replaceOnce(pattern, replacement) {
    const matches = [...source.matchAll(new RegExp(pattern.source, 'g'))];
    if (matches.length !== 1) throw new Error('Model modal patch drift: expected one ' + pattern.source);
    source = source.replace(pattern, replacement);
  }
  replaceOnce(/function ModelSelect\(\{ locked, available, directory, load, select, t \}\)/,
    'function ModelSelect({ locked, available, directory, load, select, t, renderSlot })');
  // Native select popups and asynchronous model refresh can blur the trigger
  // to no DOM node. Outside clicks already have a document-level handler.
  replaceOnce(/const onBlur = \(event\) => \{/,
    'const onBlur = (event) => { if (event.relatedTarget === null) return;');
  replaceOnce(/(name: "conversation.input.model",\s*locale: NS,)/,
    '$1\n\t\t\t\t\tchildren: { "conversation.input.model.controls": { kind: "single", scope: "session" } },');
  replaceOnce(/\}\)\] \}\),([\s]*pane === "model" && \(0, react_jsx_runtime.jsxs\)\(react_jsx_runtime.Fragment)/,
    '}), renderSlot("conversation.input.model.controls", { locked: busy })] }),$1');
  new Script(source, { filename: 'patched-model-selection.client.js' });
  return source;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const file = process.argv[2];
  if (!file) throw new Error('Usage: node patch-model-modal.mjs /path/to/ui-model-selection/lib/client.js [--check]');
  const patched = patchModelModal(await readFile(file, 'utf8'));
  if (!process.argv.includes('--check')) {
    const types = join(dirname(file), 'types/client/slots.d.ts');
    const declaration = await readFile(types, 'utf8');
    if (declaration.includes('conversation.input.model.controls')) throw new Error('Model control types already patched');
    const component = join(dirname(file), 'types/client/ModelSelect.d.ts');
    const componentSource = await readFile(component, 'utf8');
    if (!componentSource.includes('ModelSelectInjected &')) throw new Error('ModelSelect types drift');
    await writeFile(file, patched);
    await writeFile(types, declaration + '\n/** Root-menu extension owned by ui-model-selection. */\ndeclare module "@deepseek-ai/dsh-client-ui-slots" {\n  interface SlotMap {\n    "conversation.input.model.controls": { kind: "single"; scope: "session"; owner: { locked: boolean } };\n  }\n}\n');
    await writeFile(component, 'import type { PropsRenderSlots } from "@deepseek-ai/dsh-client-ui-slots";\n' + componentSource.replace('ModelSelectInjected &', 'ModelSelectInjected & PropsRenderSlots<"conversation.input.model.controls"> &'));
  }
  console.log('Checked pinned Model/Effort child control patch' + (process.argv.includes('--check') ? '' : ': applied'));
}
