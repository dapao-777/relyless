import {expect,test} from 'bun:test';
import {
  normalizePreparationContext,normalizeSupportItems,prepareSupportItems,normalizeSupportResponse,normalizeSupportResult,inspectSupportResponse,normalizeSupportAttempt,requestSupportWithCorrection,
  normalizeAssistanceCommand,normalizeAssistanceRequest,normalizeAssistanceResult,
  normalizeEmergencyItems,normalizeEmergencyResult,normalizePageTranslationItems,inspectPageTranslationResult,normalizePageTranslationResult,
} from '../extension/gloss.mjs';

const sentence = 'The request is retried unless  the token has expired. 😀';
const start = sentence.indexOf('unless');
const support = [{id:'one',sentence,domain:'tech',candidates:[{text:'unless',wordId:'general:unless',knownSenses:['except if']}]}];
const article = {key:'a'.repeat(64),text:`Retry policy. ${sentence} Contact support after expiration.`,coverage:'full'};
const meaning = {en:'In this sentence, it introduces the condition that prevents a retry.',zh:'在本句中，它引出阻止重试的条件。'};
const sentenceTranslation = '只要令牌没有过期，请求就会重试。';
const target = {text:'unless',start,end:start+6,hint:'except if this is true',translation:'除非',sense:'except if'};

const richResult = (overrides={}) => ({items:[{id:'one',target,meaning,sentenceTranslation,...overrides}]});

test('support provider selects local target IDs and reconstructs exact source ranges',()=>{
  const prepared=prepareSupportItems(normalizeSupportItems(support));

  const raw={items:[{id:'one',target:{id:'t5_5',hint:target.hint,translation:target.translation,sense:target.sense},meaning,sentenceTranslation}]};
  expect(normalizeSupportResponse(raw,prepared,article)).toEqual(richResult());
  expect(()=>normalizeSupportResponse({items:[{...raw.items[0],target:{...raw.items[0].target,id:'t0_5'}}]},prepared,article)).toThrow();
});

test('focused support binds duplicate words to their exact occurrence',()=>{
  const repeated='Inspect first, then inspect again.';
  const second=repeated.lastIndexOf('inspect'),local=[{id:'repeat',sentence:repeated,domain:'tech',candidates:[{text:'inspect'}],focus:{start:second,end:second+7}}],prepared=prepareSupportItems(local);

  const raw={items:[{id:'repeat',target:{id:'t5_5',hint:'look at closely',translation:'检查',sense:'examine closely'},meaning:{en:'It means to examine the later item closely.',zh:'这里指仔细检查后一个项目。'},sentenceTranslation:'先检查第一个，再检查一次。'}]};
  expect(normalizeSupportResponse(raw,prepared).items[0].target).toMatchObject({text:'inspect',start:second,end:second+7});
  expect(()=>normalizeSupportResponse({items:[{...raw.items[0],target:{...raw.items[0].target,id:'t1_1'}}]},prepared)).toThrow();
});

test('empty local target sets never ask a model to invent a selection',async()=>{
  const items=prepareSupportItems([{id:'title',sentence:'Compaction',domain:'tech',candidates:[]}]);
  let requests=0;
  const result=await requestSupportWithCorrection(items,null,async()=>{requests++;throw new Error('No legal model task exists');});
  expect(requests).toBe(0);
  expect(result.items).toEqual([{id:'title',target:null,meaning:{en:null,zh:null},sentenceTranslation:null}]);
});

