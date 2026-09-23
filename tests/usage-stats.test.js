import {afterEach,beforeEach,expect,test} from 'bun:test';
import {indexedDB} from 'fake-indexeddb';
import {performProviderRequest} from '../extension/api-transport.mjs';
import {mergeUsageEntry,normalizeUsageRow,usageStatsView} from '../extension/usage-stats.js';
import {isolatedChrome,isolatedSend} from './helpers/chrome-fixture.js';

// 用量统计：传输层解析各协议 usage 字段 → 后台按 天+服务+模型+操作 聚合 → USAGE_STATS/Usage_CLEAR 供设置页读取。
// 未返回计数的服务按字符估算（estInput/estOutput），绝不伪造 token。

const realFetch=globalThis.fetch;
let installedFetch=realFetch;
const requestBody=init=>{try{return JSON.parse(init?.body||'null');}catch{return null;}};
const capabilityFormat=body=>body?.response_format?.json_schema?.name==='relyless_capability'?body.response_format.json_schema:body?.text?.format?.name==='relyless_capability'?body.text.format:null;
const capabilitySuccess=body=>{
  const content=JSON.stringify({probe:capabilityFormat(body)?.schema?.properties?.probe?.enum?.[0]});
  return body?.text?.format?Response.json({status:'completed',output_text:content}):Response.json({choices:[{finish_reason:'stop',message:{content}}]});
};
beforeEach(()=>{
  installedFetch=realFetch;
  Object.defineProperty(globalThis,'fetch',{configurable:true,get:()=>installedFetch,set:handler=>{installedFetch=async(url,init)=>{const body=requestBody(init);return capabilityFormat(body)?capabilitySuccess(body):handler(url,init);};}});
});
afterEach(()=>{Object.defineProperty(globalThis,'fetch',{configurable:true,writable:true,value:realFetch});});
const schema={type:'object',additionalProperties:false,required:['value'],properties:{value:{type:'string'}}};
const service=(providerId,baseUrl,model='model')=>({id:'test',name:'Test',providerId,baseUrl,model,apiKey:'secret-key',options:{}});
const sse=chunks=>new Response(new ReadableStream({start(controller){const encoder=new TextEncoder();for(const chunk of chunks)controller.enqueue(encoder.encode(chunk));controller.close();}}),{headers:{'content-type':'text/event-stream'}});

test('usage rows merge by day+service+model+operation and estimate missing tokens',()=>{
  let rows=[];
  rows=mergeUsageEntry(rows,{provider:'api',service:'主力',model:'m1',operation:'ASSIST',ok:true,usage:{input:100,output:20},inputChars:400,outputChars:80},{now:Date.parse('2026-01-10T08:00:00Z')});
  rows=mergeUsageEntry(rows,{provider:'api',service:'主力',model:'m1',operation:'ASSIST',ok:true,usage:{input:50,output:10},inputChars:200,outputChars:40},{now:Date.parse('2026-01-10T09:00:00Z')});
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({day:'2026-01-10',requests:2,errors:0,input:150,output:30,estInput:0,estOutput:0});
  // 服务未返回 usage → 按字符估算（4 字符 ≈ 1 token），失败请求同样计数。
  rows=mergeUsageEntry(rows,{provider:'chatgpt',service:'ChatGPT 订阅',model:'gpt',operation:'ASSIST',ok:false,inputChars:800,outputChars:0},{now:Date.parse('2026-01-10T10:00:00Z')});
  const sub=rows.find(row=>row.provider==='chatgpt');
  expect(sub).toMatchObject({requests:1,errors:1,input:0,output:0,estInput:200,estOutput:0});
});

test('local MiniLM rough estimates override char fallback and mark estKind',()=>{
  let rows=[];
  // 分词器的计数只是本机粗估，与服务模型的实际 token 不同。
  rows=mergeUsageEntry(rows,{provider:'api',service:'主力',model:'m1',operation:'ASSIST',ok:true,inputChars:400,outputChars:80,estInput:97,estOutput:21,estKind:'tokenizer'},{now:Date.parse('2026-01-10T08:00:00Z')});
  expect(rows[0]).toMatchObject({estInput:97,estOutput:21,estKind:'tokenizer'});
  // 部分走 tokenizer、部分回退字符 → mixed。
  rows=mergeUsageEntry(rows,{provider:'api',service:'主力',model:'m1',operation:'ASSIST',ok:true,inputChars:400},{now:Date.parse('2026-01-10T09:00:00Z')});
  expect(rows[0].estKind).toBe('mixed');
  expect(rows[0].estInput).toBe(97+100);
  // 服务上报了 usage 时忽略条目内估计，也不改 estKind。
  rows=mergeUsageEntry(rows,{provider:'api',service:'主力',model:'m1',operation:'ASSIST',ok:true,usage:{input:10,output:5},estInput:99,estKind:'tokenizer'},{now:Date.parse('2026-01-10T10:00:00Z')});
  expect(rows[0].input).toBe(10);
  expect(normalizeUsageRow({day:'2026-01-10',provider:'api',service:'s',model:'m',operation:'ASSIST',estKind:'bogus'}).estKind).toBe('chars');
});

