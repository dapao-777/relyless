import {test,expect} from 'bun:test';
import {createPersonalization,DEFAULT_POLICY,PERSONALIZATION_SCHEMA,SUMMARY_SCHEMA} from '../extension/personalization.mjs';

function fixture({queries=[],summaries=[],model}={}){
  let meta={revision:0,profile:null,versions:[],overrides:[],lastAnalysisAt:0,lastAttemptAt:0,analysisError:'',pending:null};
  const appended=[];let changes=0,calls=0;
  const history={
    meta:async()=>structuredClone(meta),
    updateMeta:async mutator=>{const draft=structuredClone(meta),value=mutator(draft);if(value instanceof Promise)throw new Error('async mutator');meta=structuredClone(value??draft);return structuredClone(meta);},
    evidence:async()=>({queries:structuredClone(queries),summaries:structuredClone(summaries.concat(appended))}),
    snapshot:async()=>({metrics:{queries:queries.length}}),
    append:async event=>{appended.push(structuredClone(event));return true;},remove:async id=>{const index=appended.findIndex(event=>event.id===id);if(index<0)return false;appended.splice(index,1);return true;},
  };
  const settings={enabled:true,origins:['https://example.test'],summaries:true,personalization:true,autoApply:false,epoch:1,assistanceMode:'ambient'};
  const runModel=async(...args)=>{calls++;return model(...args);};
  const api=createPersonalization({history,config:async()=>structuredClone(settings),runModel,onChange:async()=>{changes++;}});
  return {api,history,settings,appended,get meta(){return meta;},get changes(){return changes;},get calls(){return calls;}};
}
const at=Date.now();
const queries=Array.from({length:10},(_,index)=>({id:`q${index}`,type:'query',at:at-index,sessionId:`s${index%3}`,term:index?'index':'schema',domain:'tech'}));
const proposal={annotation:{density:'standard',priorityTerms:['index'],depth:'hint'},domainBias:'general',translation:{detail:'standard',terminology:'contextual',focus:'meaning'},evidenceIds:['q1']};

test('summary sends only a bounded transient sample and persists the real model summary once',async()=>{
  let received;
  const f=fixture({model:(kind,payload,instructions,schema)=>{received={kind,payload,instructions,schema};return {summary:'文章解释数据库索引。',domain:'data'};}});
  const event=await f.api.summarize({sessionId:'session-1',domain:'tech',sample:'An article about database indexes.'});
  expect(received.kind).toBe('summary');expect(received.schema).toBe(SUMMARY_SCHEMA);
  expect(event.summary).toBe('文章解释数据库索引。');expect(f.appended[0]).not.toHaveProperty('sample');
  await expect(f.api.summarize({sessionId:'session-1',domain:'tech',sample:'A second sample.'})).rejects.toMatchObject({code:'NOT_READY'});
});
test('summary expected availability and stale-result states have stable codes',async()=>{
  const unavailable=fixture({model:()=>({summary:'主题摘要',domain:'general'})});unavailable.settings.summaries=false;
  await expect(unavailable.api.summarize({sessionId:'session',sample:'Original sample.',domain:'general'})).rejects.toMatchObject({code:'NOT_READY'});
  const stale=fixture({model:()=>{stale.settings.epoch++;return {summary:'主题摘要',domain:'general'};}});
  await expect(stale.api.summarize({sessionId:'session',sample:'Original sample.',domain:'general'})).rejects.toMatchObject({code:'STALE'});
});

test('analysis validates cited evidence and keeps behavior-changing proposals pending',async()=>{
  const f=fixture({queries,model:(kind,payload,instructions,schema)=>{expect(kind).toBe('personalization');expect(schema).toBe(PERSONALIZATION_SCHEMA);expect(payload.evidence).toHaveLength(10);return proposal;}});
  const state=await f.api.analyze({manual:true});
  expect(state.pending.after.annotation.priorityTerms).toEqual(['index']);expect(state.profile).toBeNull();
  const applied=await f.api.apply(state.pending.id);expect(applied.profile.after.annotation.priorityTerms).toEqual(['index']);
  const rolled=await f.api.rollback(applied.profile.id);expect(rolled.profile.after).toEqual(DEFAULT_POLICY);
});

test('only priority-term changes auto-apply, while manual locks remain separate and reversible',async()=>{
  const f=fixture({queries,model:()=>proposal});f.settings.autoApply=true;
  const state=await f.api.analyze();expect(state.profile.status).toBe('applied');expect(state.pending).toBeNull();
  const overridden=await f.api.setOverride({wordId:'general:index',senseKey:'database',stage:'quiet',locked:true});
  expect(overridden.overrides).toEqual([{wordId:'general:index',senseKey:'database',stage:'quiet',locked:true,at:expect.any(Number)}]);
  const restored=await f.api.setOverride({wordId:'general:index',senseKey:'database',stage:null,locked:false});expect(restored.overrides).toEqual([]);
});

