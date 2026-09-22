// 阅读追问会话：本机按 30 天保留问答回合，供稍后继续同一段英文的追问。
// 与 FluentRead Harness 阅读记录一致的取舍：只保存产品需要的问答，不保存完整执行现场；
// 生成中约每 500ms 落一次检查点，中断后保留已回答部分；隐私窗口不写入。

const TTL_MS = 30 * 86_400_000;
const MAX_TURNS_PER_SESSION = 40;
const MAX_HISTORY_TURNS = 4;
const MAX_ANSWER = 1200;
const MAX_QUESTION = 300;
const MAX_TEXT = 600;
const MAX_CONTEXT = 2000;
const STATUSES = new Set(['generating', 'complete', 'stopped', 'error']);
const KINDS = new Set(['word', 'phrase', 'passage']);
const LEVELS = new Set(['hint', 'rescue']);

function openDatabase(factory, name) {
  return new Promise((resolve, reject) => {
    const request = factory.open(name, 2);
    request.onupgradeneeded = event => {
      const db = request.result;
      if (event.oldVersion < 1) {
        const turns = db.createObjectStore('turns', { keyPath: 'id' });
        turns.createIndex('sessionAt', ['sessionId', 'createdAt']);
        turns.createIndex('at', 'createdAt');
      } else {
        const turns = request.transaction.objectStore('turns');
        const cursor = turns.openCursor();
        cursor.onsuccess = () => {
          const entry = cursor.result;
          if (!entry) return;
          const source = entry.value?.source;
          const url = safeSourceUrl(source?.url);
          if (source?.url !== url) entry.update({...entry.value, source:{...source, url}});
          entry.continue();
        };
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('对话数据库升级被拦截'));
  });
}

function bounded(value, max) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > max) return null;
  return trimmed;
}
function safeSourceUrl(value) {
  const input = bounded(value, 2048);
  if (!input) return '';
  try {
    const url = new URL(input);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
    url.username = '';
    url.password = '';
    url.search = '';
    url.hash = '';
    return url.href;
  } catch { return ''; }
}

/** 归一化一条问答回合；返回 null 表示拒绝。隐私窗口的写入在调用方就拦下，这里只做数据边界。 */
export function normalizeConversationTurn(input, now = Date.now()) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const id = bounded(input.id, 64);
  const sessionId = bounded(input.sessionId, 64);
  const question = bounded(input.question, MAX_QUESTION);
  const text = bounded(input.text, MAX_TEXT);
  const context = typeof input.context === 'string' ? input.context : '';
  const domain = bounded(input.domain, 32);
  const kind = KINDS.has(input.kind) ? input.kind : null;
  const level = LEVELS.has(input.level) ? input.level : null;
  const status = STATUSES.has(input.status) ? input.status : null;
  if (!id || !sessionId || !question || !text || context.length > MAX_CONTEXT || !domain || !kind || !level || !status) return null;
  if (!Number.isSafeInteger(input.createdAt) || input.createdAt <= 0) return null;
  const answer = typeof input.answer === 'string' ? input.answer.slice(0, MAX_ANSWER) : '';
  const source = input.source && typeof input.source === 'object' && !Array.isArray(input.source)
    ? { url: safeSourceUrl(input.source.url), title: bounded(input.source.title, 300) || '' }
    : { url: '', title: '' };
  return {
    id, sessionId, createdAt: input.createdAt, updatedAt: Number.isSafeInteger(input.updatedAt) ? input.updatedAt : input.createdAt,
    status, question, answer, text, context, domain, kind, level, source,
  };
}

/** 发给模型的最近几轮问答：只取已完整回答的，按时间正序，数量有上限。 */
export function conversationHistoryWindow(turns, limit = MAX_HISTORY_TURNS) {
  const answered = [...turns].filter(turn => turn.status === 'complete' && turn.answer.trim())
    .sort((a, b) => a.createdAt - b.createdAt);
  return answered.slice(-limit).map(turn => ({ question: turn.question, answer: turn.answer }));
}

