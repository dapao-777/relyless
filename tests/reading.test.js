import {test,expect} from 'bun:test';
import {encounter,interact,migrateSupportWord,normalizeSenseLabel,readingEvidence,supportState} from '../extension/reading.js';

const DAY = 86_400_000;
const START = 10 * DAY;
const SENSE_KEY = 'sense-subtle';

function fresh(overrides = {}) {
  return {
    id:'general:subtle',term:'subtle',domain:'general',kind:'word',revision:0,
    helpCount:0,lastSeen:0,hintPreference:null,
    senses:[{
      key:SENSE_KEY,label:'hard to notice',opportunityDays:0,lastOpportunityAt:0,
      lastHelpAt:0,quietUntil:0,quietCycles:0,quietOpportunityDays:0,
      hintPreference:null,assistedPageKey:'',
    }],
    ...overrides,
  };
}

function meet(word, day, hintShown) {
  return encounter(word,`page-${day}`,START+day*DAY,{senseKey:SENSE_KEY,hintShown});
}
function evidenceWord(term, domain = 'general', overrides = {}) {
  return {...fresh(),id:domain+':'+term,term,domain,...overrides};
}

test('sense labels use the persisted NFKC whitespace and lowercase identity', () => {
  expect(normalizeSenseLabel('  ＨＡＲＤ\n\tTo   Notice  ')).toBe('hard to notice');
  expect(normalizeSenseLabel('')).toBeNull();
  expect(normalizeSenseLabel('x'.repeat(61))).toBeNull();
  expect(normalizeSenseLabel(null)).toBeNull();
});

test('help records the previous cross-sense help time for the history line', () => {
  const first = interact(fresh(), 'help', START, 'page-a', SENSE_KEY);
  expect(first.helpCount).toBe(1);
  expect(first.prevHelpAt).toBe(0);
  const second = interact(first, 'help', START + 2 * DAY, 'page-b', SENSE_KEY);
  expect(second.helpCount).toBe(2);
  expect(second.prevHelpAt).toBe(START);
  const quieter = interact({...second, senses: [...second.senses, {key:'other-sense',label:'other',opportunityDays:0,lastOpportunityAt:0,lastHelpAt:START + 5 * DAY,quietUntil:0,quietCycles:0,quietOpportunityDays:0,hintPreference:null,assistedPageKey:''}]}, 'help', START + 6 * DAY, 'page-c', SENSE_KEY);
  expect(quieter.prevHelpAt).toBe(START + 5 * DAY);
  expect(interact(quieter, 'less', START + 7 * DAY, 'page-d', SENSE_KEY).prevHelpAt).toBe(START + 5 * DAY);
});



test('legacy migration preserves identity and explicit less while dropping inferred history', () => {
  const legacy = {
    id:'finance:liability',term:'liability',domain:'finance',kind:'phrase',revision:7,
    helpCount:3,lastSeen:START,hintPreference:'less',translation:'负债',
    sentence:'A liability remains.',sourceUrl:'https://private.example/read?q=secret',
    familiarity:2,memoryStrength:0.9,stabilityDays:180,qualifiedExposures:40,
    seenPages:['private-page'],contexts:[{text:'private context'}],custom:'discard',
  };
  expect(migrateSupportWord(legacy,3)).toEqual({
    id:'finance:liability',term:'liability',domain:'finance',kind:'phrase',revision:7,
    helpCount:3,requestedAt:0,prevHelpAt:0,knownAt:0,lastSeen:START,hintPreference:'less',senses:[],
  });
  expect(migrateSupportWord({...legacy,kind:'sentence'},2)).toBeNull();
});

