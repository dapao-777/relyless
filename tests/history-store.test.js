import {test,expect} from 'bun:test';
import {indexedDB,IDBKeyRange,IDBObjectStore,IDBCursor} from 'fake-indexeddb';
import {createHistoryStore} from '../extension/history-store.js';
import {createPersonalization} from '../extension/personalization.mjs';

const DAY = 86_400_000;
const BASE = Date.UTC(2026,8,13,12);
if (!globalThis.IDBKeyRange) globalThis.IDBKeyRange = IDBKeyRange;
let sequence = 0;
const storeFor = (clock = {value:BASE}) => createHistoryStore({
  name:`history-store-test-${++sequence}`,
  indexedDB,
  now:() => clock.value,
});
const query = (id,extra = {}) => ({
  id,type:'query',at:BASE,sessionId:'session',domain:'general',term:'Ephemeral',kind:'word',
  sentence:'An ephemeral cache vanished.',translation:'一个临时缓存消失了。',explanation:'短暂存在',senseKey:'brief',
  source:'personal',stage:'hint',status:'ready',modelGenerated:true,...extra,
});

const rawRecords = (name,storeName) => new Promise((resolve,reject) => {
  const open = indexedDB.open(name);
  open.onerror = () => reject(open.error);
  open.onsuccess = () => {
    const db = open.result;
    const request = db.transaction(storeName).objectStore(storeName).getAll();
    request.onerror = () => reject(request.error);
    request.onsuccess = () => { db.close(); resolve(request.result); };
  };
});

test('opens lazily and persists data between store instances', async () => {
  let opens = 0;
  const factory = new Proxy(indexedDB,{get(target,key,receiver) {
    if (key === 'open') return (...args) => { opens++; return target.open(...args); };
    return Reflect.get(target,key,receiver);
  }});
  const name = `history-lazy-${++sequence}`;
  const first = createHistoryStore({name,indexedDB:factory,now:() => BASE});
  expect(opens).toBe(0);
  expect(await first.append(query('persisted'))).toBe(true);
  expect(opens).toBe(1);
  first.close();
  const second = createHistoryStore({name,indexedDB:factory,now:() => BASE});
  expect((await second.snapshot()).events.map(event => event.id)).toEqual(['persisted']);
  second.close();
});

test('commits id deduplication atomically and only accepts successful safe events', async () => {
  const store = storeFor();
  const attempts = await Promise.all(Array.from({length:8},() => store.append(query('same-id'))));
  expect(attempts.filter(Boolean)).toHaveLength(1);
  expect(await store.append(query('failed',{status:'error'}))).toBe(false);
  expect(await store.append(query('has-url',{url:'https://private.example/article'}))).toBe(false);
  expect(await store.append(query('too-long',{sentence:'x'.repeat(1001)}))).toBe(false);
  const result = await store.snapshot();
  expect(result.metrics.queries).toBe(1);
  expect(result.events).toHaveLength(1);
  store.close();
});

test('keeps query, term, sentence, passage, annotation and reading metrics independent', async () => {
  const store = storeFor();
  await store.append(query('q1'));
  await store.append(query('q2',{domain:'technology',term:'  EPHEMERAL  ',sentence:' An  ephemeral cache vanished. '}));
  await store.append(query('passage',{kind:'passage',term:'',sentence:'A whole paragraph must not remain.',translation:'不得保留。',explanation:''}));
  await store.append({id:'mark',type:'annotation',at:BASE,sessionId:'s',domain:'general',term:'ephemeral',kind:'word',senseKey:'brief',source:'system',stage:'mark'});
  await store.append({id:'read',type:'reading',sequence:1,at:BASE,sessionId:'s',domain:'general',elapsedMs:45_000,wordCount:320});
  expect(await store.append({id:'read',type:'reading',sequence:1,at:BASE,sessionId:'s',domain:'general',elapsedMs:45_000,wordCount:320})).toBe(false);

  const result = await store.snapshot({domain:'technology',type:'query'});
  expect(result.events.map(event => event.id)).toEqual(['q2']);
  expect(result.metrics).toEqual({activeMs:45_000,words:320,queries:3,terms:1,sentences:1,passages:1,finished:0});
  expect(result.daily).toEqual([{day:'2026-09-13',activeMs:45_000,words:320,queries:3,terms:1,sentences:1,finished:0}]);
  const passage = (await store.snapshot({type:'query'})).events.find(event => event.id === 'passage');
  expect(passage).not.toHaveProperty('sentence');
  expect(passage).not.toHaveProperty('translation');
  store.close();
});
test('counts only a single original sentence and supports a bounded export-sized snapshot', async () => {
  const store = storeFor();
  await store.append(query('single'));
  await store.append(query('multi',{sentence:'First sentence. Second sentence.'}));
  expect((await store.snapshot()).metrics.sentences).toBe(1);
  expect((await store.snapshot({limit:1})).events).toHaveLength(1);
  expect((await store.snapshot({limit:100_000})).events).toHaveLength(2);
  store.close();
});

