// 站点规则包：为网页提供额外的排除选择器、正文根提示与语言声明。
// 校验思路与 FluentRead 的站点适配一致：白名单字段、容量上限、原型污染防护、解析与 DOM 使用分离。
// 这里只做纯数据解析，选择器是否真的存在由内容脚本使用时自行判断，解析阶段不碰 DOM。

export const RULE_PACK_LIMITS = Object.freeze({
  bytes: 32 * 1024, packs: 8, rules: 200, hosts: 32, paths: 32, selectors: 32, selectorLength: 256, nameLength: 64,
});

const ALLOWED_PACK_KEYS = Object.freeze(['version', 'id', 'name', 'rules']);
const ALLOWED_RULE_KEYS = Object.freeze(['id', 'hosts', 'paths', 'exclude', 'root', 'lang']);
const ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,95}$/u;
const HOST_PATTERN = /^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/u;
const DANGEROUS_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function knownRecord(input, path, allowed, issues) {
  const record = {};
  if (!isPlainObject(input)) { issues.push({ path, message: '应为 JSON 对象' }); return record; }
  for (const key of Object.getOwnPropertyNames(input)) {
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    if (DANGEROUS_KEYS.has(key) || !allowed.includes(key)) issues.push({ path: `${path}.${key}`, message: '不支持的字段' });
    else if (!('value' in descriptor)) issues.push({ path: `${path}.${key}`, message: '只接受 JSON 数据字段' });
    else record[key] = descriptor.value;
  }
  if (Object.getOwnPropertySymbols(input).length) issues.push({ path, message: '不接受 Symbol 字段' });
  return record;
}

function cleanString(value, path, issues, { min = 1, max = 128, pattern } = {}) {
  if (typeof value !== 'string' || value.length < min || value.length > max || /[\u0000-\u001f\u007f]/u.test(value)) {
    issues.push({ path, message: `应为 ${min}–${max} 字符且不含控制字符的文本` });
    return '';
  }
  const trimmed = value.trim();
  if (!trimmed || (pattern && !pattern.test(trimmed))) {
    issues.push({ path, message: '格式不符合要求' });
    return '';
  }
  return trimmed;
}

function hostList(value, path, issues) {
  if (!Array.isArray(value) || !value.length || value.length > RULE_PACK_LIMITS.hosts) {
    issues.push({ path, message: `应为 1–${RULE_PACK_LIMITS.hosts} 个站点` });
    return [];
  }
  const hosts = [];
  for (const [index, entry] of value.entries()) {
    // 前导点（.example.com）是常见写法，先归一化再校验。
    const raw = typeof entry === 'string' ? entry.trim().toLowerCase().replace(/^\.+/, '') : entry;
    const host = cleanString(raw, `${path}[${index}]`, issues, { max: 253, pattern: HOST_PATTERN });
    if (host && !hosts.includes(host)) hosts.push(host);
  }
  if (!hosts.length && !issues.some(issue => issue.path.startsWith(`${path}[`))) issues.push({ path, message: '至少需要一个有效站点' });
  return hosts;
}

function selectorList(value, path, issues) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > RULE_PACK_LIMITS.selectors) {
    issues.push({ path, message: `应为不超过 ${RULE_PACK_LIMITS.selectors} 个选择器的数组` });
    return [];
  }
  const selectors = [];
  for (const [index, entry] of value.entries()) {
    const selector = cleanString(entry, `${path}[${index}]`, issues, { max: RULE_PACK_LIMITS.selectorLength });
    // 括号与方括号不配平的选择器几乎一定是笔误，且会在 closest 里直接抛错，解析阶段就拦下并要求修正。
    const balanced = selector && (selector.match(/\(/g) || []).length === (selector.match(/\)/g) || []).length
      && (selector.match(/\[/g) || []).length === (selector.match(/\]/g) || []).length;
    if (!selector) continue;
    if (!balanced) issues.push({ path: `${path}[${index}]`, message: '选择器括号不配平' });
    else selectors.push(selector);
  }
  return selectors;
}