test('schema 4 migration normalizes bounded senses without changing their keys', () => {
  const senses = Array.from({length:10},(_,index) => ({
    key:`key-${index}`,label:`  Meaning ${index}  `,opportunityDays:index+.9,
    lastOpportunityAt:START+index,lastHelpAt:-1,quietUntil:NaN,quietCycles:9,
    quietOpportunityDays:index,hintPreference:index === 0 ? 'less' : 'other',
    assistedPageKey:index === 0 ? 'page' : null,
  }));
  senses.splice(2,0,{...senses[0],label:'duplicate key'});
  senses.splice(3,0,{key:'invalid',label:' '.repeat(4)});
  const migrated = migrateSupportWord(fresh({senses}),4);
  expect(migrated.senses).toHaveLength(8);
  expect(migrated.senses[0]).toEqual({
    key:'key-0',label:'meaning 0',opportunityDays:0,lastOpportunityAt:START,
    lastHelpAt:0,quietUntil:0,quietCycles:2,quietOpportunityDays:0,
    hintPreference:'less',assistedPageKey:'page',definition:{hint:'',translation:''},
  });
  expect(new Set(migrated.senses.map(sense => sense.key)).size).toBe(8);
  expect(migrateSupportWord(migrated,5)).toEqual(migrated);
  expect(() => migrateSupportWord(fresh(),6)).toThrow('Unsupported reading data schema');
});

test('missing word or sense stays at hint and invalid mutations are rejected', () => {
  expect(supportState(null,SENSE_KEY,START)).toEqual({stage:'hint'});
  expect(supportState(fresh(),'missing',START)).toEqual({stage:'hint'});
  expect(() => encounter(fresh(),'page',START,{senseKey:'missing',hintShown:true})).toThrow('Unknown sense key');
  expect(() => interact(fresh(),'other',START,'page',SENSE_KEY)).toThrow('Invalid support action');
});

test('twenty same-day encounters count once and do not leave hint', () => {
  let word = fresh();
  for (let index=0; index<20; index++) {
    word = encounter(word,`page-${index}`,START+index*1_000,{senseKey:SENSE_KEY,hintShown:true});
  }
  expect(word.senses[0].opportunityDays).toBe(1);
  expect(word.revision).toBe(1);
  expect(supportState(word,SENSE_KEY,START+DAY)).toEqual({stage:'hint'});
});

test('three hint days then three mark-only days begin a seven-day quiet trial', () => {
  let word = fresh();
  word = meet(word,0,true);
  word = meet(word,1,true);
  word = meet(word,2,true);
  expect(supportState(word,SENSE_KEY,START+2*DAY)).toEqual({stage:'mark'});

  word = meet(word,3,false);
  word = meet(word,4,false);
  expect(supportState(word,SENSE_KEY,START+4*DAY)).toEqual({stage:'mark'});
  word = meet(word,5,false);
  expect(word.senses[0]).toMatchObject({opportunityDays:3,quietCycles:0,quietOpportunityDays:0,
    quietUntil:START+12*DAY});
  expect(supportState(word,SENSE_KEY,START+6*DAY)).toEqual({stage:'quiet'});
  expect(Object.keys(supportState(word,SENSE_KEY,START+6*DAY))).toEqual(['stage']);
});

test('a hidden or budget-suppressed hint does not become an opportunity', () => {
  const word = meet(fresh(),0,false);
  expect(word).toEqual(fresh());
  let mark = fresh({senses:[{...fresh().senses[0],opportunityDays:3}]});
  mark = encounter(mark,'mark-page',START,{senseKey:SENSE_KEY,hintShown:true});
  expect(mark.senses[0].opportunityDays).toBe(3);
});

test('quiet opportunities are daily and extend later trials to fourteen then twenty-eight days', () => {
  let word = fresh();
  for (let day=0; day<3; day++) word = meet(word,day,true);
  for (let day=3; day<6; day++) word = meet(word,day,false);

  word = meet(word,6,false);
  word = meet(word,7,false);
  word = meet(word,7.5,false);
  expect(word.senses[0].quietOpportunityDays).toBe(2);

  word = meet(word,12,false);
  expect(word.senses[0]).toMatchObject({quietCycles:1,quietUntil:0,opportunityDays:4,
    quietOpportunityDays:0});
  word = meet(word,13,false);
  word = meet(word,14,false);
  expect(word.senses[0].quietUntil).toBe(START+28*DAY);

  word = meet(word,15,false);
  word = meet(word,16,false);
  word = meet(word,28,false);
  expect(word.senses[0]).toMatchObject({quietCycles:2,opportunityDays:4,quietUntil:0});
  word = meet(word,29,false);
  word = meet(word,30,false);
  expect(word.senses[0].quietUntil).toBe(START+58*DAY);
});

