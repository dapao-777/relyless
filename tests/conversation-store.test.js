import {expect,test} from 'bun:test';
import 'fake-indexeddb/auto';
import {createConversationStore,conversationHistoryWindow,normalizeConversationTurn,CONVERSATION_LIMITS} from '../extension/conversation-store.js';

const turn = (overrides = {}) => ({
  id: '11111111-1111-1111-1111-111111111111',
  sessionId: 'a'.repeat(64),
  createdAt: 1_700_000_000_000,
  status: 'generating',
  question: '这里为什么用完成时？',
  text: 'has been running',
  context: 'The service has been running since May, so the old bug cannot explain it.',
  domain: 'tech',
  kind: 'word',
  level: 'hint',
  ...overrides,
});

const storeFor = (name) => createConversationStore({name, now: () => 1_700_000_000_000});

test('a turn round-trips through begin, checkpoint and finish', async () => {
  const store = storeFor('db-round-trip');
  const created = await store.begin(turn());
  expect(created.status).toBe('generating');
  expect(created.answer).toBe('');
  let turns = await store.list('a'.repeat(64));
  expect(turns).toHaveLength(1);
  await store.checkpoint(created.id, '因为强调从过去持续到现在。');
  await store.finish(created.id, {answer: '因为强调从过去持续到现在。', status: 'complete'});
  turns = await store.list('a'.repeat(64));
  expect(turns[0].status).toBe('complete');
  expect(turns[0].answer).toBe('因为强调从过去持续到现在。');
});