export function createConversationStore({ name = 'shisui-conversations', indexedDB: injected, now = Date.now } = {}) {
  const factory = injected || globalThis.indexedDB;
  // 所有写入串行化，避免检查点与完成态互相覆盖。
  let chain = Promise.resolve();
  let databasePromise = factory ? openDatabase(factory, name) : null;
  const serialize = task => { const run = chain.then(task, task); chain = run.then(() => {}, () => {}); return run; };
  const ensure = async () => {
    if (!factory) throw new Error('当前环境不支持对话存储');
    if (!databasePromise) databasePromise = openDatabase(factory, name);
    try { return await databasePromise; } catch (error) { databasePromise = null; throw error; }
  };
  const ask = (store, operation) => new Promise((resolve, reject) => {
    const request = operation(store);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  const commit = transaction => new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error || new Error('对话写入被中断'));
  });
  const allBySession = async sessionId => {
    const transaction = (await ensure()).transaction('turns', 'readonly');
    const turns = await ask(transaction.objectStore('turns'), store => store.index('sessionAt').getAll(globalThis.IDBKeyRange.bound([sessionId, 0], [sessionId, 8_640_000_000_000_000])));
    return turns;
  };

  return {
    /** 新建一条生成中的回合。 */
    async begin(turnInput) {
      const turn = normalizeConversationTurn({ ...turnInput, status: 'generating', answer: '', updatedAt: now() }, now());
      if (!turn) throw new Error('追问内容无效。');
      await serialize(async () => {
        const existing = await allBySession(turn.sessionId);
        if (existing.length >= MAX_TURNS_PER_SESSION) throw new Error('这段文字的追问已达上限，请稍后再试。');
        const transaction = (await ensure()).transaction('turns', 'readwrite');
        transaction.objectStore('turns').put(turn);
        await commit(transaction);
      });
      return turn;
    },
    /** 生成中检查点：只更新仍在生成态的回合，已完成或被停止的回合不被回写。 */
    async checkpoint(id, answer) {
      const partial = typeof answer === 'string' ? answer.slice(0, MAX_ANSWER) : '';
      if (!partial.trim()) return;
      await serialize(async () => {
        const transaction = (await ensure()).transaction('turns', 'readwrite');
        const store = transaction.objectStore('turns');
        const current = await ask(store, value => value.get(id));
        if (!current || current.status !== 'generating') return;
        const next = normalizeConversationTurn({ ...current, answer: partial, updatedAt: now() }, now());
        if (next) store.put(next);
        await commit(transaction);
      });
    },
    /** 结束回合：complete / stopped / error。stopped 与 error 保留已生成的部分回答。 */
    async finish(id, { answer = '', status = 'complete' } = {}) {
      await serialize(async () => {
        const transaction = (await ensure()).transaction('turns', 'readwrite');
        const store = transaction.objectStore('turns');
        const current = await ask(store, value => value.get(id));
        if (!current) return;
        if (current.status !== 'generating' && status !== 'error') return;
        // stopped 与 error 保留已生成的部分回答：传空 answer 时沿用库里已有的内容。
        const next = normalizeConversationTurn({ ...current, status, answer: answer || current.answer, updatedAt: now() }, now());
        if (next) store.put(next);
        await commit(transaction);
      });
    },
    /** 会话的全部回合，按时间正序，供卡片展示。 */
    async list(sessionId, limit = 40) {
      const turns = await allBySession(sessionId);
      return turns.sort((a, b) => a.createdAt - b.createdAt).slice(-limit);
    },
    async removeSession(sessionId) {
      await serialize(async () => {
        const turns = await allBySession(sessionId);
        const transaction = (await ensure()).transaction('turns', 'readwrite');
        const store = transaction.objectStore('turns');
        for (const turn of turns) store.delete(turn.id);
        await commit(transaction);
      });
    },
    /** 管理视图用：所有会话按最新回合倒序，每个会话最多带回 20 轮。 */
    async sessions() {
      const transaction = (await ensure()).transaction('turns', 'readonly');
      const turns = await ask(transaction.objectStore('turns'), store => store.getAll());
      const groups = new Map();
      for (const turn of [...turns].sort((a, b) => a.createdAt - b.createdAt)) {
        if (!groups.has(turn.sessionId)) groups.set(turn.sessionId, []);
        groups.get(turn.sessionId).push(turn);
      }
      return [...groups.entries()].map(([sessionId, list]) => ({
        sessionId, turns: list.slice(-20), updatedAt: list.at(-1).updatedAt, text: list.at(-1).text, source: list.at(-1).source,
      })).sort((a, b) => b.updatedAt - a.updatedAt);
    },
    /** 过期清理：每轮按自己的 createdAt 计算 30 天；清完后不再有回合的会话自然消失。 */
    async prune(reference = now()) {
      const cutoff = reference - TTL_MS;
      return serialize(async () => {
        const transaction = (await ensure()).transaction('turns', 'readonly');
        const expired = await ask(transaction.objectStore('turns'), store => store.index('at').getAll(globalThis.IDBKeyRange.upperBound(cutoff)));
        if (!expired.length) return 0;
        const write = (await ensure()).transaction('turns', 'readwrite');
        const store = write.objectStore('turns');
        for (const turn of expired) store.delete(turn.id);
        await commit(write);
        return expired.length;
      });
    },
  };
}

export const CONVERSATION_LIMITS = Object.freeze({ TTL_MS, MAX_TURNS_PER_SESSION, MAX_HISTORY_TURNS, MAX_ANSWER, MAX_QUESTION, MAX_TEXT, MAX_CONTEXT });