test('expired quiet with too few quiet opportunities returns to mark without extending the cycle', () => {
  const sense = {...fresh().senses[0],opportunityDays:3,lastOpportunityAt:START+8*DAY,
    quietUntil:START+12*DAY,quietCycles:1,quietOpportunityDays:1};
  const word = encounter(fresh({senses:[sense]}),'return',START+12*DAY,
    {senseKey:SENSE_KEY,hintShown:false});
  expect(word.senses[0]).toMatchObject({opportunityDays:4,quietUntil:0,quietCycles:1,
    quietOpportunityDays:0});
});

test('more than fourteen days without an opportunity restores hint and clears trial state', () => {
  const sense = {...fresh().senses[0],opportunityDays:5,lastOpportunityAt:START,
    quietUntil:START+28*DAY,quietCycles:2,quietOpportunityDays:1};
  const stale = fresh({senses:[sense]});
  expect(supportState(stale,SENSE_KEY,START+15*DAY)).toEqual({stage:'hint'});
  const reset = encounter(stale,'after-gap',START+15*DAY,{senseKey:SENSE_KEY,hintShown:true});
  expect(reset.senses[0]).toMatchObject({opportunityDays:1,lastOpportunityAt:START+15*DAY,
    quietUntil:0,quietCycles:0,quietOpportunityDays:0});
});

test('exactly fourteen absent days do not trigger the greater-than boundary', () => {
  const word = fresh({senses:[{...fresh().senses[0],opportunityDays:3,
    lastOpportunityAt:START}]});
  expect(supportState(word,SENSE_KEY,START+14*DAY)).toEqual({stage:'mark'});
  const met = encounter(word,'boundary-page',START+14*DAY,
    {senseKey:SENSE_KEY,hintShown:false});
  expect(met.senses[0].opportunityDays).toBe(4);
});
test('help resets only the selected sense, clears legacy less, and blocks its page', () => {
  const other = {...fresh().senses[0],key:'other',label:'another meaning',opportunityDays:5,
    quietUntil:START+20*DAY};
  const before = fresh({revision:4,helpCount:2,hintPreference:'less',senses:[
    {...fresh().senses[0],opportunityDays:5,quietUntil:START+20*DAY,quietCycles:2,
      quietOpportunityDays:2,hintPreference:'less'},other,
  ]});
  const helped = interact(before,'help',START+5*DAY,'clicked-page',SENSE_KEY);
  expect(helped).toMatchObject({revision:5,helpCount:3,hintPreference:null,lastSeen:START+5*DAY});
  expect(helped.senses[0]).toMatchObject({opportunityDays:0,lastOpportunityAt:0,
    lastHelpAt:START+5*DAY,quietUntil:0,quietCycles:0,quietOpportunityDays:0,
    hintPreference:null,assistedPageKey:'clicked-page'});
  expect(helped.senses[1]).toEqual(other);
  expect(supportState(helped,SENSE_KEY,START+5*DAY)).toEqual({stage:'hint'});
  expect(encounter(helped,'clicked-page',START+6*DAY,{senseKey:SENSE_KEY,hintShown:true})).toEqual(helped);
});

test('less is an indefinite sense preference, not inferred ability', () => {
  const less = interact(fresh(),'less',START,'',SENSE_KEY);
  expect(less).toMatchObject({revision:1,helpCount:0,hintPreference:null});
  expect(less.senses[0].hintPreference).toBe('less');
  expect(supportState(less,SENSE_KEY,START+1_000*DAY)).toEqual({stage:'quiet'});
  expect(encounter(less,'later',START+1_000*DAY,{senseKey:SENSE_KEY,hintShown:false})).toEqual(less);
});