test('usageStatsView groups by service+model and honors the day window',()=>{
  const oldDay='2025-11-01',today=Date.parse('2026-01-10T12:00:00Z');
  let rows=[];
  rows=mergeUsageEntry(rows,{provider:'api',service:'A',model:'m1',operation:'ASSIST',ok:true,usage:{input:100,output:20}},{now:Date.parse(oldDay+'T00:00:00Z')});
  rows=mergeUsageEntry(rows,{provider:'api',service:'B',model:'m2',operation:'SUPPORT_BATCH',ok:true,usage:{input:10,output:5}},{now:today});
  rows=mergeUsageEntry(rows,{provider:'api',service:'B',model:'m2',operation:'ASSIST',ok:true,usage:{input:30,output:9}},{now:today});
  const week=usageStatsView(rows,{days:7,now:today});
  expect(week.totals.requests).toBe(2);
  expect(week.models).toHaveLength(1);
  expect(week.models[0]).toMatchObject({service:'B',model:'m2',requests:2,input:40,output:14});
  expect(week.models[0].operations.map(op=>op.operation).sort()).toEqual(['ASSIST','SUPPORT_BATCH']);
  const all=usageStatsView(rows,{days:0,now:today});
  expect(all.totals.requests).toBe(3);
  expect(all.models).toHaveLength(2);
});

test('normalizeUsageRow drops malformed rows and caps oversized fields',()=>{
  expect(normalizeUsageRow(null)).toBeNull();
  expect(normalizeUsageRow({day:'bad-date',service:'x'})).toBeNull();
  expect(normalizeUsageRow({day:'2026-01-10',service:'s',model:'m',requests:3.9,errors:-2,input:'40'})).toMatchObject({requests:3,errors:0,input:40});
});

test('chat providers report token usage when the response includes it',async()=>{
  const events=[];
  globalThis.fetch=async()=>Response.json({choices:[{finish_reason:'stop',message:{content:'{"value":"ok"}'}}],usage:{prompt_tokens:42,completion_tokens:7}});
  const result=await performProviderRequest(service('mistral','https://api.example.test/v1','mistral-small'),{},'Explain.',schema,{onUsage:u=>events.push(u)});
  expect(result).toEqual({value:'ok'});
  expect(events).toEqual([{input:42,output:7}]);
});

test('streaming chat captures usage carried on the finish chunk',async()=>{
  const events=[];
  globalThis.fetch=async()=>sse([
    'data: '+JSON.stringify({choices:[{delta:{content:'{"value":"ok"}'},finish_reason:null}]})+'\n\n',
    'data: '+JSON.stringify({choices:[{delta:{},finish_reason:'stop'}],usage:{prompt_tokens:9,completion_tokens:4}})+'\n\n',
    'data: [DONE]\n\n',
  ]);
  const result=await performProviderRequest(service('mistral','https://api.example.test/v1','mistral-small'),{},'Explain.',schema,{onContent:()=>{},onUsage:u=>events.push(u)});
  expect(result).toEqual({value:'ok'});
  expect(events).toEqual([{input:9,output:4}]);
});

test('responses and anthropic report their native usage shapes',async()=>{
  const events=[];
  globalThis.fetch=async()=>Response.json({status:'completed',output_text:'{"value":"ok"}',usage:{input_tokens:33,output_tokens:11}});
  await performProviderRequest(service('openai','https://api.example.test/v1','gpt-5'),{},'Explain.',schema,{onUsage:u=>events.push(u)});
  globalThis.fetch=async()=>Response.json({stop_reason:'end_turn',content:[{type:'text',text:'{"value":"ok"}'}],usage:{input_tokens:21,output_tokens:6}});
  await performProviderRequest(service('anthropic','https://api.example.test/v1','claude-haiku-4-5'),{},'Explain.',schema,{onUsage:u=>events.push(u)});
  expect(events).toEqual([{input:33,output:11},{input:21,output:6}]);
});

