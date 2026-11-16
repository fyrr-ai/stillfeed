#!/usr/bin/env python3
"""Stateless adapters and AI classification. JSON is a pipe protocol, never a storage file."""
import json,sys,sqlite3,time,os,hashlib
from pathlib import Path
import collect_sources as news
import ai_relevance as relevance
import triage
import fetch_follows as follows

data=json.load(sys.stdin)
started=time.time()
def timing(phase):print(f'timing adapter.{phase} +{time.time()-started:.1f}s',file=sys.stderr,flush=True)
records=list(data.get('records',[]));statuses=[]
if data.get('webs',True):
    items,statuses=news.collect_all(news.create_session(),news.datetime.now(news.UTC))
    for item in items:
        records.append(dict(site_id=item.site_id,source=item.source,title=item.title,url=item.url,published_at=news.iso(item.published_at),summary=str(item.meta.get('summary') or '')))
timing('web')
for tweet in data.get('tweets',[]):
    record=follows.to_record(tweet)
    if record:
        article=record.get('article') or {}
        records.append(dict(site_id='opmlrss',source='X follows',title=(record['text']+' '+str(article.get('title') or '')+' '+str(article.get('preview') or '')).strip(),url=f"https://x.com/{record['handle']}/status/{record['id']}",published_at=news.iso(news.datetime.fromtimestamp(record['published'],news.UTC)),tweet=record))
for record in records:
    original=record.get('title','')
    scored=relevance.add_ai_relevance_fields(dict(record,title=original+' '+str(record.get('summary') or '')))
    record.update({k:v for k,v in scored.items() if k.startswith('ai_')})
    if record.get('trusted_ai'):record['ai_is_related']=True;record['ai_relevance_reason']='ai_source'
    elif not record.get('ai_is_related') and relevance.has_data_signal(original+' '+str(record.get('summary') or '')):record['ai_is_related']=True;record['ai_relevance_reason']='data_signal'
    record['id']=str(record.get('id') or hashlib.sha256(record['url'].encode()).hexdigest()[:32])
# Decisions live in the same normalized database as articles; no JSON decision cache.
connection=sqlite3.connect(sys.argv[1],timeout=20)
connection.execute('CREATE TABLE IF NOT EXISTS model_decisions(id TEXT PRIMARY KEY,keep INTEGER NOT NULL,at REAL NOT NULL)')
# Items dropped before the radar also covered data engineering are judged again once.
connection.execute('DELETE FROM model_decisions WHERE keep=0 AND at<?',(triage.PROMPT_SINCE,))
cache={row[0]:bool(row[1]) for row in connection.execute('SELECT id,keep FROM model_decisions')}
candidates=[r for r in records if triage.is_candidate(r)]
candidates.sort(key=lambda r:r.get('source')=='X follows')
todo=[r for r in candidates if r['id'] not in cache]
if not data.get('no_model',False):
    for at in range(0,min(len(todo),triage.BATCH*triage.MAX_CALLS),triage.BATCH):
        batch=todo[at:at+triage.BATCH]
        try:
            kept=triage.parse_keep(triage.run_codex(triage.PROMPT.format(items='\n'.join(triage.line(r,i) for i,r in enumerate(batch,1)))),len(batch))
            with connection:
                for i,r in enumerate(batch,1):
                    cache[r['id']]=i in kept
                    connection.execute('INSERT OR REPLACE INTO model_decisions VALUES(?,?,?)',(r['id'],int(i in kept),time.time()))
        except Exception as error:print('Model triage unavailable:',type(error).__name__,file=sys.stderr)
for r in candidates:
    if cache.get(r['id']):r['ai_is_related']=True;r['ai_relevance_reason']='model_triage'
timing('triage')
connection.close()
print(json.dumps(dict(records=records,statuses=statuses),ensure_ascii=False))
