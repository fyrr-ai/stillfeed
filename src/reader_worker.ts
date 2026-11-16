import {Store} from './store';
import {Reader} from './reader';
import {Summaries,generateSummaries} from './summary';
import {Preparation,prepareBatch} from './preparation';
import {join,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
const args=Bun.argv.slice(2),option=(key:string,fallback:string)=>args.includes(key)?args[args.indexOf(key)+1]!:fallback;
const state=option('--state-dir',join(process.env.HOME!,'.local/share/rmt-radar/state'));
const app=resolve(import.meta.dir,'..'),python=process.env.RADAR_PYTHON||join(process.env.HOME!,'.local/share/rmt-radar/venv/bin/python');
const store=new Store(state),reader=new Reader(store,{python,app}),summaries=new Summaries(store),queue=new Preparation(store);
const generate=generateSummaries(app,python);
const token=randomUUID();let lastScan=0;
function stop(){queue.release(token);store.close();process.exit(0);}
process.on('SIGTERM',stop);process.on('SIGINT',stop);
do{
 if(Date.now()-lastScan>60000){queue.enqueueCurrent();if(Date.now()-Number(store.meta('retentionCleanedAt')||0)>86400000){const removed=store.prune();store.setMeta('retentionCleanedAt',String(Date.now()));if(removed)console.log('Expired articles removed:',removed);}lastScan=Date.now();}
 const count=await prepareBatch(queue,reader,summaries,generate,token);
 if(args.includes('--once')){console.log(JSON.stringify(queue.stats()));break;}
 if(!count)await Bun.sleep(1000);
}while(true);
store.close();
