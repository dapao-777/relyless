import {expect,test} from 'bun:test';
import {createApiKeyPool,createApiKeyRotation,classifyApiKeyFailure,ApiKeyPoolExhaustedError} from '../extension/api-key-pool.js';

const ids = n => Array.from({length: n}, (_value, index) => 'k' + index);

test('weighted rotation spreads picks evenly and respects cooldown', () => {
  const pool = createApiKeyPool(ids(3));
  const counts = {k0: 0, k1: 0, k2: 0};
  for (let index = 0; index < 30; index += 1) {
    const lease = pool.lease();
    counts[lease.keyId] += 1;
    pool.reportSuccess(lease);
  }
  expect(counts).toEqual({k0: 10, k1: 10, k2: 10});
});

test('a failing key cools down and the pool routes around it', () => {
  const pool = createApiKeyPool(ids(3), {recoveryMs: 60_000});
  const now = 1_700_000_000_000;
  pool.reportFailureForKey('k1', 'auth', now);
  const picks = [];
  for (let index = 0; index < 6; index += 1) {
    const lease = pool.lease([], now);
    picks.push(lease.keyId);
    pool.reportSuccess(lease, now);
  }
  expect(picks).not.toContain('k1');
  // 冷却期满后恢复满血并重新参与。
  const later = pool.lease([], now + 60_000);
  expect(['k0', 'k1', 'k2']).toContain(later.keyId);
});

test('failure classes distinguish credentials, transient faults, and cancellations', () => {
  expect(classifyApiKeyFailure({statusCode: 401})).toBe('cooldown');
  expect(classifyApiKeyFailure({statusCode: 429})).toBe('cooldown');
  expect(classifyApiKeyFailure({kind: 'quota'})).toBe('cooldown');
  expect(classifyApiKeyFailure({code: 'invalid_api_key'})).toBe('cooldown');
  expect(classifyApiKeyFailure({message: 'The API key is invalid'})).toBe('cooldown');
  expect(classifyApiKeyFailure({statusCode: 503})).toBe('penalty');
  expect(classifyApiKeyFailure({kind: 'network'})).toBe('penalty');
  expect(classifyApiKeyFailure({kind: 'cancelled'})).toBe('none');
  expect(classifyApiKeyFailure({name: 'AbortError'})).toBe('none');
  expect(classifyApiKeyFailure({kind: 'config'})).toBe('none');
  expect(classifyApiKeyFailure({statusCode: 400})).toBe('none');
});

test('penalty halves the weight while auth failures zero it', () => {
  const pool = createApiKeyPool(ids(2), {recoveryMs: 60_000});
  const now = 1_700_000_000_000;
  pool.reportFailureForKey('k0', 'server', now);
  expect(pool.getState(now).find(state => state.keyId === 'k0').weight).toBe(2);
  pool.reportFailureForKey('k0', 'auth', now);
  expect(pool.getState(now).find(state => state.keyId === 'k0').weight).toBe(0);
});

test('an exhausted pool reports the retry delay', () => {
  const pool = createApiKeyPool(ids(2), {recoveryMs: 30_000});
  const now = 1_700_000_000_000;
  pool.reportFailureForKey('k0', 'auth', now);
  pool.reportFailureForKey('k1', 'auth', now);
  try {
    pool.lease([], now);
    throw new Error('should have thrown');
  } catch (error) {
    expect(error).toBeInstanceOf(ApiKeyPoolExhaustedError);
    expect(error.retryAfterMs).toBeGreaterThan(0);
    expect(error.retryAfterMs).toBeLessThanOrEqual(30_000);
  }
});

test('leases are exclusive and unknown leases cannot report outcomes', () => {
  const pool = createApiKeyPool(ids(2));
  const first = pool.lease();
  const second = pool.lease();
  expect(first.keyId).not.toBe(second.keyId);
  expect(pool.reportSuccess({leaseId: 999, keyId: 'k0'})).toBe(false);
  expect(pool.reportSuccess(first)).toBe(true);
  expect(pool.reportSuccess(first)).toBe(false);
  expect(pool.getState().find(state => state.keyId === first.keyId).inFlight).toBe(false);
});

test('a late success after failure does not restore the weight', () => {
  const pool = createApiKeyPool(ids(1));
  const now = 1_700_000_000_000;
  const lease = pool.lease([], now);
  // 失败经 Key 路径上报（探测或其它调用方），随后租约才回报成功：承认结果但不拉回满血。
  pool.reportFailureForKey(lease.keyId, 'auth', now);
  expect(pool.reportSuccess(lease, now)).toBe(true);
  expect(pool.getState(now)[0].weight).toBe(0);
});

test('a lease can only be reported once', () => {
  const pool = createApiKeyPool(ids(1));
  const now = 1_700_000_000_000;
  const lease = pool.lease([], now);
  expect(pool.reportFailure(lease, 'server', now)).toBe(true);
  expect(pool.reportSuccess(lease, now)).toBe(false);
});

test('sync adopts added keys, drops removed ones, and rejects duplicates', () => {
  const pool = createApiKeyPool(['a', 'b']);
  pool.sync(['b', 'c']);
  expect(pool.getState().map(state => state.keyId)).toEqual(['b', 'c']);
  expect(() => pool.sync(['x', 'x'])).toThrow('唯一');
  expect(() => createApiKeyPool(['a', 'a'])).toThrow('唯一');
  expect(() => createApiKeyPool([''])).toThrow('唯一');
});

test('rotation scopes isolate state and nextRetry waits for the whole scope', () => {
  const rotation = createApiKeyRotation({recoveryMs: 60_000});
  const now = 1_700_000_000_000;
  rotation.nextRetry('scope-a', ids(2), [], now);
  rotation.fail('scope-a', 'k0', 'auth', now);
  rotation.fail('scope-a', 'k1', 'auth', now);
  expect(rotation.nextRetry('scope-a', ids(2), [], now)).toBeGreaterThan(0);
  expect(rotation.nextRetry('scope-b', ids(2), [], now)).toBe(0);
  const lease = rotation.pick('scope-b', ids(2), [], now);
  expect(['k0', 'k1']).toContain(lease.keyId);
  expect(rotation.success('scope-b', lease, now)).toBe(true);
  expect(() => rotation.pick('scope-a', ids(2), [], now)).toThrow(ApiKeyPoolExhaustedError);
  // 旧作用域在容量上限时被淘汰，不无界增长。
  const bounded = createApiKeyRotation({maxScopes: 2});
  bounded.pick('s1', ids(1), [], now);
  bounded.pick('s2', ids(1), [], now);
  bounded.pick('s3', ids(1), [], now);
  expect(bounded.nextRetry('s3', ids(1), [], now)).toBe(0);
  expect(bounded.success('s1', 'k0', now)).toBe(false);
});
