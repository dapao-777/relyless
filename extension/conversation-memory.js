// 追问的本地记忆：把读者自己过去的讲解笔记（词条义项）整理成有界上下文，供模型参考。
// 只读取本机 passive reading state，不访问网络，也不把记忆当指令——内容在提示词里明确为数据。

const MAX_ENTRIES = 5;
const MAX_LABEL = 60;
const MAX_DEFINITION = 400;
const MAX_TOTAL = 1500;

const bounded = (value, max) => (typeof value === 'string' ? value.trim().slice(0, max) : '');

/** 从 state.words 收集与当前选文相关的本地笔记；没有则返回空数组。 */
export function collectConversationMemory(state, request) {
  const words = Array.isArray(state?.words) ? state.words : [];
  if (!words.length || typeof request?.text !== 'string' || !request.text.trim()) return [];
  const seen = new Set();
  const entries = [];
  for (const domain of [request.domain, 'general']) {
    const id = `${domain}:${request.text.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase()}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const word = words.find(value => value.id === id);
    if (!word) continue;
    const notes = [];
    for (const sense of Array.isArray(word.senses) ? word.senses : []) {
      const label = bounded(sense?.label, MAX_LABEL);
      const definition = bounded(sense?.definition, MAX_DEFINITION);
      if (label && definition) notes.push({label, definition});
    }
    if (notes.length) entries.push({
      term: bounded(word.term, 100) || bounded(request.text, 100),
      domain: bounded(word.domain, 32),
      known: Number(word.knownAt) > 0,
      helps: Number.isFinite(Number(word.helpCount)) ? Number(word.helpCount) : 0,
      notes: notes.slice(0, 3),
    });
    if (entries.length >= 2) break;
  }
  let total = 0;
  return entries.flatMap(entry => entry.notes.map(note => ({...entry, ...note})))
    .filter(entry => {
      total += entry.label.length + entry.definition.length;
      return total <= MAX_TOTAL;
    })
    .slice(0, MAX_ENTRIES)
    .map(({term, domain, known, helps, label, definition}) => ({term, domain, known, helps, label, definition}));
}

export const CONVERSATION_MEMORY_LIMITS = Object.freeze({MAX_ENTRIES, MAX_LABEL, MAX_DEFINITION, MAX_TOTAL});
