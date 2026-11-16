import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

/** Everything Stillfeed stores lives under STILLFEED_HOME (default ~/.local/share/stillfeed); each path can be overridden. */
export const app = resolve(import.meta.dir, '..');
const home = process.env.STILLFEED_HOME || join(process.env.XDG_DATA_HOME || join(process.env.HOME || '.', '.local/share'), 'stillfeed');

/** KEY=value lines from STILLFEED_HOME/.env and ./.env; real environment variables always win. */
export function loadEnv(files = [join(home, '.env'), join(process.cwd(), '.env')]) {
  for (const file of files) {
    if (!existsSync(file)) continue;
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
      if (!match || line.trimStart().startsWith('#')) continue;
      const value = match[2]!.replace(/^(['"])(.*)\1$/, '$2');
      if (process.env[match[1]!] === undefined) process.env[match[1]!] = value;
    }
  }
}
loadEnv();

const env = (key: string, fallback: string) => process.env[key] || fallback;
export const config = {
  home,
  state: env('STILLFEED_STATE_DIR', join(home, 'state')),
  hostname: env('STILLFEED_HOSTNAME', '127.0.0.1'),
  port: Number(env('STILLFEED_PORT', '3200')),
  /** Plain-language description of what the reader cares about; Hot, suggestions and triage read it. */
  interests: env('STILLFEED_INTERESTS', join(home, 'interests.md')),
  /** Extra feeds (OPML) and X accounts (one handle per line) the user adds on top of the defaults. */
  feeds: env('STILLFEED_FEEDS', join(home, 'feeds.opml')),
  xAccounts: env('STILLFEED_X_ACCOUNTS', join(home, 'x-accounts.txt')),
  /** Language of AI summaries, Hot reasons and suggestion reasons, e.g. "English", "Czech", "German". */
  language: env('STILLFEED_LANGUAGE', 'English'),
};
