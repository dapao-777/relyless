// 多 API Key 轮询：平滑加权轮询 + 租约 + 失败分级冷却，只存摘要不存明文。
// 从 FluentRead 的 apiKeyPool 移植为纯逻辑模块：不读配置、不发请求、不碰存储，
// 调用方提供不透明 key id 与时间，健康权重只存在于当前运行进程。

const DEFAULT_WEIGHT = 4;
const DEFAULT_RECOVERY_MS = 60_000;
const MAX_OUTSTANDING_LEASES = 4096;
// config/cancelled 不计权重；auth/quota/rate-limit 直接归零；其余折半。
const NON_PENALIZING = new Set(['config', 'cancelled']);
const ZERO_WEIGHT = new Set(['auth', 'quota', 'rate-limit']);
let nextPoolGeneration = 1;

export const API_KEY_POOL_DEFAULTS = Object.freeze({DEFAULT_WEIGHT, DEFAULT_RECOVERY_MS, MAX_OUTSTANDING_LEASES});

export class ApiKeyPoolExhaustedError extends Error {
  constructor(retryAfterMs) {
    super(`没有可用的 API Key，约 ${Math.max(1, Math.ceil(retryAfterMs / 1000))} 秒后恢复，也可以逐项检查。`);
    this.name = 'ApiKeyPoolExhaustedError';
    this.retryAfterMs = Math.max(1, Math.ceil(retryAfterMs));
  }
}

const cooldownMs = (value, fallback) => value !== undefined && Number.isFinite(value) ? Math.max(1000, value) : fallback;
const weight0 = value => value === undefined || !Number.isFinite(value) ? DEFAULT_WEIGHT : Math.max(0, Math.floor(value));
const at = value => value !== undefined && Number.isFinite(value) ? value : Date.now();

/** 失败分级：cooldown（凭据/配额/限流问题，归零并冷却）、penalty（临时问题，折半冷却）、none（不计）。 */
export function classifyApiKeyFailure(input = {}) {
  const {kind, statusCode, code, name, message} = input;
  if (kind === 'cancelled' || name === 'AbortError') return 'none';
  const c = typeof code === 'string' ? code.toLowerCase() : '';
  const m = typeof message === 'string' ? message.toLowerCase() : '';
  if (/(^|[_-])(api[_-]?key[_-]?invalid|invalid[_-]?api[_-]?key|invalid[_-]?token)([_-]|$)/.test(c)
    || /\b(?:api[ _-]?key|access token|auth token)\b.*\b(?:invalid|not valid|expired)\b|\b(?:invalid|expired)\b.*\b(?:api[ _-]?key|access token|auth token)\b|\btoken (?:is )?(?:invalid|not valid|expired)\b|\b(?:invalid|expired) token(?:[.!,:;]|$)/.test(m)) return 'cooldown';
  if (kind === 'config') return 'none';
  if (kind === 'auth' || kind === 'quota' || kind === 'rate-limit') return 'cooldown';
  if (/(^|[_-])(auth(?:entication|orization)?|quota|rate(?:[_-]?limit)?)([_-]|$)/.test(c)) return 'cooldown';
  if (statusCode === 401 || statusCode === 403 || statusCode === 429) return 'cooldown';
  if (kind === 'transient' || kind === 'network' || kind === 'server') return 'penalty';
  if (statusCode === 408 || statusCode === 425 || (statusCode !== undefined && statusCode >= 500)) return 'penalty';
  return 'none';
}