test('google usageMetadata and ollama eval counts are normalized',async()=>{
  const events=[];
  globalThis.fetch=async()=>Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:'{"value":"ok"}'}]}}],usageMetadata:{promptTokenCount:15,candidatesTokenCount:3}});
  await performProviderRequest(service('google','https://api.example.test/v1','gemini-2.5-flash-lite'),{},'Explain.',schema,{onUsage:u=>events.push(u)});
  globalThis.fetch=async()=>Response.json({message:{content:'{"value":"ok"}'},done_reason:'stop',prompt_eval_count:12,eval_count:5});
  await performProviderRequest(service('ollama','http://localhost:11434/api','gemma3:4b'),{},'Explain.',schema,{onUsage:u=>events.push(u)});
  expect(events).toEqual([{input:15,output:3},{input:12,output:5}]);
});

test('missing usage metadata emits nothing so callers can estimate',async()=>{
  const events=[];
  globalThis.fetch=async()=>Response.json({choices:[{finish_reason:'stop',message:{content:'{"value":"ok"}'}}]});
  await performProviderRequest(service('mistral','https://api.example.test/v1','mistral-small'),{},'Explain.',schema,{onUsage:u=>events.push(u)});
  expect(events).toEqual([]);
});

// 后台集成：一次真实 ASSIST 请求 → modelUsage 聚合 → USAGE_STATS 查询 → USAGE_CLEAR 清空。
const chromeBefore=globalThis.chrome;
const pageSender={url:'https://isolated.example/read',tab:{id:91,url:'https://isolated.example/read',active:true},frameId:0};
const trustedSender={id:'usage-fixture',url:'chrome-extension://usage-fixture/ui/options.html'};
const assistResult={result:{level:'hint',hint:'a short gloss',sense:'test sense',details:{meaning:{en:'It means something here.',zh:'它在这里表示某个意思。'},sentenceTranslation:'查询用了索引。'}}};

test('an assist request records model usage that USAGE_STATS reports and USAGE_CLEAR removes',async()=>{
  const primary={id:'svc-primary',name:'主力服务',providerId:'openai',baseUrl:'https://primary.example/v1',model:'primary-model',apiKey:'primary-key'};
  const fixture=isolatedChrome({wordSchemaVersion:5,productSchemaVersion:1,words:[],settings:{providerKind:'api',apiServices:[primary],activeApiServiceId:primary.id,domainDetection:{mode:'local'},rememberSupport:false}},{id:'usage-fixture'});
  globalThis.chrome=fixture.api;
  globalThis.fetch=async(url,init)=>{
    const body=requestBody(init),format=capabilityFormat(body);
    if(format)return capabilitySuccess(body);
    return Response.json({status:'completed',output_text:JSON.stringify(assistResult),usage:{input_tokens:120,output_tokens:30}});
  };
  await import(`../extension/background.js?usage=${Date.now()}`);
  const result=await isolatedSend(fixture,{type:'ASSIST',requestId:'usage-1',text:'index',context:'The database query uses an index.',domain:'tech',kind:'word',level:'hint',detail:'full'},pageSender);
  expect(result.hint).toBe('a short gloss');
  const stats=await isolatedSend(fixture,{type:'USAGE_STATS',days:7},trustedSender);
  expect(stats.usage.totals.requests).toBe(1);
  expect(stats.usage.totals.input).toBe(120);
  expect(stats.usage.totals.output).toBe(30);
  const group=stats.usage.models[0];
  expect(group).toMatchObject({provider:'api',service:'主力服务',model:'primary-model',requests:1});
  expect(group.operations[0].operation).toBe('ASSIST');
  // 网页侧不可读：USAGE_STATS 不在 contentAllowed。
  await expect(isolatedSend(fixture,{type:'USAGE_STATS'},pageSender)).rejects.toThrow();
  await isolatedSend(fixture,{type:'USAGE_CLEAR'},trustedSender);
  const cleared=await isolatedSend(fixture,{type:'USAGE_STATS',days:0},trustedSender);
  expect(cleared.usage.totals.requests).toBe(0);
  expect(fixture.local.modelUsage).toBeUndefined();
  globalThis.chrome=chromeBefore;
});

test('partial provider usage keeps missing output unknown for estimation',()=>{
  const [row]=mergeUsageEntry([],{provider:'api',service:'A',model:'m',operation:'ASSIST',ok:true,usage:{input:25,output:null},inputChars:400,outputChars:80});
  expect(row).toMatchObject({input:25,output:0,estInput:0,estOutput:20});
});