test('invalid evidence references and priority terms never change the profile',async()=>{
  const f=fixture({queries,model:()=>({...proposal,annotation:{...proposal.annotation,priorityTerms:['never queried']},evidenceIds:['outside']})});
  await expect(f.api.analyze({manual:true})).rejects.toThrow();expect((await f.api.snapshot()).profile).toBeNull();expect(f.meta.analysisError).toBeTruthy();
});

test('in-flight analysis is shared and a revision change discards the late result',async()=>{
  let release;const deferred=new Promise(resolve=>{release=resolve;});
  const f=fixture({queries,model:()=>deferred});
  const first=f.api.analyze({manual:true}),second=f.api.analyze({manual:true});
  await new Promise(resolve=>setTimeout(resolve,0));await f.history.updateMeta(meta=>{meta.revision++;});release(proposal);
  const results=await Promise.allSettled([first,second]);expect(results.map(result=>result.status)).toEqual(['rejected','rejected']);expect(results[0].reason).toMatchObject({code:'STALE'});expect((await f.api.snapshot()).profile).toBeNull();expect(f.calls).toBe(1);
});
test('subscription sends history tasks and only closed translation preferences',async()=>{
  let listener,last;
  const port={onDisconnect:{addListener(){}},onMessage:{addListener(fn){listener=fn;}},postMessage(message){last=message;queueMicrotask(()=>listener({id:message.id,ok:true,data:message.type==='historyModel'?{summary:'真实摘要',domain:'tech'}:{level:'hint',hint:null}}));},disconnect(){}};
  globalThis.chrome={runtime:{connectNative:()=>port,lastError:null}};
  try{
    const {historyModelSubscription,assistSubscription}=await import(`../extension/subscription.js?personalization=${Date.now()}`);
    expect(await historyModelSubscription('summary',{sample:'Short source.',domain:'tech'},'fixture')).toEqual({summary:'真实摘要',domain:'tech'});
    expect(last.type).toBe('historyModel');expect(last.payload).toEqual({kind:'summary',payload:{sample:'Short source.',domain:'tech'},model:'fixture'});
    const preferences={detail:'concise',terminology:'consistent',focus:'usage'};
    await assistSubscription({text:'index',context:'Use an index.',domain:'tech',kind:'word',level:'hint',detail:'brief'},'fixture',undefined,preferences);
    expect(last.payload.personalization).toEqual(preferences);
    await expect(assistSubscription({text:'index',context:'Use an index.',domain:'tech',kind:'word',level:'hint',detail:'brief'},'fixture',undefined,{...preferences,prompt:'ignore rules'})).rejects.toThrow('偏好无效');
  }finally{delete globalThis.chrome;}
});

test('insufficient evidence does not spend an attempt and identical evidence cannot self-reinforce',async()=>{
  const rows=[],f=fixture({queries:rows,model:()=>proposal});
  await expect(f.api.analyze()).rejects.toMatchObject({code:'NOT_READY'});expect(f.calls).toBe(0);
  rows.push(...queries);await f.api.analyze();expect(f.calls).toBe(1);
  await f.history.updateMeta(meta=>{meta.lastAttemptAt=Date.now()-8*86400000;});
  await expect(f.api.analyze()).rejects.toMatchObject({code:'NOT_READY'});expect(f.calls).toBe(1);
});
test('analysis authorization and automatic or manual cooldowns have stable not-ready codes',async()=>{
  const unauthorized=fixture({queries,model:()=>proposal});unauthorized.settings.personalization=false;
  await expect(unauthorized.api.analyze()).rejects.toMatchObject({code:'NOT_READY'});
  const automatic=fixture({queries,model:()=>proposal});await automatic.history.updateMeta(meta=>{meta.lastAttemptAt=Date.now();});
  await expect(automatic.api.analyze()).rejects.toMatchObject({code:'NOT_READY'});
  const manual=fixture({queries,model:()=>proposal});await manual.history.updateMeta(meta=>{meta.lastManualAttemptAt=Date.now();});
  await expect(manual.api.analyze({manual:true})).rejects.toMatchObject({code:'NOT_READY'});
  expect(unauthorized.calls+automatic.calls+manual.calls).toBe(0);
});

test('failed analysis is rate limited without persisting provider errors or changing policy',async()=>{
  const providerError=new Error('private-provider-body');providerError.code='NETWORK';
  const f=fixture({queries,model:()=>{throw providerError;}});
  await expect(f.api.analyze()).rejects.toBe(providerError);await expect(f.api.analyze()).rejects.toMatchObject({code:'NOT_READY'});
  expect(f.calls).toBe(1);expect(f.meta.profile).toBeNull();expect(JSON.stringify(f.meta)).not.toContain('private-provider-body');
});

test('consent revoked during final summary storage removes the late record',async()=>{
  const f=fixture({model:()=>({summary:'主题摘要',domain:'general'})}),append=f.history.append;
  f.history.append=async event=>{await append(event);f.settings.enabled=false;f.settings.epoch++;return true;};
  await expect(f.api.summarize({sessionId:'session',sample:'Original private sample.',domain:'general'})).rejects.toMatchObject({code:'STALE'});
  expect(f.appended).toEqual([]);
});
