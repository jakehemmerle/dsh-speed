import { readFile, mkdir, writeFile, rename } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
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
    } catch (e) { if (e.code !== 'ENOENT') throw e; }
  }
  let queue = Promise.resolve();
  return {
    get(s) { return entries.get(preferenceKey(s.sessionId, s.provider, s.model))?.mode; },
    set(s) {
      if (!validSelection(s)) return Promise.reject(new Error('Invalid speed selection'));
      const commit = queue.then(async () => {
        const next = new Map(entries);
        next.set(preferenceKey(s.sessionId, s.provider, s.model), { ...s });
        if (next.size > 10_000) next.delete(next.keys().next().value);
        if (file) {
          await mkdir(dirname(file), { recursive: true });
          const temp = file + '.' + randomUUID() + '.tmp';
          await writeFile(temp, JSON.stringify([...next.values()]) + '\n', { mode: 0o600 });
          await rename(temp, file);
        }
        entries = next;
      });
      queue = commit.catch(() => {});
      return commit;
    },
  };
}
