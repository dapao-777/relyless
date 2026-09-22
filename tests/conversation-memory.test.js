import {expect,test} from 'bun:test';
import {collectConversationMemory,CONVERSATION_MEMORY_LIMITS} from '../extension/conversation-memory.js';
import {normalizeConversationRequest} from '../extension/gloss.mjs';

const word = (overrides = {}) => ({
  id: 'tech:index',
  term: 'index',
  domain: 'tech',
  kind: 'word',
  helpCount: 2,
  knownAt: 0,
  senses: [
    {key: 'tech:index:1', label: '检索键', definition: 'A structure that speeds up lookups.'},
    {key: 'tech:index:2', label: '下标', definition: 'A position in an array.'},
  ],
  ...overrides,
});

test('memory collects the term\'s own notes from the current domain and general fallback', () => {
  const memory = collectConversationMemory({words: [word()]}, {text: 'index', domain: 'tech'});
  expect(memory).toHaveLength(2);
  expect(memory[0]).toEqual({term: 'index', domain: 'tech', known: false, helps: 2, label: '检索键', definition: 'A structure that speeds up lookups.'});
  const general = collectConversationMemory({words: [word({id: 'general:index', domain: 'general', senses: [{key: 'g', label: '索引', definition: 'An ordered list.'}]})]}, {text: 'index', domain: 'tech'});
  expect(general).toEqual([{term: 'index', domain: 'general', known: false, helps: 2, label: '索引', definition: 'An ordered list.'}]);
});

test('memory is empty without a matching word, empty senses, or valid request text', () => {
  expect(collectConversationMemory({words: []}, {text: 'index', domain: 'tech'})).toEqual([]);
  expect(collectConversationMemory({words: [word({senses: []})]}, {text: 'index', domain: 'tech'})).toEqual([]);
  expect(collectConversationMemory({words: [word({senses: [{key: 'x', label: '', definition: 'no label'}]})]}, {text: 'index', domain: 'tech'})).toEqual([]);
  expect(collectConversationMemory({words: [word()]}, {text: '', domain: 'tech'})).toEqual([]);
  expect(collectConversationMemory({words: [word()]}, {text: 42, domain: 'tech'})).toEqual([]);
  expect(collectConversationMemory(null, {text: 'index', domain: 'tech'})).toEqual([]);
});

test('memory marks known words and caps entries, labels, and definitions', () => {
  const known = collectConversationMemory({words: [word({knownAt: 1_700_000_000_000})]}, {text: 'index', domain: 'tech'});
  expect(known[0].known).toBe(true);
  const manySenses = Array.from({length: 6}, (_value, index) => ({key: `k${index}`, label: '标签', definition: '定义内容'}));
  const long = collectConversationMemory({words: [word({senses: manySenses})]}, {text: 'index', domain: 'tech'});
  expect(long.length).toBeLessThanOrEqual(CONVERSATION_MEMORY_LIMITS.MAX_ENTRIES);
  expect(long.length).toBe(3);
  const oversized = collectConversationMemory({words: [word({senses: [{key: 'k', label: 'x'.repeat(200), definition: 'y'.repeat(2000)}]})]}, {text: 'index', domain: 'tech'});
  expect(oversized[0].label).toHaveLength(60);
  expect(oversized[0].definition).toHaveLength(400);
});

test('conversation requests accept bounded local memory and reject oversized entries', () => {
  const base = {text: 'index', context: 'The database query uses an index.', domain: 'tech', kind: 'word', level: 'hint', question: '上次怎么讲的？', history: []};
  const entry = {term: 'index', domain: 'tech', known: false, helps: 2, label: '检索键', definition: 'A structure that speeds up lookups.'};
  const normalized = normalizeConversationRequest({...base, memory: [{...entry, extra: 'ignored'}]});
  expect(normalized.memory).toEqual([entry]);
  expect(normalizeConversationRequest(base).memory).toEqual([]);
  expect(() => normalizeConversationRequest({...base, memory: Array.from({length: 6}, () => entry)})).toThrow('追问本地记忆无效');
  expect(() => normalizeConversationRequest({...base, memory: [{...entry, definition: 'y'.repeat(401)}]})).toThrow('追问本地记忆无效');
  expect(() => normalizeConversationRequest({...base, memory: [{...entry, label: ''}]})).toThrow('追问本地记忆无效');
  expect(() => normalizeConversationRequest({...base, memory: 'nope'})).toThrow('追问本地记忆无效');
});