function pathList(value, path, issues) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > RULE_PACK_LIMITS.paths) {
    issues.push({ path, message: `应为不超过 ${RULE_PACK_LIMITS.paths} 个路径前缀的数组` });
    return [];
  }
  const paths = [];
  for (const [index, entry] of value.entries()) {
    const pathValue = cleanString(entry, `${path}[${index}]`, issues, { max: 128 });
    if (pathValue && pathValue.startsWith('/') && !paths.includes(pathValue)) paths.push(pathValue);
  }
  return paths;
}

/** 解析单个规则包。返回 { pack, issues }：issues 非空时 pack 为 null，调用方必须整体拒绝而不是部分采用。 */
export function parseRulePack(value) {
  const issues = [];
  if (!isPlainObject(value)) return { pack: null, issues: [{ path: '', message: '规则包应为 JSON 对象' }] };
  let serialized = '';
  try { serialized = JSON.stringify(value); } catch { return { pack: null, issues: [{ path: '', message: '规则包不可序列化' }] }; }
  if (serialized.length > RULE_PACK_LIMITS.bytes) return { pack: null, issues: [{ path: '', message: `规则包超过 ${RULE_PACK_LIMITS.bytes} 字节` }] };
  const source = knownRecord(value, '', ALLOWED_PACK_KEYS, issues);
  if (source.version !== 1) issues.push({ path: 'version', message: '只支持 version 为 1 的规则包' });
  const id = source.id === undefined ? 'pack' : cleanString(source.id, 'id', issues, { max: 96, pattern: ID_PATTERN });
  const name = source.name === undefined ? '' : cleanString(source.name, 'name', issues, { max: RULE_PACK_LIMITS.nameLength });
  if (!Array.isArray(source.rules) || !source.rules.length || source.rules.length > RULE_PACK_LIMITS.rules) {
    issues.push({ path: 'rules', message: `应为 1–${RULE_PACK_LIMITS.rules} 条规则` });
    return { pack: null, issues };
  }
  const rules = [];
  for (const [index, entry] of source.rules.entries()) {
    const path = `rules[${index}]`;
    const rule = knownRecord(entry, path, ALLOWED_RULE_KEYS, issues);
    const hosts = hostList(rule.hosts, `${path}.hosts`, issues);
    const paths = pathList(rule.paths, `${path}.paths`, issues);
    const exclude = selectorList(rule.exclude, `${path}.exclude`, issues);
    const root = rule.root === undefined ? '' : cleanString(rule.root, `${path}.root`, issues, { max: RULE_PACK_LIMITS.selectorLength });
    let lang = '';
    if (rule.lang !== undefined && rule.lang !== '') {
      if (rule.lang !== 'en') issues.push({ path: `${path}.lang`, message: '目前只支持声明 lang 为 en' });
      else lang = 'en';
    }
    const ruleId = rule.id === undefined ? `rule-${index + 1}` : cleanString(rule.id, `${path}.id`, issues, { max: 96, pattern: ID_PATTERN });
    if (hosts.length) rules.push({ id: ruleId || `rule-${index + 1}`, hosts, paths, exclude, root, lang });
  }
  if (issues.length || !rules.length) return { pack: null, issues };
  return { pack: { version: 1, id, name, rules }, issues: [] };
}

/** 按当前站点与路径取第一条命中的规则；不命中返回 null。 */
export function matchRule(packs, { hostname = '', pathname = '/' } = {}) {
  if (!Array.isArray(packs) || !hostname) return null;
  for (const pack of packs) {
    for (const rule of pack?.rules || []) {
      if (!rule.hosts.some(host => hostname === host || hostname.endsWith(`.${host}`))) continue;
      if (rule.paths.length && !rule.paths.some(path => pathname.startsWith(path))) continue;
      return rule;
    }
  }
  return null;
}

/** 设置入口：只保留完整通过校验的规则包，并限制数量。 */
export function normalizeRulePacks(value) {
  if (!Array.isArray(value)) return [];
  const packs = [];
  for (const entry of value.slice(0, RULE_PACK_LIMITS.packs)) {
    const { pack } = parseRulePack(entry);
    if (pack && !packs.some(existing => existing.id === pack.id)) packs.push(pack);
  }
  return packs;
}