test('compacts expired details and keeps archived aggregates immutable by event id', async () => {
  const clock = {value:BASE};
  const store = storeFor(clock);
  const oldAt = BASE - 100 * DAY;
  await store.append(query('old',{at:oldAt,term:'legacy',sentence:'A retained statistic has no retained sentence.'}));
  await store.append(query('recent'));
  let cumulative = await store.snapshot({days:0});
  expect(cumulative.events.map(event => event.id)).toEqual(['recent']);
  expect(cumulative.metrics).toMatchObject({queries:2,terms:2,sentences:2});
  expect(cumulative.retentionDays).toBe(90);
  expect(await store.remove('old')).toBe(false);
  expect(await store.remove('recent')).toBe(true);
  cumulative = await store.snapshot({days:0});
  expect(cumulative.metrics).toMatchObject({queries:1,terms:1,sentences:1});
  expect(await store.append(query('old',{at:oldAt,term:'legacy',sentence:'A retained statistic has no retained sentence.'}))).toBe(false);
  store.close();
});

test('uses a private per-database salt and stores no original text in statistics', async () => {
  const firstName = `history-salt-a-${++sequence}`;
  const secondName = `history-salt-b-${++sequence}`;
  const first = createHistoryStore({name:firstName,indexedDB,now:() => BASE});
  const second = createHistoryStore({name:secondName,indexedDB,now:() => BASE});
  await first.append(query('a'));
  await second.append(query('b'));
  const [firstFacts,secondFacts,firstControl] = await Promise.all([
    rawRecords(firstName,'contributions'),rawRecords(secondName,'contributions'),rawRecords(firstName,'control'),
  ]);
  expect(firstFacts[0].termFingerprint).not.toBe(secondFacts[0].termFingerprint);
  expect(firstFacts[0].sentenceFingerprint).not.toBe(secondFacts[0].sentenceFingerprint);
  expect(JSON.stringify(firstFacts)).not.toContain('ephemeral');
  expect(firstControl.find(record => record.key === 'salt').value).toHaveLength(64);
  first.close(); second.close();
});

test('edits and deletes invalidate derived profile while append does not', async () => {
  const store = storeFor();
  const updated = await store.updateMeta(draft => {
    draft.profile = {conciseness:'short'};
    draft.pending = {token:'proposal'};
    draft.versions=[{id:'old-policy',status:'applied'}];
    draft.lastAnalysisAt = BASE;
  });
  expect(updated).toMatchObject({revision:0,profile:{conciseness:'short'},pending:{token:'proposal'}});
  await store.append({id:'summary',type:'summary',at:BASE,sessionId:'s',domain:'technology',summary:'分布式缓存设计。',status:'ready',modelGenerated:true});
  expect((await store.meta()).revision).toBe(0);
  expect(await store.editSummary('summary','缓存设计与失效策略。')).toBe(true);
  expect((await store.snapshot({type:'summary'})).events[0]).toMatchObject({summary:'缓存设计与失效策略。',modelGenerated:false});
  expect(await store.meta()).toMatchObject({revision:1,profile:null,pending:null});
  expect((await store.meta()).versions[0].status).toBe('invalidated');
  await store.remove('summary');
  expect((await store.meta()).revision).toBe(2);
  await store.clear();
  expect(await store.meta()).toMatchObject({profile:null,versions:[],overrides:[],lastAnalysisAt:0,lastAttemptAt:0,pending:null});
  expect(await store.snapshot({days:0})).toMatchObject({events:[],startedAt:null,total:0});
  store.close();
});

