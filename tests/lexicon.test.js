import { test, expect } from 'bun:test';
import { analyze, analyzeBatch, englishTokenStats, historyMatches, isKnownTerm, localReferenceFor, resolveCanonicalTerm } from '../extension/lexicon.js';
import { DEFAULT_SETTINGS, wordId } from '../extension/shared.js';

const settings = patch => ({...DEFAULT_SETTINGS,...patch});
const terms = result => result.terms.map(candidate => candidate.term);
const saved = (term, domain = 'general', extra = {}) => ({
  id:wordId(term,domain),term,domain,kind:'word',revision:7,helpCount:2,senses:[],...extra,
});

test('batch analysis preserves input order and isolates per-domain preparation', () => {
  const words = [saved('liability','finance'),saved('liability','legal'),saved('pipeline','data')];
  const items = [
    {sentence:'The liability remains.',domain:'finance'},
    {sentence:'A pipeline can mitigate failures.',domain:'data'},
    {sentence:'The liability remains.',domain:'legal'},
    {sentence:'The pipeline remains.',domain:'data'},
  ];
  const options = settings({domain:'auto',annotationPolicy:{priorityTerms:['mitigate']}});
  const batch = analyzeBatch(items,options,words);

  expect(batch).toEqual(items.map(item => analyze(item.sentence,options,words,item.domain)));
  expect(batch.map(result => result.domain)).toEqual(['finance','data','legal','data']);
  expect(batch[0].terms.find(term => term.term === 'liability')?.id).toBe(wordId('liability','finance'));
  expect(batch[2].terms.find(term => term.term === 'liability')?.id).toBe(wordId('liability','legal'));
});

test('cold-start nominations prefer rare words and retain domain-specific common words', () => {
  const cold = terms(analyze('liability precedes ephemeral ramifications',settings({})));
  expect(cold.indexOf('ephemeral')).toBeLessThan(cold.indexOf('liability'));
  expect(terms(analyze('The promise resolves after training.',settings({domain:'tech'})))).toContain('promise');
  expect(terms(analyze('Ephemeral results arrive.',settings({})))).toContain('ephemeral');
});

const commonQueryTerms = ["simple","follow","meaning","example","search","window","clear","choice","answer","help","start","work","find","open","learn","read","idea","change","place","point","show","speak","meet","leave"];
const rareQueryTerms = ["ephemeral","ubiquitous","ambiguous","nuance","empirical","paradigm","inherent","subtle","pragmatic","meticulous","elusive","intricate","conundrum","dichotomy","idiosyncratic","convoluted","anomaly","alleviate","mitigate","sporadic","tenuous","exacerbate","coherent","salient"];
const queryHistory = (vocabulary,extra={}) => {
  const requestedAt = Date.now();
  return vocabulary.map(term=>saved(term,extra.domain || 'general',{requestedAt,...extra}));
};
const unseenSentence = 'The result reveals peculiar consequences and lasting arrangements.';

test('query difficulty changes unseen nominations without turning the estimate into a hard cutoff', () => {
  const cold = terms(analyze(unseenSentence,settings({})));
  const common = terms(analyze(unseenSentence,settings({}),queryHistory(commonQueryTerms)));
  const rare = terms(analyze(unseenSentence,settings({}),queryHistory(rareQueryTerms)));
  expect(cold).not.toContain('result');
  expect(common).toContain('result');
  expect(cold).toContain('consequences');
  expect(rare).not.toContain('consequences');
  expect(rare).toContain('peculiar');
  // A single easy query cannot overturn a broader body of difficult queries.
  expect(terms(analyze(unseenSentence,settings({}),[...queryHistory(rareQueryTerms),saved('help','general',{requestedAt:Date.now()})]))).toEqual(rare);
});

