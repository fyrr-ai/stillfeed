import type { Feed, Preferences, Session } from './lib';
export const defaults: Preferences = {view:'feed',scope:'ai',kind:'all',q:'',hideSeen:true};
export const PAGE_SIZE = 30;
export function loadPreferences(): Preferences {
  try {
    const saved = JSON.parse(localStorage.getItem('stillfeed-preferences') || 'null');
    if (saved) return { view: saved.view === 'saved' ? 'saved' : saved.view === 'hot' ? 'hot' : 'feed', scope: saved.scope === 'all' ? 'all' : 'ai', kind: ['article', 'x'].includes(saved.kind) ? saved.kind : 'all', q: typeof saved.q === 'string' ? saved.q.slice(0, 300) : '', hideSeen: saved.autoSeen === true ? saved.hideSeen !== false : true,
      ...(typeof saved.savedTopic === 'string' && /^([a-f0-9]{32}|ungrouped)$/.test(saved.savedTopic) ? { savedTopic: saved.savedTopic } : {}) };
  } catch {}
  return { ...defaults };
}
export function storePreferences(preferences: Preferences) { localStorage.setItem('stillfeed-preferences', JSON.stringify({ ...preferences, autoSeen: true })); }
export function loadSession(key: string, preferences?: Preferences, maxAge = Infinity): Session | null {
  try {
    const session = JSON.parse(sessionStorage.getItem(key) || 'null') as (Session & {dismissalVersion?:number;collapsed?:unknown}) | null;
    if (!session || !session.preferences || typeof session.batch !== 'string' || !Number.isInteger(session.pages) || session.pages < 1) return null;
    session.preferences.view ??= 'feed';
    if (preferences && JSON.stringify(session.preferences) !== JSON.stringify(preferences)) return null;
    if (Date.now() - (session.at ?? 0) > maxAge) return null;
    // Preserve explicit hides made by the previous UI; the next save writes only the batch ID.
    if(session.dismissalVersion===2&&Array.isArray(session.collapsed))session.legacyDismissals=session.collapsed.filter((id:unknown):id is string=>typeof id==='string'&&/^[a-f0-9]{32}$/.test(id));
    return session;
  } catch { return null; }
}

export function feedURL(preferences: Preferences, restore?: {batch:string;offset:number}, limit=PAGE_SIZE, previous?: Feed|null) {
  const params = new URLSearchParams();
  if(limit>PAGE_SIZE)params.set('limit',String(limit));
  if(restore){params.set('batch',restore.batch);params.set('offset',String(restore.offset));}
  else {
    params.set('saved',preferences.view==='saved'?'1':'0');
    params.set('personal',preferences.view==='hot'?'1':'0');
    params.set('scope',preferences.scope);params.set('kind',preferences.kind);params.set('q',preferences.q);params.set('hideSeen','0');
    if(preferences.view==='hot'){const base=loadSession('stillfeed-session-feed');if(base)params.set('from',base.batch);}
    if(preferences.view==='saved'&&preferences.savedTopic)params.set('topic',preferences.savedTopic);
    if(previous&&preferences.view==='feed'){params.set('seenBefore',String(previous.seenBefore));params.set('revision',String(previous.revision));}
  }
  return '/api/feed?'+params;
}

type InitialResponse = {path:string;response:Promise<Response>};
const startup = window as typeof window & {__stillfeedInitialFeed?:InitialResponse};
export function startInitialRequest(){
  // The older storage names are migrated by main.tsx before selecting a view.
  if([localStorage,sessionStorage].some(store=>Object.keys(store).some(key=>key.startsWith('radar-v2-'))))return;
  let preferences=loadPreferences(),saved=loadSession('stillfeed-session',preferences);
  if(preferences.view==='hot'){
    const base=loadSession('stillfeed-session-feed');
    if(base&&saved?.personalBatch!==base.batch){preferences={...base.preferences,view:'hot'};saved=null;}
  }
  if(saved?.legacyDismissals?.length)return;
  const restore=saved&&preferences.view!=='saved'?{batch:saved.batch,offset:0}:undefined;
  const path=feedURL(preferences,restore,Math.min(saved?.pages??1,100)*PAGE_SIZE);
  const response=fetch(path,{cache:'no-store'});
  void response.catch(()=>{});
  startup.__stillfeedInitialFeed={path,response};
}
export function takeInitialResponse(path:string){
  if(!path.startsWith('/api/feed?'))return undefined;
  const pending=startup.__stillfeedInitialFeed;
  delete startup.__stillfeedInitialFeed;
  return pending?.path===path?pending.response:undefined;
}