test('provider reporting only input tokens leaves output unreported',async()=>{
  const events=[];
  globalThis.fetch=async()=>Response.json({status:'completed',output_text:'{"value":"ok"}',usage:{input_tokens:17}});
  await performProviderRequest(service('openai','https://api.example.test/v1','gpt-5'),{},'Explain.',schema,{onUsage:u=>events.push(u)});
  expect(events).toEqual([{input:17,output:null}]);
});

test('incognito model calls never persist usage, failed clear remains visible and retryable',async()=>{
  const previousIndexedDB=globalThis.indexedDB;
  globalThis.indexedDB=indexedDB;
  const primary={id:'svc-primary',name:'Primary',providerId:'openai',baseUrl:'https://primary.example/v1',model:'primary-model',apiKey:'primary-key'};
  const fixture=isolatedChrome({wordSchemaVersion:5,productSchemaVersion:1,words:[],settings:{providerKind:'api',apiServices:[primary],activeApiServiceId:primary.id,domainDetection:{mode:'local'},rememberSupport:false}},{id:'usage-private-fixture'});
  globalThis.chrome=fixture.api;
  let failure=false,partial=false;
  globalThis.fetch=async()=>failure?new Response('unauthorized',{status:401}):Response.json({status:'completed',output_text:JSON.stringify(assistResult),usage:partial?{input_tokens:120}:{input_tokens:120,output_tokens:30}});
  const owner={id:fixture.id,url:'chrome-extension://'+fixture.id+'/ui/options.html'};
  try{
    await import('../extension/background.js?usage-private='+Date.now());
    const command=(id,text='index')=>({type:'ASSIST',requestId:id,text,context:'The database query uses '+text+'.',domain:'tech',kind:'word',level:'hint',detail:'full'});
    const privateSender={...pageSender,tab:{...pageSender.tab,incognito:true}};
    expect((await isolatedSend(fixture,command('private-ok'),privateSender)).hint).toBe('a short gloss');
    failure=true;
    await expect(isolatedSend(fixture,command('private-error','query'),privateSender)).rejects.toThrow();
    expect(fixture.local.modelUsage).toBeUndefined();
    failure=false;
    expect((await isolatedSend(fixture,command('ordinary-ok','database'),pageSender)).hint).toBe('a short gloss');
    const before=(await isolatedSend(fixture,{type:'USAGE_STATS',days:0},owner)).usage;
    expect(before.totals.requests).toBe(1);
    const remove=fixture.api.storage.local.remove;
    fixture.api.storage.local.remove=async keys=>{if(keys==='modelUsage')throw new Error('storage unavailable');return remove(keys);};
    await expect(isolatedSend(fixture,{type:'USAGE_CLEAR'},owner)).rejects.toThrow('storage unavailable');
    expect((await isolatedSend(fixture,{type:'USAGE_STATS',days:0},owner)).usage.totals.requests).toBe(1);
    expect(fixture.local.modelUsage.rows[0].requests).toBe(1);
    fixture.api.storage.local.remove=remove;
    await isolatedSend(fixture,{type:'USAGE_CLEAR'},owner);
    expect((await isolatedSend(fixture,{type:'USAGE_STATS',days:0},owner)).usage.totals.requests).toBe(0);
    expect(fixture.local.modelUsage).toBeUndefined();
    partial=true;
    await isolatedSend(fixture,command('ordinary-again','another'),pageSender);
    expect(fixture.local.modelUsage.rows[0].requests).toBe(1);
    expect(fixture.local.modelUsage.rows[0]).toMatchObject({input:120,output:0,estInput:0});
    expect(fixture.local.modelUsage.rows[0].estOutput).toBeGreaterThan(0);
    fixture.api.storage.local.remove=async keys=>{if(keys==='modelUsage')throw new Error('storage unavailable');return remove(keys);};
    await expect(isolatedSend(fixture,{type:'MEMORY_CLEAR'},owner)).rejects.toThrow('storage unavailable');
    expect(fixture.local.readingCleanup?.scope).toBe('memory');
    expect(fixture.local.modelUsage.rows[0].requests).toBe(1);
    fixture.api.storage.local.remove=remove;
    await isolatedSend(fixture,{type:'MEMORY_CLEAR'},owner);
    expect(fixture.local.modelUsage).toBeUndefined();
    expect(fixture.local.readingCleanup).toBeUndefined();
  }finally{globalThis.chrome=chromeBefore;globalThis.indexedDB=previousIndexedDB;}
});
