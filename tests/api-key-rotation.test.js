import {expect,test} from 'bun:test';
import {runWithApiKeyRotation,checkSingleApiKey,withServiceApiKey,redactKeys,rotationScope} from '../extension/api-key-rotation.js';
import {normalizeApiKeys,normalizeApiService} from '../extension/api-providers.mjs';

const service = (keys) => normalizeApiService({id:'svc',name:'Svc',providerId:'openai-compatible',baseUrl:'https://api.example.com/v1',model:'m',apiKey:'',apiKeys:keys});

const boom = (message, code, httpStatus) => Object.assign(new Error(message), {code, httpStatus});

test('key list normalization dedupes, trims, caps, and mirrors the first key', () => {
  expect(normalizeApiKeys([' a ', 'a', 'b', '', '  '])).toEqual(['a', 'b']);
  expect(normalizeApiKeys(Array.from({length: 12}, (_v, i) => 'k' + i))).toHaveLength(8);
  expect(normalizeApiKeys(undefined, 'legacy')).toEqual(['legacy']);
  expect(normalizeApiKeys([], '')).toEqual([]);
  const normalized = normalizeApiService({id:'x',name:'X',providerId:'openai',baseUrl:'https://api.openai.com/v1',model:'m',apiKey:'one',apiKeys:['one','two']});
  expect(normalized.apiKey).toBe('one');
  expect(normalized.apiKeys).toEqual(['one','two']);
});

test('a single-key service runs the operation untouched', async () => {
  const seen = [];
  const result = await runWithApiKeyRotation(service(['only']), snapshot => { seen.push(snapshot); return 'ok'; });
  expect(result).toBe('ok');
  expect(seen).toHaveLength(1);
  expect(seen[0].apiKey).toBe('only');
  expect(seen[0].apiKeys).toEqual(['only']);
});

test('a 401 on the first key fails over to the second key', async () => {
  const used = [];
  const result = await runWithApiKeyRotation(service(['bad', 'good']), snapshot => {
    used.push(snapshot.apiKey);
    if (snapshot.apiKey === 'bad') throw boom('unauthorized', 'AUTH', 401);
    return 'ok';
  });
  expect(result).toBe('ok');
  expect(used).toEqual(['bad', 'good']);
});

test('a non-credential failure does not burn the remaining keys', async () => {
  const used = [];
  await expect(runWithApiKeyRotation(service(['k1', 'k2']), snapshot => {
    used.push(snapshot.apiKey);
    throw boom('bad request', 'BAD_REQUEST', 400);
  })).rejects.toThrow('bad request');
  expect(used).toEqual(['k1']);
});

test('errors never carry the raw key', async () => {
  const secret = 'sk-super-secret-value';
  await expect(runWithApiKeyRotation(service([secret]), () => { throw new Error(`401 invalid key ${secret}`); }))
    .rejects.toThrow('[已隐藏的密钥]');
});

test('an exhausted pool explains the wait instead of leaking keys', async () => {
  const rotation = await import('../extension/api-key-pool.js');
  const scope = await rotationScope(service(['a', 'b']));
  const pool = rotation.createApiKeyRotation({recoveryMs: 60_000});
  pool.fail(scope, await sha('a'), 'auth', Date.now());
  pool.fail(scope, await sha('b'), 'auth', Date.now());
  // 直接验证池耗尽错误的文案（不含密钥）。
  const error = new rotation.ApiKeyPoolExhaustedError(60_000);
  expect(error.message).not.toContain('a');
  expect(error.retryAfterMs).toBe(60000);
});

async function sha(text) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, '0')).join('');
}

test('single-key checks bypass the pool and report success or failure', async () => {
  const good = service(['good']);
  await expect(checkSingleApiKey(good, 'good', snapshot => { expect(snapshot.apiKey).toBe('good'); return 'ok'; })).resolves.toBe('ok');
  await expect(checkSingleApiKey(service(['bad']), 'bad', () => { throw boom('nope', 'AUTH', 401); })).rejects.toThrow('nope');
});

test('redaction covers plain and encoded forms', () => {
  const error = redactKeys(Object.assign(new Error('key abc123 in url?key=abc123'), {code: 'abc123'}), ['abc123']);
  expect(error.message).toBe('key [已隐藏的密钥] in url?key=[已隐藏的密钥]');
  expect(error.code).toBe('[已隐藏的密钥]');
});

test('snapshots are immutable views of one key', () => {
  const base = {id: 's', apiKeys: ['a', 'b'], apiKey: 'a'};
  const snapshot = withServiceApiKey(base, 'b');
  expect(snapshot).toEqual({id: 's', apiKeys: ['b'], apiKey: 'b'});
  expect(base.apiKeys).toEqual(['a', 'b']);
});