test('short source blocks retain full lexical targets without failing their batch',async()=>{
  const items=prepareSupportItems([
    {id:'heading',sentence:'Debugging',domain:'tech',candidates:[{text:'Debugging'}]},
    {id:'phrase',sentence:'Transaction isolation',domain:'data',candidates:[{text:'Transaction isolation'}]},
    ...support,
  ]);
  const raw={items:[
    {id:'heading',target:{id:'t1_1',hint:'finding and fixing bugs',translation:'调试',sense:'finding and fixing program errors'},meaning:{en:'This heading introduces debugging tools.',zh:'这个标题介绍调试工具。'},sentenceTranslation:'调试'},
    {id:'phrase',target:{id:'t1_2',hint:'keeping transactions separate',translation:'事务隔离',sense:'separation between concurrent transactions'},meaning:{en:'This heading names a database property.',zh:'这个标题指一种数据库属性。'},sentenceTranslation:'事务隔离'},
    {id:'one',target:{id:'t5_5',hint:target.hint,translation:target.translation,sense:target.sense},meaning,sentenceTranslation},
  ]};
  let requests=0;
  const result=await requestSupportWithCorrection(items,article,async batch=>{requests++;return inspectSupportResponse(raw,batch,article);});
  expect(result.items.map(row=>[row.id,row.target.text,row.target.start,row.target.end])).toEqual([
    ['heading','Debugging',0,9],['phrase','Transaction isolation',0,21],['one','unless',start,start+6],
  ]);
  expect(requests).toBe(1);
});

test('an exact source range cannot nominate a word outside the local candidates',()=>{
  const items=prepareSupportItems([{id:'one',sentence:'Inspect logs carefully.',domain:'tech',candidates:[{text:'logs'}]}]);
  const raw={items:[{id:'one',target:{id:'t1_1',hint:'look closely',translation:'检查',sense:'examine'},meaning,sentenceTranslation:'仔细检查日志。'}]};
  let error;try{inspectSupportResponse(raw,items);}catch(failure){error=failure;}
  expect(error).toMatchObject({code:'OUTPUT_INVALID',detail:{fields:['target','id'],itemIndex:0}});
});

test('filtered requests keep diagnostics attached to the original input item',async()=>{
  const items=prepareSupportItems([{id:'empty',sentence:'Compaction',domain:'tech',candidates:[]},...support]);
  let failure;
  try{await requestSupportWithCorrection(items,article,async batch=>inspectSupportResponse({items:[{id:'one',target:{id:'t1_1',hint:'look closely',translation:'检查',sense:'examine'},meaning,sentenceTranslation}]},batch,article));}catch(error){failure=error;}
  expect(failure).toMatchObject({code:'OUTPUT_INVALID',detail:{fields:['target','id'],itemIndex:1}});
});

test('local targets cannot be forged or select partial source tokens across the native boundary',()=>{
  const items=prepareSupportItems([{id:'one',sentence:'cache_key cache',domain:'tech',candidates:[{text:'cache'}]}]);
  const raw={items:[{id:'one',target:{id:'t2_2',hint:'temporary storage',translation:'缓存',sense:'temporary storage'},meaning,sentenceTranslation:'缓存键和缓存。'}]};
  expect(normalizeSupportResponse(raw,items).items[0].target).toMatchObject({text:'cache',start:10,end:15});
  expect(()=>normalizeSupportResponse(raw,items.map(item=>({...item,targets:[{id:'t2_2',text:'cache_key',first:1,last:1}]})))).toThrow();
  const forged={items:[{id:'one',target:{text:'cache',start:0,end:5,hint:'temporary storage',translation:'缓存',sense:'temporary storage'},meaning,sentenceTranslation:'缓存键和缓存。'}],invalid:[]};
  expect(()=>normalizeSupportAttempt(forged,items)).toThrow();
});

test('support keeps the word gloss, contextual meaning, and whole-sentence translation separate',()=>{
  const selected = normalizeSupportItems(support);
  expect(selected[0].sentence).toBe(sentence);
  expect(selected[0].candidates[0]).toEqual({text:'unless',wordId:'general:unless',knownSenses:['except if']});
  expect(normalizeSupportResult(richResult(),selected,article)).toEqual(richResult());
});