test('returns bounded recent evidence and excludes reading and annotations', async () => {
  const store = storeFor();
  for (let index=0; index<65; index++) await store.append(query(`q-${index}`,{at:BASE-index}));
  for (let index=0; index<35; index++) await store.append({id:`s-${index}`,type:'summary',at:BASE-index,sessionId:'s',domain:'general',summary:`主题 ${index}`,status:'ready',modelGenerated:true});
  await store.append({id:'read-only',type:'reading',sequence:1,at:BASE,sessionId:'s',domain:'general',elapsedMs:1000,wordCount:5});
  const evidence = await store.evidence();
  expect(evidence.queries).toHaveLength(60);
  expect(evidence.summaries).toHaveLength(30);
  expect(evidence.queries[0].id).toBe('q-0');
  expect(evidence.summaries[0].id).toBe('s-0');
  store.close();
});
test('paginates same-timestamp events exclusively with exact filtered totals', async () => {
  const store = storeFor();
  await store.append(query('a',{domain:'technology'}));
  await store.append(query('c',{domain:'technology'}));
  await store.append(query('b',{domain:'technology'}));
  await store.append(query('other',{domain:'general',term:'different'}));

  const first = await store.snapshot({domain:'technology',type:'query',search:'ephemeral',limit:2});
  expect(first.events.map(event => event.id)).toEqual(['c','b']);
  expect(first.total).toBe(3);
  expect(first.nextCursor).toEqual({at:BASE,id:'b'});
  expect(first.metrics.queries).toBe(4);

  const second = await store.snapshot({domain:'technology',type:'query',search:'ephemeral',limit:2,cursor:first.nextCursor});
  expect(second.events.map(event => event.id)).toEqual(['a']);
  expect(second.total).toBe(3);
  expect(second.nextCursor).toBeNull();
  expect(second.metrics).toEqual(first.metrics);
  store.close();
});

test('does not read event bodies for a zero-limit snapshot', async () => {
  const store = storeFor();
  await store.append(query('body'));
  const originalGet = IDBObjectStore.prototype.get;
  const originalGetAll = IDBObjectStore.prototype.getAll;
  let bodyReads = 0;
  IDBObjectStore.prototype.get = function (...args) {
    if (this.name === 'events') bodyReads++;
    return originalGet.apply(this,args);
  };
  IDBObjectStore.prototype.getAll = function (...args) {
    if (this.name === 'events') bodyReads++;
    return originalGetAll.apply(this,args);
  };
  try {
    const result = await store.snapshot({limit:0});
    expect(result.events).toEqual([]);
    expect(result.total).toBe(1);
    expect(result.nextCursor).toBeNull();
    expect(bodyReads).toBe(0);
  } finally {
    IDBObjectStore.prototype.get = originalGet;
    IDBObjectStore.prototype.getAll = originalGetAll;
    store.close();
  }
});

test('compacts to exact daily unions across archived and retained overlap without replay double-counting', async () => {
  const clock = {value:BASE};
  const name = `history-archive-union-${++sequence}`;
  let store = createHistoryStore({name,indexedDB,now:() => clock.value});
  const boundaryDay = BASE - 90 * DAY;
  await store.append(query('archived',{at:boundaryDay-DAY/24,term:'Shared',sentence:'The same sentence remains distinct only once.'}));
  await store.append(query('retained',{at:boundaryDay+DAY/24,term:' shared ',sentence:' The same sentence remains distinct only once. '}));
  await store.append(query('older-day',{at:boundaryDay-DAY-DAY/24,term:'Shared',sentence:'The same sentence remains distinct only once.'}));

  let result = await store.snapshot({days:0});
  expect(result.metrics).toMatchObject({queries:3,terms:1,sentences:1});
  expect(result.daily).toEqual([
    {day:'2026-06-14',activeMs:0,words:0,queries:1,terms:1,sentences:1,finished:0},
    {day:'2026-06-15',activeMs:0,words:0,queries:2,terms:1,sentences:1,finished:0},
  ]);
  expect((await rawRecords(name,'contributions')).map(item => item.id)).toEqual(['retained']);
  expect(JSON.stringify(await rawRecords(name,'archive'))).not.toContain('Shared');
  store.close();

  store = createHistoryStore({name,indexedDB,now:() => clock.value});
  expect(await store.append(query('archived',{at:boundaryDay-DAY/24,term:'Shared',sentence:'The same sentence remains distinct only once.'}))).toBe(false);
  result = await store.snapshot({days:0});
  expect(result.metrics).toMatchObject({queries:3,terms:1,sentences:1});
  await store.clear();
  expect(await store.snapshot({days:0})).toMatchObject({events:[],metrics:{activeMs:0,words:0,queries:0,terms:0,sentences:0,passages:0,finished:0},daily:[],startedAt:null,total:0,nextCursor:null});
  expect(await rawRecords(name,'archive')).toEqual([]);
  expect(await rawRecords(name,'receipts')).toEqual([]);
  store.close();
});

