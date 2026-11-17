import { expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from './store';
import { isCandidate, line, parseTopics, triage } from './triage';

test('the model answer must be a list of valid item numbers', () => {
  expect(parseTopics('Sure: {"ai": [1, 3], "data": [3]}', 3)).toEqual(new Map([[1,['ai']],[3,['ai','data']]]));
  for (const bad of ['{"ai":[4],"data":[]}', '{"ai":[],"data":["1"]}', '{"ai":[true],"data":[]}', 'nothing', '{"ai":1,"data":[]}', '{"keep":[1]}']) expect(() => parseTopics(bad, 3)).toThrow();
});

test('only unmatched, non-CJK items from feeds and X are candidates', () => {
  expect(isCandidate({ id: 'a', site_id: 'opmlrss', title: 'Fragments' })).toBe(true);
  expect(isCandidate({ id: 'a', site_id: 'opmlrss', title: 'x', ai_is_related: true })).toBe(false);
  expect(isCandidate({ id: 'a', site_id: 'hackernews', title: 'x' })).toBe(false);
  expect(isCandidate({ id: 'a', site_id: 'opmlrss', title: '人工智能' })).toBe(false);
  expect(line({ source: 'Blog', title: 'A\n  title' }, 2)).toBe('2. [Blog] A title');
});

test('cached decisions apply without a model call', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'stillfeed-triage-')), store = new Store(dir);
  try {
    store.db.query('INSERT INTO model_decisions(id,keep,at) VALUES(?,?,?)').run('keep', 1, Date.now() / 1000);
    store.db.query('INSERT INTO model_decisions(id,keep,at) VALUES(?,?,?)').run('old-drop', 0, 1);
    store.db.query('INSERT INTO model_decisions(id,keep,at,categories) VALUES(?,?,?,?)').run('data',1,Date.now()/1000,JSON.stringify(['data']));
    store.db.query('INSERT INTO model_decisions(id,keep,at,categories) VALUES(?,?,?,?)').run('both',1,Date.now()/1000,JSON.stringify(['ai','data']));
    const records = [{id:'data',site_id:'opmlrss',title:'Storage internals'},{id:'both',site_id:'opmlrss',title:'Practical systems'}, { id: 'keep', site_id: 'opmlrss', title: 'Fragments' }, { id: 'new', site_id: 'opmlrss', title: 'Notes' }] as Record<string, unknown>[];
    await triage(store, records, false);
    expect(records[0]).toMatchObject({ai_is_related:true,ai_topic:false,data_is_related:true});
    expect(records[1]).toMatchObject({ai_topic:true,data_is_related:true});
    expect(records[2]).toMatchObject({ ai_is_related: true, ai_relevance_reason: 'model_triage' });
    expect(records[3]!.ai_is_related).toBeUndefined();
    // Drops made under the old AI-only prompt are judged again.
    expect(store.db.query("SELECT 1 FROM model_decisions WHERE id='old-drop'").get()).toBeNull();
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});
