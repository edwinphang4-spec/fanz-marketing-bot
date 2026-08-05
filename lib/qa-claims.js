// ============================================
// qa-claims.js — 事实声明拦截（代码层，100% 判定）
//
// 2026-08-01 实测事故:文案写出了
//   "Choose the GAZE 52N Oakwood for rooms up to 225 sq ft"
// 而系统里**没有任何房间尺寸数据** —— 这个数字是模型编的。
//
// 为什么这条比"内容雷同"严重:这些帖子要发到 Fanz 官方 Facebook 给真实客户看。
// 客户照着"适合 225 平方尺"买了、房间太大不够凉,他会去找 Fanz 投诉,而这个
// 数字是我们编的。老板娘并不知道它没有依据 —— 出事是 Fanz 和 Edwin 承担。
//
// 规则很简单:**没有可核实来源的具体数字,一律不许出现**。
//   · 有来源的(型号尺寸/叶数/颜色/有无灯):必须和素材库记录一致,不一致=拦
//   · 品牌事实(10年马达保修/SIRIM/马新上门/RM100万责任险/十年历史):允许
//   · 其余一切性能数字(平方尺/瓦/分贝/百分比/风量/转速/价格):一律拦
// ============================================

// 允许出现的品牌事实(Fanz 提供,非模型编造)
const BRAND_FACT_PATTERNS = [
  /\b10[\s-]*year[s]?\b(?=[^.]{0,40}\b(warranty|motor)\b)/i,  // 10年马达保修
  /\b10\+?\s*year[s]?\b(?=[^.]{0,40}\b(serving|home|malaysia|trust|journey|decade)\b)/i, // 十年历史
  /\ba decade\b/i,
  /\bRM\s?1[,.]?000[,.]?000\b/i,                                // 责任险 RM100万
  /\bRM\s?1\s?(million|mil)\b/i,
];

// 一律禁止的性能数字 —— 系统里没有任何真实来源
const FORBIDDEN_UNITS = [
  { re: /\b\d[\d,.]*\s*(?:sq\.?\s?ft|sqft|square\s?feet|square\s?foot)\b/gi, what: '房间/覆盖面积(平方尺)' },
  { re: /\b\d[\d,.]*\s*(?:m2|sq\.?\s?m|square\s?met(?:re|er)s?)\b/gi, what: '房间/覆盖面积(平方米)' },
  { re: /\b\d[\d,.]*\s*(?:watts?|w)\b(?![a-z])/gi, what: '功率(瓦)' },
  { re: /\b\d[\d,.]*\s*kwh\b/gi, what: '耗电量(度)' },
  { re: /\b\d[\d,.]*\s*(?:db|decibels?)\b/gi, what: '噪音(分贝)' },
  { re: /\b\d[\d,.]*\s*(?:cfm|m³\/min|cubic)\b/gi, what: '风量' },
  { re: /\b\d[\d,.]*\s*rpm\b/gi, what: '转速' },
  { re: /\b\d+\s*[- ]?(?:speed|speeds|speed settings|fan speeds)\b/gi, what: '档位数' },
  { re: /\b\d[\d,.]*\s*%/g, what: '百分比(省电/折扣等)' },
  { re: /\bsaves?\s+(?:up\s+to\s+)?\d/gi, what: '省钱/省电数字' },
  { re: /\bup\s+to\s+\d[\d,.]*\s*(?:sq|m2|%|watt|w\b|db)/gi, what: '"up to N" 性能声明' },
];

// 价格/折扣:等真实促销条款到手前一律不许写
const PRICE_PATTERNS = [
  { re: /\bRM\s?\d[\d,.]*/gi, what: '价格/折扣金额(RM)' },
  { re: /\b\d[\d,.]*\s*%\s*(?:off|discount|rebate)\b/gi, what: '折扣百分比' },
];

