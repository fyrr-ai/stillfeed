import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

/** Everything Radar stores lives under RADAR_HOME (default ~/.local/share/radar); each path can be overridden. */
export const app = resolve(import.meta.dir, '..');
const home = process.env.RADAR_HOME || join(process.env.XDG_DATA_HOME || join(process.env.HOME || '.', '.local/share'), 'radar');

/** KEY=value lines from RADAR_HOME/.env and ./.env; real environment variables always win. */
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
  state: env('RADAR_STATE_DIR', join(home, 'state')),
  data: env('RADAR_DATA_DIR', join(home, 'data')),
  python: env('RADAR_PYTHON', join(home, 'venv/bin/python')),
  hostname: env('RADAR_HOSTNAME', '127.0.0.1'),
  port: Number(env('RADAR_PORT', '3200')),
  /** Plain-language description of what the reader cares about; Hot, suggestions and triage read it. */
  interests: env('RADAR_INTERESTS', join(home, 'interests.md')),
  /** Extra feeds (OPML) and X accounts (one handle per line) the user adds on top of the defaults. */
  feeds: env('RADAR_FEEDS', join(home, 'feeds.opml')),
  xAccounts: env('RADAR_X_ACCOUNTS', join(home, 'x-accounts.txt')),
  /** Language of AI summaries, Hot reasons and suggestion reasons, e.g. "English", "Czech", "German". */
  language: env('RADAR_LANGUAGE', 'English'),
};