test('different senses never share quiet state or opportunity counters', () => {
  const word = fresh({senses:[fresh().senses[0],{
    ...fresh().senses[0],key:'other',label:'another meaning',opportunityDays:3,
  }]});
  const less = interact(word,'less',START,'',SENSE_KEY);
  expect(supportState(less,SENSE_KEY,START)).toEqual({stage:'quiet'});
  expect(supportState(less,'other',START)).toEqual({stage:'mark'});
  expect(less.senses[1]).toEqual(word.senses[1]);
});


test('schema 5 preserves bounded durable definitions and explicit request intent', () => {
  const migrated=migrateSupportWord(fresh({requestedAt:START,senses:[{...fresh().senses[0],definition:{hint:'a possible future duty',translation:'可能承担的责任',ignored:'x'}}]}),5);
  expect(migrated.requestedAt).toBe(START);
  expect(migrated.senses[0].definition).toEqual({hint:'a possible future duty',translation:'可能承担的责任'});
  expect(JSON.stringify(migrated)).not.toContain('ignored');
});
test('reader evidence uses only explicit query and word-level preference history in allowed domains', () => {
  const records = [
    evidenceWord('requested term','finance',{requestedAt:200,lastSeen:9_000}),
    evidenceWord('explicit help','general',{helpCount:1,lastSeen:100,
      senses:[{...fresh().senses[0],lastHelpAt:300}]}),
    evidenceWord('legacy help','finance',{helpCount:2,lastSeen:150}),
    evidenceWord('passive suggestion','finance',{lastSeen:99_000}),
    evidenceWord('other specialty','medical',{requestedAt:500}),
    evidenceWord('dual signal','finance',{helpCount:1,requestedAt:350,hintPreference:'less'}),
    evidenceWord('less globally','general',{hintPreference:'less',lastSeen:400}),
    evidenceWord('sense only','finance',{senses:[{...fresh().senses[0],hintPreference:'less'}]}),
    evidenceWord('  LESS   GLOBALLY  ','finance',{hintPreference:'less',lastSeen:50}),
    evidenceWord('https://private.test/query','finance',{requestedAt:600,hintPreference:'less'}),
    evidenceWord('中文 term','finance',{requestedAt:700,hintPreference:'less'}),
  ];
  expect(readingEvidence(records,'finance')).toEqual({
    recentQueries:['dual signal','explicit help','requested term','legacy help'],
    lessHelpTerms:['less globally','dual signal'],
  });
  expect(readingEvidence(records,'medical')).toEqual({
    recentQueries:['other specialty','explicit help'],lessHelpTerms:['less globally'],
  });
  expect(readingEvidence(records,'general')).toEqual({
    recentQueries:['explicit help'],lessHelpTerms:['less globally'],
  });
  expect(readingEvidence([], 'finance')).toEqual({recentQueries:[],lessHelpTerms:[]});
});

test('reader evidence is normalized, recent-first, deduplicated, and bounded to twelve terms', () => {
  const terms = ['alpha','bravo','charlie','delta','echo','foxtrot','golf','hotel','india','juliet','kilo','lima','mike','november'];
  const records = terms.map((term,index) => evidenceWord(term,'finance',{requestedAt:index+1}));
  records.push(evidenceWord('  NOVEMBER  ','general',{requestedAt:1}));
  const evidence = readingEvidence(records,'finance');
  expect(evidence.recentQueries).toEqual([...terms].reverse().slice(0,12));
  expect(new Set(evidence.recentQueries).size).toBe(12);
  expect(evidence.lessHelpTerms).toEqual([]);
});

test('schema 5 preserves and normalizes explicit known timestamps',()=>{
  expect(migrateSupportWord(evidenceWord('index','tech',{knownAt:123.75}),5).knownAt).toBe(123.75);
  expect(migrateSupportWord(evidenceWord('index','tech',{knownAt:-1}),5).knownAt).toBe(0);
});
