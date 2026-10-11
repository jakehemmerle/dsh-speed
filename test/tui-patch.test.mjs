import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const types = process.env.DSH_TUI_TYPES;
assert.ok(types, 'Set DSH_TUI_TYPES to the patched dsh-tui lib/types directory');
const source = name => readFile(join(types, name), 'utf8');
test('TUI reads the plugin speed for the live session and renders it on both footers', async () => {
  assert.match(await source('dsh-adapter/plugin.js'), /speedControl: ctx.get\('dshSpeed'\)/);
  const chat = await source('screens/Chat.js');
  assert.match(chat, /speedControl\?\.getMode\(\{ sessionId: channel.sessionId, provider: channel.provider, model: channel.model \}\)/);
  assert.match(chat, /speedLabel: speedLabel/);
  assert.match(await source('screens/Launchpad.js'), /segment: 'speed', value: speedLabel/);
  assert.match(await source('screens/StatusLine.js'), /key: 'speed'.*children: speedLabel/);
});
test('the speed dialog stays over the first screen and clears its command draft', async () => {
  const chat = await source('screens/Chat.js');
  assert.match(chat, /'permission', 'kernel', 'speed'/);
  assert.match(chat, /launchpadShown && \(LAUNCHPAD_OVERLAY_KINDS.has\(overlay.kind\) \|\| dialogSnapshot !== null\)/);
  assert.match(chat, /parsed.name === 'speed'[\s\S]{0,200}setLaunchpadDraft\(''\)/);
});