test('preparation context is bounded, explicit, and defaults to an isolated excerpt',()=>{
  expect(normalizePreparationContext()).toEqual({key:'',text:'',coverage:'excerpt'});
  expect(normalizePreparationContext(article)).toEqual(article);
  expect(()=>normalizePreparationContext({...article,key:'not-a-sha256'})).toThrow('上下文');
  expect(()=>normalizePreparationContext({...article,text:'x'.repeat(12001)})).toThrow('上下文');
  expect(()=>normalizePreparationContext({key:'',text:'',coverage:'full'})).toThrow('上下文');
  expect(()=>normalizePreparationContext({...article,extra:true})).toThrow('上下文');
});

test('support target null carries no fabricated explanation',()=>{
  const isolated = {items:[{id:'one',target:null,meaning:{en:null,zh:null},sentenceTranslation:null}]};
  expect(normalizeSupportResult(isolated,support)).toEqual(isolated);
  expect(()=>normalizeSupportResult({items:[{...isolated.items[0],meaning}]},support,article)).toThrow();
  expect(()=>normalizeSupportResult({items:[{...isolated.items[0],sentenceTranslation:'整句翻译。'}]},support,article)).toThrow();
});

test('support rejects incomplete, forged, language-invalid, and offset-invalid batches',()=>{
  expect(()=>normalizeSupportResult({items:[]},support,article)).toThrow('完整批次');
  expect(()=>normalizeSupportResult({items:[{id:'one',target:null,meaning:{en:null,zh:null},sentenceTranslation:null,support:{stage:'quiet'}}]},support,article)).toThrow('无效');
  expect(()=>normalizeSupportResult(richResult({target:{...target,start:start+1,end:start+7}}),support,article)).toThrow('无效目标');
  expect(()=>normalizeSupportResult(richResult({target:{...target,hint:'除非'}}),support,article)).toThrow('无效目标');
  expect(()=>normalizeSupportResult(richResult({target:{...target,translation:'unless'}}),support,article)).toThrow('无效目标');
  expect(()=>normalizeSupportResult(richResult({meaning:{en:'含中文',zh:'中文'}}),support,article)).toThrow('解释内容');
  expect(()=>normalizeSupportResult(richResult({sentenceTranslation:'Chinese without Han'}),support,article)).toThrow();
  expect(()=>normalizeSupportResult(richResult({meaning:{en:'x'.repeat(601),zh:'语境义'}}),support,article)).toThrow();
  expect(()=>normalizeSupportResult(richResult({meaning:{en:'Contextual meaning.',zh:'义'.repeat(401)}}),support,article)).toThrow();
  expect(()=>normalizeSupportResult(richResult({sentenceTranslation:'译'.repeat(2001)}),support,article)).toThrow();
  expect(()=>normalizeSupportResult({items:[{...richResult().items[0],details:{meaning,sentenceTranslation}}]},support,article)).toThrow('无效');
});

test('reader evidence is copied exactly and rejects unbounded or non-English terms',()=>{
  const reader = {recentQueries:['unless','transaction isolation'],lessHelpTerms:['index']};
  const selected = normalizeSupportItems([{...support[0],reader}]);
  expect(selected[0].reader).toEqual(reader);
  expect(selected[0].reader).not.toBe(reader);
  expect(selected[0].reader.recentQueries).not.toBe(reader.recentQueries);
  expect(()=>normalizeSupportItems([{...support[0],reader:{recentQueries:Array(13).fill('unless'),lessHelpTerms:[]}}])).toThrow('读者证据');
  expect(()=>normalizeSupportItems([{...support[0],reader:{recentQueries:['  unless'],lessHelpTerms:[]}}])).toThrow('读者证据');
  expect(()=>normalizeSupportItems([{...support[0],reader:{recentQueries:['除非'],lessHelpTerms:[]}}])).toThrow('读者证据');
  expect(()=>normalizeSupportItems([{...support[0],reader:{recentQueries:[],lessHelpTerms:[],level:'C1'}}])).toThrow('读者证据');
});
test('support request validates exact candidates, aggregate limits, and keeps original whitespace',()=>{
  expect(()=>normalizeSupportItems([{...support[0],candidates:[{text:'missing'}]}])).toThrow('候选');
  expect(()=>normalizeSupportItems(Array.from({length:9},(_,i)=>({...support[0],id:String(i)})))).toThrow('1–8');
  expect(()=>normalizeSupportItems([{...support[0],candidates:[{text:'unless',knownSenses:['例外']}]}])).toThrow('候选');
});

