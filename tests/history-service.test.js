import {expect,test} from 'bun:test';
import {IDBFactory} from 'fake-indexeddb';
import {createHistoryStore} from '../extension/history-store.js';
import {createReadingHistory} from '../extension/history-service.js';

function memory(){const data={};return {get:async key=>({[key]:structuredClone(data[key])}),set:async value=>Object.assign(data,structuredClone(value)),remove:async key=>{delete data[key];}};}
function fixture(words=[]){
  const page={tabId:7,url:'https://reading.example/article?private=yes',sourceHash:'article-one',active:true,incognito:false};
  const settings={assistanceMode:'ambient',providerKind:'api',apiServices:[]};
  const sender={tab:{id:7},frameId:0,documentId:'document-one'},store=createHistoryStore({indexedDB:new IDBFactory()});
  const history=createReadingHistory({storage:memory(),session:memory(),source:async()=>({...page}),paused:async()=>false,state:async()=>({settings,words}),runModel:async()=>{throw new Error('No model call expected');},onChange:async()=>{},store});
  const enable=()=>history.configure({enabled:true,origins:['https://reading.example']});
  return {history,page,sender,store,enable,settings};
}
const query={text:'unless',context:'The request is retried unless the token has expired.',kind:'word',domain:'tech'};
const result={details:{meaning:{zh:'引出例外条件'},sentenceTranslation:'除非令牌已过期，否则会重试。'}};

test('history needs separate origin consent and rejects private or replaced documents',async()=>{
  const {history,page,sender,store,enable}=fixture();
  expect(await history.begin(sender)).toEqual({enabled:false});
  await history.configure({enabled:true});expect(await history.begin(sender)).toEqual({enabled:false});
  await enable();page.incognito=true;expect(await history.begin(sender)).toEqual({enabled:false});page.incognito=false;
  expect(await history.begin({...sender,frameId:1})).toEqual({enabled:false});
  await history.prepareQuery(sender,'pending',query,result);
  expect(await history.commit({...sender,documentId:'replacement'},'pending')).toBe(false);
  await history.configure({enabled:false});expect(await history.commit(sender,'pending')).toBe(false);
  expect((await history.snapshot()).metrics.queries).toBe(0);store.close();
});
test('same article URL state keeps history pending while another article or document cannot commit it',async()=>{
  const {history,page,sender,store,enable}=fixture();await enable();
  await history.prepareQuery(sender,'same-article',query,result);
  page.url='https://reading.example/article?private=changed#next';
  expect(await history.commit(sender,'same-article')).toBe(true);
  await history.prepareQuery(sender,'other-article',query,result);
  page.url='https://reading.example/other';page.sourceHash='article-two';
  expect(await history.commit(sender,'other-article')).toBe(false);
  page.url='https://reading.example/article';page.sourceHash='article-one';
  await history.prepareQuery(sender,'old-document',query,result);
  expect(await history.commit({...sender,documentId:'document-two'},'old-document')).toBe(false);
  expect((await history.snapshot()).metrics.queries).toBe(1);store.close();
});

test('only displayed queries count; repeats deduplicate terms and examples but not requests',async()=>{
  const {history,sender,store,enable}=fixture();await enable();
  await history.prepareQuery(sender,'first',query,result);expect((await history.snapshot()).metrics.queries).toBe(0);
  expect(await history.commit(sender,'first')).toBe(true);expect(await history.commit(sender,'first')).toBe(false);
  await history.prepareQuery(sender,'second',query,result);await history.commit(sender,'second');
  let snapshot=await history.snapshot();expect(snapshot.metrics).toMatchObject({queries:2,terms:1,sentences:1});
  expect(snapshot.events[0]).toMatchObject({sentence:query.context,translation:result.details.sentenceTranslation,source:'personal'});
  expect(JSON.stringify(snapshot.events)).not.toContain('private=yes');
  const offered=await history.offer(sender,[{id:'item',sentence:query.context,domain:'tech'}],{items:[{id:'item',target:{text:'unless',stage:'hint'}}]});
  expect((await history.snapshot()).events.some(event=>event.type==='annotation')).toBe(false);
  const id=offered.items[0].target.historyId;expect(await history.annotation({id,stage:'mark'},sender)).toBe(true);expect(await history.annotation({id,stage:'mark'},sender)).toBe(false);
  snapshot=await history.snapshot();expect(snapshot.events.find(event=>event.type==='annotation').sentence).toBeUndefined();expect(snapshot.metrics.queries).toBe(2);
  await history.remove(snapshot.events.find(event=>event.type==='query').id);expect((await history.snapshot()).metrics).toMatchObject({queries:1,terms:1,sentences:1});
  await history.clear();expect((await history.snapshot()).metrics).toMatchObject({queries:0,terms:0,sentences:0});store.close();
});
test('brief word help records its real definition without fabricating details',async()=>{
  const {history,sender,store,enable}=fixture();await enable();
  const brief={hint:'except if',sense:'introduces an exception',support:{wordId:'tech:unless',senseKey:'sense-one'}};
  expect(await history.prepareQuery(sender,'brief',query,brief)).toBe(true);expect(await history.commit(sender,'brief')).toBe(true);
  const event=(await history.snapshot()).events[0];expect(event).toMatchObject({term:'unless',explanation:'except if',translation:'',senseKey:'sense-one'});store.close();
});

