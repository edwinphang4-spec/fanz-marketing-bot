// ============================================
// content-history.js — 跨月记忆的**唯一**查询层
//
// 2026-08-07 Edwin 查出来的缺口:记忆的作用域全部锁死在 plan_id 上 ——
//   · 月度规划提示词完全不看已有内容;
//   · 选品轮换只在本次这批 rows 内不重复;
//   · 查重器 listContentCalendarByPlanId(planId) —— 只查同一个 plan;
//   · 图上文字查重同上;
//   · 知识点讲过什么没人记。
// 于是上个月推过 DELTA56 三次,这个月照样可能再推三次,而且**两次都能过查重**。
//
// 最讽刺的是 Mark 其实有记忆(getContentSummary 取最近 40 行、不限月份,
// 提示词里还写着"绝不要提议重复已发布的内容")—— 但那份记忆只有对话看得到,
// 真正生成 12 篇内容的那条路径从头到尾不知道。
// 「能力做出来了,但没接到真正需要它的地方」——和之前"新逻辑只接了月度批量"
// 是同一个模式。
//
// 所以这里做成**一个**查询层,四个消费方都从这里取,不各查各的:
// 各查各的迟早会出现"规划器认为讲过、查重器认为没讲过"。
// ============================================

const supabase = require('./supabase');

// 三个窗口(Edwin 定的):讲过什么看 90 天,用过哪台扇看 60 天。
const TOPIC_WINDOW_DAYS = 90;
const SKU_WINDOW_DAYS = 60;

// 一次查询喂四个消费方,60 秒内复用 —— 规划一次会连着调好几处。
const CACHE_TTL_MS = 60_000;
let _cache = null, _cacheAt = 0, _cacheDays = 0;

function daysAgo(n) {
  const d = new Date(Date.now() - n * 86400_000);
  return d.toISOString().slice(0, 10);
}

function readSpec(row) {
  const raw = row && row.compose_spec;
  if (!raw) return {};
  if (typeof raw === 'object') return raw;
  try { return JSON.parse(raw); } catch (_) { return {}; }
}

/**
 * 最近 N 天的帖子。读不到就返回空数组 —— 记忆是**增益**,
 * 拿不到历史应当照常出内容,绝不能因此挡住规划。
 */
async function recentPosts(days = TOPIC_WINDOW_DAYS) {
  const now = Date.now();
  if (_cache && _cacheDays >= days && now - _cacheAt < CACHE_TTL_MS) return _cache;
  try {
    const rows = await supabase.listContentCalendar({
      since: daysAgo(days), limit: 200, order: 'created_at.desc',
    });
    _cache = rows || [];
    _cacheAt = now;
    _cacheDays = days;
    return _cache;
  } catch (err) {
    console.error('[content-history] 读历史失败,本次不带跨月记忆:', err.message);
    return [];
  }
}

/** 测试和"刚写完立刻要读"的场景用 */
function clearCache() { _cache = null; _cacheAt = 0; _cacheDays = 0; }

/**
 * 给月度规划提示词的「最近讲过什么」。
 *
 * 只给**标题 + 产品**,不给正文:规划器要的是"别撞题",不是"学写法"。
 * 给多了会让它去模仿上个月的措辞,反而更像。
 */
function coveredBlock(rows) {
  const usable = (rows || []).filter((r) => r && r.topic && r.status !== 'rejected');
  if (usable.length === 0) return '';
  const lines = usable.slice(0, 40).map((r) => {
    const when = String(r.suggested_date || r.created_at || '').slice(0, 10);
    const prod = r.source_product_image ? ` · ${r.source_product_image}` : '';
    return `- ${when} [${r.pillar || '?'}]${prod} "${r.topic}"`;
  });
  return `\n\nALREADY COVERED IN THE LAST ${TOPIC_WINDOW_DAYS} DAYS — do not repeat these. `
    + `Pick different products, different angles and different topics. If a subject genuinely `
    + `deserves revisiting, come at it from a clearly different direction and say so in the angle:\n`
    + lines.join('\n');
}

/**
 * 最近用过的型号 → 用了几次。选品据此降权(不是禁用):
 * 池子只有 25 个型号,硬禁 60 天会把选择面压得太窄。
 */
function recentSkuUsage(rows, days = SKU_WINDOW_DAYS) {
  const cutoff = daysAgo(days);
  const usage = new Map();
  for (const r of rows || []) {
    if (!r || !r.source_product_image || r.status === 'rejected') continue;
    const when = String(r.suggested_date || r.created_at || '').slice(0, 10);
    if (when && when < cutoff) continue;
    const k = r.source_product_image;
    usage.set(k, (usage.get(k) || 0) + 1);
  }
  return usage;
}

/** 最近讲过的知识点(knowledge 帖的 teaching_key) */
function recentTeachingKeys(rows) {
  const keys = new Set();
  for (const r of rows || []) {
    const k = readSpec(r).teaching_key;
    if (k) keys.add(String(k));
  }
  return keys;
}

/**
 * 查重用:最近的标题 / 开场句 / 图上文字。
 * 和当月那份合并后一起喂给 qa-content —— 它本来就只认"一批行",不关心哪来的。
 */
function repetitionRows(rows) {
  return (rows || [])
    .filter((r) => r && r.status !== 'rejected')
    .map((r) => {
      const spec = readSpec(r);
      return {
        topic: r.topic,
        pillar: spec.is_festival ? 'festival' : r.pillar,
        angle: spec.angle || null,
        fb_content: r.fb_content,
        imageTexts: spec.image_texts || null,
        historical: true,          // 报告里要能分清"这个月撞了"还是"跟上个月撞了"
      };
    });
}

module.exports = {
  TOPIC_WINDOW_DAYS, SKU_WINDOW_DAYS,
  recentPosts, clearCache, daysAgo,
  coveredBlock, recentSkuUsage, recentTeachingKeys, repetitionRows,
};
