// ============================================
// qa-content.js — 整月内容查重（代码层，100% 可靠，不靠提示词祈祷）
//
// 2026-08-01 实测事故:整月 12 篇的图上文字几乎一模一样 ——
//   · 标题含 "Whisper-Quiet" 的 8/12
//   · 副标题就是 "10-Year Motor Warranty" 的 8/12(不重复的副标题只有 2 个)
//   · CTA 是 "Get Yours Today" 的 7/12
//   · 文案正文里 6/12 篇开头第一句完全相同
// 靠提示词说"每篇要不同"是概率性的,治不了根。这里用纯字符串统计,
// 超阈值就报警,报警必须出现在人看得到的地方(Telegram + plan notes)。
//
// 本模块只统计不改写:它的作用是**让雷同无处可藏**,不是自动改文案。
// ============================================

// 图上同一句文字最多允许出现几次(整月)
const MAX_SAME_IMAGE_TEXT = 2;
// 同一个短语最多允许出现在几篇文案正文里
const MAX_POSTS_PER_PHRASE = 5;
// 自动抓重复短语时的词数窗口
const NGRAM_SIZES = [3, 4, 5];

function norm(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[‘’'"]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 统计一组字符串里各值出现次数(归一化后) */
function tally(values) {
  const m = new Map();
  for (const v of values) {
    const k = norm(v);
    if (!k) continue;
    if (!m.has(k)) m.set(k, { count: 0, sample: String(v).trim() });
    m.get(k).count++;
  }
  return m;
}

/**
 * 从多篇正文里自动找出"跨篇重复的短语"。
 * 不写死关键词表 —— 今天是 whisper-quiet,明天换个套话照样要抓得到。
 * @returns {Array<{phrase:string, posts:number}>}
 */
function repeatedPhrases(bodies, maxPosts = MAX_POSTS_PER_PHRASE) {
  const phraseToPosts = new Map();
  bodies.forEach((body, idx) => {
    // 网址/话题标签是每篇都该有的固定件,不算"雷同"——先剥掉,否则
    // "fanz my https fanz my" 这种碎片会刷屏,把真正的雷同淹掉。
    const cleaned = String(body || '')
      .replace(/https?:\/\/\S+/gi, ' ')
      .replace(/#\S+/g, ' ')
      .replace(/\bfanz\.?my\b/gi, ' ');
    const words = norm(cleaned).split(' ').filter(Boolean);
    const seenHere = new Set();
    for (const n of NGRAM_SIZES) {
      for (let i = 0; i + n <= words.length; i++) {
        const g = words.slice(i, i + n).join(' ');
        if (seenHere.has(g)) continue;
        seenHere.add(g);
        if (!phraseToPosts.has(g)) phraseToPosts.set(g, new Set());
        phraseToPosts.get(g).add(idx);
      }
    }
  });
  const hits = [];
  for (const [phrase, posts] of phraseToPosts) {
    if (posts.size > maxPosts) hits.push({ phrase, posts: posts.size });
  }
  // 长短语优先(信息量大),同长度按出现篇数排
  hits.sort((a, b) => b.posts - a.posts || b.phrase.length - a.phrase.length);
  // 去掉被更长短语包含的碎片,避免刷屏
  const kept = [];
  for (const h of hits) {
    if (!kept.some((k) => k.phrase.includes(h.phrase))) kept.push(h);
  }
  return kept.slice(0, 12);
}

/**
 * 整月查重。
 *
 * @param {Array<{topic?:string, pillar?:string, fb_content?:string,
 *   imageTexts?:{title?:string, selling_point?:string, cta?:string}}>} rows
 * @returns {{ok:boolean, alerts:string[], detail:object}}
 */
function checkMonthlyRepetition(rows = [], opts = {}) {
  // 2026-08-07:查重范围从"同一个 plan"扩到"再加最近 90 天"。范围变了,
  // 报告的口径就必须跟着变 —— 否则跟上个月撞的句子会被报成"在整月出现 3 次",
  // 她翻遍这个月也找不到那三篇,只会以为系统在乱报。
  const scope = opts.scopeLabel || '整月';
  const alerts = [];
  const detail = {};

  // ① 图上文字:同一句出现超过 MAX_SAME_IMAGE_TEXT 次
  for (const field of ['title', 'selling_point', 'cta']) {
    const values = rows.map((r) => (r.imageTexts || {})[field]).filter(Boolean);
    const t = tally(values);
    const over = [...t.values()].filter((v) => v.count > MAX_SAME_IMAGE_TEXT)
      .sort((a, b) => b.count - a.count);
    const label = { title: '标题', selling_point: '副标题', cta: 'CTA' }[field];
    detail[field] = {
      total: values.length,
      unique: t.size,
      repeated: over.map((o) => ({ text: o.sample, count: o.count })),
    };
    for (const o of over) {
      alerts.push(`图上${label}「${o.sample}」在${scope}出现 ${o.count} 次(上限 ${MAX_SAME_IMAGE_TEXT})`);
    }
    // 多样性本身也值得报:不重复率过低
    if (values.length >= 5 && t.size <= Math.ceil(values.length / 3)) {
      alerts.push(`图上${label}只有 ${t.size} 种写法(${scope}共 ${values.length} 篇)——多样性过低`);
    }
  }

  // ② 开头第一句:不该出现同一句开场(跨月同样算 —— 上个月用过的开场再用一次也是重复)
  const firstLines = rows
    .map((r) => String(r.fb_content || '').split('\n').map((s) => s.trim()).filter(Boolean)[0])
    .filter(Boolean);
  const ft = tally(firstLines);
  const dupOpen = [...ft.values()].filter((v) => v.count > 1).sort((a, b) => b.count - a.count);
  detail.openingLines = { total: firstLines.length, unique: ft.size, repeated: dupOpen.map((o) => ({ text: o.sample, count: o.count })) };
  for (const o of dupOpen) {
    alerts.push(`开头第一句「${o.sample.slice(0, 60)}」在${scope}重复 ${o.count} 篇`);
  }

  // ③ 正文里跨篇重复的短语(自动发现,不写死词表)
  const bodies = rows.map((r) => r.fb_content || '').filter(Boolean);
  const phrases = repeatedPhrases(bodies);
  detail.repeatedPhrases = phrases;
  for (const p of phrases) {
    alerts.push(`短语「${p.phrase}」出现在 ${p.posts}/${bodies.length} 篇正文里(上限 ${MAX_POSTS_PER_PHRASE})`);
  }

  return { ok: alerts.length === 0, alerts, detail };
}

/** 把查重结果压成一段可直接发 Telegram / 存 plan notes 的文字 */
function formatRepetitionReport(result, max = 12, scopeLabel = '整月') {
  if (!result || result.ok) return null;
  const lines = result.alerts.slice(0, max).map((a) => `• ${a}`);
  const more = result.alerts.length > max ? `\n…另有 ${result.alerts.length - max} 条` : '';
  return `⚠️ ${scopeLabel}内容查重发现 ${result.alerts.length} 处雷同:\n${lines.join('\n')}${more}`;
}

module.exports = {
  checkMonthlyRepetition,
  formatRepetitionReport,
  repeatedPhrases,
  MAX_SAME_IMAGE_TEXT,
  MAX_POSTS_PER_PHRASE,
};
