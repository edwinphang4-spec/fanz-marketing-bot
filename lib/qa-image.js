// ============================================
// qa-image.js — 成品自检（Edwin 2026-07-30 拍板的治本方案）
//
// 背景:此前流程是"模型盲画 → 直接交人 → 人挑毛病 → 改 prompt → 再画",
// 系统从不知道自己画出来的 logo 是不是太小、文字看不看得清,所以永远靠人当
// 眼睛、永远来回震荡。三轮"太大/太小"的争论,真正原因其实是一个算错的数字
// (logo 素材一半是透明留白,15% 的框里只有 7.5% 的墨)。
//
// 本模块只做**能量化**的部分,分两类:
//   A. 纯代码(100% 可靠、毫秒级、零成本):有墨占比、真实对比度、卖点重复、
//      图上数字与素材库记录是否矛盾。
//   B. 估算(有误差,只当保守闸门):最小字高。
// 叶数/有无灯/颜色/禁止元素属于视觉判断,放在 qa-vision.js,**只报警不拦截**
// ——建库时实测视觉模型会把灰色机身盖误判成灯(6 次)、低清图数错叶数,
// 拿它当闸门会误杀、白烧重生成的钱。
// ============================================

const sharp = require('sharp');

const BRAND_BLUE_RGB = [0x27, 0x47, 0x97];
const WHITE_RGB = [255, 255, 255];

// WCAG 对非文字图形元素的对比度门槛就是 3:1。
const GRAPHIC_CONTRAST_MIN = 3.0;

// ── 2026-08-03 Edwin 目检:13 张里 4 张判错,全是「该用蓝却用了白」──
//
// 旧规则是「蓝版够 3:1 就用蓝,否则谁对比高用谁」。测量没错(复算过:09-01 右上
// 实测 RGB [153,129,105],蓝 2.34:1 / 白 3.68:1),**错的是规则**:它把"看得清"
// 当唯一标准,忽略了品牌表达。而米色天花板这种中间调正好卡在蓝版 3:1 临界线下,
// 于是一路掉进白版 —— 但白版落在浅色/中间调上是**更糟**的,不是更好:
// 数学上白版对比度更高,视觉上却是发虚、发脏,而蓝版即使 2.3:1 也是"印上去的"。
//
// 新规则:**品牌蓝是默认,白版是例外**。
//   · 只有**真正的暗背景**(夜景那种)才用白版;
//   · 浅色和中间调一律用蓝,对比不够时优先挪位、其次加极淡底衬,**绝不换白版**。
const DARK_BG_LUMINANCE = 0.10;   // 相对亮度 ≤ 此值才算"真正的暗背景"(夜景实测 0.02)

// 2026-08-03 第二轮:Edwin 看了重贴效果 —— 蓝版方向对,但**底衬太明显**,
// logo 后面能看出一圈浅色光晕、有圆形轮廓,像自带发光,显廉价。
// 定调:「宁可对比度只有 2.8:1 看起来干净,也不要 3.3:1 但能看出光圈」。
// 所以顺序改成 **挪位优先、底衬是最后手段**:
//   · 蓝版 < 3:1 先在四个角里找最好的,能到 SCRIM_LAST_RESORT 以上就挪过去(零成本、无底衬)
//   · 四个角全都低于 SCRIM_LAST_RESORT,才原地加一层"几乎看不见"的底衬
const BLUE_CONTRAST_ACCEPTABLE = 2.5;  // 挪过去只要到这个数就够,不必硬凑 3:1
const SCRIM_LAST_RESORT = 2.5;         // 四个角都低于它 → 才动用底衬
// 挪位要有**实质**收益才挪。2026-08-01 就吃过一次亏:按"杂乱度最低"排序,
// 3.9 vs 4.9 这种噪声级差距也会让 logo 换角落 —— logo 在帖子之间乱跳比
// 固定位置更伤品牌。实测 09-29 左右两角 2.56 vs 2.63,差 0.07,属于同一个数。
const MOVE_MIN_GAIN = 0.3;

