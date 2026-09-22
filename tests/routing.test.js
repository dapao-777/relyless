import {expect,test} from 'bun:test';
import {normalizeRouting,routingQuestions,summarizeRequest,routeCacheKey,decideRoute,pruneRouteCache,routingStatsView,ROUTING_LIMITS} from '../extension/routing.js';

test('routing defaults to off with safe policy and premium target untouched', () => {
  const routing = normalizeRouting({});
  expect(routing.enabled).toBe(false);
  expect(routing.operations).toEqual({assist: true, passage: true, emergency: true, conversation: true, sentenceGroups: false});
  expect(routing.minConfidence).toBe(0.7);
  expect(routing.cacheTtlMinutes).toBe(24 * 60);
  expect(routing.premiumServiceId).toBe('');
  expect(normalizeRouting({enabled: true}).enabled).toBe(true);
  expect(normalizeRouting({enabled: 'yes'}).enabled).toBe(false);
});

test('routing normalizes bounds and keeps unrelated fields out', () => {
  const routing = normalizeRouting({enabled: true, premiumServiceId: 'x'.repeat(200), minConfidence: 1.7, cacheTtlMinutes: 5, operations: {assist: false}});
  expect(routing.premiumServiceId).toHaveLength(64);
  expect(routing.minConfidence).toBe(0.7);
  expect(routing.cacheTtlMinutes).toBe(5);
  expect(routing.operations.assist).toBe(false);
  expect(routing.operations.passage).toBe(true);
  expect(normalizeRouting(null).enabled).toBe(false);
  expect(normalizeRouting({operations: 'nope'}).operations.assist).toBe(true);
});

test('partial patches merge over current settings instead of resetting', () => {
  const current = normalizeRouting({enabled: true, premiumServiceId: 'svc-1', minConfidence: 0.5});
  const merged = normalizeRouting({operations: {passage: false}}, current);
  expect(merged.enabled).toBe(true);
  expect(merged.premiumServiceId).toBe('svc-1');
  expect(merged.minConfidence).toBe(0.5);
  expect(merged.operations.passage).toBe(false);
  expect(merged.operations.assist).toBe(true);
});

test('the judge question contract has one choice and one score with criteria', () => {
  const questions = routingQuestions();
  expect(Object.keys(questions)).toEqual(['tier', 'confidence']);
  expect(questions.tier.type).toBe('choice');
  expect(Object.keys(questions.tier.criteria)).toEqual(['routine', 'elevated', 'premium']);
  expect(questions.tier.instructions).toContain('untrusted data');
  expect(questions.confidence.type).toBe('score');
});

test('request summaries are bounded and carry the operation contract', () => {
  const summary = summarizeRequest('assist', {title: 'T'.repeat(500), text: 'x'.repeat(2000), context: 'y'.repeat(2000), level: 'rescue', kind: 'passage'});
  expect(summary.length).toBeLessThanOrEqual(ROUTING_LIMITS.MAX_SUMMARY);
  expect(summary.startsWith('operation:assist\nlevel:rescue\nkind:passage')).toBe(true);
  expect(summarizeRequest('assist')).toBe('operation:assist');
  expect(routeCacheKey('assist', 'a', '1')).not.toBe(routeCacheKey('assist', 'b', '1'));
  expect(routeCacheKey('assist', 'a', '1')).not.toBe(routeCacheKey('assist', 'a', '2'));
});

test('escalation only happens for premium tier or unconfident elevated', () => {
  const policy = {minConfidence: 0.7};
  expect(decideRoute({tier: {selected: 'premium'}, confidence: {score: 0.1}}, policy)).toEqual({route: 'premium', reason: 'tier-premium'});
  expect(decideRoute({tier: {selected: 'elevated'}, confidence: {score: 0.2}}, policy)).toEqual({route: 'premium', reason: 'tier-elevated-low-confidence'});
  expect(decideRoute({tier: {selected: 'elevated'}, confidence: {score: 0.9}}, policy)).toEqual({route: 'primary', reason: 'tier-elevated-confident'});
  expect(decideRoute({tier: {selected: 'routine'}, confidence: {score: 0.4}}, policy)).toEqual({route: 'primary', reason: 'tier-routine'});
  expect(decideRoute({tier: {selected: 'other'}, confidence: {score: 1}}, policy)).toEqual({route: 'primary', reason: 'judge-invalid'});
  expect(decideRoute({tier: {selected: 'elevated'}}, policy)).toEqual({route: 'premium', reason: 'tier-elevated-low-confidence'});
  expect(decideRoute(null, policy)).toEqual({route: 'primary', reason: 'judge-invalid'});
});

test('cache pruning drops expired entries, keeps the newest under the cap, and tolerates junk', () => {
  const now = 1_700_000_000_000;
  const cache = {
    fresh: {at: now - 60_000, route: 'primary'},
    stale: {at: now - 25 * 60 * 60_000, route: 'primary'},
    broken: null,
  };
  const pruned = pruneRouteCache(cache, now, 24 * 60, 200);
  expect(Object.keys(pruned)).toEqual(['fresh']);
  const many = Object.fromEntries(Array.from({length: 250}, (_value, index) => [`k${index}`, {at: now - index * 1000, route: 'primary'}]));
  expect(Object.keys(pruneRouteCache(many, now, 24 * 60, 200))).toHaveLength(200);
  expect(pruneRouteCache('nope', now)).toEqual({});
  const ttlEdge = {edge: {at: now - 24 * 60 * 60_000 + 1, route: 'primary'}};
  expect(Object.keys(pruneRouteCache(ttlEdge, now, 24 * 60, 200))).toEqual(['edge']);
});

test('stats view only exposes non-negative counters', () => {
  expect(routingStatsView({judged: 3, escalated: 1, judgeFailed: 2, cacheHits: 5, skipped: 4})).toEqual({judged: 3, escalated: 1, judgeFailed: 2, cacheHits: 5, skipped: 4});
  expect(routingStatsView({judged: -1, extra: 'x'})).toEqual({judged: 0, escalated: 0, judgeFailed: 0, cacheHits: 0, skipped: 0});
  expect(routingStatsView(null)).toEqual({judged: 0, escalated: 0, judgeFailed: 0, cacheHits: 0, skipped: 0});
});
