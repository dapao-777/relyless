// 间隔重复复习（Leitner 精简版）：把“遇到过、帮过”的词按盒子计划重新带到读者面前。
// 纯逻辑，不碰存储：仓库存 wordReviewPlan（chrome.storage.local），后台负责读写，页面负责呈现。
// 判断依据只使用本机已有数据（helpCount / requestedAt / knownAt），不引入新采集。

const BOX_INTERVAL_DAYS = Object.freeze([1, 3, 7, 21, 60]);
const BOX_LIMIT = BOX_INTERVAL_DAYS.length;
const DAY = 86_400_000;
const MAX_LAPSES = 99;

const clampBox = box => Number.isSafeInteger(box) ? Math.min(Math.max(box, 1), BOX_LIMIT) : 1;

/** 归一化一条复习计划；无效返回 null。 */
export function normalizeReview(value, now = Date.now()) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if (!Number.isSafeInteger(value.dueAt) || value.dueAt <= 0) return null;
  const box = clampBox(value.box);
  return {
    box,
    dueAt: value.dueAt,
    lastAt: Number.isSafeInteger(value.lastAt) ? value.lastAt : now,
    lapses: Number.isSafeInteger(value.lapses) ? Math.min(Math.max(value.lapses, 0), MAX_LAPSES) : 0,
  };
}

/** 首次预约：帮过一次之后第 1 天再来。 */
export function scheduleFirstReview(now = Date.now()) {
  return {box: 1, dueAt: now + BOX_INTERVAL_DAYS[0] * DAY, lastAt: now, lapses: 0};
}

/** 反馈推进：know 升盒并拉长间隔；again 回第 1 盒、记一次遗忘，当天再访。 */
export function advanceReview(review, outcome, now = Date.now()) {
  const current = normalizeReview(review, now) || scheduleFirstReview(now);
  if (outcome === 'know') {
    const box = clampBox(current.box + 1);
    return {box, dueAt: now + BOX_INTERVAL_DAYS[box - 1] * DAY, lastAt: now, lapses: current.lapses};
  }
  if (outcome === 'again') {
    return {box: 1, dueAt: now + BOX_INTERVAL_DAYS[0] * DAY, lastAt: now, lapses: Math.min(current.lapses + 1, MAX_LAPSES)};
  }
  return current;
}

/** 从候选条目中筛出到期项：条目需带 wordId 与 senseKey，按到期时间升序。 */
export function dueReviewEntries(plan, entries, now = Date.now(), limit = 20) {
  if (!plan || typeof plan !== 'object' || !Array.isArray(entries)) return [];
  const due = [];
  for (const entry of entries) {
    if (!entry || typeof entry.wordId !== 'string' || typeof entry.senseKey !== 'string') continue;
    const key = reviewKey(entry.wordId, entry.senseKey);
    const review = normalizeReview(plan[key], now);
    if (!review || review.dueAt > now) continue;
    due.push({...entry, key, review});
  }
  return due.sort((a, b) => a.review.dueAt - b.review.dueAt).slice(0, Math.max(0, limit));
}

export const reviewKey = (wordId, senseKey) => `${wordId}#${senseKey}`;
export const SRS_LIMITS = Object.freeze({BOX_INTERVAL_DAYS, BOX_LIMIT, MAX_LAPSES});