/** 创建单个服务作用域的 Key 池；keyIds 必须是唯一且非空的不透明 id。 */
export function createApiKeyPool(keyIds, options = {}) {
  const initialWeight = weight0(options.initialWeight);
  const recoveryMs = options.recoveryMs === undefined || !Number.isFinite(options.recoveryMs) ? DEFAULT_RECOVERY_MS : Math.max(0, options.recoveryMs);
  const keys = [];
  const byId = new Map();
  for (const keyId of keyIds) {
    if (typeof keyId !== 'string' || !keyId.trim() || byId.has(keyId)) throw new TypeError('API Key 池需要唯一且非空的不透明 id。');
    const state = {keyId, weight: initialWeight, current: 0, inFlight: false, lastFailureAt: null, cooldownUntil: null, failureRevision: 0};
    keys.push(state);
    byId.set(keyId, state);
  }
  let nextLeaseId = 1;
  const poolGeneration = nextPoolGeneration++;
  const activeLeases = new Map();
  const maxOutstanding = options.maxOutstandingLeases === undefined || !Number.isFinite(options.maxOutstandingLeases)
    ? MAX_OUTSTANDING_LEASES : Math.max(1, Math.floor(options.maxOutstandingLeases));

  function recover(now) {
    for (const key of keys) {
      if (key.cooldownUntil !== null && now >= key.cooldownUntil) {
        key.weight = initialWeight;
        key.current = 0;
        key.lastFailureAt = null;
        key.cooldownUntil = null;
      }
    }
  }

  function lease(excludedKeyIds = [], nowInput) {
    const now = at(nowInput);
    recover(now);
    const excluded = new Set(excludedKeyIds);
    const candidates = keys.filter(key => !excluded.has(key.keyId) && key.weight > 0);
    if (!candidates.length) {
      const retryAfter = keys.filter(key => !excluded.has(key.keyId) && key.cooldownUntil !== null)
        .reduce((minimum, key) => Math.min(minimum, Math.max(1, key.cooldownUntil - now)), Infinity);
      throw new ApiKeyPoolExhaustedError(Number.isFinite(retryAfter) ? retryAfter : 1);
    }
    if (activeLeases.size >= maxOutstanding) throw new ApiKeyPoolExhaustedError(1);
    const totalWeight = candidates.reduce((sum, key) => sum + key.weight, 0);
    let selected = candidates[0];
    for (const key of candidates) {
      key.current += key.weight;
      if (key.current > selected.current) selected = key;
    }
    selected.current -= totalWeight;
    const leaseId = nextLeaseId++;
    activeLeases.set(leaseId, {key: selected, failureRevision: selected.failureRevision});
    selected.inFlight = true;
    return {keyId: selected.keyId, leaseId, poolGeneration};
  }

  function finish(lease) {
    const entry = activeLeases.get(lease.leaseId);
    if (!entry || entry.key.keyId !== lease.keyId || (lease.poolGeneration !== undefined && lease.poolGeneration !== poolGeneration)) return null;
    activeLeases.delete(lease.leaseId);
    entry.key.inFlight = [...activeLeases.values()].some(candidate => candidate.key === entry.key);
    return entry.key;
  }

  function reportSuccess(lease, nowInput) {
    const entry = activeLeases.get(lease.leaseId);
    const key = finish(lease);
    if (!key) return false;
    recover(at(nowInput));
    // 失败后迟到的成功不再加权，避免把已降权的 Key 拉回满血。
    if (entry && entry.failureRevision !== key.failureRevision) return true;
    key.weight = Math.min(initialWeight, key.weight + 1);
    return true;
  }

  function penalize(key, kind, now, retryAfterMs) {
    if (NON_PENALIZING.has(kind)) return false;
    key.lastFailureAt = now;
    key.failureRevision += 1;
    key.cooldownUntil = now + cooldownMs(retryAfterMs, recoveryMs);
    key.weight = ZERO_WEIGHT.has(kind) ? 0 : Math.floor(key.weight / 2);
    return true;
  }

  function reportFailure(lease, kind, nowInput, retryAfterMs) {
    const key = finish(lease);
    if (!key) return false;
    const now = at(nowInput);
    recover(now);
    return penalize(key, kind, now, retryAfterMs);
  }

  function reportSuccessForKey(keyId, nowInput) {
    const key = byId.get(keyId);
    if (!key) return false;
    recover(at(nowInput));
    key.lastFailureAt = null;
    key.failureRevision += 1;
    key.weight = initialWeight;
    return true;
  }

  function reportFailureForKey(keyId, kind, nowInput, retryAfterMs) {
    const key = byId.get(keyId);
    if (!key) return false;
    const now = at(nowInput);
    recover(now);
    return penalize(key, kind, now, retryAfterMs);
  }

  function getState(nowInput) {
    recover(at(nowInput));
    return keys.map(({keyId, weight, current, inFlight, lastFailureAt, cooldownUntil}) => ({keyId, weight, current, inFlight, lastFailureAt, cooldownUntil}));
  }

  function sync(nextIds) {
    const next = new Set();
    for (const keyId of nextIds) {
      if (typeof keyId !== 'string' || !keyId.trim() || next.has(keyId)) throw new TypeError('API Key 池需要唯一且非空的不透明 id。');
      next.add(keyId);
    }
    for (let index = keys.length - 1; index >= 0; index -= 1) if (!next.has(keys[index].keyId)) keys.splice(index, 1);
    for (const [leaseId, entry] of activeLeases) if (!next.has(entry.key.keyId)) activeLeases.delete(leaseId);
    for (const keyId of nextIds) if (!byId.has(keyId)) {
      const state = {keyId, weight: initialWeight, current: 0, inFlight: false, lastFailureAt: null, cooldownUntil: null, failureRevision: 0};
      keys.push(state);
      byId.set(keyId, state);
    }
    for (const keyId of [...byId.keys()]) if (!next.has(keyId)) byId.delete(keyId);
  }

  return {lease, reportSuccess, reportFailure, reportSuccessForKey, reportFailureForKey, getState, sync};
}

