// 持久化本机缓存：词条释义（glossCache）与整页译文（translationCache）。
// 纯逻辑模块：键由调用方用 sha256 摘要生成，值只有模型产出与时间戳；
// 不保存网址、标题、原文或密钥。LRU 以对象插入顺序为准，命中即移到末尾。

export const GLOSS_CACHE_LIMIT = 500;
export const PAGE_TRANSLATION_CACHE_LIMIT = 1500;
export const GLOSS_CACHE_VERSION = 1;
export const TRANSLATION_CACHE_VERSION = 1;

const text = (value, max) => typeof value === 'string' ? value.slice(0, max) : '';
const stamp = value => Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;

/** 词条缓存值：{hint, translation, sense, at, hits} */
export function normalizeGlossEntry(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const hint = text(value.hint, 500), translation = text(value.translation, 500), sense = text(value.sense, 200);
  if (!hint && !translation) return null;
  return {hint, translation, sense, at: stamp(value.at), hits: Math.min(9999, stamp(value.hits))};
}

/** 译文缓存值：{zh, at} */
export function normalizeTranslationEntry(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const zh = text(value.zh, 8000);
  if (!zh) return null;
  return {zh, at: stamp(value.at)};
}

export function normalizeGlossCache(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [key, value] of Object.entries(raw)) {
    const entry = normalizeGlossEntry(value);
    if (entry) out[text(key, 128)] = entry;
  }
  return trimCache(out, GLOSS_CACHE_LIMIT);
}

export function normalizeTranslationCache(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [key, value] of Object.entries(raw)) {
    const entry = normalizeTranslationEntry(value);
    if (entry) out[text(key, 128)] = entry;
  }
  return trimCache(out, PAGE_TRANSLATION_CACHE_LIMIT);
}

/** 命中读取：LRU 移到末尾并计次；返回新对象（未命中返回 null）。 */
export function readCache(cache, key, {counter = 'hits'} = {}) {
  const entry = cache?.[key];
  if (!entry) return null;
  const next = {...cache};
  delete next[key];
  next[key] = counter === 'hits' ? {...entry, hits: stamp(entry.hits) + 1} : {...entry};
  return {cache: next, entry: next[key]};
}

/** 写入：覆盖同键并 LRU 裁剪到上限；返回新对象。 */
export function writeCache(cache, key, entry, {limit = GLOSS_CACHE_LIMIT} = {}) {
  const next = {...cache};
  delete next[key];
  next[key] = entry;
  return trimCache(next, limit);
}

function trimCache(cache, limit) {
  const keys = Object.keys(cache);
  if (keys.length <= limit) return cache;
  const next = {...cache};
  for (const key of keys.slice(0, keys.length - limit)) delete next[key];
  return next;
}
