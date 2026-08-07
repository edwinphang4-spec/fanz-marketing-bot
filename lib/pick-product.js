// ============================================
// pick-product.js — 按素材库给整月计划选产品（Edwin 三步方案的第三步）
//
// 设计前提（Edwin 2026-07-30 拍板）：
//   · 不让 AI 看图猜型号——吊扇长得都差不多，AI 认型号会错。
//   · 型号/尺寸/LED/颜色以人工标注为真源（brand_assets.metadata）。
//   · 只从 metadata.in_pool===true 的"信息完全清楚"的素材里选。
//
// 这里是纯代码规则，不调 LLM：
//   1) 文案里明确点了系列 → 只在该系列里选
//   2) 明确点了尺寸 → 只在该尺寸里选
//   3) 提到有灯/无灯 → 按 has_led 过滤
//   4) 提到房间类型 → 优先 spaces 命中的（尺寸-房间的物理常识已写进库）
//   5) 整月轮换 → 已用过的 SKU 不再用；优先没出现过的"系列+尺寸"组合
//   同分时按 row.id 哈希稳定挑一个，保证可复现。
// ============================================

const brand = require('./brand');

// 2026-08-04:官方清单建库后选品池从 4 个系列扩到 10 个。这张表只有 4 条时,
// 文案写 "DELTA" / "HEPTA" 根本匹配不上,整月还是会挤在 FS/GAZE 里。
const SERIES_PATTERNS = [
  { series: 'GRANDE', re: /\bgrande\b/i },
  { series: 'FERRO', re: /\bferro\b/i },
  { series: 'GAZE', re: /\bgaze\b/i },
  { series: 'DELTA', re: /\bdelta\b/i },
  { series: 'HEPTA', re: /\bhepta\b/i },
  { series: 'INNO', re: /\binno\b/i },
  { series: 'AURA', re: /\baura\b/i },
  { series: 'ALPINE', re: /\balpine\b/i },
  { series: 'MOVA', re: /\bmova\b/i },
  { series: 'HERA', re: /\bhera\b/i },
  { series: 'ALDO', re: /\baldo\b/i },
  { series: 'V605', re: /\bV\s?605\b/i },
  { series: 'FS', re: /\bFS[\s-]?\d|\bFS series\b/i },
];

// ── 整月分布硬指标(Edwin 2026-08-04 定)──
// 池里有 10 个系列却整月只用 FS/GAZE,内行一看就知道来来去去这几款。
const MIN_SERIES_PER_MONTH = 5;   // 整月至少覆盖 5 个不同系列
const MAX_POSTS_PER_SERIES = 3;   // 同一系列整月最多 3 篇

/**
 * 素材的系列名。
 *
 * ⚠️ 不能直接信 brand_assets.series 列:老素材存的是系列名("FS"/"GAZE"),
 * 从清单建的那批存的是完整型号("DELTA56"/"GRANDE453L")。混着用会把
 * DELTA56 和 DELTA66 当成两个系列,"覆盖 5 个系列"就变成假的。
 * 一律从 catalog_model 推系列,推不出来才退回 series 列。
 */
function seriesOf(asset) {
  const md = (asset && asset.metadata) || {};
  const m = md.catalog_model || asset.series || '';
  const hit = SERIES_PATTERNS.find((p) => p.re.test(m));
  if (hit) return hit.series;
  return String(m).replace(/[0-9].*$/, '').replace(/\s+V$/, '').trim() || 'Fanz';
}

const ROOM_PATTERNS = [
  { space: '大客厅', re: /living room|lounge|family room|大客厅|客厅/i },
  { space: '餐厅', re: /dining|餐厅/i },
  { space: '卧室', re: /bedroom|master bed|卧室|睡房/i },
  { space: '小空间(condo)', re: /condo|apartment|studio|small space|compact space|小空间/i },
  { space: '商用空间', re: /office|shop|caf[eé]|restaurant|commercial|showroom|商用/i },
  { space: '有盖阳台', re: /balcony|patio|porch|verandah|terrace|阳台/i },
];

