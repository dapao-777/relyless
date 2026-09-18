import assert from 'node:assert/strict';
import test from 'node:test';
import {normalizeSentenceGroupItems,normalizeSentenceGroupResponse,normalizeSentenceGroupsResult,prepareSentenceGroupItems} from '../extension/sentence-groups.mjs';

const node=(role,first,last)=>({role,first,last});
const result=(id,...groups)=>({items:[{id,groups}]});

test('provided IDs distinguish repeated words and preserve punctuation, Unicode and whitespace',()=>{
  const items=[{id:'repeat',sentence:'  Go, go—\u{1F680}\tgo.  '}];
  assert.deepEqual(prepareSentenceGroupItems(items)[0].tokens,[[1,'Go'],[2,','],[3,'go'],[4,'—'],[5,'\u{1F680}'],[6,'go'],[7,'.']]);
  const groups=normalizeSentenceGroupsResult(result('repeat',node('subject',1,1),node('predicate',3,3),node('object',5,7)),items).items[0].groups;
  assert.deepEqual(groups.map(({start,end,role,parent})=>[items[0].sentence.slice(start,end),role,parent]),[
    ['Go, go—\u{1F680}\tgo.','clause',-1],['Go','subject',0],['go','predicate',0],['\u{1F680}\tgo.','object',0]
  ]);
});

test('range containment derives reading order and hierarchy without rewriting unannotated gaps',()=>{
  const sentence='When systems fail, teams recover.';
  const value=result('gaps',node('predicate',6,6),node('predicate',3,3),node('subject',2,2),node('subject',5,5),node('adverbial',1,3));
  const groups=normalizeSentenceGroupsResult(value,[{id:'gaps',sentence}]).items[0].groups;
  assert.deepEqual(groups.map(({start,end,role,parent})=>[sentence.slice(start,end),role,parent]),[
    [sentence,'clause',-1],['When systems fail','adverbial',0],['systems','subject',1],['fail','predicate',1],['teams','subject',0],['recover','predicate',0]
  ]);
  assert.equal(groups.some(({start,end})=>sentence.slice(start,end)===','),false);
});

test('an empty fragment analysis receives only the local root',()=>{
  const sentence='API Reference';
  assert.deepEqual(normalizeSentenceGroupsResult(result('fragment'),[{id:'fragment',sentence}]).items[0].groups,[{start:0,end:13,role:'clause',parent:-1}]);
});

test('malformed nodes are discarded locally while response identity and shape remain strict',()=>{
  const source=[{id:'s',sentence:'One two three four.'}];
  const malformed=result('s',
    node('subject',0,1),node('subject',1,6),node('subject',3,2),
    {role:'subject',first:1,last:1,children:[]},{role:'subject',first:1,last:1,text:'One'},
    node('clause',1,1),node('subject',1.5,2),node('predicate',2,2));
  assert.deepEqual(normalizeSentenceGroupResponse(malformed,source),result('s',node('predicate',2,2)));
});

test('duplicate and crossing output is repaired without changing useful role boundaries',()=>{
  const sentence='Alpha beta gamma delta epsilon zeta eta theta iota kappa.';
  const source=[{id:'reported',sentence}];
  const raw=result('reported',
    node('subject',1,5),node('adverbial',4,7),
    node('attributive',2,2),node('attributive',2,2),
    node('predicate',3,3),
    node('object',6,6),node('complement',6,6),
    node('predicate',8,8),node('object',9,10));
  const snapshot=structuredClone(raw);
  const repaired=normalizeSentenceGroupResponse(raw,source);
  assert.deepEqual(repaired,result('reported',
    node('attributive',2,2),node('predicate',3,3),node('predicate',8,8),node('object',9,10)));
  assert.deepEqual(raw,snapshot);
  assert.deepEqual(normalizeSentenceGroupResponse(repaired,source),repaired);

  const projected=normalizeSentenceGroupsResult(raw,source).items[0].groups;
  assert.deepEqual(normalizeSentenceGroupsResult(repaired,source).items[0].groups,projected);
  assert.deepEqual(projected.map(({start,end,role,parent})=>[sentence.slice(start,end),role,parent]),[
    [sentence,'clause',-1],['beta','attributive',0],['gamma','predicate',0],
    ['theta','predicate',0],['iota kappa','object',0]
  ]);
});

