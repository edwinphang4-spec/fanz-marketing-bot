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

// 一律禁止的性能数字 —— 清单里根本没有这些列，讲多少都是编的。
//
// 2026-08-06 解锁:风量(CFM)/功率(W)/档位 从这张表里移走了。它们不是"无据可查"，
// 是 Fanz 那份官方 Excel 里**本来就有**，只是拦截规则停留在"还没拿到清单"的时代。
// 移走不等于放行 —— 改成逐条比对本篇型号在清单里的真值(见 checkVerifiedSpecs)，
// 跟尺寸那套完全一样的写法，不开天窗。
const FORBIDDEN_UNITS = [
  { re: /\b\d[\d,.]*\s*(?:sq\.?\s?ft|sqft|square\s?feet|square\s?foot)\b/gi, what: '房间/覆盖面积(平方尺)' },
  { re: /\b\d[\d,.]*\s*(?:m2|sq\.?\s?m|square\s?met(?:re|er)s?)\b/gi, what: '房间/覆盖面积(平方米)' },
  { re: /\b\d[\d,.]*\s*kwh\b/gi, what: '耗电量(度)' },
  { re: /\b\d[\d,.]*\s*(?:db|decibels?)\b/gi, what: '噪音(分贝)' },
  // 转速:清单 47 个型号里只有 2 个有值，且 VIOZ 表连这一列都没有 → 全系不许引用
  { re: /\b\d[\d,.]*\s*rpm\b/gi, what: '转速' },
  { re: /\bsaves?\s+(?:up\s+to\s+)?\d/gi, what: '省钱/省电数字' },
  { re: /\bup\s+to\s+\d[\d,.]*\s*(?:sq|m2|%|db)/gi, what: '"up to N" 性能声明' },
];

