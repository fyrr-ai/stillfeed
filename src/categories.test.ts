import {test,expect} from 'bun:test';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {parseCategories} from './categories';
import {Store,hash,type Filters} from './store';
import {classify} from './collect';

const filters:Filters={categories:[],kind:'all',q:'',hideSeen:false,hours:72};
const records=()=>[
  {url:'https://example.com/ai',title:'Claude coding agents',ai_is_related:true,ai_relevance_reason:'matched_ai_signal'},
  {url:'https://example.com/data',title:'DuckDB query execution',ai_is_related:true,ai_relevance_reason:'data_signal'},
  {url:'https://example.com/both',title:'LLMs for data engineering',ai_is_related:true,ai_relevance_reason:'matched_ai_signal'},
  {url:'https://example.com/other',title:'Baking bread',ai_is_related:false},
].map(record=>({...record,source:'Journal',site_id:'opmlrss',published_at:new Date().toISOString()}));

test('category selections are canonical, combine choices and migrate the combined legacy scope',()=>{
  expect(parseCategories(['data','ai','data'])).toEqual(['ai','data']);
  expect(parseCategories([])).toEqual([]);
  expect(parseCategories(undefined,'ai')).toEqual(['ai','data']);
  expect(parseCategories(undefined,'all')).toEqual([]);
  for(const invalid of [['unknown'],['AI'],'ai',null])expect(()=>parseCategories(invalid)).toThrow();
});

test('AI and Data filter independently, overlap once, remain in Hot and never restrict Saved',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'stillfeed-categories-')),store=new Store(dir);
  try{
    const classified=await classify(store,records(),[],false);store.ingest(classified,new Date().toISOString());
    const titles=(categories:Filters['categories'])=>store.feed({...filters,categories}).items.map(item=>item.title).sort();
    expect(titles(['ai'])).toEqual(['Claude coding agents','LLMs for data engineering']);
    expect(titles(['data'])).toEqual(['DuckDB query execution','LLMs for data engineering']);
    expect(titles(['ai','data'])).toHaveLength(3);expect(titles([])).toHaveLength(4);
    const parent=store.feed({...filters,categories:['data']});
    store.setMeta('personalProfile','profile');
    for(const record of records())store.db.query('INSERT INTO personal_ratings VALUES(?,?,?,?,?,?)').run(hash(record.url),'profile',3,'Relevant',Date.now(),'test');
    const hot=store.feed({...filters,categories:['ai','data'],personalOnly:true,personalBatch:parent.batch});
    expect(hot.items.map(item=>item.id).sort()).toEqual(parent.items.map(item=>item.id).sort());
    store.save(hash(records()[3]!.url),true);
    expect(store.feed({...filters,categories:['data'],savedOnly:true}).items.map(item=>item.title)).toEqual(['Baking bread']);
  }finally{store.close();rmSync(dir,{recursive:true,force:true});}
});

test('upgrading old categories preserves batch membership, seen marks, explicit hides and bookmarks',()=>{
  const dir=mkdtempSync(join(tmpdir(),'stillfeed-categories-upgrade-'));let store=new Store(dir);
  try{
    store.ingest(records(),new Date().toISOString());
    const batch=store.feed({...filters,categories:['ai','data']});
    const data=hash(records()[1]!.url);store.mark([data],true);store.save(data,true);store.hideSeen(batch.batch,'upgrade-hide');
    const {categories,...previous}=batch.filters;
    store.db.query('UPDATE batches SET filters=? WHERE id=?').run(JSON.stringify({...previous,scope:'ai'}),batch.batch);
    store.db.exec("DELETE FROM meta WHERE key='feedCategoriesVersion';ALTER TABLE articles DROP COLUMN ai_topic;ALTER TABLE articles DROP COLUMN data_topic;ALTER TABLE model_decisions DROP COLUMN categories;");
    store.close();store=new Store(dir);
    const restored=store.feed(filters,batch.batch);
    expect(restored.batch).toBe(batch.batch);expect(restored.items.map(item=>item.id)).toEqual(batch.items.map(item=>item.id));
    expect(restored.filters.categories).toEqual(['ai','data']);expect(restored.dismissed).toEqual([data]);
    expect(restored.items.find(item=>item.id===data)).toMatchObject({seen:true,saved:true});
    expect(store.feed({...filters,categories:['ai']}).items.map(item=>item.title).sort()).toEqual(['Claude coding agents','LLMs for data engineering']);
    store.close();store=new Store(dir);expect(store.feed(filters,batch.batch).dismissed).toEqual([data]);
  }finally{store.close();rmSync(dir,{recursive:true,force:true});}
});
