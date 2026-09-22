import {expect,test} from 'bun:test';
import {normalizeConversationRequest,normalizeConversationResult} from '../extension/gloss.mjs';
import {conversationProgress} from '../extension/assistance-stream.mjs';

const request = (overrides = {}) => ({
  text: 'has been running',
  context: 'The service has been running since May, so the old bug cannot explain it.',
  domain: 'tech',
  kind: 'word',
  level: 'hint',
  question: '这里为什么用完成时？',
  history: [],
  ...overrides,
});

test('a valid conversation request keeps bounded text, question and history', () => {
  const normalized = normalizeConversationRequest(request({history: [{question: '  q  ', answer: '  a  '}]}));
  expect(normalized.question).toBe('这里为什么用完成时？');
  expect(normalized.history).toEqual([{question: 'q', answer: 'a'}]);
});

test('conversation requests reject unbounded or malformed payloads', () => {
  expect(() => normalizeConversationRequest(request({question: 'x'.repeat(301)}))).toThrow('追问内容无效');
  expect(() => normalizeConversationRequest(request({history: Array.from({length: 5}, () => ({question: 'q', answer: 'a'}))}))).toThrow('追问历史无效');
  expect(() => normalizeConversationRequest(request({history: [{question: 'q', answer: 'a'.repeat(1201)}]}))).toThrow('追问历史无效');
  expect(() => normalizeConversationRequest(request({history: [{question: 'q'}]}))).toThrow('追问历史无效');
  expect(() => normalizeConversationRequest(request({text: 'y'.repeat(101), context: 'y'.repeat(101)}))).toThrow('选文超出追问范围');
  expect(() => normalizeConversationRequest(request({kind: 'passage', text: 'z'.repeat(601), context: 'z'.repeat(601)}))).toThrow('选文超出追问范围');
  expect(() => normalizeConversationRequest(request({context: '不含选文的上下文'}))).toThrow('追问请求无效');
  expect(() => normalizeConversationRequest(request({domain: 'unknown'}))).toThrow('追问请求无效');
  expect(() => normalizeConversationRequest(null)).toThrow('追问请求无效');
});

test('conversation results only accept a single bounded answer', () => {
  expect(normalizeConversationResult({answer: '  因为强调持续到现在。  '})).toEqual({answer: '因为强调持续到现在。'});
  expect(() => normalizeConversationResult({answer: ''})).toThrow('服务未返回有效回答');
  expect(() => normalizeConversationResult({answer: 'a'.repeat(1201)})).toThrow('服务未返回有效回答');
  expect(() => normalizeConversationResult({answer: 42})).toThrow('服务未返回有效回答');
  expect(() => normalizeConversationResult({answer: 'ok', extra: 1})).toThrow('结果封装无效');
  expect(() => normalizeConversationResult(null)).toThrow('结果封装无效');
});

test('conversation progress streams only the answer field', () => {
  const prefix = '{"answer":"因为强调从过去持续到现';
  expect(conversationProgress(prefix)).toEqual({answer: '因为强调从过去持续到现'});
  const complete = JSON.stringify({answer: '因为强调从过去持续到现在。'});
  expect(conversationProgress(complete)).toEqual({answer: '因为强调从过去持续到现在。'});
  expect(conversationProgress('{"other":"x"}')).toEqual({});
  expect(conversationProgress('{"answer":"')).toEqual({});
  expect(conversationProgress('{"answer":')).toEqual({});
  expect(conversationProgress('not json')).toEqual({});
  expect(conversationProgress(''.padEnd(30_000, 'x'))).toEqual({});
});

test('conversation progress rejects prototype and forged fields', () => {
  const payload = JSON.parse('{"answer":"ok","constructor":{"x":1}}');
  expect(conversationProgress(JSON.stringify(payload))).toEqual({});
  expect(Object.prototype.x).toBeUndefined();
  expect(conversationProgress('{"answer":"ok","answer":"dup"}')).toEqual({});
});