test('sparse or duplicated lexical evidence cannot manufacture a vocabulary level', () => {
  const cold = analyze(unseenSentence,settings({}));
  expect(analyze(unseenSentence,settings({}),queryHistory(commonQueryTerms.slice(0,2)))).toEqual(cold);
  const repeated = Array.from({length:24},(_,i)=>saved(['search','searches','searching'][i%3],'general',{requestedAt:Date.now(),helpCount:1000}));
  expect(analyze(unseenSentence,settings({}),repeated)).toEqual(cold);
});

test('only recent explicit word queries contribute to vocabulary inference', () => {
  const cold = analyze(unseenSentence,settings({})), now = Date.now();
  const passive = queryHistory(commonQueryTerms,{helpCount:0,requestedAt:0,lastSeen:now});
  const stale = queryHistory(commonQueryTerms,{requestedAt:now-120*86400000,lastSeen:now});
  const phrases = queryHistory(commonQueryTerms,{kind:'phrase'});
  const known = queryHistory(commonQueryTerms,{knownAt:now});
  for (const evidence of [passive,stale,phrases,known]) expect(analyze(unseenSentence,settings({}),evidence)).toEqual(cold);
  const recent = analyze(unseenSentence,settings({}),queryHistory(commonQueryTerms));
  const aging = analyze(unseenSentence,settings({}),queryHistory(commonQueryTerms,{requestedAt:now-60*86400000}));
  const score = result => result.terms.find(term=>term.term==='consequences').priority;
  expect(score(aging)).toBeGreaterThan(score(cold));
  expect(score(aging)).toBeLessThan(score(recent));
  // Successful help timestamps remain evidence even when an intent timestamp is absent.
  const committed = queryHistory(commonQueryTerms,{requestedAt:0,senses:[{lastHelpAt:now}]});
  expect(terms(analyze(unseenSentence,settings({}),committed))).toContain('result');
});

test('vocabulary inference respects domain boundaries with a weaker general fallback', () => {
  const tech = settings({domain:'tech'}), cold = analyze(unseenSentence,tech);
  const finance = queryHistory(commonQueryTerms,{domain:'finance'});
  expect(analyze(unseenSentence,tech,finance)).toEqual(cold);
  const general = analyze(unseenSentence,tech,queryHistory(commonQueryTerms));
  const sameDomain = analyze(unseenSentence,tech,queryHistory(commonQueryTerms,{domain:'tech'}));
  const score = result => result.terms.find(term=>term.term==='consequences').priority;
  expect(score(general)).toBeGreaterThan(score(cold));
  expect(score(sameDomain)).toBeGreaterThan(score(general));
});

test('explicit known words suppress cross-domain inflections but not derivations or substrings', () => {
  const words = [saved('search','tech',{knownAt:1}),saved('hard','general',{knownAt:1}),saved('mitigate','general',{knownAt:1})];
  expect(isKnownTerm('SEARCHES',words)).toBe(true);
  expect(isKnownTerm('hardly',words)).toBe(false);
  expect(isKnownTerm('research',words)).toBe(false);
  expect(isKnownTerm('rated',[saved('rat','general',{knownAt:1})])).toBe(false);
  expect(terms(analyze('Mitigated risks remain.',settings({domain:'finance'}),words))).not.toContain('mitigated');
  expect(terms(analyze('Mitigated risks remain.',settings({domain:'finance'}),words.map(word=>({...word,knownAt:0}))))).toContain('mitigated');
});

test('applied priority terms influence the candidate shortlist before truncation', () => {
  const words = ['mitigate','ephemeral','liability','ramifications'].map(term=>saved(term));
  const source = 'mitigate ephemeral liability ramifications';
  expect(terms(analyze(source,settings({}),words)).slice(0,3)).not.toContain('ramifications');
  expect(terms(analyze(source,settings({annotationPolicy:{priorityTerms:['ramifications']}}),words)).slice(0,3)).toContain('ramifications');
});