test('visible word signals are document-bound, monotonic, and resumable without recounting',async()=>{
  const {history,page,sender,store,enable}=fixture();await enable();const session=await history.begin(sender);
  const signal={sessionId:session.id,epoch:session.epoch,sequence:1,elapsedMs:100,words:['block:1','block:2'],domain:'general'};
  expect((await history.tick(signal,sender)).recorded).toBe(true);expect((await history.tick(signal,sender)).recorded).toBe(false);
  await history.tick({...signal,sequence:2,words:['block:2','block:3']},sender);expect((await history.snapshot()).metrics.words).toBe(3);
  expect((await history.begin(sender)).sequence).toBe(2);
  page.active=false;expect((await history.tick({...signal,sequence:3,words:['block:4']},sender)).recorded).toBe(false);page.active=true;
  await history.invalidate();expect((await history.tick({...signal,sequence:3,words:['block:4']},sender)).recorded).toBe(false);
  expect((await history.snapshot()).metrics.words).toBe(3);
  const resumed=await history.begin(sender);expect(resumed.id).toBe(session.id);
  await history.tick({...signal,epoch:resumed.epoch,sequence:3,words:['block:1','block:3']},sender);
  expect((await history.snapshot()).metrics.words).toBe(3);store.close();
});
test('on-demand mode stops consented passive history without blocking explicit help',async()=>{
  const {history,sender,store,enable,settings}=fixture();await enable();
  const session=await history.begin(sender);
  settings.assistanceMode='on-demand';
  expect(await history.begin(sender)).toEqual({enabled:false});
  expect(await history.tick({sessionId:session.id,epoch:session.epoch,sequence:1,elapsedMs:100,words:['block:1'],domain:'general'},sender)).toEqual({recorded:false});
  await history.prepareQuery(sender,'explicit',query,result);
  expect(await history.commit(sender,'explicit')).toBe(true);
  expect((await history.snapshot()).metrics).toMatchObject({words:0,queries:1});store.close();
});

test('known words remain visible without history consent and annotation depth applies beyond priority terms',async()=>{
  const word={id:'tech:unless',term:'unless',domain:'tech',kind:'word',knownAt:123,helpCount:0,requestedAt:0,hintPreference:null,senses:[{key:'sense',label:'exception',opportunityDays:0,lastOpportunityAt:0,lastHelpAt:0,quietUntil:0,quietCycles:0,quietOpportunityDays:0,hintPreference:null,assistedPageKey:'',definition:{hint:'',translation:''}}]};
  const {history,store}=fixture([word]);
  expect((await history.snapshot()).knownWords).toEqual([{wordId:'tech:unless',term:'unless',domain:'tech',kind:'word',knownAt:123}]);
  await history.configure({enabled:true,origins:['https://reading.example'],personalization:true});
  await store.updateMeta(meta=>({...meta,profile:{expiresAt:Date.now()+60000,after:{annotation:{depth:'mark',priorityTerms:['different']}}}}));
  await history.snapshot();
  expect(history.effective(word,'sense')).toMatchObject({stage:'mark',origin:'adaptive'});
  word.senses[0].hintPreference='less';expect(history.effective(word,'sense')).toMatchObject({stage:'quiet',origin:'manual'});store.close();
});