const wordRequest = {requestId:'req-1',text:'unless',context:sentence,domain:'tech',kind:'word',level:'hint',detail:'full',wordId:'general:unless',senseKey:'sense-1',bypassCache:true};

test('assistance command validates local identity but provider request contains no local fields',()=>{
  expect(normalizeAssistanceCommand(wordRequest)).toEqual(wordRequest);
  expect(normalizeAssistanceRequest(wordRequest)).toEqual({text:'unless',context:sentence,domain:'tech',kind:'word',level:'hint',detail:'full'});
  expect(()=>normalizeAssistanceCommand({...wordRequest,stage:'quiet'})).toThrow('字段');
});

test('assistance result keeps its private native envelope boundary and rejects forged local fields',()=>{
  const provider = normalizeAssistanceRequest(wordRequest);
  const details = {meaning:{en:'Introduces an exception to a condition.',zh:'引出某个条件的例外。'},sentenceTranslation};
  expect(normalizeAssistanceResult({level:'hint',hint:'except if this happens',sense:'except if',details},provider)).toEqual({level:'hint',hint:'except if this happens',sense:'except if',details});
  expect(normalizeAssistanceResult({level:'hint',hint:null},provider)).toEqual({level:'hint',hint:null});
  expect(()=>normalizeAssistanceResult({level:'hint',hint:'except if',sense:'except if',details,wordId:'fake'},provider)).toThrow('格式');
  expect(()=>normalizeAssistanceResult({level:'hint',hint:'except if',sense:'except if'},provider)).toThrow();
  expect(()=>normalizeAssistanceResult({level:'hint',hint:'except if',sense:'except if',details:{...details,contextMeaning:'mixed'}},provider)).toThrow();
  expect(()=>normalizeAssistanceResult({level:'rescue',translation:'除非',sense:'except if',details},provider)).toThrow('格式');
  expect(()=>normalizeAssistanceResult({level:'hint',hint:null,sense:'except if'},provider)).toThrow('不得包含义项');
});

test('passage assistance is bounded to three sentences and only returns the selected unit shape',()=>{
  const passage = {text:'First condition. Second exception.',context:'First condition. Second exception.',domain:'general',kind:'passage',level:'rescue',detail:'full'};
  expect(normalizeAssistanceResult({level:'rescue',translation:'第一个条件。第二个例外。'},passage)).toEqual({level:'rescue',translation:'第一个条件。第二个例外。'});
  expect(()=>normalizeAssistanceResult({level:'rescue',translation:'第一个条件。第二个例外。',details:{meaning:{en:'A condition.',zh:'一个条件。'},sentenceTranslation:'第一个条件。第二个例外。'}},passage)).toThrow('格式');
  expect(()=>normalizeAssistanceRequest({...passage,text:'One. Two. Three. Four.',context:'One. Two. Three. Four.'})).toThrow('最多 3 句');
  expect(()=>normalizeAssistanceRequest({...passage,text:'x'.repeat(601),context:'x'.repeat(601)})).toThrow('600 字符');
  expect(()=>normalizeAssistanceResult({level:'rescue',translation:'Chinese without Han'},passage)).toThrow('内容');
});