test('orders same-domain history before custom or domain expressions and strips support state', () => {
  const history = saved('mitigate','general',{hintPreference:'less',senses:[{key:'sense',quietUntil:Infinity}]});
  const result = analyze('A pipeline can mitigate ephemeral failures.',settings({
    domain:'general',customTerms:[{term:'pipeline',translation:'流程',domain:'general'}],
  }),[history]);
  expect(terms(result).slice(0,3)).toEqual(['mitigate','pipeline','ephemeral']);
  expect(result.terms[0]).toMatchObject({
    id:history.id,term:'mitigate',canonicalTerm:'mitigate',domain:'general',kind:'word',priority:3,reason:'history',
  });
  for (const candidate of result.terms) {
    for (const forbidden of ['familiarity','stage','revision','senses','hintPreference','helpCount','translation','support']) {
      expect(candidate).not.toHaveProperty(forbidden);
    }
  }
});

test('resolves inflections to a unique historical identity without depending on array order', () => {
  const mitigate = saved('mitigate');
  expect(resolveCanonicalTerm('Mitigated','general',[mitigate])).toBe('mitigate');
  expect(resolveCanonicalTerm('Rated','general',[saved('rat'),saved('rate')])).toBe('rated');
  expect(resolveCanonicalTerm('mitigated','finance',[mitigate])).toBe('mitigate');

  const finance = saved('liability','finance');
  const general = saved('liability','general');
  for (const words of [[finance,general],[general,finance]]) {
    expect(resolveCanonicalTerm('Liability','finance',words)).toBe('liability');
    expect(analyze('mitigated liability',settings({domain:'finance'}),[mitigate,...words]).terms
      .find(candidate => candidate.term === 'mitigated')?.id).toBe(wordId('mitigate','finance'));
  }
});
test('keeps passive suggestions below custom terms and reserves history priority for explicit requests', () => {
  const passive = saved('consequences','general',{helpCount:0,requestedAt:0});
  const requested = saved('ephemeral','general',{helpCount:0,requestedAt:42});
  const result = analyze('The ephemeral pipeline has consequences.',settings({
    domain:'general',customTerms:[{term:'pipeline',translation:'流程',domain:'general'}],
  }),[passive,requested]);
  expect(result.terms.slice(0,3).map(({term,reason}) => ({term,reason}))).toEqual([
    {term:'ephemeral',reason:'history'},
    {term:'pipeline',reason:'custom'},
    {term:'consequences',reason:'suggested'},
  ]);
});

test('returns every exact case, inflection, and flexible-space history occurrence', () => {
  const mitigate = saved('mitigate');
  const phrase = saved('in spite of','general',{kind:'phrase'});
  const source = '🙂 Mitigated risks, then MITIGATED again; in   spite of that, In\tSpite Of it. unmitigated https://x.test/mitigated';
  const matches = historyMatches(source,'general',[phrase,mitigate]);
  const visible = matches.map(({word,text,start,end,sameDomain,requested}) => ({term:word.term,text,start,end,sameDomain,requested}));
  expect(visible).toEqual([
    {term:'mitigate',text:'Mitigated',start:3,end:12,sameDomain:true,requested:true},
    {term:'mitigate',text:'MITIGATED',start:25,end:34,sameDomain:true,requested:true},
    {term:'in spite of',text:'in   spite of',start:42,end:55,sameDomain:true,requested:true},
    {term:'in spite of',text:'In\tSpite Of',start:62,end:73,sameDomain:true,requested:true},
  ]);
  for (const match of matches) expect(source.slice(match.start,match.end)).toBe(match.text);

  const analyzed = analyze(source,settings({domain:'general'}),[phrase,mitigate]);
  expect(analyzed.terms.find(candidate => candidate.term === 'mitigated')?.occurrences).toEqual([
    {text:'Mitigated',start:3,end:12},{text:'MITIGATED',start:25,end:34},
  ]);
  expect(analyzed.terms.find(candidate => candidate.term === 'in spite of')?.occurrences).toEqual([
    {text:'in   spite of',start:42,end:55},{text:'In\tSpite Of',start:62,end:73},
  ]);
});

