// ============================================
// content-request.js — 「她要什么」的统一表达
//
// 2026-08-08 Edwin 定方向:不要再给每种说法补一条命令。
// 她说"下星期三篇"、"帮我搞三篇"、"这个月重点推 DELTA"、"国庆前准备几篇" ——
// 真人说话本来就不会落在预设的格子里,补命令永远补不完。
//
// 所以把所有说法收成同一个请求对象:
//     { count, from, to, pillars?, products?, theme? }
// "整月"只是它的一个特例(count=12、from/to=当月首尾)。
//
// ⚠️ 日期由**代码**算,不由模型算。
// 我们在这里栽过:一篇排在 9/28 的帖子写出 "National Day is near",
// 而 Merdeka(8/31)和 Malaysia Day(9/16)那时都已经过去了。
// 模型对日期的直觉不可靠,凡是能算的就不要问它。
// Mark 只输出**相对意图**(next_week / this_month / 具体日期),换算在这里。
//
// ⚠️ 而且算完要**显示**(Edwin 加的一条):
// "下星期"本身就有歧义 —— 周一到周日还是周日到周六?今天周五的话是后天
// 还是下下周?这种代码也算不准。所以卡片上必须写出"下星期 = 9月8日 到 9月14日",
// 她看到不对可以当场说。**显示比猜准更重要。**
// ============================================

const MS_DAY = 86400_000;

/** 马来西亚当天(UTC+8),只取日期部分 */
function todayMY(now) {
  const d = now ? new Date(now) : new Date();
  const my = new Date(d.getTime() + 8 * 3600_000);
  return new Date(Date.UTC(my.getUTCFullYear(), my.getUTCMonth(), my.getUTCDate()));
}

const iso = (d) => d.toISOString().slice(0, 10);
const addDays = (d, n) => new Date(d.getTime() + n * MS_DAY);

/**
 * 周一为一周之始(马来西亚商业惯例)。
 * 这是个**选择**,不是事实 —— 所以调用方必须把算出来的范围显示给她。
 */
function startOfWeek(d) {
  const dow = d.getUTCDay();               // 0=日
  const back = dow === 0 ? 6 : dow - 1;    // 周日算成上一周的第 7 天
  return addDays(d, -back);
}

const MONTH_ZH = (m) => `${m + 1} 月`;

/** 给人看的日期:9月8日 */
function humanDate(isoStr) {
  const [, m, d] = String(isoStr).split('-').map(Number);
  return `${m}月${d}日`;
}

/**
 * 把相对意图换算成具体范围。
 *
 * @param {string|{from:string,to:string}} when
 *   'this_week' | 'next_week' | 'this_month' | 'next_month'
 *   | 'YYYY-MM-DD' (当天) | {from,to} | 'YYYY-MM-DD..YYYY-MM-DD'
 * @param {number|Date} [now] 测试用
 * @returns {{from:string,to:string,label:string,ambiguous:boolean}|null}
 *   认不出来返回 null —— 认不出就该问她,不该猜一个。
 */
function resolveWhen(when, now) {
  const today = todayMY(now);

  if (when && typeof when === 'object' && when.from && when.to) {
    return { from: when.from, to: when.to, label: '指定日期', ambiguous: false };
  }
  const s = String(when || '').trim().toLowerCase();

  const rangeMatch = s.match(/^(\d{4}-\d{2}-\d{2})\s*\.\.\s*(\d{4}-\d{2}-\d{2})$/);
  if (rangeMatch) {
    return { from: rangeMatch[1], to: rangeMatch[2], label: '指定日期', ambiguous: false };
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    return { from: s, to: s, label: humanDate(s), ambiguous: false };
  }

  if (s === 'this_week' || s === 'next_week') {
    const base = startOfWeek(today);
    const from = s === 'next_week' ? addDays(base, 7) : base;
    const to = addDays(from, 6);
    return {
      from: iso(from), to: iso(to),
      label: s === 'next_week' ? '下星期' : '这星期',
      // 周界怎么算是个约定,不是事实 —— 标记出来,让调用方一定把范围写给她看
      ambiguous: true,
    };
  }

  if (s === 'this_month' || s === 'next_month') {
    const y = today.getUTCFullYear();
    const m = today.getUTCMonth() + (s === 'next_month' ? 1 : 0);
    const first = new Date(Date.UTC(y, m, 1));
    const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0));
    return {
      from: iso(first), to: iso(last),
      label: `${first.getUTCFullYear()} 年 ${MONTH_ZH(first.getUTCMonth())}`,
      ambiguous: false,
    };
  }

  return null;
}

/**
 * 一句给她看的确认 —— 数量和日期都要写出来。
 * 她说"几篇"我理解成 3、她以为 5,这种误会只有写出来才拦得住。
 */
function describeRequest(req) {
  if (!req) return '';
  const range = req.from === req.to
    ? humanDate(req.from)
    : `${humanDate(req.from)} 到 ${humanDate(req.to)}`;
  const when = req.label && req.label !== '指定日期' ? `${req.label}（${range}）` : range;
  const bits = [`${req.count} 篇`, when];
  if (req.products && req.products.length) bits.push(`指定产品：${req.products.join(' / ')}`);
  if (req.pillars && req.pillars.length) bits.push(`类型倾向：${req.pillars.join(' / ')}`);
  if (req.theme) bits.push(`主题：${req.theme}`);
  return bits.join(' · ');
}

/**
 * 组装一个完整请求。数量或日期缺一不可 —— 缺了就返回 need,由调用方去问她。
 * **不替她填默认值**:"几篇"默认成 3 而她想要 5,做完才发现是最贵的错。
 */
function buildRequest({ count, when, pillars, products, theme }, now) {
  const range = resolveWhen(when, now);
  if (!range) return { ok: false, need: 'when' };
  const n = Number(count);
  if (!Number.isFinite(n) || n < 1) return { ok: false, need: 'count', range };
  return {
    ok: true,
    request: {
      count: Math.min(Math.round(n), 31),   // 上限兜底:一次几百篇是误解不是需求
      from: range.from,
      to: range.to,
      label: range.label,
      ambiguous: range.ambiguous,
      pillars: pillars && pillars.length ? pillars : null,
      products: products && products.length ? products : null,
      theme: theme || null,
    },
  };
}

module.exports = {
  resolveWhen, buildRequest, describeRequest, humanDate, todayMY, startOfWeek,
};
