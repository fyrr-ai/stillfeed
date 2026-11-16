import {Store} from './store';
import {Reader} from './reader';
import {Summaries,generateSummaries} from './summary';
import {Preparation,prepareBatch} from './preparation';
import {config} from './config';
import {randomUUID} from 'node:crypto';
import {SavedTopics,groupSavedTopics} from './saved-topics';
import {describe} from './llm';
const args=Bun.argv.slice(2),option=(key:string,fallback:string)=>args.includes(key)?args[args.indexOf(key)+1]!:fallback;
const state=option('--state-dir',config.state);
const store=new Store(state),reader=new Reader(store),summaries=new Summaries(store),queue=new Preparation(store);
const savedTopics=new SavedTopics(store);
const token=randomUUID();let lastScan=0;
function stop(){queue.release(token);savedTopics.release(token);store.close();process.exit(0);}
process.on('SIGTERM',stop);process.on('SIGINT',stop);
do{
 if(Date.now()-lastScan>60000){queue.enqueueCurrent();if(Date.now()-Number(store.meta('retentionCleanedAt')||0)>86400000){const removed=store.prune();store.setMeta('retentionCleanedAt',String(Date.now()));if(removed)console.log('Expired articles removed:',removed);}lastScan=Date.now();}
 const grouped=describe()?await savedTopics.refresh(groupSavedTopics,token):0;
 const count=await prepareBatch(queue,reader,summaries,generateSummaries,token);
 if(args.includes('--once')){console.log(JSON.stringify(queue.stats()));break;}
 if(!count&&!grouped)await Bun.sleep(1000);
}while(true);
store.close();