test('prefers current-domain identity while carrying only general query intent', () => {
  const general = saved('liability','general',{senses:[{key:'general-sense',quietUntil:Infinity}]});
  for (const words of [[general],[general].reverse()]) {
    const candidate = analyze('liability',settings({domain:'finance'}),words).terms[0];
    expect(candidate).toMatchObject({term:'liability',canonicalTerm:'liability',domain:'finance',
      id:wordId('liability','finance'),priority:3,reason:'history'});
    for (const privateField of ['revision','senses','helpCount','hintPreference','support']) {
      expect(candidate).not.toHaveProperty(privateField);
    }
    expect(historyMatches('liability','finance',words)[0]).toMatchObject({word:general,sameDomain:false,requested:true});
  }

  const generalReconcile = saved('reconcile','general');
  const financePassive = saved('reconcile','finance',{helpCount:0,requestedAt:0});
  for (const words of [[generalReconcile,financePassive],[financePassive,generalReconcile]]) {
    const [match] = historyMatches('RECONCILE','finance',words);
    expect(match.word).toBe(financePassive);
    expect(match).toMatchObject({text:'RECONCILE',sameDomain:true,requested:true});
    expect(analyze('RECONCILE',settings({domain:'finance'}),words).terms[0]).toMatchObject({
      id:financePassive.id,priority:3,reason:'history',
    });
  }
});

test('does not nominate sentence records, names, URLs, numbers, or unknown noise', () => {
  const sentence = {...saved('an entire sentence'),kind:'sentence'};
  const result = analyze('An entire sentence names Shisui at https://example.test/ephemeral-9000 with zxqvplm 12345',settings({}),[sentence]);
  expect(terms(result)).not.toContain('an entire sentence');
  for (const rejected of ['shisui','ephemeral','zxqvplm']) expect(terms(result)).not.toContain(rejected);
  expect(result.terms.every(term => !/\d/.test(term.term))).toBe(true);
});

test('returns only an exact local reference with documented precedence', () => {
  const customTerms = [
    {term:'token',translation:'通用自定义',domain:'general'},
    {term:'token',translation:'技术自定义',domain:'tech'},
  ];
  expect(localReferenceFor(' TOKEN ','tech',{customTerms})).toMatchObject({translation:'技术自定义',domain:'tech',custom:true});
  expect(localReferenceFor('token','data',{customTerms})).toMatchObject({translation:'通用自定义',domain:'general',custom:true});
  expect(localReferenceFor('token','tech',{})).toMatchObject({translation:'模型文本单位',domain:'tech',custom:false});
  expect(localReferenceFor('mitigate','tech',{})).toMatchObject({translation:'减轻；缓解',domain:'general',custom:false});
  expect(localReferenceFor('mitigated','general',{})).toBeNull();
  expect(localReferenceFor('an entire sentence','general',{})).toBeNull();
});

test('reports recognized token coverage and distinct required function words', () => {
  expect(englishTokenStats('The database and the index are used with data.')).toEqual({tokens:9,recognized:9,functionWords:4});
  expect(englishTokenStats('the THE and of to is are that with zxqvplm')).toEqual({tokens:10,recognized:9,functionWords:8});
  expect(englishTokenStats('Visit https://example.test/the and read it.')).toEqual({tokens:4,recognized:4,functionWords:1});
});

test('history occurrences respect complete source tokens in mixed and compound text', () => {
  const source = "Cache’s cache‑backed cache2 cache_v2 中文cache cafe\u0301 in spite of-errors; in   spite of errors unless cache expires.";
  const matches = historyMatches(source,'general',[saved('cache'),saved('backed'),saved('cafe'),saved('cache-backed'),saved('unless'),saved('in spite of','general',{kind:'phrase'})]);
  expect(matches.map(({text})=>text)).toEqual(['Cache’s','cache‑backed','in   spite of','unless','cache']);
  for (const match of matches) expect(source.slice(match.start,match.end)).toBe(match.text);
});
