import { readFileSync } from 'node:fs';
import { readFile, mkdir, writeFile, rename } from 'node:fs/promises';
import { dirname } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { MODES } from './capabilities.js';
export function preferenceKey(sessionId, provider, model) { return JSON.stringify([sessionId, provider, model]); }
export function validSelection(s) {
  return s && ['sessionId', 'provider', 'model'].every(k => typeof s[k] === 'string' && s[k].length > 0 && s[k].length <= 256)
    && MODES.includes(s.mode);
}
export async function createPreferences(file) {
  let entries = new Map();
  if (file) {
    try {
      const value = JSON.parse(await readFile(file, 'utf8'));
      if (!Array.isArray(value)) throw new Error('Invalid dsh-speed preferences');
      for (const s of value) if (validSelection(s)) entries.set(preferenceKey(s.sessionId, s.provider, s.model), s);
    } catch (e) { if (e.code !== 'ENOENT' && !(e instanceof SyntaxError)) throw e; }
  }
  let queue = Promise.resolve();
  return {
    get(s) {
      const key = preferenceKey(s.sessionId, s.provider, s.model);
      if (file) {
        try {
          const saved = JSON.parse(readFileSync(recordFile(key), 'utf8'));
          return validSelection(saved) && preferenceKey(saved.sessionId, saved.provider, saved.model) === key ? saved.mode : undefined;
        } catch (e) { if (e.code !== 'ENOENT') return undefined; }
      }
      return entries.get(key)?.mode;
    },
    set(s) {
      if (!validSelection(s)) return Promise.reject(new Error('Invalid speed selection'));
      const commit = queue.then(async () => {
        const key = preferenceKey(s.sessionId, s.provider, s.model);
        const next = new Map(entries);
        next.set(key, { ...s });
        if (next.size > 10_000) next.delete(next.keys().next().value);
        if (file) {
          const target = recordFile(key);
          await mkdir(dirname(target), { recursive: true, mode: 0o700 });
          const temp = target + '.' + randomUUID() + '.tmp';
          await writeFile(temp, JSON.stringify(s) + '\n', { mode: 0o600 });
          await rename(temp, target);
        }
        entries = next;
      });
      queue = commit.catch(() => {});
      return commit;
    },
  };
  // One atomic record per session/provider/model prevents independent web and
  // terminal processes overwriting each other's selections. Read old arrays
  // as a migration fallback, and leave the original file intact.
  function recordFile(key) { return file + '.d/' + createHash('sha256').update(key).digest('hex') + '.json'; }
}
