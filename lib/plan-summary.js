// ============================================
// plan-summary.js — 月度计划的「整体确认」卡片
//
// 2026-08-07 Edwin 走查:旧版是 12 篇 × 3 个按钮 = 36 个按钮,而按钮上的标题被
// 截到 27 字("FS Serie…" "Choosin…")。更荒谬的是**同一份信息出现了两次**:
// 正文里标题是完整的,下面又用残缺标题重复列一遍当按钮 —— 她要操作的是残缺那份。
//
// 但真正的问题不是按钮丑,是**定位错了**:
//   · 这一步她只有标题和角度,文案配图都没生成 —— 没有足够信息做逐篇判断;
//   · 她看月度计划时想的是"够不够丰富/有没有重复/节庆覆盖了吗",是看整体;
//   · 而且后面文案、配图她还要各审一次。
// 把"整体审阅"做成"逐条操作",结果就是她只能全部 Approve ——
// 一个让人只能点"全部批准"的审核界面,等于没有审核。
//
// 所以改成:先人话摘要(回答她心里那四个问题)→ 再完整清单(标题不截断)
// → 只留两个按钮。要改某一篇就用说的("第3篇跟第7篇太像"),
// 比在 36 个按钮里找准确得多,而且自然语言那套本来就已经做好了。
// ============================================

/** pillar → 她看得懂的说法(不要在界面上出现 product/case 这种内部词) */
const PILLAR_LABEL = {
  product: '产品介绍',
  case: '使用场景',
  educational: '知识科普',
  story: '品牌故事',
  promo: '促销',
  festival: '节庆',
};

/** 清单里那一列用的短标签 */
const PILLAR_SHORT = {
  product: '产品',
  case: '场景',
  educational: '知识',
  story: '故事',
  promo: '促销',
  festival: '节庆',
};

const PILLAR_ORDER = ['product', 'case', 'educational', 'story', 'promo', 'festival'];

// 计划的月份内部一律是 'September 2026' 这种英文串(monthly-planning 的格式)。
// 直接拼进中文句子会变成"September 2026内容规划好了" —— 读起来是断的。
// 摘要那部分是给她看的说明,应当是中文;清单里的标题是实际要发的英文内容,
// 中英分层是有意的,但**月份属于说明,不属于内容**。
const EN_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];
function localiseMonth(label) {
  const m = String(label || '').trim().match(/^([A-Za-z]+)\s+(\d{4})$/);
  if (!m) return String(label || '');
  const idx = EN_MONTHS.findIndex((x) => x.toLowerCase() === m[1].toLowerCase());
  return idx >= 0 ? `${m[2]} 年 ${idx + 1} 月` : String(label);
}

// suggested_date 是**日历日期**(YYYY-MM-DD),不是时刻 —— 所以直接按数字拆,
// 不要先解析成带时区的瞬间再取 UTC 方法。
// 2026-08-07 测试抓到:上一版写 new Date(`${d}T00:00:00+08:00`).getUTCDay(),
// +08:00 的午夜换算成 UTC 是**前一天** 16:00,于是周几整体差一天 ——
// 9/5 是周六却被判成周五,"几篇在周末"这个数直接是错的。
function ymd(dateStr) {
  const [y, m, d] = String(dateStr).split('-').map(Number);
  return new Date(Date.UTC(y, (m || 1) - 1, d || 1));
}

/** '2026-09-03' → 周几(0=日) */
function weekdayOf(dateStr) {
  return ymd(dateStr).getUTCDay();
}

/** ISO 周序号,用来数"每周几篇" */
function weekKey(dateStr) {
  const t = ymd(dateStr);
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return `${t.getUTCFullYear()}-${Math.ceil(((t - yearStart) / 86400000 + 1) / 7)}`;
}

/**
 * 发布节奏的一句人话。
 * 只说她能据此做判断的事:每周几篇、避不避周末、有没有挤在一起。
 */
function rhythmLine(posts) {
  const byWeek = new Map();
  for (const p of posts) {
    const k = weekKey(p.suggested_date);
    byWeek.set(k, (byWeek.get(k) || 0) + 1);
  }
  const counts = [...byWeek.values()];
  const min = Math.min(...counts), max = Math.max(...counts);
  const perWeek = min === max ? `每周 ${min} 篇` : `每周 ${min}-${max} 篇`;

  const weekend = posts.filter((p) => [0, 6].includes(weekdayOf(p.suggested_date))).length;
  const weekendPart = weekend === 0 ? '避开周末'
    : weekend === posts.length ? '全部排在周末'
      : `其中 ${weekend} 篇在周末`;

  // 同一天挤了两篇以上 —— 她一眼看不出来,但会影响观感,值得报
  const byDay = new Map();
  for (const p of posts) byDay.set(p.suggested_date, (byDay.get(p.suggested_date) || 0) + 1);
  const clashes = [...byDay.entries()].filter(([, n]) => n > 1);
  const clashPart = clashes.length
    ? ` · ⚠️ ${clashes.map(([d]) => d.slice(5)).join('、')} 同一天有多篇`
    : '';

  return `${perWeek} · ${weekendPart}${clashPart}`;
}

