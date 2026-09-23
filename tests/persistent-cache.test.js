import {expect,test} from 'bun:test';
import {GLOSS_CACHE_LIMIT,PAGE_TRANSLATION_CACHE_LIMIT,normalizeGlossCache,normalizeTranslationCache,readCache,writeCache} from '../extension/persistent-cache.js';
import {usageRatioFor} from '../extension/usage-stats.js';

test('gloss cache keeps bounded normalized entries and drops malformed rows',()=>{
  const cache=normalizeGlossCache({
    good:{hint:'except if',translation:'除非',sense:'exception',at:1,hits:3},
    empty:{hint:'',translation:'',sense:'x',at:1},
    junk:'nope',list:[1,2],
    over:{hint:'x'.repeat(600),translation:'y',sense:'s',at:5,hits:99999},
  });
  expect(Object.keys(cache).sort()).toEqual(['good','over']);
  expect(cache.good.hits).toBe(3);
  expect(cache.over.hint.length).toBe(500);
  expect(cache.over.hits).toBe(9999);
});

test('read moves hits to the end and counts them without mutating the input',()=>{
  let cache=writeCache({},'a',{hint:'h',translation:'t',sense:'s',at:1,hits:0},{limit:3});
  cache=writeCache(cache,'b',{hint:'h2',translation:'t2',sense:'s2',at:2,hits:0},{limit:3});
  const before=cache;
  const hit=readCache(cache,'a');
  expect(hit.entry.hint).toBe('h');expect(hit.entry.hits).toBe(1);
  expect(before.a.hits).toBe(0);expect(Object.keys(hit.cache)).toEqual(['b','a']);
  expect(readCache(cache,'missing')).toBeNull();
});

test('write evicts least recently used entries beyond the limit',()=>{
  let cache={};
  for(let i=0;i<5;i++)cache=writeCache(cache,'k'+i,{zh:'译文'+i,at:i},{limit:4});
  expect(Object.keys(cache)).toEqual(['k1','k2','k3','k4']);
  const hit=readCache(cache,'k1').cache; // k1 移到末尾 → [k2,k3,k4,k1]
  cache=writeCache(hit,'k5',{zh:'译文5',at:5},{limit:4});
  expect(Object.keys(cache)).toEqual(['k3','k4','k1','k5']);
});

test('translation cache entries normalize shape and cap independently',()=>{
  const cache=normalizeTranslationCache({ok:{zh:'译文',at:9},bad:{zh:''},junk:42});
  expect(Object.keys(cache)).toEqual(['ok']);
  let big={};for(let i=0;i<PAGE_TRANSLATION_CACHE_LIMIT+3;i++)big=writeCache(big,'k'+i,{zh:'x',at:i},{limit:PAGE_TRANSLATION_CACHE_LIMIT});
  expect(Object.keys(big)).toHaveLength(PAGE_TRANSLATION_CACHE_LIMIT);
});

test('usageRatioFor computes tokens per char from recent matching rows only',()=>{
  const today=new Date().toISOString().slice(0,10);
  const rows=[
    {day:today,provider:'api',service:'main',model:'m1',operation:'EMERGENCY_TRANSLATE',requests:1,input:100,output:200,estInput:0,estOutput:0,inputChars:1000,outputChars:300},
    {day:today,provider:'api',service:'main',model:'m1',operation:'ASSIST',requests:1,input:50,output:50,estInput:0,estOutput:0,inputChars:500,outputChars:60},
    {day:today,provider:'api',service:'other',model:'m1',operation:'ASSIST',requests:1,input:999,output:999,estInput:0,estOutput:0,inputChars:1,outputChars:1},
    {day:'2000-01-01',provider:'api',service:'main',model:'m1',operation:'ASSIST',requests:1,input:9999,output:0,estInput:0,estOutput:0,inputChars:10,outputChars:0},
  ];
  const ratio=usageRatioFor(rows,{provider:'api',service:'main',model:'m1',days:30});
  expect(ratio.samples).toBe(1500);
  expect(ratio.tokensPerChar).toBeCloseTo(400/1500);
  expect(usageRatioFor(rows,{provider:'api',service:'unknown',days:30})).toBeNull();
});
