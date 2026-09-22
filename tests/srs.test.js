import {expect,test,beforeAll} from 'bun:test';
import {Window} from 'happy-dom';
import {readFileSync} from 'node:fs';
import {normalizeReview,scheduleFirstReview,advanceReview,dueReviewEntries,reviewKey,SRS_LIMITS} from '../extension/srs.js';

beforeAll(() => {
  const window = new Window({url: 'https://reading.example/article'});
  Object.assign(globalThis, {
    window, document: window.document, Node: window.Node, NodeFilter: window.NodeFilter,
    getComputedStyle: value => ({...window.getComputedStyle(value), opacity: '1', display: 'block', visibility: 'visible', contentVisibility: 'visible', clip: 'auto', clipPath: 'none', overflow: 'visible'}),
    location: window.location, navigator: window.navigator, CustomEvent: window.CustomEvent, Event: window.Event,
  });
  const kernel = readFileSync(new URL('../extension/content/kernel.js', import.meta.url), 'utf8');
  const review = readFileSync(new URL('../extension/content/review.js', import.meta.url), 'utf8');
  new Function(kernel)();
  new Function(review)();
});

const now = 1_700_000_000_000;
const day = 86_400_000;

test('first review lands one day out and normalizes garbage', () => {
  expect(scheduleFirstReview(now)).toEqual({box: 1, dueAt: now + day, lastAt: now, lapses: 0});
  expect(normalizeReview(null, now)).toBeNull();
  expect(normalizeReview({dueAt: 0}, now)).toBeNull();
  expect(normalizeReview({box: 99, dueAt: now, lastAt: 'x', lapses: -5}, now)).toEqual({box: SRS_LIMITS.BOX_LIMIT, dueAt: now, lastAt: now, lapses: 0});
});

test('know advances the box and stretches the interval; again resets to day one', () => {
  let review = scheduleFirstReview(now);
  review = advanceReview(review, 'know', now);
  expect(review.box).toBe(2);
  expect(review.dueAt).toBe(now + 3 * day);
  review = advanceReview(review, 'know', now + 3 * day);
  expect(review.box).toBe(3);
  expect(review.dueAt).toBe(now + 3 * day + 7 * day);
  for (let i = 0; i < 10; i += 1) review = advanceReview(review, 'know', now);
  expect(review.box).toBe(SRS_LIMITS.BOX_LIMIT);
  const lapsed = advanceReview(review, 'again', now + 60 * day);
  expect(lapsed.box).toBe(1);
  expect(lapsed.dueAt).toBe(now + 60 * day + day);
  expect(lapsed.lapses).toBe(1);
  expect(advanceReview(review, 'unknown', now)).toEqual(review);
});

test('due entries filter by plan, future, and malformed input', () => {
  const plan = {
    [reviewKey('tech:index', 's1')]: {box: 2, dueAt: now - day, lastAt: now - 4 * day, lapses: 0},
    [reviewKey('tech:cache', 's2')]: {box: 1, dueAt: now + day, lastAt: now, lapses: 0},
  };
  const entries = [
    {wordId: 'tech:index', senseKey: 's1', text: 'index', domain: 'tech'},
    {wordId: 'tech:cache', senseKey: 's2', text: 'cache', domain: 'tech'},
    {wordId: 'tech:other', senseKey: 's3', text: 'other', domain: 'tech'},
    {wordId: 'tech:index', senseKey: 's9', text: 'index', domain: 'tech'},
    {text: 'missing ids'},
  ];
  const due = dueReviewEntries(plan, entries, now);
  expect(due.map(entry => entry.wordId)).toEqual(['tech:index']);
  expect(due[0].review.box).toBe(2);
  expect(dueReviewEntries(plan, entries, now, 0)).toEqual([]);
  expect(dueReviewEntries(null, entries, now)).toEqual([]);
  expect(dueReviewEntries(plan, 'nope', now)).toEqual([]);
});

test('the review button reflects the due count and feedback updates the plan', async () => {
  const kernel = globalThis.ShisuiContent;
  const review = globalThis.ShisuiReview;
  const sent = [];
  let dueResponse = {due: [{key: 'k1', wordId: 'tech:index', senseKey: 's1', text: 'index', domain: 'tech', box: 2}]};
  kernel.register({
    request: async (type, payload) => { sent.push([type, payload]); return type === 'REVIEW_DUE' ? dueResponse : {updated: true, box: 3, dueAt: now + 7 * day}; },
    inViewport: () => true,
  });
  kernel.state.records = [{block: document.createElement('p'), target: {wordId: 'tech:index', senseKey: 's1', text: 'index', domain: 'tech'}}];
  kernel.state.enabled = true;

  await review.refresh();
  expect(sent[0][0]).toBe('REVIEW_DUE');
  const button = document.querySelector('[data-shisui-ui="review-button"]');
  expect(button.textContent).toBe('复习 1');
  button.click();
  expect(document.querySelector('[data-shisui-ui="review-panel"]')).not.toBeNull();

  await review.answer(dueResponse.due[0], 'know');
  expect(sent[1]).toEqual(['REVIEW_FEEDBACK', {wordId: 'tech:index', senseKey: 's1', outcome: 'know'}]);
  expect(document.querySelector('[data-shisui-ui="review-button"]')).toBeNull();
  expect(document.querySelector('[data-shisui-ui="review-panel"]')).toBeNull();

  // 没有到期项时不再出现入口。
  dueResponse = {due: []};
  await review.refresh();
  expect(document.querySelector('[data-shisui-ui="review-button"]')).toBeNull();
  review.hide();
});