/** 节庆那一行:哪个节、哪天。没有就说没有 —— 沉默会让她以为系统忘了。 */
function festivalLine(festivalPosts) {
  if (!festivalPosts || festivalPosts.length === 0) {
    return '本月没有排节庆帖';
  }
  return festivalPosts
    .map((p) => `${p.suggested_date.slice(5)} ${p.topic}`)
    .join(' · ');
}

/**
 * 组装整张卡片。
 *
 * @param {object} input
 * @param {Array} input.posts        全部帖子(含节庆),要有 suggested_date/pillar/topic
 * @param {Array} [input.picks]      pickProductsForPlan 的返回(取 series 做覆盖统计)
 * @param {Array} [input.festivalPosts]
 * @param {string} input.monthLabel  '9月'
 * @param {string} [input.planId]    有才出按钮
 * @returns {{text:string, keyboard:object|undefined}}
 */
function buildPlanCard(input) {
  const { posts = [], picks = [], festivalPosts = [], monthLabel, planId } = input;
  const sorted = [...posts].sort((a, b) => String(a.suggested_date).localeCompare(String(b.suggested_date)));
  const regular = sorted.filter((p) => p.pillar !== 'festival');
  const fests = festivalPosts.length ? festivalPosts : sorted.filter((p) => p.pillar === 'festival');

  // ── 摘要 ──
  const counts = {};
  for (const p of sorted) counts[p.pillar] = (counts[p.pillar] || 0) + 1;
  const mixLine = PILLAR_ORDER
    .filter((k) => counts[k])
    .map((k) => `${PILLAR_LABEL[k]} ${counts[k]}`)
    .join(' · ');

  const series = [...new Set((picks || []).filter(Boolean).map((x) => x && x.series).filter(Boolean))];
  const seriesLine = series.length
    ? `${series.join(' · ')}（${series.length} 个系列）`
    : '（选品还没定，出文案时再挑）';

  // 刻意**不用 parse_mode**(Edwin 2026-08-07 拍板)。
  // 标题里只要出现一个 _ 或 *,Telegram 的 Markdown 解析就会整条消息报 400 ——
  // 她什么都收不到。旧卡片也有这个隐患,但新卡片把 12 个完整标题都放进正文,
  // 撞上的概率高得多。取舍很清楚:一个偶尔完全收不到消息的界面,
  // 比一个没有加粗的界面糟得多。靠 emoji 和分隔线已经够清楚。
  const head = `📅 ${localiseMonth(monthLabel)}内容规划好了\n\n`
    + `${regular.length} 篇${fests.length ? ` + ${fests.length} 篇节庆` : ''}\n\n`
    + `📊 内容配比\n${mixLine}\n\n`
    + `🌀 覆盖产品\n${seriesLine}\n\n`
    + `📅 发布节奏\n${rhythmLine(sorted)}\n\n`
    + `🎊 节庆\n${festivalLine(fests)}\n`;

  // ── 完整清单:日期 + 类型 + **完整标题**,不截断 ──
  // 旧版把标题塞进按钮才被迫截断。标题留在正文里就没有这个限制。
  let list = `\n━━━━━━━━━━━━━━\n📝 完整清单\n\n`;
  for (const p of sorted) {
    list += `${String(p.suggested_date).slice(5)}  ${PILLAR_SHORT[p.pillar] || '内容'}  ${p.topic}\n`;
  }

  const text = head + list;

  // ── 只留两个按钮 ──
  // 逐篇 Remove/Replace/编辑全部删掉:这一步她没有足够信息做逐篇判断,
  // 而且"第3篇换个角度"用说的比在 36 个按钮里找准确得多。
  const keyboard = planId ? {
    inline_keyboard: [
      [{ text: '✅ 就这样，开始写文案', callback_data: `ma:${planId}` }],
      [{ text: '💬 我有想法要调整', callback_data: `mt:${planId}` }],
    ],
  } : undefined;

  return { text, keyboard };
}

/** 点「我有想法要调整」之后的引导语 —— 给例子,但都是"怎么说"不是"抄这句" */
const ADJUST_PROMPT =
  '你想改哪里？直接跟我说就行，比如：\n'
  + '· 促销太少了，加一篇\n'
  + '· 第 3 篇跟第 7 篇太像\n'
  + '· 这个月不要节庆帖\n'
  + '· 9 月 7 号那篇换个角度\n\n'
  + '如果是配比这种要整月重排的，我会先告诉你再重来一次。';

module.exports = {
  buildPlanCard, ADJUST_PROMPT, localiseMonth,
  PILLAR_LABEL, PILLAR_SHORT, rhythmLine, festivalLine,
};