test('emergency translation validates exact ids, plain result shape, and item limits',()=>{
  const items = [{id:'first',text:'Keep the original English visible.'},{id:'second',text:'Stop translating when asked.'}];
  expect(normalizeEmergencyItems(items)).toEqual(items);
  expect(normalizeEmergencyResult({items:[{id:'second',translation:'收到请求时停止翻译。'},{id:'first',translation:'保留可见的英文原文。'}]},items)).toEqual({items:[{id:'first',translation:'保留可见的英文原文。'},{id:'second',translation:'收到请求时停止翻译。'}]});
  expect(()=>normalizeEmergencyItems([...items,{id:'third',text:'x'},{id:'fourth',text:'x'},{id:'fifth',text:'x'}])).toThrow('1–4');
  expect(()=>normalizeEmergencyItems([{id:'one',text:'x'.repeat(4001)}])).toThrow('无效');
  expect(()=>normalizeEmergencyItems([{id:'one',text:'x'.repeat(4000)},{id:'two',text:'x'.repeat(4000)},{id:'three',text:'x'.repeat(4000)},{id:'four',text:'x'}])).toThrow('过长');
  for(const [code,first] of [['ITEM_ID',{id:'wrong',translation:'错误标识。'}],['TRANSLATION_NO_HAN',{id:'first',translation:'local'}],['ITEM_FIELDS',{id:'first',translation:'翻译。',html:'<p>'}]]){
    let failure;try{normalizeEmergencyResult({items:[first,{id:'second',translation:'翻译。'}]},items);}catch(error){failure=error;}
    expect(failure?.code).toBe(code);expect(failure?.detail.itemIndex).toBe(0);
  }
});

const pageContext={title:'Retry guide',heading:'Failure handling',before:'The service may pause.',after:'Retry only the failed item.'};
const pageItems=[{id:'first',text:'Keep the original English visible.',context:pageContext},{id:'second',text:'Stop translating when asked.',context:{...pageContext,heading:'Stopping'}}];

test('page translation validates closed bounded context while passage remains context-free',()=>{
  expect(normalizePageTranslationItems(pageItems)).toEqual(pageItems);
  expect(()=>normalizePageTranslationItems([{...pageItems[0],context:{...pageContext,title:'x'.repeat(161)}}])).toThrow('上下文');
  expect(()=>normalizePageTranslationItems([{...pageItems[0],context:{...pageContext,extra:''}}])).toThrow('上下文');
  expect(()=>normalizeEmergencyItems(pageItems)).toThrow('无效');
  const oversized=[1,2,3].map(index=>({id:`p${index}`,text:'x'.repeat(3500),context:{title:'t'.repeat(160),heading:'h'.repeat(160),before:'b'.repeat(400),after:'a'.repeat(400)}}));
  expect(()=>normalizePageTranslationItems(oversized)).toThrow('过长');
});

test('page translation preserves known successes and assigns only known bad or missing items errors',()=>{
  const inspected=inspectPageTranslationResult({items:[{id:'second',translation:''},{id:'first',translation:'保留可见的英文原文。'}]},pageItems);
  expect(inspected).toEqual({items:[{id:'first',translation:'保留可见的英文原文。'}],errors:[{id:'second',code:'TRANSLATION_EMPTY'}]});
  expect(inspectPageTranslationResult({items:[{id:'first',translation:'保留可见的英文原文。'}]},pageItems)).toEqual({items:[{id:'first',translation:'保留可见的英文原文。'}],errors:[{id:'second',code:'ITEM_ID'}]});
  expect(normalizePageTranslationResult(inspected,pageItems)).toEqual(inspected);
});