// ── Fanz 官方选尺寸表:唯一真源就是 product-facts.ROOM_SIZE_GUIDE ──
// 这里不重抄一份数字。表改了,拦截跟着改;拦截和表永远不会各说各话。
const RANGE_RE = /\b(\d{2})\s*[-–—]\s*(\d{2})\s*(?:inch(?:es)?|["”])/gi;

/** "36 - 42 inch" → "36-42";房间名 → 区间 / 区间 → 房间名 */
const { GUIDE_RANGES, ROOM_TO_RANGE } = (() => {
  const byRange = new Map();
  const byRoom = new Map();
  try {
    const { ROOM_SIZE_GUIDE } = require('./product-facts');
    for (const r of ROOM_SIZE_GUIDE.rows) {
      const m = String(r.inches).match(/(\d{2})\s*[-–—]\s*(\d{2})/);
      if (!m) continue;
      const range = `${m[1]}-${m[2]}`;
      const room = String(r.room).toLowerCase();
      byRange.set(range, room);
      byRoom.set(room, range);
    }
  } catch (_) { /* 读不到表 → 两张表都空 → 所有区间一律拦(最严格,不放行) */ }
  return { GUIDE_RANGES: byRange, ROOM_TO_RANGE: byRoom };
})();

/** 一段文字里说的是哪种房间;说不清就返回 null(不判它对错) */
function roomInText(text) {
  const t = String(text || '').toLowerCase();
  if (/\bliving room|\blounge\b|\bfamily room\b/.test(t)) return 'living room';
  if (/\bbedroom/.test(t)) return 'bedroom';
  if (/\bsmall room|\bsmall space/.test(t)) return 'small room';
  return null;
}

/** 把品牌事实那几处从文本里剔掉,避免它们被当成违规数字 */
function maskBrandFacts(text) {
  let t = String(text || '');
  for (const re of BRAND_FACT_PATTERNS) t = t.replace(re, ' ');
  return t;
}

/**
 * 检查一段文字里有没有"编出来的具体数字/事实声明"。
 *
 * @param {string} text - 文案正文或图上文字
 * @param {object|null} productMeta - brand_assets.metadata（本篇指定产品的真值）
 * @returns {{ok:boolean, blocking:string[], warnings:string[]}}
 */
function checkFabricatedClaims(text, productMeta = null) {
  const blocking = [];
  const warnings = [];
  const raw = String(text || '');
  let masked = maskBrandFacts(raw);

  // 已确认的真实规格要放行,否则会误伤自己的真数据。
  // 2026-08-01:Fanz 官方规格图公布了 Grande 的 6 段风速等 —— 但**只属于 Grande**,
  // 所以放行严格按本篇产品所属系列来,不是全局放行。
  try {
    const pf = require('./product-facts');
    const series = productMeta && productMeta.model_code
      ? String(productMeta.model_code).split(/[\s\d]/)[0]
      : null;
    const spec = series ? pf.specsForSeries(series) : null;
    if (spec) {
      if (spec.speed_settings) {
        masked = masked.replace(
          new RegExp(`\\b${spec.speed_settings}\\s*[- ]?speeds?\\b`, 'gi'), ' ');
      }
      // 该系列的官方尺寸也放行(与 size_inches 不同的合法尺寸,如 Grande 的 45")
      for (const n of spec.sizes_inch || []) {
        masked = masked.replace(new RegExp(`\\b${n}\\s*(?:["”]|inch(?:es)?|-inch)`, 'gi'), ' ');
      }
    }
  } catch (_) { /* 规格库读不到就按最严格的走,不放行 */ }

  // ①' 选尺寸区间:**逐条比对 Fanz 官方表**,不是"长得像区间就放行"。
  //
  // 2026-08-05 实测:上一版无条件放行 30-72 之间任何 "NN-NN inch",于是
  //   "bedrooms benefit from fans in the 60-70 inch range"   → 一条不拦
  //   "Small rooms need 30-35 inch fans"                     → 一条不拦
  // 表抄错、抄反,照样发给真实客户。白名单放行的必须是**这张表里真有的那三行**,
  // 而且房间类型要对得上 —— 区间对、房间说反了,一样是错的资讯。
  masked = masked.replace(RANGE_RE, (m, a, b, off, whole) => {
    const range = `${a}-${b}`;
    if (!GUIDE_RANGES.has(range)) {
      blocking.push(`选尺寸区间对不上 Fanz 官方表:「${m.trim()}」—— 表里只有 ${[...GUIDE_RANGES.keys()].join(' / ')} 英寸`);
      return ' ';
    }
    // 区间在表里 → 再看它旁边说的是哪种房间
    const near = String(whole).slice(Math.max(0, off - 80), off + m.length + 80);
    const said = roomInText(near);
    if (said && GUIDE_RANGES.get(range) !== said) {
      blocking.push(`房间类型和尺寸区间对不上:「${said}」在 Fanz 官方表里是 ${ROOM_TO_RANGE.get(said)} 英寸,不是 ${range}`);
    }
    return ' ';
  });

  // ① 一律禁止的性能数字。
  //    多条规则会命中同一处文字("225 sq ft" 同时命中面积和 "up to N"),
  //    按覆盖区间去重,免得一条违规刷出三条告警(这些要发给人看)。
  const spans = [];
  for (const { re, what } of [...FORBIDDEN_UNITS, ...PRICE_PATTERNS]) {
    re.lastIndex = 0;
    for (const m of masked.matchAll(re)) {
      spans.push({ start: m.index, end: m.index + m[0].length, text: m[0].trim(), what });
    }
  }
  spans.sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start));
  const kept = [];
  for (const s of spans) {
    if (kept.some((k) => s.start < k.end && s.end > k.start)) continue; // 与已记录区间重叠
    kept.push(s);
    blocking.push(`无依据的${s.what}:「${s.text}」—— 系统里没有这项真实数据`);
  }

  // ② 有来源但必须对得上的:尺寸(英寸)。
  //    注意用 masked 而不是原文 —— 白名单(该系列官方尺寸、官方选尺寸区间)
  //    已经从 masked 里抹掉了,否则会把 Fanz 自己公布的 45" / 45-56 inch 误拦。
  // 注意:引号是非词字符,后面不能再跟 \b —— 第一版就是这么写的,
  // 结果 `66" of steady airflow` 整条漏过去(实测把 66 寸写给 52 寸的扇没抓到)。
  const inches = [...masked.matchAll(/\b(\d{2})\s*(?:["”]|inch(?:es)?\b|-inch\b)/gi)].map((m) => Number(m[1]));
  for (const n of [...new Set(inches)]) {
    if (productMeta && productMeta.size_inches) {
      if (n !== Number(productMeta.size_inches)) {
        blocking.push(`尺寸对不上:文里写 ${n}" 但这台是 ${productMeta.size_inches}"`);
      }
    } else {
      warnings.push(`出现尺寸 ${n}" 但本篇没有指定产品,无法核对`);
    }
  }

  // ③ 叶数:库里有真值才允许写;库里未知(如 FS 48/62)就不许写
  const blades = [...masked.matchAll(/\b(\d)\s*[-\s]?blades?\b/gi)].map((m) => Number(m[1]));
  for (const n of [...new Set(blades)]) {
    if (!productMeta) { warnings.push(`出现叶数 ${n} 但本篇没有指定产品`); continue; }
    if (!productMeta.blade_count) {
      blocking.push(`叶数无依据:文里写 ${n} 叶,但素材库对 ${productMeta.model_code || '这台'} 的叶数尚未确认`);
    } else if (n !== Number(productMeta.blade_count)) {
      blocking.push(`叶数对不上:文里写 ${n} 叶但这台是 ${productMeta.blade_count} 叶`);
    }
  }

  return { ok: blocking.length === 0, blocking, warnings };
}

/**
 * 给文案 agent 用的"可讲/不可讲"清单 —— 把限制写进提示词,
 * 让模型一开始就少编,代码层再兜底。
 */
function buildFactBoundaryBlock(productMeta) {
  const canSay = [
    '10-year motor warranty (Fanz brand fact)',
    'SIRIM certified (Fanz brand fact)',
    'DC motor technology (a fact about the product line — but NOT any efficiency figure)',
    'On-site service across Malaysia & Singapore (Fanz brand fact)',
    'Product liability insurance up to RM 1,000,000 (Fanz brand fact)',
    '10+ years serving Malaysian homes (Fanz brand fact)',
  ];
  if (productMeta) {
    if (productMeta.size_inches) canSay.push(`This model's diameter: ${productMeta.size_inches} inch — this exact number only`);
    if (productMeta.color) canSay.push(`Finish: ${productMeta.color}`);
    if (typeof productMeta.has_led === 'boolean') canSay.push(productMeta.has_led ? 'This model has an integrated LED light' : 'This model has NO light');
    if (productMeta.blade_count) canSay.push(`Blade count: ${productMeta.blade_count}`);
  }
  return `
VERIFIED FACTS — you may state these, and ONLY these:
${canSay.map((c) => `- ${c}`).join('\n')}

NEVER STATE (we have no source for these — inventing them misleads real customers
who buy on the strength of the claim, and Fanz carries the complaint):
- Room size / coverage area ("suitable for rooms up to N sq ft", "covers N square feet")
- Noise level in decibels, or any dB figure
- Wattage, kWh, electricity cost, or any energy-saving percentage or amount
- Airflow (CFM), RPM, number of speed settings
- Any price, discount percentage or promotional amount
- Blade count for a model whose blade count is not listed above
- Any other numeric performance figure not listed under VERIFIED FACTS
You may still say a fan is quiet, energy-efficient or suitable for a large room —
just never attach a number or a specific area to it.`;
}

module.exports = {
  checkFabricatedClaims,
  buildFactBoundaryBlock,
  FORBIDDEN_UNITS,
};
