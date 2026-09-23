// 多 Key 轮询的服务层接线：作用域隔离、不透明 Key id、凭据快照、重试循环与错误脱敏。
// 从 FluentRead 的 apiKeyRotation 移植。健康权重只存当前运行进程，不持久化、不写日志；
// 调用方提供服务快照与实际请求，本模块只决定“用哪个 Key 试、失败后换不换”。

import {createApiKeyRotation, classifyApiKeyFailure, ApiKeyPoolExhaustedError} from './api-key-pool.js';
import {diagnosticError} from './diagnostics.mjs';

async function sha256(text) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

// 作用域只纳入影响路由的字段：编辑 Key 列表不重置权重，换端点/模型才重置。
export async function rotationScope(service) {
  return sha256(JSON.stringify([service.providerId, service.baseUrl, service.model]));
}

// 不可变凭据快照：一次尝试只绑定一个 Key，列表其余部分不参与本次请求。
export function withServiceApiKey(service, key) {
  return {...service, apiKey: key, apiKeys: [key]};
}

/** provider 回显的任意 Key 都不得进入 runtime 错误或诊断。 */
export function redactKeys(error, keys) {
  const result = error instanceof Error ? error : new Error(String(error || '请求失败。'));
  for (const field of ['message', 'code']) {
    let value = result[field];
    if (typeof value !== 'string') continue;
    for (const key of keys) {
      if (!key) continue;
      value = value.split(key).join('[已隐藏的密钥]').split(encodeURIComponent(key)).join('[已隐藏的密钥]');
    }
    result[field] = value;
  }
  return result;
}

export function classifyFailure(error) {
  if (error?.name === 'AbortError') return 'none';
  const detail = diagnosticError(error);
  const kind = detail.code === 'AUTH' ? 'auth'
    : detail.code === 'RATE_LIMIT' ? 'rate-limit'
      : detail.code === 'NETWORK' || detail.code === 'TIMEOUT' ? (detail.code === 'TIMEOUT' ? 'transient' : 'network')
        : detail.code === 'HTTP' && Number(error?.httpStatus) >= 500 ? 'server'
          : detail.code === 'NOT_READY' || detail.code === 'STALE' ? 'config' : error instanceof TypeError ? 'network' : undefined;
  return classifyApiKeyFailure({kind, statusCode: Number(error?.httpStatus) || undefined, code: error?.code, name: error?.name, message: error?.message});
}

const rotations = new Map();
function getRotation(cooldownMs) {
  let rotation = rotations.get(cooldownMs);
  if (!rotation) {
    rotation = createApiKeyRotation({recoveryMs: cooldownMs});
    rotations.set(cooldownMs, rotation);
  }
  return rotation;
}

/**
 * 带轮询地执行一次请求。service.apiKeys 少于两个时原样执行（单 Key 零开销）。
 * options.cooldownMs 控制冷却恢复窗口；options.signal 取消时不计失败。
 */
export async function runWithApiKeyRotation(service, operation, options = {}) {
  const keys = [...new Set((Array.isArray(service.apiKeys) ? service.apiKeys : []).filter(key => typeof key === 'string' && key.trim()))];
  if (keys.length < 2) {
    // 单 Key 直连，但错误同样脱敏：provider 回显的密钥不得进入界面或诊断。
    try { return await operation(service); } catch (error) { throw redactKeys(error, keys); }
  }
  const cooldownMs = Number.isFinite(options.cooldownMs) && options.cooldownMs >= 0 ? options.cooldownMs : 60_000;
  const rotation = getRotation(cooldownMs);
  const scope = await rotationScope(service);
  const ids = await Promise.all(keys.map(key => sha256(key)));
  const excluded = [];
  let lastError = null;
  while (excluded.length < keys.length) {
    if (options.signal?.aborted) throw redactKeys(lastError || new Error('请求已取消。'), keys);
    let lease;
    try {
      lease = rotation.pick(scope, ids, excluded, Date.now());
    } catch (error) {
      if (!(error instanceof ApiKeyPoolExhaustedError)) throw redactKeys(error, keys);
      const retryAfterMs = error.retryAfterMs;
      const base = lastError ? redactKeys(lastError, keys).message + ' 其他 Key 暂时不可用。' : '所有 API Key 暂时不可用。';
      const failure = Object.assign(new Error(`${base}约 ${Math.max(1, Math.ceil(retryAfterMs / 60000))} 分钟后自动恢复，也可以逐项检查。`), {code: 'RATE_LIMIT', retryAfterMs});
      throw failure;
    }
    const key = keys[ids.indexOf(lease.keyId)];
    excluded.push(lease.keyId);
    try {
      const result = await operation(withServiceApiKey(service, key));
      rotation.success(scope, lease, Date.now());
      return result;
    } catch (error) {
      const failure = options.signal?.aborted ? 'none' : classifyFailure(error);
      rotation.fail(scope, lease, failure === 'cooldown' ? 'auth' : failure === 'penalty' ? 'transient' : 'cancelled', Date.now(),
        failure === 'cooldown' ? (Number(error?.retryAfterMs) || undefined) : undefined);
      lastError = error;
      if (failure === 'none') throw redactKeys(error, keys);
    }
  }
  throw redactKeys(lastError || new Error('所有 API Key 都未成功。'), keys);
}

/** 单 Key 检测：绕过冷却与轮询，只测指定行；供选项页“逐项检查”。 */
export async function checkSingleApiKey(service, key, operation) {
  const id = await sha256(key);
  const scope = await rotationScope(service);
  const rotation = getRotation(60_000);
  rotation.nextRetry(scope, [id], [], Date.now());
  try {
    const result = await operation(withServiceApiKey(service, key));
    rotation.success(scope, id, Date.now());
    return result;
  } catch (error) {
    const failure = classifyFailure(error);
    if (failure !== 'none') rotation.fail(scope, id, failure === 'cooldown' ? 'auth' : 'transient', Date.now());
    throw redactKeys(error, [key]);
  }
}