test('finish events count toward daily and archived completion metrics', async () => {
  const store = storeFor();
  const finish = id => ({id,type:'finish',at:BASE,sessionId:'s',domain:'general'});
  await store.append(finish('f1'));
  await store.append(finish('f1')); // same id deduplicates
  await store.append(finish('f2'));
  const result = await store.snapshot({days:0});
  expect(result.metrics.finished).toBe(2);
  expect(result.daily).toEqual([{day:'2026-09-13',activeMs:0,words:0,queries:0,finished:2,terms:0,sentences:0}]);
  store.close();
});

test('atomically upgrades v1 data with compound event indexes and compact archive', async () => {
  const name = `history-v1-${++sequence}`;
  await new Promise((resolve,reject) => {
    const open = indexedDB.open(name,1);
    open.onerror = () => reject(open.error);
    open.onupgradeneeded = () => {
      const db = open.result;
      const events = db.createObjectStore('events',{keyPath:'id'});
      events.createIndex('at','at'); events.createIndex('type','type'); events.createIndex('domain','domain');
      const contributions = db.createObjectStore('contributions',{keyPath:'id'});
      contributions.createIndex('at','at'); contributions.createIndex('day','day');
      db.createObjectStore('control',{keyPath:'key'});
    };
    open.onsuccess = () => {
      const db = open.result;
      const transaction = db.transaction(['events','contributions','control'],'readwrite');
      transaction.objectStore('events').put(query('v1-old',{at:BASE-100*DAY}));
      transaction.objectStore('contributions').put({id:'v1-old',at:BASE-100*DAY,day:'2026-06-05',activeMs:0,words:0,queries:1,passages:0,termFingerprint:'term-hash',sentenceFingerprint:'sentence-hash'});
      transaction.objectStore('control').put({key:'startedAt',value:BASE-100*DAY});
      transaction.oncomplete = () => { db.close(); resolve(); };
      transaction.onerror = () => reject(transaction.error);
    };
  });

  const store = createHistoryStore({name,indexedDB,now:() => BASE});
  const result = await store.snapshot({days:0});
  expect(result.events).toEqual([]);
  expect(result.metrics).toMatchObject({queries:1,terms:1,sentences:1});
  const schema = await new Promise((resolve,reject) => {
    const open = indexedDB.open(name);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const indexes = [...db.transaction('events').objectStore('events').indexNames];
      const stores = [...db.objectStoreNames];
      db.close();
      resolve({indexes,stores});
    };
  });
  expect(schema.stores).not.toContain('eventIndex');
  expect(schema.indexes).toEqual(expect.arrayContaining(['atId','typeAtId','domainAtId','domainTypeAtId']));
  expect(await store.append(query('v1-old',{at:BASE-100*DAY}))).toBe(false);
  expect(await rawRecords(name,'archive')).toHaveLength(1);
  expect(await rawRecords(name,'receipts')).toEqual([{id:'v1-old',at:BASE-100*DAY,day:'2026-06-05',sequence:0,archived:true}]);
  store.close();
});

test('bounds evidence value cursors to returned evidence', async () => {
  const store = storeFor();
  for (let index=0; index<120; index++) await store.append(query(`bounded-q-${index}`,{at:BASE-index}));
  const originalContinue = IDBCursor.prototype.continue;
  let continuations = 0;
  IDBCursor.prototype.continue = function (...args) {
    continuations++;
    return originalContinue.apply(this,args);
  };
  try {
    const result = await store.evidence();
    expect(result.queries).toHaveLength(60);
    expect(continuations).toBe(60);
  } finally {
    IDBCursor.prototype.continue = originalContinue;
    store.close();
  }
});
test('clearing history between summary authorization and commit never recreates deleted data',async()=>{
  const store=storeFor({value:Date.now()}),append=store.append.bind(store);let visibleAfterClear=-1;
  store.append=async(event,options)=>{await store.clear();const accepted=await append(event,options);visibleAfterClear=(await store.snapshot({days:0})).events.length;return accepted;};
  const engine=createPersonalization({history:store,config:async()=>({enabled:true,origins:['https://example.test'],summaries:true,epoch:1,assistanceMode:'ambient'}),runModel:async()=>({summary:'A bounded summary.',domain:'general'}),onChange:async()=>{}});
  try{await expect(engine.summarize({sessionId:'s',domain:'general',sample:'A short article.'})).rejects.toMatchObject({code:'STALE'});expect(visibleAfterClear).toBe(0);expect((await store.snapshot({days:0})).total).toBe(0);}finally{store.close();}
});