test('ambiguous duplicate wrappers are dropped while their inner groups survive',()=>{
  const sentence='One two three four five.';
  const source=[{id:'ambiguous',sentence}];
  const raw=result('ambiguous',node('subject',1,5),node('object',1,5),node('attributive',2,4),node('predicate',3,3));
  assert.deepEqual(normalizeSentenceGroupResponse(raw,source),result('ambiguous',node('attributive',2,4),node('predicate',3,3)));
  assert.deepEqual(normalizeSentenceGroupsResult(raw,source).items[0].groups.map(group=>group.parent),[-1,0,1]);
});

test('a broken sentence does not discard useful groups from another batch item',()=>{
  const source=[{id:'broken',sentence:'One two.'},{id:'valid',sentence:'Teams recover.'}];
  const raw={items:[
    {id:'broken',groups:[node('subject',0,9),node('predicate',1,2),node('object',2,3)]},
    {id:'valid',groups:[node('subject',1,1),node('predicate',2,2)]}
  ]};
  assert.deepEqual(normalizeSentenceGroupResponse(raw,source),{items:[
    {id:'broken',groups:[]},
    {id:'valid',groups:[node('subject',1,1),node('predicate',2,2)]}
  ]});
  assert.deepEqual(normalizeSentenceGroupsResult(raw,source).items.map(item=>item.groups.map(({role})=>role)),[
    ['clause'],['clause','subject','predicate']
  ]);
});

test('local nesting depth and the node limit keep a valid bounded structure',()=>{
  const source=[{id:'s',sentence:'One two three four five.'}];
  const allowed=[node('subject',1,5),node('object',1,4),node('complement',1,3),node('attributive',1,2)];
  assert.deepEqual(normalizeSentenceGroupsResult(result('s',...allowed),source).items[0].groups.map(group=>group.parent),[-1,0,1,2,3]);
  assert.deepEqual(normalizeSentenceGroupResponse(result('s',...allowed,node('adverbial',1,1)),source),result('s',...allowed));
  const many=[{id:'many',sentence:Array.from({length:64},(_,index)=>`w${index}`).join(' ')}];
  const siblings=Array.from({length:64},(_,index)=>node('subject',index+1,index+1));
  const bounded=normalizeSentenceGroupResponse(result('many',...siblings),many);
  assert.equal(bounded.items[0].groups.length,63);
  assert.deepEqual(bounded.items[0].groups.at(-1),node('subject',63,63));
  assert.equal(normalizeSentenceGroupsResult(result('many',...siblings),many).items[0].groups.length,64);
});

test('batch identity, response shape and request budgets remain strict',()=>{
  const source=[{id:'a',sentence:'One.'},{id:'b',sentence:'Two.'}];
  assert.throws(()=>normalizeSentenceGroupResponse({items:[{id:'b',groups:[]},{id:'a',groups:[]}]},source));
  assert.throws(()=>normalizeSentenceGroupResponse({items:[{id:'a',groups:[]},{id:'b',groups:[],extra:true}]},source));
  assert.throws(()=>normalizeSentenceGroupResponse({items:[{id:'a',root:{}}]},[{id:'a',sentence:'One.'}]));
  assert.throws(()=>normalizeSentenceGroupItems([{id:'same',sentence:'One.'},{id:'same',sentence:'Two.'}]));
  assert.throws(()=>normalizeSentenceGroupItems(Array.from({length:5},(_,i)=>({id:String(i),sentence:'Sentence.'}))));
  assert.throws(()=>normalizeSentenceGroupItems([{id:'large',sentence:'x'.repeat(2001)}]));
  assert.throws(()=>normalizeSentenceGroupItems(Array.from({length:3},(_,i)=>({id:String(i),sentence:'x'.repeat(1500)}))));
});
