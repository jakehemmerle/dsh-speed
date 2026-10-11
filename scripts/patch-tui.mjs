import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export function patchTui(files) {
  const output = { ...files };
  function replace(file, before, after) {
    if (output[file].split(before).length !== 2) throw new Error('dsh-speed TUI patch drift: ' + file + ' / ' + before.slice(0, 70));
    output[file] = output[file].replace(before, after);
  }
  replace('dsh-adapter/plugin.js', "extensionStatus: getHostStatusStore(ctx.get('tuiStatus')),",
    "extensionStatus: getHostStatusStore(ctx.get('tuiStatus')),\n        speedControl: ctx.get('dshSpeed'),");
  replace('screens/Chat.js', 'bonusNotices, extensionStatus, activityStore,', 'bonusNotices, extensionStatus, speedControl, activityStore,');
  replace('screens/Chat.js', 'useExternalVersion(channel.subscribe, () => channel.version);', `useExternalVersion(channel.subscribe, () => channel.version);
    // dsh-speed: the footer reads the same per-session preference as inference.
    const subscribeSpeed = React.useCallback(listener => speedControl?.subscribe(listener) ?? (() => {}), [speedControl]);
    const speedMode = React.useSyncExternalStore(subscribeSpeed, () => speedControl?.getMode({ sessionId: channel.sessionId, provider: channel.provider, model: channel.model }));
    const speedLabel = speedMode === undefined ? undefined : 'Speed: ' + ({ standard: 'Standard', fast: '⚡', ultrafast: '⚡⚡' })[speedMode];`);
  replace('screens/Chat.js', 'launchpadShown && LAUNCHPAD_OVERLAY_KINDS.has(overlay.kind)',
    'launchpadShown && (LAUNCHPAD_OVERLAY_KINDS.has(overlay.kind) || dialogSnapshot !== null)');
  replace('screens/Chat.js', "'permission', 'kernel']),", "'permission', 'kernel', 'speed']),");
  replace('screens/Chat.js', "const parsed = text.startsWith('/') ? parseCommandName(text) : undefined;", `const parsed = text.startsWith('/') ? parseCommandName(text) : undefined;
        if (parsed?.name === 'speed' && launchpadOpen) {
            setLaunchpadOpen(true);
            void runCommand(parsed.name, parsed.rawInput);
            return;
        }`);
  replace('screens/Chat.js', 'overlayPanel: launchpadOverlayUp ? pickerPanels : undefined,', `overlayPanel: launchpadOverlayUp ? (dialogSnapshot === null ? pickerPanels : _jsx(ExtensionDialog, { dialog: dialogSnapshot, onDecide: value => dialogs.decide(dialogSnapshot.key, value), onCancel: () => dialogs.cancel(dialogSnapshot.key) }, dialogSnapshot.key)) : undefined,`);
  replace('screens/Chat.js', '}, model: channel.modelDisplay ?? channel.model, effort:', '}, speedLabel: speedLabel, model: channel.modelDisplay ?? channel.model, effort:');
  replace('screens/Chat.js', "const parsed = parseCommandName(commandLine);\n                if (parsed === undefined)\n                    return;", `const parsed = parseCommandName(commandLine);
                if (parsed === undefined)
                    return;
                if (parsed.name === 'speed') {
                    setLaunchpadDraft('');
                    setLaunchpadCaret(0);
                }`);
  replace('screens/Chat.js', '_jsx(StatusLine, { channel: channel, activity:', '_jsx(StatusLine, { channel: channel, speedLabel: speedLabel, activity:');
  replace('screens/Launchpad.js', "['model', 'effort', 'preset', 'permission']", "['model', 'effort', 'speed', 'preset', 'permission']");
  replace('screens/Launchpad.js', 'onParamPick, model, effort, preset,', 'onParamPick, model, effort, speedLabel, preset,');
  replace('screens/Launchpad.js', "        if (preset !== undefined && preset !== '') {", `        if (speedLabel !== undefined)
            parts.push({ segment: 'speed', value: speedLabel });
        if (preset !== undefined && preset !== '') {`);
  replace('screens/StatusLine.js', 'helpOpen = false, backendMode, modelPicker,', 'helpOpen = false, speedLabel, backendMode, modelPicker,');
  replace('screens/StatusLine.js', '        ...(tpsPart !== undefined ? [tpsPart] : []),', `        ...(speedLabel === undefined ? [] : [{ key: 'speed', node: _jsx(Text, { color: "remember", children: speedLabel }) }]),
        ...(tpsPart !== undefined ? [tpsPart] : []),`);
  return output;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = process.argv[2];
  if (!root) throw new Error('Usage: patch-tui.mjs <dsh-tui/lib/types>');
  const names = ['dsh-adapter/plugin.js', 'screens/Chat.js', 'screens/Launchpad.js', 'screens/StatusLine.js'];
  const files = Object.fromEntries(await Promise.all(names.map(async name => [name, await readFile(join(root, name), 'utf8')])));
  const patched = patchTui(files);
  for (const name of names) await writeFile(join(root, name), patched[name]);
}