/** 按服务/端点/模型隔离的有界轮询管理器；作用域状态仅存内存。 */
export function createApiKeyRotation(options = {}) {
  const maxScopes = options.maxScopes === undefined || !Number.isFinite(options.maxScopes) ? 64 : Math.max(1, Math.floor(options.maxScopes));
  const pools = new Map();

  function getPool(scopeId, keyIds, now) {
    if (typeof scopeId !== 'string' || !scopeId.trim()) throw new TypeError('Key 轮询需要非空作用域 id。');
    let entry = pools.get(scopeId);
    if (!entry) {
      if (pools.size >= maxScopes) {
        const oldest = [...pools.entries()].sort((left, right) => left[1].touchedAt - right[1].touchedAt)[0];
        if (oldest) pools.delete(oldest[0]);
      }
      entry = {pool: createApiKeyPool(keyIds, options), touchedAt: now};
      pools.set(scopeId, entry);
    } else {
      entry.touchedAt = now;
      entry.pool.sync(keyIds);
    }
    return entry.pool;
  }

  return {
    pick(scopeId, keyIds, excludedKeyIds = [], nowInput) {
      const now = at(nowInput);
      return getPool(scopeId, keyIds, now).lease(excludedKeyIds, now);
    },
    success(scopeId, key, nowInput) {
      const entry = pools.get(scopeId);
      if (!entry) return false;
      return typeof key === 'string' ? entry.pool.reportSuccessForKey(key, at(nowInput)) : entry.pool.reportSuccess(key, at(nowInput));
    },
    fail(scopeId, key, kind, nowInput, retryAfterMs) {
      const entry = pools.get(scopeId);
      if (!entry) return false;
      const now = at(nowInput);
      return typeof key === 'string' ? entry.pool.reportFailureForKey(key, kind, now, retryAfterMs) : entry.pool.reportFailure(key, kind, now, retryAfterMs);
    },
    nextRetry(scopeId, keyIds, excludedKeyIds = [], nowInput) {
      const now = at(nowInput);
      const states = getPool(scopeId, keyIds, now).getState(now).filter(state => !new Set(excludedKeyIds).has(state.keyId));
      if (states.some(state => state.weight > 0)) return 0;
      const retryAfter = states.filter(state => state.cooldownUntil !== null)
        .reduce((minimum, state) => Math.min(minimum, Math.max(1, state.cooldownUntil - now)), Infinity);
      return Number.isFinite(retryAfter) ? retryAfter : 1;
    },
  };
}
