import {randomUUID} from 'node:crypto';
import {Store} from './store';
import {Personal,modelRater} from './personal';
import {readInterests} from './interests';
import {config} from './config';
import {describe} from './llm';

const args=Bun.argv.slice(2),at=args.indexOf('--state-dir');
const store=new Store(at>=0?args[at+1]!:config.state),personal=new Personal(store),token=randomUUID(),controller=new AbortController();
let stopping=false;
const stop=()=>{stopping=true;controller.abort();};
process.on('SIGTERM',stop);process.on('SIGINT',stop);
do {
  personal.configure(await readInterests(config.interests,store));
  const count=describe()?await personal.work(modelRater,token,controller.signal):0;
  if(args.includes('--once')){console.log(JSON.stringify(personal.status()));break;}
  if(!count&&!stopping)await Bun.sleep(1000);
}while(!stopping);
personal.release(token);store.close();
