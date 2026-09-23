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
