const OFFSCREEN_URL = 'local-inference/offscreen.html';
const MAX_TEXT_LENGTH = 6000;
const MAX_TITLE_LENGTH = 240;

let creatingDocument;
let requestChain = Promise.resolve();

function bounded(value, limit) {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, limit) : '';
}

async function hasOffscreenDocument() {
  if (chrome.offscreen.hasDocument) return chrome.offscreen.hasDocument();
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [chrome.runtime.getURL(OFFSCREEN_URL)],
  });
  return contexts.length > 0;
}

async function ensureOffscreenDocument() {
  if (await hasOffscreenDocument()) return;
  creatingDocument ??= chrome.offscreen.createDocument({
    url: OFFSCREEN_URL,
    reasons: ['WORKERS'],
    justification: '在独立线程中运行打包的本地 ONNX 领域分类模型',
  }).finally(() => { creatingDocument = undefined; });
  await creatingDocument;
}

async function performClassification(text, title) {
  await ensureOffscreenDocument();
  const response = await chrome.runtime.sendMessage({
    target: 'local-classifier',
    type: 'CLASSIFY_LOCAL',
    text: bounded(text, MAX_TEXT_LENGTH),
    title: bounded(title, MAX_TITLE_LENGTH),
  });
  if (!response?.ok) throw new Error(response?.error || '本地领域识别没有返回结果');
  return response.data;
}

async function performLocal(type, payload, { onlyIfWarm = false } = {}) {
  // warm-only 调用不创建离屏文档：没有活跃工作线程就直接返回 null。
  if (onlyIfWarm && !(await hasOffscreenDocument())) return null;
  await ensureOffscreenDocument();
  const response = await chrome.runtime.sendMessage({ target: 'local-classifier', type, ...payload });
  if (!response?.ok) return null;
  return response.data;
}

export function classifyLocal(text, title = '') {
  const run = requestChain.then(() => performClassification(text, title));
  requestChain = run.catch(() => {});
  return run;
}

export function embedLocal(texts, { onlyIfWarm = false } = {}) {
  const items = (Array.isArray(texts) ? texts : []).slice(0, 16).map(value => bounded(value, 600));
  if (!items.length) return Promise.resolve(null);
  const run = requestChain
    .then(() => performLocal('EMBED_LOCAL', { texts: items, onlyIfWarm }, { onlyIfWarm }))
    .catch(() => null);
  requestChain = run.catch(() => {});
  return run;
}

// 用量统计只读估计：模型未热时绝不为其冷启动，超时同样回退为 null。
export function countTokensLocal(texts, { onlyIfWarm = true, timeoutMs = 300 } = {}) {
  const items = (Array.isArray(texts) ? texts : [texts]).slice(0, 16).map(value => bounded(value, MAX_TEXT_LENGTH));
  if (!items.length) return Promise.resolve(null);
  const run = requestChain
    .then(() => performLocal('COUNT_TOKENS_LOCAL', { texts: items, onlyIfWarm }, { onlyIfWarm }))
    .catch(() => null);
  requestChain = run.catch(() => {});
  return Promise.race([run, new Promise(resolve => setTimeout(() => resolve(null), Math.max(50, timeoutMs)))]);
}

async function performNano(type, payload) {
  await ensureOffscreenDocument();
  const response = await chrome.runtime.sendMessage({ target: 'local-classifier', type, ...payload });
  if (!response?.ok) throw new Error(response?.error || '本机模型调用失败');
  return response.data;
}

// 本机模型状态探测：返回 {availability} 或 null（离屏文档不可用时）。
export function nanoStatus() {
  const run = requestChain.then(() => performNano('NANO_STATUS', {})).catch(() => null);
  requestChain = run.catch(() => {});
  return run;
}

// Gemini Nano 单次提示：抛错由调用方负责回落，绝不静默吞掉真实失败。
export function nanoAssist({ instructions, prompt, schema, timeoutMs = 15000 }) {
  const boundedSchema = schema && typeof schema === 'object' && JSON.stringify(schema).length <= 8000 ? schema : undefined;
  const run = requestChain
    .then(() => performNano('NANO_ASSIST', {
      instructions: bounded(instructions, 4000),
      prompt: bounded(prompt, MAX_TEXT_LENGTH),
      schema: boundedSchema,
      timeoutMs,
    }));
  requestChain = run.catch(() => {});
  return Promise.race([
    run,
    new Promise((_, reject) => setTimeout(() => reject(new Error('本机模型响应超时。')), Math.max(1500, timeoutMs + 2000))),
  ]);
}