test('page translation rejects unreliable batch mapping without keeping plausible neighbors',()=>{
  for(const [raw,code] of [
    ['not json','BATCH_SHAPE'],
    [{items:[{id:'first',translation:'正确。'},{id:'unknown',translation:'错误。'}]},'ITEM_ID'],
    [{items:[{id:'first',translation:'正确。'},{id:'first',translation:'重复。'}]},'ITEM_DUPLICATE'],
  ])expect(inspectPageTranslationResult(raw,pageItems)).toEqual({items:[],errors:pageItems.map(({id})=>({id,code}))});
});
test('one correction preserves valid items, pins the failed occurrence, and carries no rejected text',async()=>{
  const items=prepareSupportItems([{...support[0],id:'good'},{...support[0],id:'bad'}]);
  const row=(id,translation)=>({id,target:{id:'t5_5',hint:target.hint,translation,sense:target.sense},meaning,sentenceTranslation});
  const calls=[];
  const result=await requestSupportWithCorrection(items,article,async(batch,corrections)=>{
    calls.push({ids:batch.map(item=>item.id),corrections});
    if(!corrections.length)return inspectSupportResponse({items:[row('bad','PRIVATE rejected response'),row('good','除非')]},batch,article);
    expect(batch[0].focus).toEqual({first:5,last:5});
    return inspectSupportResponse({items:[row('bad','若非')]},batch,article);
  });
  expect(calls.map(call=>call.ids)).toEqual([['good','bad'],['bad']]);
  expect(JSON.stringify(calls)).not.toContain('PRIVATE rejected response');
  expect(result.items.map(item=>[item.id,item.target.translation])).toEqual([['good','除非'],['bad','若非']]);
});

test('a correction cannot become an endless retry or erase the failed target',async()=>{
  const items=prepareSupportItems(support);
  for(const erase of [false,true]){
    let calls=0;
    await expect(requestSupportWithCorrection(items,article,async batch=>{
      calls++;
      const row=erase&&calls===2?{id:'one',target:null,meaning:{en:null,zh:null},sentenceTranslation:null}:{id:'one',target:{id:'t5_5',hint:target.hint,translation:'unless',sense:target.sense},meaning,sentenceTranslation};
      return inspectSupportResponse({items:[row]},batch,article);
    })).rejects.toThrow('纠正后');
    expect(calls).toBe(2);
  }
});

test('transport failures are never retried; structural failures get exactly one retry',async()=>{
  const items=prepareSupportItems(support),base={id:'one',target:{id:'t5_5',hint:target.hint,translation:'除非',sense:target.sense},meaning,sentenceTranslation};
  let calls=0;
  await expect(requestSupportWithCorrection(items,article,async()=>{calls++;throw new Error('network unavailable');})).rejects.toThrow();
  expect(calls).toBe(1);
  for(const response of [{...base,id:'forged'},{...base,target:{...base.target,id:'t0_0'}}]){
    calls=0;
    await expect(requestSupportWithCorrection(items,article,async batch=>{calls++;return inspectSupportResponse({items:[response]},batch,article);})).rejects.toThrow();
    expect(calls).toBe(2);
  }
});

test('one structural retry recovers a batch whose target carried an extra field',async()=>{
  const items=prepareSupportItems(support),valid={id:'one',target:{id:'t5_5',hint:target.hint,translation:'除非',sense:target.sense},meaning,sentenceTranslation};
  const malformed={...valid,target:{...valid.target,text:'unless'}};
  let calls=0;
  const result=await requestSupportWithCorrection(items,article,async batch=>{calls++;return inspectSupportResponse({items:[calls===1?malformed:valid]},batch,article);});
  expect(calls).toBe(2);
  expect(result.items[0].target).toMatchObject({text:'unless',translation:'除非'});
});

test('native attempts reject overlapping success and failure IDs and shifted correction focus',()=>{
  const items=prepareSupportItems(support),good=richResult().items[0];
  expect(()=>normalizeSupportAttempt({items:[good],invalid:[{id:'one',fields:['target','translation']}]},items,article)).toThrow();
  const focused=items.map(item=>({...item,focus:{first:5,last:5}}));
  expect(()=>normalizeSupportAttempt({items:[],invalid:[{id:'one',fields:['target','translation'],focus:{first:4,last:4}}]},focused,article)).toThrow('焦点');
});

