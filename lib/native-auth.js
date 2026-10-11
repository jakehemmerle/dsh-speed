import { readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

// Codex owns persistence and refresh-token rotation. Never import a refresh
// token into DSH's credential store or refresh it with another OAuth client.
export async function refreshWithCodex(command, file) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('CODEX_')));
  env.CODEX_HOME = dirname(file);
  const child = spawn(command, ['--no-daemon', '--disable', 'apps', '--disable', 'plugins', 'app-server', '--listen', 'stdio://'],
    { env, stdio: ['pipe', 'pipe', 'ignore'] });
  const lines = createInterface({ input: child.stdout });
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Codex refresh timed out')), 30_000);
      const finish = error => { clearTimeout(timer); error ? reject(error) : resolve(); };
      child.once('error', () => finish(new Error('Could not start Codex for auth refresh')));
      child.once('exit', () => finish(new Error('Codex exited before auth refresh completed')));
      lines.on('line', line => {
        let value; try { value = JSON.parse(line); } catch { return; }
        if (value.id === 1) {
          if (value.error) return finish(new Error('Codex auth initialization failed'));
          child.stdin.write(JSON.stringify({ method: 'initialized', params: {} }) + '\n');
          child.stdin.write(JSON.stringify({ id: 2, method: 'account/read', params: { refreshToken: true } }) + '\n');
        } else if (value.id === 2) {
          finish(value.error || value.result?.account?.type !== 'chatgpt' ? new Error('Codex sign-in needs attention') : undefined);
        }
      });
      child.stdin.on('error', () => finish(new Error('Codex auth connection closed')));
      child.stdin.write(JSON.stringify({ id: 1, method: 'initialize', params: {
        clientInfo: { name: 'dsh_speed', title: 'DSH local Codex authentication', version: '0.2.0' },
      } }) + '\n');
    });
  } finally { lines.close(); child.stdin.end(); child.kill(); }
}

export function createNativeAuth({ file, command, now = Date.now, refresh = refreshWithCodex }) {
  let refreshing;
  async function read() {
    let doc, claims;
    try {
      doc = JSON.parse(await readFile(file, 'utf8'));
      claims = JSON.parse(Buffer.from(doc.tokens.access_token.split('.')[1], 'base64url').toString());
    } catch { throw new Error('Codex sign-in missing or unreadable; sign in with the local Codex CLI'); }
    const accountId = doc.tokens?.account_id;
    if (doc.auth_mode !== 'chatgpt' || typeof accountId !== 'string' || !accountId ||
        claims['https://api.openai.com/auth']?.chatgpt_account_id !== accountId || !Number.isFinite(claims.exp)) {
      throw new Error('Codex sign-in is invalid or has an account mismatch');
    }
    return { kind: 'grant', payload: { type: 'oauth', access: doc.tokens.access_token, accountId, expires: claims.exp * 1000 } };
  }
  return async function readNativeAuth() {
    let record = await read();
    if (record.payload.expires <= now() + 300_000) {
      if (!command) throw new Error('Codex sign-in expired; refresh it with the local Codex CLI');
      // A shared in-flight refresh prevents this process racing its own requests.
      // Cross-process locking and persistence remain owned by Codex.
      refreshing ??= refresh(command, file).finally(() => { refreshing = undefined; });
      try { await refreshing; } catch { throw new Error('Codex could not refresh its sign-in; sign in with the local Codex CLI'); }
      record = await read();
      if (record.payload.expires <= now() + 300_000) throw new Error('Codex sign-in remains expired after refresh');
    }
    return record;
  };
}