test('conversation source drops URL credentials, query and fragment before storage', async () => {
  const store=storeFor('db-private-url');
  await store.begin(turn({source:{url:'https://user:password@reading.example/article?access_token=private#secret',title:'Article'}}));
  const [stored]=await store.list('a'.repeat(64));
  expect(stored.source).toEqual({url:'https://reading.example/article',title:'Article'});
});
test('opening an older conversation database removes saved URL secrets', async () => {
  const name='db-old-private-url',request=indexedDB.open(name,1);
  request.onupgradeneeded=()=>{
    const turns=request.result.createObjectStore('turns',{keyPath:'id'});
    turns.createIndex('sessionAt',['sessionId','createdAt']);
    turns.createIndex('at','createdAt');
  };
  const db=await new Promise((resolve,reject)=>{request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
  const transaction=db.transaction('turns','readwrite');
  transaction.objectStore('turns').put(turn({source:{url:'https://reading.example/article?secret=old#fragment',title:'Old'}}));
  await new Promise((resolve,reject)=>{transaction.oncomplete=resolve;transaction.onerror=()=>reject(transaction.error);});
  db.close();
  const [stored]=await storeFor(name).list('a'.repeat(64));
  expect(stored.source.url).toBe('https://reading.example/article');
});

test('checkpoints never overwrite a finished or stopped turn', async () => {
  const store = storeFor('db-checkpoint-race');
  const created = await store.begin(turn());
  await store.finish(created.id, {answer: '最终回答', status: 'complete'});
  await store.checkpoint(created.id, '迟到的部分回答');
  const [stored] = await store.list(created.sessionId);
  expect(stored.answer).toBe('最终回答');
  await store.finish(created.id, {answer: '迟到的部分回答', status: 'stopped'});
  const [afterStop] = await store.list(created.sessionId);
  expect(afterStop.status).toBe('complete');
  expect(afterStop.answer).toBe('最终回答');
});

test('stopping keeps the partial answer that was already streamed', async () => {
  const store = storeFor('db-stop');
  const created = await store.begin(turn());
  await store.checkpoint(created.id, '讲到这里被打断');
  await store.finish(created.id, {status: 'stopped'});
  const [stored] = await store.list(created.sessionId);
  expect(stored.status).toBe('stopped');
  expect(stored.answer).toBe('讲到这里被打断');
});

test('history window keeps only answered turns, oldest first, capped at four', () => {
  const turns = [
    {status: 'complete', answer: '一', question: 'q1', createdAt: 1},
    {status: 'generating', answer: '进行中', question: 'q2', createdAt: 2},
    {status: 'stopped', answer: '半个', question: 'q3', createdAt: 3},
    {status: 'complete', answer: '二', question: 'q4', createdAt: 4},
    {status: 'complete', answer: '三', question: 'q5', createdAt: 5},
    {status: 'complete', answer: '四', question: 'q6', createdAt: 6},
    {status: 'complete', answer: '五', question: 'q7', createdAt: 7},
  ];
  expect(conversationHistoryWindow(turns)).toEqual([
    {question: 'q4', answer: '二'},
    {question: 'q5', answer: '三'},
    {question: 'q6', answer: '四'},
    {question: 'q7', answer: '五'},
  ]);
});

test('turns expire per their own createdAt and sessions disappear with them', async () => {
  const store = createConversationStore({name: 'db-ttl', now: () => 1_700_000_000_000 + CONVERSATION_LIMITS.TTL_MS + 1000});
  await store.begin(turn({id: '22222222-2222-2222-2222-222222222222'}));
  await store.begin(turn({id: '33333333-3333-3333-3333-333333333333', createdAt: 1_700_000_000_000 + CONVERSATION_LIMITS.TTL_MS - 1000}));
  const removed = await store.prune();
  expect(removed).toBe(1);
  expect(await store.list('a'.repeat(64))).toHaveLength(1);
  await store.removeSession('a'.repeat(64));
  expect(await store.list('a'.repeat(64))).toHaveLength(0);
});

test('a session cannot grow past the turn cap', async () => {
  const store = storeFor('db-cap');
  for (let index = 0; index < CONVERSATION_LIMITS.MAX_TURNS_PER_SESSION; index += 1) {
    await store.begin(turn({id: String(index).padStart(36, '0'), createdAt: 1_700_000_000_000 + index}));
  }
  await expect(store.begin(turn({id: 'f'.repeat(36), createdAt: 1_799_999_999_999}))).rejects.toThrow('上限');
});

test('concurrent starts still enforce the per-session turn cap', async () => {
  const store = storeFor('db-concurrent-cap');
  const attempts = await Promise.allSettled(Array.from({length: CONVERSATION_LIMITS.MAX_TURNS_PER_SESSION + 1}, (_, index) =>
    store.begin(turn({id: String(index).padStart(36, '0'), createdAt: 1_700_000_000_000 + index}))));
  expect(attempts.filter(result => result.status === 'fulfilled')).toHaveLength(CONVERSATION_LIMITS.MAX_TURNS_PER_SESSION);
  expect(attempts.filter(result => result.status === 'rejected')).toHaveLength(1);
  expect(await store.list('a'.repeat(64))).toHaveLength(CONVERSATION_LIMITS.MAX_TURNS_PER_SESSION);
});

test('removing a session after a queued start removes that new turn', async () => {
  const store = storeFor('db-concurrent-remove');
  const started = store.begin(turn());
  const removed = store.removeSession('a'.repeat(64));
  await Promise.all([started, removed]);
  expect(await store.list('a'.repeat(64))).toHaveLength(0);
});

test('invalid turns are rejected at the boundary', () => {
  expect(normalizeConversationTurn(turn(), 1)).not.toBeNull();
  expect(normalizeConversationTurn(null, 1)).toBeNull();
  expect(normalizeConversationTurn(turn({question: '  '}), 1)).toBeNull();
  expect(normalizeConversationTurn(turn({question: 'x'.repeat(301)}), 1)).toBeNull();
  expect(normalizeConversationTurn(turn({text: 'y'.repeat(601)}), 1)).toBeNull();
  expect(normalizeConversationTurn(turn({context: 'z'.repeat(2001)}), 1)).toBeNull();
  expect(normalizeConversationTurn(turn({kind: 'other'}), 1)).toBeNull();
  expect(normalizeConversationTurn(turn({level: 'other'}), 1)).toBeNull();
  expect(normalizeConversationTurn(turn({status: 'pending'}), 1)).toBeNull();
  expect(normalizeConversationTurn(turn({domain: ''}), 1)).toBeNull();
  expect(normalizeConversationTurn(turn({createdAt: 0}), 1)).toBeNull();
  const answer = normalizeConversationTurn(turn({answer: 'a'.repeat(5000)}), 1);
  expect(answer.answer).toHaveLength(1200);
});

test('turn normalization ignores prototype keys', () => {
  const payload = JSON.parse(`{"id":"1","sessionId":"s","createdAt":1,"question":"q","text":"t","context":"c","domain":"tech","kind":"word","level":"hint","status":"generating","constructor":{"x":1}}`);
  const turnValue = normalizeConversationTurn(payload, 1);
  expect(turnValue).not.toBeNull();
  expect(Object.prototype.x).toBeUndefined();
});

test('sessions groups turns and sorts by the most recent update', async () => {
  let clock = 1_700_000_000_000;
  const store = createConversationStore({name: 'db-sessions', now: () => clock});
  await store.begin(turn({id: 'a'.repeat(36)}));
  await store.finish('a'.repeat(36), {answer: '第一段会话的回答', status: 'complete'});
  clock += 60_000;
  await store.begin(turn({id: 'b'.repeat(36), sessionId: 'b'.repeat(64), question: '另一个问题'}));
  await store.finish('b'.repeat(36), {answer: '第二段会话的回答', status: 'complete'});
  const sessions = await store.sessions();
  expect(sessions).toHaveLength(2);
  expect(sessions[0].sessionId).toBe('b'.repeat(64));
  expect(sessions[0].turns).toHaveLength(1);
  expect(sessions[0].text).toBe('has been running');
  expect(sessions[1].turns[0].answer).toBe('第一段会话的回答');
  expect(sessions[0].updatedAt).toBeGreaterThan(sessions[1].updatedAt);
});

test('sessions caps per-session turns at twenty', async () => {
  const store = storeFor('db-sessions-cap');
  for (let index = 0; index < 25; index += 1) {
    await store.begin(turn({id: String(index).padStart(36, '0'), createdAt: 1_700_000_000_000 + index}));
    await store.finish(String(index).padStart(36, '0'), {answer: `回答 ${index}`, status: 'complete'});
  }
  const [session] = await store.sessions();
  expect(session.turns).toHaveLength(20);
  expect(session.turns.at(-1).answer).toBe('回答 24');
});