// ── 对外推导:一律禁止 ──
//
// Edwin 2026-08-06 特别指定的红线。有了 CFM/W 之后最容易犯、而且**长得最像"有依据"**
// 的错就是这个:数字本身是真的，推出来的结论是编的。客户照着"够 40 平方"买了不够凉，
// 投诉的是 Fanz。
//
// 只讲 Fanz 自己产品之间的横向对比，不做任何对外推导。
const DERIVATION_BANS = [
  { re: /\bcfm\b[^.!?]{0,60}\b(?:cover|covers|enough for|suitable for|suits|ideal for|good for)\b/gi,
    what: '拿风量推覆盖面积/适用房间' },
  { re: /\b(?:cover|covers|enough for|suitable for|good for)\b[^.!?]{0,40}\bcfm\b/gi,
    what: '拿风量推覆盖面积/适用房间' },
  { re: /\b\d[\d,.]*\s*w(?:atts?)?\b[^.!?]{0,60}\b(?:rm|ringgit|bill|electricity|save|cost|cheaper|month)\b/gi,
    what: '拿功率推电费/省钱' },
  { re: /\b(?:bill|electricity|ringgit|rm)\b[^.!?]{0,60}\b\d[\d,.]*\s*w(?:atts?)?\b/gi,
    what: '拿功率推电费/省钱' },
  { re: /\b\d+\s*(?:\+\s*\d+\s*)?speeds?\b[^.!?]{0,50}\b(?:km\/h|m\/s|mph|times faster|faster than)\b/gi,
    what: '拿档位推绝对风速' },
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
    // 表没核实过 → 两张表留空 → 任何房间-尺寸建议一律拦（2026-08-05 存证失败后的状态）
    if (!ROOM_SIZE_GUIDE.verified) throw new Error('room size guide unverified');
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

/** 素材库记的型号("FERRO 56L")对到清单的键("FERRO56L") */
function catalogSpecFor(productMeta) {
  if (!productMeta) return null;
  const said = productMeta.catalog_model || productMeta.model_code;
  if (!said) return null;
  try {
    const pc = require('./product-catalog');
    if (pc.specsFor(said)) return { model: said, spec: pc.specsFor(said), pc };
    const norm = (s) => String(s).toUpperCase().replace(/[^A-Z0-9]/g, '');
    const hit = Object.keys(pc.CATALOG).find((k) => norm(k) === norm(said));
    return hit && pc.specsFor(hit) ? { model: hit, spec: pc.specsFor(hit), pc } : null;
  } catch (_) { return null; }
}

/**
 * 已解锁的三项规格:风量 / 功率 / 档位。
 * 有真值且对得上 → 放行;对不上 → 拦;这台没这项数据 → 拦(不许写)。
 *
 * 写法刻意和尺寸那套一致:白名单放行的是**这台在清单里的那个数**,
 * 不是"长得像风量的字符串"。
 */
function checkVerifiedSpecs(masked, productMeta, blocking, warnings) {
  const found = catalogSpecFor(productMeta);
  const cite = (field) => Boolean(found && found.pc.canCite(found.model, field));
  const val = (field) => (found ? found.spec[field] : null);

  const scan = (re, field, label, matches) => {
    for (const m of masked.matchAll(re)) {
      const n = Number(String(m[1]).replace(/,/g, ''));
      if (!found) { warnings.push(`出现${label} ${m[0].trim()} 但本篇没有指定产品,无法核对`); continue; }
      if (!cite(field)) {
        blocking.push(`${label}无依据:文里写「${m[0].trim()}」,但清单里 ${found.model} 的这项是空的`);
        continue;
      }
      if (!matches(n, val(field))) {
        blocking.push(`${label}对不上:文里写「${m[0].trim()}」但 ${found.model} 是 ${val(field)}`);
      }
    }
    return masked.replace(re, ' ');
  };

  let out = masked;
  out = scan(/\b(\d[\d,]*)\s*cfm\b/gi, 'cfm', '风量', (n, real) => n === Number(real));
  // 灯的瓦数(22W/24W)和马达功率(31-42W)是两项,写哪个都得对得上其中之一
  out = scan(/\b(\d[\d,.]*)\s*w(?:atts?)?\b(?![a-z])/gi, 'watt', '功率', (n) => {
    const motor = parseInt(val('watt'), 10);
    const led = parseInt(val('led_watt'), 10);
    return n === motor || n === led;
  });
  // "6+6" / "6 speeds" 都要对上清单的 speed("6+6")
  out = scan(/\b(\d+)\s*(?:\+\s*\d+\s*)?(?:speeds?|speed settings|fan speeds)\b/gi, 'speed', '档位', (n) => {
    const first = parseInt(String(val('speed')).split('+')[0], 10);
    return n === first;
  });
  out = scan(/\b(\d+)\s*\+\s*\d+\b(?=[^.!?]{0,20}\bspeed)/gi, 'speed', '档位', (n) => {
    const first = parseInt(String(val('speed')).split('+')[0], 10);
    return n === first;
  });
  return out;
}

/**
 * 百分比:默认全禁,**只放行**能对上清单真实配对的那类横向对比。
 *
 * 为什么不干脆放开:一旦允许任意百分比,"省电 30%"就跟着进来了 —— 那正是
 * 我们最怕的那种"看起来有依据"的编造。这里放行的每一个数字,都对应清单里
 * 一对具体型号(同尺寸、叶数不同、风量确有差),可以逐个核。
 */
function checkPercentages(masked, blocking) {
  let allowed = new Set();
  try {
    for (const c of require('./product-catalog').airflowComparisons()) allowed.add(c.pct);
  } catch (_) { /* 算不出来就一个都不放行 */ }

  return masked.replace(/\b(\d[\d,.]*)\s*%/g, (m, num, off, whole) => {
    const n = Math.round(Number(String(num).replace(/,/g, '')));
    const near = String(whole).slice(Math.max(0, off - 90), off + m.length + 90).toLowerCase();
    const isAirflow = /\bair(flow)?\b|\bcfm\b|\bblade/.test(near);
    const isMoney = /\brm\b|ringgit|bill|electric|save|discount|off\b/.test(near);
    // ±1 是四舍五入的容差,不是"差不多就行"
    const matchesReal = [...allowed].some((p) => Math.abs(p - n) <= 1);
    if (isAirflow && !isMoney && matchesReal) return ' ';
    blocking.push(isAirflow
      ? `风量对比百分比对不上清单:「${m.trim()}」—— 清单算得出来的是 ${[...allowed].sort((a, b) => a - b).join('% / ')}%`
      : `无依据的百分比:「${m.trim()}」—— 只有同尺寸自家扇的风量对比才有真值可算`);
    return ' ';
  });
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
      blocking.push(GUIDE_RANGES.size
        ? `选尺寸区间对不上 Fanz 官方表:「${m.trim()}」—— 表里只有 ${[...GUIDE_RANGES.keys()].join(' / ')} 英寸`
        : `房间-尺寸建议「${m.trim()}」不许写 —— Fanz 官方选尺寸表尚未核实,系统里没有可依据的口径`);
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

  // ①'' 对外推导 —— 必须在数字被抹掉之前查，因为它认的是「数字 + 上下文词」的组合。
  //     数字本身是真的，推出来的结论是编的:这类最难看出来，所以单独列一档。
  for (const { re, what } of DERIVATION_BANS) {
    re.lastIndex = 0;
    for (const m of masked.matchAll(re)) {
      blocking.push(`${what}:「${m[0].trim().slice(0, 60)}」—— 只能横向比自家同尺寸的扇,不许往外推`);
    }
  }

  // ①''' 已解锁的三项(风量/功率/档位):逐条比对本篇型号在清单里的真值
  masked = checkVerifiedSpecs(masked, productMeta, blocking, warnings);

  // ①'''' 百分比:只放行能对上清单真实配对的风量横向对比
  masked = checkPercentages(masked, blocking);

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

  // ③ 叶数:库里有真值才允许写;库里未知(如 FS 48/62)就不许写。
  //
  // 2026-08-06:解锁风量对比后这里踩了一次 —— "5 blades move 33% more air than 3"
  // 被判成"文里写 5 叶但这台是 6 叶"。**对比句里出现别的叶数是合法的**,那正是
  // 这类知识帖的全部内容。所以放行条件收得很紧:必须是对比句 **且** 那个叶数
  // 在清单里同尺寸下真的存在。凭空说"7 叶"照样拦。
  const bladeHits = [...masked.matchAll(/\b(\d)\s*[-\s]?blades?\b/gi)];
  const sameSizeBlades = (() => {
    const s = new Set();
    try {
      const pc = require('./product-catalog');
      const size = productMeta && Number(productMeta.size_inches);
      if (size) for (const [m, spec] of Object.entries(pc.CATALOG)) {
        if (spec.size_inch === size && pc.canCite(m, 'blades')) s.add(Number(spec.blades));
      }
    } catch (_) { /* 读不到清单 → 空集合 → 一个都不放行 */ }
    return s;
  })();
  const seenBlades = new Set();
  for (const hit of bladeHits) {
    const n = Number(hit[1]);
    if (seenBlades.has(n)) continue;
    seenBlades.add(n);
    if (!productMeta) { warnings.push(`出现叶数 ${n} 但本篇没有指定产品`); continue; }
    const near = masked.slice(Math.max(0, hit.index - 80), hit.index + hit[0].length + 80).toLowerCase();
    const isComparison = /\bmore air\b|\bthan\b|\bvs\.?\b|\bversus\b|\bcompared\b|\binstead of\b/.test(near);
    if (isComparison && sameSizeBlades.has(n)) continue;   // 同尺寸下真有这种叶数的扇
    if (!productMeta.blade_count) {
      blocking.push(`叶数无依据:文里写 ${n} 叶,但素材库对 ${productMeta.model_code || '这台'} 的叶数尚未确认`);
    } else if (n !== Number(productMeta.blade_count)) {
      blocking.push(`叶数对不上:文里写 ${n} 叶但这台是 ${productMeta.blade_count} 叶`);
    }
  }

  // 同一处违规可能被两条规则各抓一次("9+9" 命中档位的两种写法)。
  // 这些是给人看的,去重。
  const uniq = (a) => [...new Set(a)];
  return { ok: blocking.length === 0, blocking: uniq(blocking), warnings: uniq(warnings) };
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

  // 2026-08-06 解锁:风量/功率/档位/材质等来自 Fanz 官方 Excel 清单，
  // 逐条按本篇型号给值 —— 给了才准写，没给就是没有。
  const found = catalogSpecFor(productMeta);
  if (found) {
    const { model, spec, pc } = found;
    const ok = (f) => pc.canCite(model, f);
    if (ok('cfm')) canSay.push(`Airflow: ${spec.cfm} CFM — this exact figure only, and never converted into a room area`);
    if (ok('watt')) canSay.push(`Motor power: ${spec.watt} — the figure only, never turned into a cost or a saving`);
    if (ok('led_watt')) canSay.push(`LED power: ${spec.led_watt}`);
    if (ok('speed')) canSay.push(`Speed settings: ${spec.speed} (forward + reverse)`);
    if (ok('material')) canSay.push(`Blade material: ${spec.material}`);
    if (ok('wifi')) canSay.push(spec.wifi ? 'WiFi / smart-app control' : 'Remote control, no WiFi');
    if (ok('dimmable') && spec.dimmable) canSay.push('The light is dimmable');
    if (spec.led === '3 TONE') canSay.push('3-tone LED (switchable colour temperature)');
  }

  // 同尺寸自家扇的风量横向对比 —— 这是目前唯一有真值可算的百分比。
  let comparisons = '';
  try {
    const rows = require('./product-catalog').conservativeAirflowComparisons();
    if (rows.length) {
      comparisons = `

BLADE-COUNT COMPARISON (computed from Fanz's own product list — safe to state, and the ONLY
percentages you may ever write). Each line compares two REAL Fanz fans of the SAME diameter:
${rows.map((c) => `- At ${c.size}": the ${c.more.blades}-blade ${c.more.model} moves about ${c.pct}% more air than the ${c.fewer.blades}-blade ${c.fewer.model} (${c.more.cfm} vs ${c.fewer.cfm} CFM)`).join('\n')}
- Name both fans when you use one of these. A bare "5 blades move X% more air" with no models
  behind it is not something we can stand behind.`;
    }
  } catch (_) { /* 算不出来就不给对比事实 */ }

  return `
VERIFIED FACTS — you may state these, and ONLY these:
${canSay.map((c) => `- ${c}`).join('\n')}${comparisons}

NEVER DERIVE — this is the trap. The figures above are real, so anything you build on top of
them LOOKS sourced. It is not. A customer who buys on the strength of a derived claim and finds
the room still hot complains to Fanz, and the number was ours:
- Never turn a CFM figure into a room size, a coverage area, or "enough airflow for" a space
- Never turn a wattage figure into money — no monthly cost, no saving, no fraction of a bill
- Never turn speed settings into an absolute wind speed
- Compare ONLY Fanz fans of the same diameter against each other. Never against another brand,
  never against "an ordinary fan", never against a national average.

NEVER STATE (we have no source at all for these):
- Room size / coverage area, in any unit
- Noise level in decibels, or any dB figure
- kWh, electricity cost, or any energy-saving percentage
- RPM (the product list leaves this blank for almost every model)
- Any price, discount percentage or promotional amount
- Any figure for a model that is not listed under VERIFIED FACTS above
- What size fan a bedroom / living room / small room "needs" — we have no verified room-size table
You may still say a fan is quiet, energy-efficient or suitable for a large room —
just never attach a number or a specific area to it.`;
}

module.exports = {
  checkFabricatedClaims,
  buildFactBoundaryBlock,
  FORBIDDEN_UNITS,
};
