const MAX_PENDING = 8;
const MAX_TEXT_LENGTH = 6000;
const MAX_TITLE_LENGTH = 240;
const IDLE_TIMEOUT_MS = 5 * 60 * 1000;
const pending = new Map();
let worker;
let idleTimer;
let nextRequestId = 1;

function bounded(value, limit) {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, limit) : '';
}

function releaseWhenIdle() {
  clearTimeout(idleTimer);
  if (pending.size) return;
  // 离屏文档持有计时器；MV3 后台休眠不会让模型一直占用内存。
  idleTimer = setTimeout(() => {
    if (pending.size) return;
    worker?.terminate();
    worker = undefined;
  }, IDLE_TIMEOUT_MS);
}

function getWorker() {
  if (worker) return worker;
  const instance = new Worker('./classifier-worker.js', { type: 'module', name: 'shisui-local-classifier' });
  worker = instance;
  instance.addEventListener('message', ({ data }) => {
    const request = pending.get(data?.id);
    if (!request) return;
    pending.delete(data.id);
    if (data.ok) request.resolve(data.data);
    else request.reject(new Error(data.error || '本地领域识别失败'));
    releaseWhenIdle();
  });
  instance.addEventListener('error', (event) => {
    if (worker !== instance) return;
    const error = new Error(event.message || '本地领域识别 Worker 异常');
    instance.terminate();
    worker = undefined;
    clearTimeout(idleTimer);
    for (const request of pending.values()) request.reject(error);
    pending.clear();
  });
  return instance;
}

function sendToWorker(payload) {
  if (pending.size >= MAX_PENDING) return Promise.reject(new Error('本地推理队列已满'));
  clearTimeout(idleTimer);
  const id = nextRequestId++;
  return new Promise((resolve, reject) => {
    const activeWorker = getWorker();
    pending.set(id, { resolve, reject });
    activeWorker.postMessage({ ...payload, id });
  });
}

function classify(text, title) {
  return sendToWorker({
    type: 'classify',
    text: bounded(text, MAX_TEXT_LENGTH),
    title: bounded(title, MAX_TITLE_LENGTH),
  });
}

// Gemini Nano（Prompt API）只在窗口上下文可用：离屏文档承担查询与会话，
// 下载必须由设置页的用户手势发起，这里不触发下载。
async function nanoStatus() {
  if (typeof LanguageModel === 'undefined') return { availability: 'unsupported' };
  try { return { availability: await LanguageModel.availability() }; }
  catch { return { availability: 'unavailable' }; }
}

async function nanoAssist(message) {
  if (typeof LanguageModel === 'undefined') throw new Error('此浏览器不支持本机模型。');
  const availability = await LanguageModel.availability().catch(() => 'unavailable');
  if (availability === 'unavailable') throw new Error('本机模型在此设备上不可用。');
  if (availability !== 'available') throw new Error('本机模型尚未下载：请在扩展设置的「本机模型」中完成下载。');
  const controller = new AbortController();
  const timeout = Math.max(1000, Math.min(30000, Number(message.timeoutMs) || 15000));
  const timer = setTimeout(() => controller.abort(), timeout);
  let session;
  try {
    session = await LanguageModel.create({
      systemPrompt: bounded(message.instructions, 4000),
      signal: controller.signal,
    });
    const schema = message.schema && typeof message.schema === 'object' ? message.schema : undefined;
    const text = await session.prompt(bounded(message.prompt, MAX_TEXT_LENGTH), {
      ...(schema ? { responseConstraint: schema } : {}),
      signal: controller.signal,
    });
    return { text: String(text || ''), inputTokens: Number.isFinite(session.inputUsage) ? session.inputUsage : null };
  } catch (error) {
    if (controller.signal.aborted) throw new Error('本机模型响应超时。');
    throw error;
  } finally {
    clearTimeout(timer);
    try { session?.destroy(); } catch {}
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.target !== 'local-classifier') return false;
  if (sender.id !== chrome.runtime.id || sender.tab) {
    sendResponse({ ok: false, error: '不允许网页直接调用本地领域模型' });
    return false;
  }
  let work;
  if (message.type === 'CLASSIFY_LOCAL') work = classify(message.text, message.title);
  else if (message.type === 'NANO_STATUS') work = nanoStatus();
  else if (message.type === 'NANO_ASSIST') work = nanoAssist(message);
  else if (message.type === 'EMBED_LOCAL' || message.type === 'COUNT_TOKENS_LOCAL') {
    // 只为已经预热的工作线程服务；冷启动成本不应由辅助任务承担。
    if (message.onlyIfWarm && !worker) { sendResponse({ ok: false, error: 'cold' }); return false; }
    work = sendToWorker({ type: message.type === 'EMBED_LOCAL' ? 'embed' : 'countTokens', texts: message.texts });
  } else return false;
  work.then(
    (data) => sendResponse({ ok: true, data }),
    (error) => sendResponse({ ok: false, error: error?.message || String(error) }),
  );
  return true;
});