// 颜色线索。库里的四种成品色 + 常见写法（Fanz 的 OAK 实际是深胡桃木色）。
// 复合写法(matte black)排在裸色词(black)之前，避免 "matte black" 被 black 抢。
const COLOR_PATTERNS = [
  { color: 'Matte Black', re: /matte?\s*black|哑黑|啞黑/i },
  { color: 'Matte White', re: /matte?\s*white|哑白|啞白/i },
  { color: 'Oakwood', re: /oak\s*wood|oakwood|\boak\b|walnut|橡木|胡桃/i },
  { color: 'Pinewood', re: /pine\s*wood|pinewood|\bpine\b|松木/i },
  { color: 'Matte Black', re: /\bblack\b|黑色/i },
  { color: 'Matte White', re: /\bwhite\b|白色/i },
];

/** 从文案里读出"必须是这个系列/尺寸/颜色/有无灯"的硬线索。 */
function readHints(text) {
  const t = String(text || '');
  const hints = { series: null, inches: null, color: null, led: null, spaces: [] };

  for (const p of SERIES_PATTERNS) {
    if (p.re.test(t)) { hints.series = p.series; break; }
  }

  // 尺寸线索有两种写法，都要认：
  //  ① 带单位:'56"' / "56 inch" / "56寸"
  //  ② 型号数字:"FS 563"(三位→前两位是尺寸)、"GAZE 66"/"GRANDE 52"(两位→就是尺寸)
  //     2026-07-30 干测教训:只认 ① 时，标题写 "FS 563 Pinewood" 会被选成 FS 525。
  const withUnit = t.match(/\b(3[0-9]|4[0-9]|5[0-9]|6[0-9]|7[0-2])\s*(?:"|inch|-inch|inches|寸)/i);
  if (withUnit) hints.inches = Number(withUnit[1]);
  if (!hints.inches) {
    const byCode = t.match(/\b(?:FS|GAZE|FERRO|GRANDE)\s*-?\s*(\d{2,3})\b/i);
    if (byCode) {
      const code = byCode[1];
      const n = code.length === 3 ? Number(code.slice(0, 2)) : Number(code);
      if (n >= 30 && n <= 72) hints.inches = n;
    }
  }

  for (const c of COLOR_PATTERNS) {
    if (c.re.test(t)) { hints.color = c.color; break; }
  }

  if (/\b(no light|without light|light-free|不带灯|无灯)\b/i.test(t)) hints.led = false;
  else if (/\b(LED|integrated light|with light|带灯|灯)\b/i.test(t)) hints.led = true;

  for (const r of ROOM_PATTERNS) if (r.re.test(t)) hints.spaces.push(r.space);
  return hints;
}

function hashOf(str) {
  let h = 0;
  for (const ch of String(str)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h;
}

// 素材名里出现的颜色词（池里实际用到的那几个）。
// "matt" 和 "matte" 都收 —— 人打字不会记得库里存的是哪个。
const COLOUR_WORDS = [
  'matte black', 'matt black', 'matte white', 'matt white',
  'oakwood', 'pinewood', 'greywood', 'graywood',
];

/** 型号比对用的归一化:"FS 563L" / "fs-563l" / "FS563L" 是同一台 */
function normModel(s) {
  return String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/**
 * 把**人说出口的型号**解析成素材库里的具体素材。
 *
 * 2026-08-05 实测事故:老板娘说「推 INNO525L」,Mark 卡片也显示 "Product: INNO525L",
 * 生成出来却是 DELTA56 —— 因为单篇建行时根本没把 draft.product 传下去,
 * generateCopy 于是自己另挑了一台。**嘴上答应、实际没做**,比报错更伤信任。
 *
 * 这里只做解析,不做替代:解析不出来就返回 null,由调用方明说"库里没有这台",
 * 绝不静悄悄换一台顶上。
 *
 * @param {string} said - 她/Mark 说的型号,可带颜色("INNO525L Pinewood")
 * @returns {Promise<{name, model, colourAsked, colourMatched, exactModel, alternatives}|null>}
 */
async function resolveAssetByModel(said) {
  const raw = String(said || '').trim();
  if (!raw) return null;

  let pool;
  try {
    const assets = await brand.listProductAssets();
    pool = assets.filter((a) => a && a.metadata && a.metadata.in_pool === true);
  } catch (err) {
    console.error('[pick-product] 型号解析读不到素材库:', err.message);
    return null;
  }
  if (!pool.length) return null;

  const modelOf = (a) => (a.metadata.catalog_model || a.metadata.model_code || '');
  const lower = raw.toLowerCase();
  const colourAsked = COLOUR_WORDS.find((c) => lower.includes(c)) || null;
  const want = normModel(colourAsked ? lower.replace(colourAsked, ' ') : lower);
  if (!want) return null;

  // ① 完整型号精确命中("INNO525L")
  let hits = pool.filter((a) => normModel(modelOf(a)) === want);
  // ② 只说了系列或前半截("DELTA" / "FS 563")→ 该前缀下的全部候选。
  //    3 个字符以下不做前缀匹配,免得 "FS" 之类把半个库都收进来还自称精确。
  const exactModel = hits.length > 0;
  if (!hits.length && want.length >= 3) {
    hits = pool.filter((a) => normModel(modelOf(a)).startsWith(want));
  }
  if (!hits.length) return null;

  const byColour = colourAsked
    ? hits.filter((a) => normModel(a.metadata.color) === normModel(colourAsked))
    : [];
  const finalists = byColour.length ? byColour : hits;
  // 同型号多个颜色时稳定挑一个(同样的输入永远同样的结果,便于复现)
  const sorted = [...finalists].sort((a, b) => a.name.localeCompare(b.name));
  const chosen = sorted[hashOf(raw) % sorted.length];

  return {
    name: chosen.name,
    model: modelOf(chosen) || null,
    colourAsked,
    colourMatched: byColour.length > 0,
    exactModel,
    alternatives: sorted.filter((a) => a.name !== chosen.name).map((a) => a.name),
  };
}

/**
 * 给一批计划行选产品。
 *
 * @param {Array<{id?: string, pillar?: string, topic?: string, post_angle?: string, fb_content?: string}>} rows
 *   按你希望的处理顺序传入（轮换是顺序相关的）。
 * @returns {Promise<Array<{rowId, name, reason, series, size_inches, has_led, color}|null>>}
 *   与 rows 一一对应；池子为空时整体返回 null 数组（调用方保持原有兜底行为）。
 */
async function pickProductsForPlan(rows) {
  let pool = [];
  try {
    const assets = await brand.listProductAssets();
    pool = assets.filter((a) => a && a.metadata && a.metadata.in_pool === true && a.public_url);
  } catch (err) {
    console.error('[pick-product] product pool read failed:', err.message);
  }
  if (pool.length === 0) return rows.map(() => null);

  // 角扇(SPINOR/AXEL16)不该出现在这里 —— backfill 已把它们移出池,
  // 这层再兜一次:出图提示词整条假设"天花板吊扇、扇叶水平旋转",画角扇会错。
  pool = pool.filter((a) => (a.metadata.product_type || 'ceiling') === 'ceiling');

  // 商用型号排除。我们现在整月 13 篇的调性都是家用(卧室/家庭/温馨),
  // 商用型号进去会被写成"让你卧室凉爽" —— 餐厅老板看不到,屋主买不起也装不下。
  // 只排 'commercial';**'unknown' 不排** —— 那是"还没跟 Fanz 确认",不是"是商用"。
  // 等确认了商用型号有哪些,再单独设计商用的内容角度和调性。
  try {
    const cat = require('./product-catalog');
    pool = pool.filter((a) => {
      const m = a.metadata.catalog_model;
      return !m || cat.productClass(m) !== 'commercial';
    });
  } catch (_) { /* 目录读不到就不额外过滤,不阻断选品 */ }

  if (pool.length === 0) return rows.map(() => null);

  const allSeries = new Set(pool.map(seriesOf));

  // ── 跨月轮换(2026-08-07)──
  // 在此之前轮换只在**本次这批 rows** 内生效:上个月推过 DELTA56 三次,
  // 这个月照样可以再推三次,函数外没有任何状态。
  // 用"降权"而不是"禁用":池子只有 25 个型号,硬禁 60 天会把选择面压得太窄,
  // 而且系列覆盖那条硬指标(整月至少 5 个系列)可能因此选不出来。
  let recentUsage = new Map();
  try {
    const hist = require('./content-history');
    recentUsage = hist.recentSkuUsage(await hist.recentPosts(hist.SKU_WINDOW_DAYS), hist.SKU_WINDOW_DAYS);
  } catch (err) {
    console.error('[pick-product] 跨月用量读取失败,只按本月轮换:', err.message);
  }

  const usedNames = new Set();
  const usedSeriesSize = new Set();
  const seriesCount = new Map();          // 系列 → 本月已用几篇
  const out = [];

  for (const row of rows) {
    const text = [row.topic, row.post_angle, row.fb_content].filter(Boolean).join(' \n ');
    const hints = readHints(text);

    // 逐级收窄；每一级如果筛空就退回上一级（宁可放宽也不要选不出来）
    const narrow = (list, fn) => { const n = list.filter(fn); return n.length ? n : list; };
    let cands = pool;
    // 用 seriesOf 而不是 a.series 列 —— 后者老素材存 "FS"、新素材存 "DELTA56",
    // 直接比会让文案点名 DELTA 时一个都匹配不到。
    if (hints.series) cands = narrow(cands, (a) => seriesOf(a) === hints.series);
    if (hints.inches) cands = narrow(cands, (a) => Number(a.metadata.size_inches) === hints.inches);
    if (hints.color) cands = narrow(cands, (a) => a.metadata.color === hints.color);
    if (hints.led !== null) cands = narrow(cands, (a) => a.metadata.has_led === hints.led);
    // 空间匹配。这一条对大尺寸旗舰是**硬约束**,不是"优先":
    // HEPTA72(72" / CFM 15000)排进"卧室安眠"这种场景是明显的外行错误,
    // 宁可这一篇选不到理想型号,也不能把 72 吋塞进小卧室。
    if (hints.spaces.length) {
      const spaceOk = (a) => (a.metadata.spaces || []).some((s) => hints.spaces.includes(s));
      const matched = cands.filter(spaceOk);
      if (matched.length) {
        cands = matched;
      } else {
        // 没有完全匹配的:至少把"尺寸明显不适合这个空间"的排掉
        const small = hints.spaces.some((s) => ['卧室', '小空间(condo)', '有盖阳台'].includes(s));
        const trimmed = cands.filter((a) => !small || Number(a.metadata.size_inches) <= 56);
        cands = trimmed.length ? trimmed : cands;
      }
    }

    // 整月系列配额:同一系列最多 MAX_POSTS_PER_SERIES 篇。
    // 满了就把该系列整个排掉 —— 排空了才放宽(宁可重复也不能选不出来)。
    const underQuota = cands.filter((a) => (seriesCount.get(seriesOf(a)) || 0) < MAX_POSTS_PER_SERIES);
    if (underQuota.length) cands = underQuota;

    // 轮换：先排除整月已用过的具体 SKU，再优先没出现过的"系列+尺寸"
    const fresh = cands.filter((a) => !usedNames.has(a.name));
    const usable = fresh.length ? fresh : cands;

    // 覆盖度:整月还没凑够 MIN_SERIES_PER_MONTH 个系列时,优先没用过的系列。
    // 剩余篇数不够补齐时才放弃(不是每个月都有 13 篇可用)。
    const unusedSeries = usable.filter((a) => !seriesCount.has(seriesOf(a)));
    const needMoreSeries = seriesCount.size < Math.min(MIN_SERIES_PER_MONTH, allSeries.size);
    const bySeriesFirst = (needMoreSeries && unusedSeries.length) ? unusedSeries : usable;

    const brandNew = bySeriesFirst.filter(
      (a) => !usedSeriesSize.has(`${seriesOf(a)}|${a.metadata.size_inches}`)
    );
    let finalSet = brandNew.length ? brandNew : bySeriesFirst;

    // 最近 60 天用得少的优先。同为最少时保留原有的稳定哈希取模 ——
    // 降权只重排优先级,不改"同样条件下永远选同一台"这个可复现性。
    const leastUsed = Math.min(...finalSet.map((a) => recentUsage.get(a.name) || 0));
    const cooler = finalSet.filter((a) => (recentUsage.get(a.name) || 0) === leastUsed);
    if (cooler.length) finalSet = cooler;

    // 同分里按 row 稳定取模（可复现），没有 id 时用 topic
    const pick = finalSet[hashOf(row.id || row.topic || '') % finalSet.length];
    const pickSeries = seriesOf(pick);
    usedNames.add(pick.name);
    usedSeriesSize.add(`${pickSeries}|${pick.metadata.size_inches}`);
    seriesCount.set(pickSeries, (seriesCount.get(pickSeries) || 0) + 1);

    const why = [];
    if (hints.series) why.push(`系列命中 ${hints.series}`);
    if (hints.inches) why.push(`尺寸命中 ${hints.inches}"`);
    if (hints.color) why.push(`颜色命中 ${hints.color}`);
    if (hints.led !== null) why.push(hints.led ? '文案提到灯' : '文案提到无灯');
    if (hints.spaces.length) why.push(`空间 ${hints.spaces.join('/')}`);
    if (why.length === 0) why.push('无明确线索，按轮换挑');

    out.push({
      rowId: row.id || null,
      name: pick.name,
      reason: why.join('；'),
      series: pickSeries,
      model: pick.metadata.catalog_model || pick.metadata.model_code || null,
      size_inches: pick.metadata.size_inches,
      spaces: pick.metadata.spaces || null,
      has_led: pick.metadata.has_led,
      color: pick.metadata.color,
    });
  }
  return out;
}


/**
 * 给文案 agent 准备产品上下文:现货系列清单 + 本篇已定的具体型号。
 *
 * 2026-07-30:文案层原本写死了一份产品清单(含 AURA/Inno/Smart),会写出库里没有
 * 的型号和尺寸,再被提炼成图上标题 —— 实测出现"标题写 36 吋 AURA、画面是 FS 563L"。
 * 这个函数让文案只认素材库现货,并在已定产品时明确"本篇就写这台"。
 *
 * @param {object} row - content_calendar row（读 source_product_image）
 * @returns {Promise<{rangeLines: string[], assigned: object|null}|undefined>}
 *   undefined → 调用方不传，buildCopywritingPrompt 用内置兜底清单
 */
async function copywritingProductContext(row) {
  try {
    const assets = await brand.listProductAssets();
    const pool = assets.filter((a) => a && a.metadata && a.metadata.in_pool === true);
    if (pool.length === 0) return undefined;

    const bySeries = new Map();
    for (const a of pool) {
      const md = a.metadata || {};
      const s = seriesOf(a);
      if (!bySeries.has(s)) bySeries.set(s, { sizes: new Set(), led: false, noLed: false });
      const e = bySeries.get(s);
      if (md.size_inches) e.sizes.add(Number(md.size_inches));
      if (md.has_led === true) e.led = true;
      if (md.has_led === false) e.noLed = true;
    }
    const rangeLines = [...bySeries.entries()].map(([s, e]) => {
      const sizes = [...e.sizes].sort((x, y) => x - y).map((n) => `${n}"`).join('/');
      const light = e.led && e.noLed ? 'with LED light (L) or without (N)'
        : e.led ? 'with integrated LED light' : 'without light';
      return `${s} Series — ${sizes}, ${light}`;
    });

    let assigned = null;
    const name = row && row.source_product_image;
    if (name) {
      const hit = pool.find((a) => a.name === name);
      if (hit) {
        const md = hit.metadata || {};
        assigned = {
          name: hit.name,
          // 从清单建的素材只有 catalog_model;不兜底的话文案层拿不到型号,
          // 连带 product-facts 的系列规格也带不出来。
          model_code: md.model_code || md.catalog_model || null,
          size_inches: md.size_inches || null,
          has_led: typeof md.has_led === 'boolean' ? md.has_led : null,
          color: md.color || null,
          blade_count: md.blade_count || null,
        };
      }
    }
    return { rangeLines, assigned };
  } catch (err) {
    console.error('[pick-product] copywriting context failed, falling back:', err.message);
    return undefined;
  }
}

module.exports = {
  pickProductsForPlan, readHints, copywritingProductContext, seriesOf,
  resolveAssetByModel,
  MIN_SERIES_PER_MONTH, MAX_POSTS_PER_SERIES,
};
