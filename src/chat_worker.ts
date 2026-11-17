import { randomUUID } from 'node:crypto';
import { Store } from './store';
import { Chats } from './chat';
import { config } from './config';
const args = Bun.argv.slice(2), at = args.indexOf('--state-dir');
const store = new Store(at >= 0 ? args[at + 1]! : config.state), chats = new Chats(store), token = randomUUID();
function stop() { chats.release(token); store.close(); process.exit(0); }
process.on('SIGTERM', stop); process.on('SIGINT', stop);
do {
  const worked = await chats.work(token);
  if (args.includes('--once')) break;
  if (!worked) await Bun.sleep(500);
} while (true);
store.close();
