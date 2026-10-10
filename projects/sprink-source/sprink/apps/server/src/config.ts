import { chmodSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { isAbsolute, join, resolve } from 'node:path';

/** Keep deployment errors descriptive without echoing environment values or paths. */
export function serverConfig(env: NodeJS.ProcessEnv, defaultDataDir: string) {
  const production = env.NODE_ENV === 'production';
  const hostname = env.SPRINK_HOST ?? '127.0.0.1';
  if (!hostname.trim() || hostname !== hostname.trim() || /[\s/]/.test(hostname)) throw new Error('SPRINK_HOST must be a hostname or IP address.');
  const portValue = env.PORT ?? '4310';
  if (!/^\d+$/.test(portValue) || !Number.isInteger(Number(portValue)) || Number(portValue) < 1 || Number(portValue) > 65535) throw new Error('PORT must be an integer from 1 to 65535.');
  if (env.SPRINK_DATA_DIR !== undefined && (!env.SPRINK_DATA_DIR.trim() || !isAbsolute(env.SPRINK_DATA_DIR))) throw new Error('SPRINK_DATA_DIR must be an absolute path to persistent storage.');
  if (production && !env.SPRINK_DATA_DIR) throw new Error('Production requires SPRINK_DATA_DIR on persistent storage.');
  const dataDir = resolve(env.SPRINK_DATA_DIR ?? defaultDataDir);
  // An absent mount must not silently create a fresh, unrelated pilot database.
  if (production && (!existsSync(join(dataDir, 'field.sqlite')) || !statSync(join(dataDir, 'field.sqlite')).isFile())) throw new Error('Production storage must contain an initialized field.sqlite. Mount storage and import authorized sources before starting.');
  const remote = !['127.0.0.1', 'localhost', '::1'].includes(hostname);
  if ((production || remote) && (!env.SPRINK_TOKEN || env.SPRINK_TOKEN.trim().length < 32)) throw new Error('Production or remote binding requires SPRINK_TOKEN with at least 32 characters.');
  if (env.SPRINK_TOKEN !== undefined && (env.SPRINK_TOKEN.trim().length < 16 || env.SPRINK_TOKEN !== env.SPRINK_TOKEN.trim() || /[\r\n]/.test(env.SPRINK_TOKEN))) throw new Error('SPRINK_TOKEN must contain at least 16 characters without surrounding whitespace.');
  return { hostname, port: Number(portValue), dataDir, production };
}

export function accessToken(dataDir: string, configured?: string): string {
  if (configured !== undefined) return configured;
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const path = join(dataDir, 'access-token');
  let token: string;
  try { token = readFileSync(path, 'utf8').trim(); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    token = randomBytes(32).toString('hex');
    try { writeFileSync(path, token, { mode: 0o600, flag: 'wx' }); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      token = readFileSync(path, 'utf8').trim();
    }
  }
  if (token.length < 16 || /\s/.test(token)) throw new Error('Stored access token is invalid. Configure SPRINK_TOKEN or restore the access-token file.');
  chmodSync(path, 0o600);
  return token;
}