// logo 有墨宽度占画面宽的目标区间(Edwin 认可 10-14%,先取中位 12%)
const LOGO_INK_RATIO_TARGET = 0.12;
const LOGO_INK_RATIO_MIN = 0.10;
const LOGO_INK_RATIO_MAX = 0.14;

// 正文最小字高 = 画布高的 3.5%(1024 图上约 36px;手机上约 14px 可读)
const MIN_TEXT_HEIGHT_RATIO = 0.035;
// 触发重生成的红线定得比目标低一截 —— 字高是估算值,留出误差余量,
// 只有"明显太小"才值得花钱重画。
const TEXT_HEIGHT_REGEN_FLOOR = 0.025;

/** sRGB 通道 → 线性值(WCAG 相对亮度用) */
function channelLinear(c) {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

/** WCAG 相对亮度 0(黑)–1(白) */
function relLuminance([r, g, b]) {
  return 0.2126 * channelLinear(r) + 0.7152 * channelLinear(g) + 0.0722 * channelLinear(b);
}

/** WCAG 对比度 1:1 – 21:1 */
function contrastRatio(rgbA, rgbB) {
  const a = relLuminance(rgbA);
  const b = relLuminance(rgbB);
  const [hi, lo] = a >= b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * 算出 logo 实际会落在画布的哪一块。
 * 必须和 compose.buildLogoLayer 的几何保持一致(裁掉留白后按有墨宽度缩放,
 * margin = 4.5% 画布宽),否则采样的是别处的背景 —— 这正是我第一次判错的原因。
 */
function logoFootprint(W, H, opts = {}) {
  const ratio = opts.logoWidthRatio || LOGO_INK_RATIO_TARGET;
  const inkW = Math.round(W * ratio);
  const inkH = Math.round(inkW * (opts.inkAspect || 1.13)); // lockup 有墨区约 997x1126
  const margin = Math.round(W * 0.045);
  const pos = opts.logoPosition || 'top_right';
  let left = W - inkW - margin, top = margin;
  if (pos === 'top_left') { left = margin; top = margin; }
  else if (pos === 'top_center') { left = Math.round((W - inkW) / 2); top = margin; }
  else if (pos === 'bottom_center') { left = Math.round((W - inkW) / 2); top = H - inkH - margin; }
  else if (pos === 'bottom_right') { left = W - inkW - margin; top = H - inkH - margin; }
  return {
    left: Math.max(0, Math.min(left, W - inkW)),
    top: Math.max(0, Math.min(top, H - inkH)),
    width: Math.min(inkW, W),
    height: Math.min(inkH, H),
  };
}


/**
 * 取某个矩形区域的统计值。
 *
 * ⚠️ 必须先 toBuffer 再 stats:sharp 的 `.stats()` **不应用 `.extract()`**,
 * 它算的是输入图整体。2026-08-01 实测踩到 —— 我以为在量 logo 落点的背景,
 * 实际一直在量整张图的平均值,所以蓝白版阈值怎么调都调不准(连错三次的真因)。
 * 验证:整图 159.7 / 左上 159.7 / 右上 159.7 —— 三者相同即为无效。
 */
async function regionStats(imageBuffer, box, greyscale = false) {
  const cropped = await sharp(imageBuffer).extract(box).toBuffer();
  return greyscale ? sharp(cropped).greyscale().stats() : sharp(cropped).stats();
}

/**
 * 按真实对比度选 logo 蓝版/白版。
 *
 * 规则:品牌蓝只要够得着 3:1(WCAG 图形元素门槛)就用品牌蓝;够不着才比谁高。
 * 这样既尊重"能用主色就用主色"的品牌惯例,又不会把 logo 放在读不出的底上。
 *
 * @returns {Promise<{variant:'blue'|'white', bgRgb:number[], contrastBlue:number,
 *   contrastWhite:number, reason:string}>}
 */
async function pickLogoVariantByContrast(imageBuffer, opts = {}) {
  try {
    const meta = await sharp(imageBuffer).metadata();
    const box = logoFootprint(meta.width, meta.height, opts);
    const stats = await regionStats(imageBuffer, box);
    const bg = [stats.channels[0].mean, stats.channels[1].mean, stats.channels[2].mean].map(Math.round);
    const cBlue = contrastRatio(BRAND_BLUE_RGB, bg);
    const cWhite = contrastRatio(WHITE_RGB, bg);
    const variant = cBlue >= GRAPHIC_CONTRAST_MIN ? 'blue' : (cBlue >= cWhite ? 'blue' : 'white');
    const reason = cBlue >= GRAPHIC_CONTRAST_MIN
      ? `brand blue clears ${GRAPHIC_CONTRAST_MIN}:1 (${cBlue.toFixed(2)}:1)`
      : `brand blue only ${cBlue.toFixed(2)}:1 — white gives ${cWhite.toFixed(2)}:1`;
    return { variant, bgRgb: bg, contrastBlue: +cBlue.toFixed(2), contrastWhite: +cWhite.toFixed(2), reason };
  } catch (err) {
    return { variant: 'blue', bgRgb: null, contrastBlue: null, contrastWhite: null, reason: `measure failed: ${err.message}` };
  }
}

/**
 * 量成品里 logo 有墨部分实际占了多宽。
 * logo 是我们自己贴的,所以这其实是"设定值核对"而不是猜 —— 对不上说明
 * 几何算错了(比如留白没裁),属于必修 bug 而不是审美问题。
 */
async function measureLogoInkRatio(logoAssetBuffer, placedInkWidth, canvasWidth) {
  try {
    const trimmed = await sharp(logoAssetBuffer).trim({ threshold: 8 }).toBuffer();
    const m = await sharp(trimmed).metadata();
    return {
      inkRatio: +(placedInkWidth / canvasWidth).toFixed(4),
      assetInkAspect: +(m.height / m.width).toFixed(3),
      inRange: placedInkWidth / canvasWidth >= LOGO_INK_RATIO_MIN
        && placedInkWidth / canvasWidth <= LOGO_INK_RATIO_MAX,
    };
  } catch (err) {
    return { inkRatio: null, assetInkAspect: null, inRange: null, error: err.message };
  }
}

/** 归一化:小写、去标点、去常见虚词,便于比对两句话是不是在说同一件事 */
function normalizeClaim(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s"]/g, ' ')
    .split(/\s+/)
    .filter((w) => w && !['the', 'a', 'an', 'your', 'our', 'with', 'for', 'and'].includes(w))
    .join(' ');
}

/**
 * 标题/副标题/CTA 有没有在重复同一条信息。
 * 图上文字是我们自己提炼的,所以这是纯字符串比对,100% 可靠。
 * (上一轮"10-Year Motor Warranty 文字 + 金盾徽章又写一遍"就是这类问题)
 */
function checkDuplicateClaims(texts = {}) {
  const fields = ['title', 'selling_point', 'cta', 'promo_badge'];
  const present = fields
    .filter((f) => texts[f] && String(texts[f]).trim())
    .map((f) => ({ field: f, norm: normalizeClaim(texts[f]), raw: texts[f] }));
  const dups = [];
  for (let i = 0; i < present.length; i++) {
    for (let j = i + 1; j < present.length; j++) {
      const a = new Set(present[i].norm.split(' ').filter(Boolean));
      const b = new Set(present[j].norm.split(' ').filter(Boolean));
      if (a.size === 0 || b.size === 0) continue;
      let shared = 0;
      for (const w of a) if (b.has(w)) shared++;
      const overlap = shared / Math.min(a.size, b.size);
      if (overlap >= 0.6) {
        dups.push({
          fields: [present[i].field, present[j].field],
          overlap: +overlap.toFixed(2),
          text: [present[i].raw, present[j].raw],
        });
      }
    }
  }
  return { ok: dups.length === 0, duplicates: dups };
}

/**
 * 图上文字里的型号/尺寸数字,和这一行实际用的产品对不对得上。
 *
 * 这条是硬性的:上一轮实测出现过"图上写 36 吋 AURA、画面里是 FS 563L(56吋)",
 * 这种图文矛盾发出去就是事故,必须拦住 —— 而它 100% 可以用代码查。
 */
function checkTextProductConsistency(texts = {}, productMeta = null) {
  if (!productMeta) return { ok: true, issues: [], skipped: 'no product metadata' };
  const blob = ['title', 'selling_point', 'cta', 'promo_badge']
    .map((f) => texts[f] || '').join(' ');
  const issues = [];

  // 尺寸:图上出现的英寸数,必须等于这台的尺寸
  const sizeMatches = [...blob.matchAll(/\b(\d{2})\s*(?:"|”|inch|-inch|inches)/gi)].map((m) => Number(m[1]));
  for (const n of sizeMatches) {
    if (productMeta.size_inches && n !== Number(productMeta.size_inches)) {
      issues.push(`on-image text says ${n}" but the product is ${productMeta.size_inches}"`);
    }
  }
  // 系列:图上提到的系列名必须就是这台的系列
  const seriesSeen = ['FS', 'GAZE', 'FERRO', 'GRANDE', 'AURA', 'INNO', 'VETTA', 'SMART']
    .filter((s) => new RegExp(`\\b${s}\\b`, 'i').test(blob));
  for (const s of seriesSeen) {
    if (productMeta.model_code && !new RegExp(`^${s}`, 'i').test(productMeta.model_code)) {
      issues.push(`on-image text names "${s}" but the product is ${productMeta.model_code}`);
    }
  }
  // 叶数:只有库里有真值时才查(FS 48/62 叶数未知,不查)
  const bladeMatch = blob.match(/\b(\d)\s*[- ]?blades?\b/i);
  if (bladeMatch && productMeta.blade_count && Number(bladeMatch[1]) !== Number(productMeta.blade_count)) {
    issues.push(`on-image text says ${bladeMatch[1]} blades but the product has ${productMeta.blade_count}`);
  }
  return { ok: issues.length === 0, issues };
}

/**
 * 用 OCR 读出画面里真实渲染的文字行 + 每行高度。
 *
 * 为什么不用自己写的边缘检测:2026-07-30 实测验证不通过 —— Edwin 说"字太大"
 * 那版和"字太小"那版都被量成 0.4%,完全区分不开,家具边缘还被当成文字(量出
 * 一条 19.4% 的"文字带")。所以换真 OCR(tesseract.js),拿真实文字框。
 *
 * ⚠️ 已知精度边界(实测,不粉饰):
 *   · 行框高度**不是字号的可靠代理** —— 同一句话换行成两行,每行框高反而变小。
 *     实测 Edwin 说"太小"的那版 headline 量出 4.0%,说"太大"的那版是 3.4%/3.6%。
 *     所以**不拿它判断"好不好看/够不够大"这种审美问题**。
 *   · 召回不全:蓝底白字的 CTA 按钮经常读不到。
 * 因此它的正当用途只有两个,都很硬:
 *   ① 守低线:确实小到 < TEXT_HEIGHT_REGEN_FLOOR 的才重画(明显事故,不是审美)
 *   ② 核对渲染:我们知道该出现哪些字,OCR 读出实际渲染的字,比对有没有拼错/漏渲染
 *
 * @returns {Promise<{lines:Array, minRatio:number|null, renderedText:string, error?:string}>}
 */
async function ocrTextLines(imageSource, opts = {}) {
  let worker = null;
  try {
    const { createWorker } = require('tesseract.js');
    const buf = Buffer.isBuffer(imageSource) ? imageSource : require('fs').readFileSync(imageSource);
    const meta = await sharp(buf).metadata();
    const H = meta.height, W = meta.width;
    const lf = logoFootprint(W, H, opts);

    worker = await createWorker('eng');
    const { data } = await worker.recognize(buf, {}, { blocks: true });

    const lines = [];
    for (const b of data.blocks || []) {
      for (const p of b.paragraphs || []) {
        for (const l of p.lines || []) {
          const text = (l.text || '').trim();
          if (text.length < 3 || l.confidence < 60) continue;
          // logo 的文字是我们自己贴上去的、内容固定,按内容排除最可靠 ——
          // 实测 OCR 会把角落 logo 和同一水平带的杂讯并成一个很宽的框
          // ("- fanz",x 从 512 到 976),纯几何重叠只有 26%,排不掉。
          const bare = text.toLowerCase().replace(/[^a-z ]/g, '').trim();
          if (/^(fanz|the air mover|fanz the air mover)$/.test(bare)) continue;
          // 排除 logo 所在那一角 —— 否则会把 lockup 里的 "fanz" 当成正文量进去。
          // 用**重叠面积**判断而不是中心点:实测 OCR 会把 logo 连同旁边的杂讯读成
          // "- fanz",框被撑宽后中心点跑到 logo 外面,中心点法就漏了。
          const ox = Math.max(0, Math.min(l.bbox.x1, lf.left + lf.width) - Math.max(l.bbox.x0, lf.left));
          const oy = Math.max(0, Math.min(l.bbox.y1, lf.top + lf.height) - Math.max(l.bbox.y0, lf.top));
          const lineArea = Math.max(1, (l.bbox.x1 - l.bbox.x0) * (l.bbox.y1 - l.bbox.y0));
          if ((ox * oy) / lineArea >= 0.4) continue;
          lines.push({
            text,
            heightRatio: +((l.bbox.y1 - l.bbox.y0) / H).toFixed(4),
            confidence: Math.round(l.confidence),
          });
        }
      }
    }
    const minRatio = lines.length ? Math.min(...lines.map((l) => l.heightRatio)) : null;
    return {
      lines,
      minRatio,
      renderedText: (data.text || '').replace(/\s+/g, ' ').trim(),
      belowRegenFloor: minRatio != null && minRatio < TEXT_HEIGHT_REGEN_FLOOR,
      meetsTarget: minRatio != null && minRatio >= MIN_TEXT_HEIGHT_RATIO,
    };
  } catch (err) {
    return { lines: [], minRatio: null, renderedText: '', error: err.message };
  } finally {
    if (worker) { try { await worker.terminate(); } catch (_) {} }
  }
}

/**
 * 核对"该出现的字"有没有真的渲染出来(OCR 读到的 vs 我们提炼的文案)。
 * 用宽松匹配:OCR 会漏字符,所以按词命中率算,低于 0.5 判为没渲染出来。
 */
function checkRenderedText(renderedText, texts = {}) {
  const rendered = String(renderedText || '').toLowerCase();
  const missing = [];
  for (const field of ['title', 'selling_point']) {
    const want = String(texts[field] || '').trim();
    if (!want) continue;
    const words = want.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((w) => w.length >= 3);
    if (words.length === 0) continue;
    const hit = words.filter((w) => rendered.includes(w)).length;
    if (hit / words.length < 0.5) missing.push({ field, expected: want, hitRate: +(hit / words.length).toFixed(2) });
  }
  return { ok: missing.length === 0, missing };
}

module.exports = {
  relLuminance,
  contrastRatio,
  logoFootprint,
  pickLogoVariantByContrast,
  pickLogoPlacement,
  decideLogoPlacement,
  regionStats,
  measureLogoInkRatio,
  checkDuplicateClaims,
  checkTextProductConsistency,
  ocrTextLines,
  checkRenderedText,
  BRAND_BLUE_RGB,
  WHITE_RGB,
  GRAPHIC_CONTRAST_MIN,
  DARK_BG_LUMINANCE,
  BLUE_CONTRAST_ACCEPTABLE,
  SCRIM_LAST_RESORT,
  MOVE_MIN_GAIN,
  LOGO_INK_RATIO_TARGET,
  LOGO_INK_RATIO_MIN,
  LOGO_INK_RATIO_MAX,
  MIN_TEXT_HEIGHT_RATIO,
  TEXT_HEIGHT_REGEN_FLOOR,
};

/**
 * 从候选位置里挑一个最适合放 logo 的角落。
 *
 * 2026-08-01:此前 logo 位置写死右上角。去 Fanz 官方账号实地看内容才发现,
 * 他们**位置是变的** —— AURA 和角扇封面在左上、"Fresh Air" 在右下、
 * 颜色对比图在下方居中。位置跟着构图走,不是固定的。
 *
 * 2026-08-03 Edwin 目检 13 张后重写选色规则(旧规则判错 4 张,全是「该蓝用了白」):
 * **品牌蓝是默认,白版是例外**。优先级——
 *   ① 默认位真的是暗背景(相对亮度 ≤ 0.10)→ 白版。白版只有这一个用武之地。
 *   ② 默认位蓝版 ≥ 3:1 且不杂乱 → 蓝版,原地不动(最理想)
 *   ③ 默认位蓝版 < 2:1(淡底衬也救不回来)→ 挪到蓝版真够用的角落
 *   ④ 默认位蓝版 2:1–3:1 → 留在原位 + 极淡底衬。位置稳定比多挣对比度重要。
 *   ⑤ 兜底:蓝版最好的角落 + 底衬
 * 浅色/中间调**在任何分支都不会退到白版** —— 白版在浅底上是发虚,不是更清楚。
 *
 * @returns {Promise<{position:string, variant:'blue'|'white', contrast:number,
 *   cBlue:number, cWhite:number, luminance:number, busyness:number,
 *   movedFromDefault:boolean, scrim:boolean, reason:string, all:Array}>}
 */
async function pickLogoPlacement(imageBuffer, opts = {}) {
  const candidates = opts.candidates || ['top_right', 'top_left', 'bottom_right', 'bottom_center'];
  const ratio = opts.logoWidthRatio || LOGO_INK_RATIO_TARGET;
  const meta = await sharp(imageBuffer).metadata();
  const scored = [];

  for (const pos of candidates) {
    try {
      const box = logoFootprint(meta.width, meta.height, { logoPosition: pos, logoWidthRatio: ratio });
      const stats = await regionStats(imageBuffer, box);
      const bg = [stats.channels[0].mean, stats.channels[1].mean, stats.channels[2].mean].map(Math.round);
      const cBlue = contrastRatio(BRAND_BLUE_RGB, bg);
      const cWhite = contrastRatio(WHITE_RGB, bg);

      // 干净度:灰度标准差 —— 纯净的墙面接近 0,压在家具/图案上会很高
      const grey = await regionStats(imageBuffer, box, true);
      const busyness = grey.channels[0].stdev;

      scored.push({
        position: pos,
        bgRgb: bg,
        luminance: +relLuminance(bg).toFixed(4),
        cBlue: +cBlue.toFixed(2),
        cWhite: +cWhite.toFixed(2),
        busyness: +busyness.toFixed(1),
      });
    } catch (_) { /* 该位置取不到就跳过 */ }
  }
  return decideLogoPlacement(scored, opts.preferredPosition || 'top_right');
}

/**
 * 纯决策:给定四个角落的实测数据,选位置 + 变体 + 要不要底衬。
 *
 * 之所以和测量拆开:验收时要能拿**落库的历史实测值**重跑判定(零成本,不碰
 * 图片 API)。如果验证脚本自己复刻一遍分支逻辑,那验的就不是线上跑的那份代码了
 * —— 两边迟早漂开。拆出来之后,复算和线上走的是同一个函数。
 *
 * @param {Array<{position,bgRgb,luminance,cBlue,cWhite,busyness}>} scored
 * @param {string} preferred - 模板的默认位置
 */
function decideLogoPlacement(scored, preferred = 'top_right') {
  if (!scored || scored.length === 0) {
    return { position: 'top_right', variant: 'blue', contrast: null, busyness: null, scrim: false, all: [] };
  }

  const BUSY_OK = 25;                    // 低于这个值都算"干净",不再细分
  const def = scored.find((s) => s.position === preferred);
  const out = (c, variant, { moved = false, scrim = false, reason }) => ({
    position: c.position,
    variant,
    contrast: variant === 'blue' ? c.cBlue : c.cWhite,
    cBlue: c.cBlue,
    cWhite: c.cWhite,
    luminance: c.luminance,
    busyness: c.busyness,
    bgRgb: c.bgRgb,
    movedFromDefault: moved,
    scrim,
    reason,
    all: scored,
  });

  // ① 真正的暗背景 → 白版。这是白版**唯一**的用武之地(夜景/深色海报)。
  //    判据是默认位的实测亮度,不是"谁对比高" —— 后者正是判错 4 张的原因。
  if (def && def.luminance <= DARK_BG_LUMINANCE) {
    const darkPool = scored.filter((s) => s.luminance <= DARK_BG_LUMINANCE);
    if (def.cWhite >= GRAPHIC_CONTRAST_MIN && def.busyness <= BUSY_OK) {
      return out(def, 'white', { reason: `dark background (luminance ${def.luminance}) — white logo` });
    }
    const best = [...(darkPool.length ? darkPool : scored)]
      .sort((a, b) => (a.busyness <= BUSY_OK ? 0 : 1) - (b.busyness <= BUSY_OK ? 0 : 1) || b.cWhite - a.cWhite)[0];
    return out(best, 'white', {
      moved: best.position !== preferred,
      reason: `dark background; default ${preferred} too busy (${def.busyness}) — white logo moved`,
    });
  }

  // ── 以下都是浅色/中间调:**一律品牌蓝,绝不退白版** ──

  // ② 默认位蓝版就够用 → 最理想,原地不动、不加底衬
  if (def && def.cBlue >= GRAPHIC_CONTRAST_MIN && def.busyness <= BUSY_OK) {
    return out(def, 'blue', { reason: `default position kept (blue ${def.cBlue}:1)` });
  }

  // ③ 默认位不够 → **先挪位**,不先加底衬。
  //    挪位是零成本的:换个角落就能拿到真实对比度,不用往画面上糊任何东西。
  //    只要挪过去能到 2.5:1 就走 —— 不必硬凑 3:1 再去加底衬把画面弄脏。
  const cleanCorners = scored.filter((s) => s.busyness <= BUSY_OK);
  const bestElsewhere = [...(cleanCorners.length ? cleanCorners : scored)]
    .sort((a, b) => b.cBlue - a.cBlue)[0];
  if (bestElsewhere && bestElsewhere.cBlue >= BLUE_CONTRAST_ACCEPTABLE
      && (!def || bestElsewhere.cBlue - def.cBlue >= MOVE_MIN_GAIN)) {
    return out(bestElsewhere, 'blue', {
      moved: bestElsewhere.position !== preferred,
      reason: def
        ? `default ${preferred} weak for blue (${def.cBlue}:1) — moved to ${bestElsewhere.position} (${bestElsewhere.cBlue}:1), no scrim needed`
        : `default ${preferred} unmeasurable — moved to ${bestElsewhere.position} (${bestElsewhere.cBlue}:1)`,
    });
  }

  // ④ 默认位本来就是最好的那个,而且还够 2.5:1 → 原地不动,也不用底衬
  if (def && def.cBlue >= BLUE_CONTRAST_ACCEPTABLE) {
    return out(def, 'blue', {
      reason: `blue ${def.cBlue}:1 — best of all four corners, kept in place without a scrim`,
    });
  }

  // ⑤ 最后手段:四个角落蓝版全都低于 2.5:1 → 取最好的那个,加一层几乎看不见的底衬
  const bestBlue = bestElsewhere || scored[0];
  const target = (def && def.cBlue >= bestBlue.cBlue) ? def : bestBlue;
  return out(target, 'blue', {
    moved: target.position !== preferred,
    scrim: true,
    reason: `every corner is below blue ${SCRIM_LAST_RESORT}:1 (best ${target.cBlue}:1) — last resort, barely-there scrim`,
  });
}
