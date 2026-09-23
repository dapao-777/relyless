// 模型用量统计：按 天 + 服务 + 模型 + 操作 聚合请求次数与 token 计数。
// 纯逻辑模块：不碰存储与网络；后台负责把它落到 chrome.storage.local。
// 只存计数与配置标识（服务名、模型 ID、操作名），不保存正文、网址或密钥。

export const USAGE_RETENTION_DAYS = 90;
export const USAGE_VERSION = 1;

const count = value => { const n = Number(value); return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0; };
const text = (value, max) => typeof value === 'string' ? value.slice(0, max) : '';
const usageProvider = value => ['chatgpt', 'grok', 'antigravity'].includes(value) ? value : 'api';
export const usageDay = (time = Date.now()) => new Date(time).toISOString().slice(0, 10);
const cutoffDay = (now, days) => new Date(now - (days - 1) * 86400000).toISOString().slice(0, 10);
const tokenEstimate = chars => Math.ceil(count(chars) / 4);
const estKind = value => ['tokenizer', 'mixed'].includes(value) ? value : 'chars';

export function usageRowKey(row) {
  return [row.day, row.provider, row.service, row.model, row.operation].join('|');
}

/** 校验并归一化一条已存聚合行；非法行返回 null。 */
export function normalizeUsageRow(row) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return null;
  if (typeof row.day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(row.day)) return null;
  const provider = usageProvider(row.provider);
  const service = text(row.service, 80), model = text(row.model, 150), operation = text(row.operation, 40);
  if (!service && !model) return null;
  return {
    day: row.day, provider, service, model, operation,
    requests: count(row.requests), errors: count(row.errors),
    input: count(row.input), output: count(row.output),
    estInput: count(row.estInput), estOutput: count(row.estOutput),
    inputChars: count(row.inputChars), outputChars: count(row.outputChars),
    estKind: estKind(row.estKind),
  };
}

/**
 * 把一次模型调用并入聚合行。entry: {provider, service, model, operation, ok, usage:{input,output}|null, inputChars, outputChars}
 * 服务返回了 token 计数就记实际值；缺失的部分按字符数估算，分别进 input/output 与 estInput/estOutput。
 */
export function usageEntryToRow(entry, day = usageDay()) {
  if (!entry || typeof entry !== 'object') return null;
  const provider = usageProvider(entry.provider);
  const service = text(entry.service, 80), model = text(entry.model, 150), operation = text(entry.operation, 40);
  if (!service && !model) return null;
  const usage = entry.usage && typeof entry.usage === 'object' ? entry.usage : null;
  const reportedInput = usage && usage.input != null ? count(usage.input) : null;
  const reportedOutput = usage && usage.output != null ? count(usage.output) : null;
  const estInput = reportedInput === null ? (count(entry.estInput) || tokenEstimate(entry.inputChars)) : 0;
  const estOutput = reportedOutput === null ? (count(entry.estOutput) || tokenEstimate(entry.outputChars)) : 0;
  const tokenized = (reportedInput === null && count(entry.estInput) > 0) || (reportedOutput === null && count(entry.estOutput) > 0);
  const charred = (reportedInput === null && !count(entry.estInput) && count(entry.inputChars) > 0) || (reportedOutput === null && !count(entry.estOutput) && count(entry.outputChars) > 0);
  return {
    day, provider, service, model, operation,
    requests: 1, errors: entry.ok === false ? 1 : 0,
    input: reportedInput ?? 0, output: reportedOutput ?? 0,
    estInput, estOutput,
    inputChars: count(entry.inputChars), outputChars: count(entry.outputChars),
    estKind: tokenized ? (charred ? 'mixed' : 'tokenizer') : 'chars',
  };
}

/** 把一条新调用并入 rows（原地修改并返回同一数组）；同时按保留天数与条数上限裁剪。 */
export function mergeUsageEntry(rows, entry, { now = Date.now(), retentionDays = USAGE_RETENTION_DAYS, limit = 400 } = {}) {
  const list = Array.isArray(rows) ? rows : [];
  const row = usageEntryToRow(entry, usageDay(now));
  if (row) {
    const key = usageRowKey(row), found = list.find(value => usageRowKey(value) === key);
    if (found) {
      if ((row.estInput || row.estOutput) && found.estKind !== row.estKind) found.estKind = 'mixed';
      for (const field of ['requests', 'errors', 'input', 'output', 'estInput', 'estOutput', 'inputChars', 'outputChars']) found[field] += row[field];
    } else list.push(row);
  }
  const cutoff = cutoffDay(now, retentionDays);
  return list.filter(value => typeof value?.day === 'string' && value.day >= cutoff).slice(-limit);
}

/** 近 days 天某服务·模型的 tokens/字符比率（含估算量），用于整页翻译预估；无历史返回 null。 */
export function usageRatioFor(rows, {provider, service, model, days = 30, now = Date.now()} = {}) {
  const list = (Array.isArray(rows) ? rows : []).map(normalizeUsageRow).filter(Boolean);
  const limit = cutoffDay(now, Math.max(1, Math.min(Number(days) || 30, 3660)));
  let tokens = 0, chars = 0;
  for (const row of list) {
    if (row.day < limit) continue;
    if (provider && row.provider !== provider) continue;
    if (service && row.service !== service) continue;
    if (model && row.model !== model) continue;
    tokens += row.input + row.output + row.estInput + row.estOutput;
    chars += row.inputChars;
  }
  return chars > 0 ? {tokensPerChar: tokens / chars, samples: chars} : null;
}

/** 汇总展示：days=1 今日 / N 近 N 天 / 0 累计。返回按总 token 倒序的服务·模型分组。 */
export function usageStatsView(rows, { days = 7, now = Date.now() } = {}) {
  const list = (Array.isArray(rows) ? rows : []).map(normalizeUsageRow).filter(Boolean);
  const limit = days === 0 ? null : cutoffDay(now, Math.max(1, Math.min(Number(days) || 7, 3660)));
  const range = limit ? list.filter(row => row.day >= limit) : list;
  const totals = { requests: 0, errors: 0, input: 0, output: 0, estInput: 0, estOutput: 0 };
  const groups = new Map();
  for (const row of range) {
    for (const field of ['requests', 'errors', 'input', 'output', 'estInput', 'estOutput']) totals[field] += row[field];
    const key = [row.provider, row.service, row.model].join('|');
    let group = groups.get(key);
    if (!group) {
      group = { provider: row.provider, service: row.service, model: row.model, requests: 0, errors: 0, input: 0, output: 0, estInput: 0, estOutput: 0, operations: new Map() };
      groups.set(key, group);
    }
    for (const field of ['requests', 'errors', 'input', 'output', 'estInput', 'estOutput']) group[field] += row[field];
    const op = group.operations.get(row.operation) || { operation: row.operation, requests: 0, input: 0, output: 0, estInput: 0, estOutput: 0 };
    op.requests += row.requests; op.input += row.input; op.output += row.output; op.estInput += row.estInput; op.estOutput += row.estOutput;
    group.operations.set(row.operation, op);
  }
  const models = [...groups.values()]
    .map(group => ({ ...group, operations: [...group.operations.values()].sort((a, b) => (b.input + b.output + b.estInput + b.estOutput) - (a.input + a.output + a.estInput + a.estOutput) || b.requests - a.requests) }))
    .sort((a, b) => (b.input + b.output + b.estInput + b.estOutput) - (a.input + a.output + a.estInput + a.estOutput) || b.requests - a.requests);
  return { days, from: limit, totals, models };
}
