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

// WCAG 对非文字图形元素的对比度门槛就是 3:1。品牌色够得着这条线就用品牌色,
// 够不着才退白版 —— 而不是像之前那样拿一个拍脑袋的灰度阈值来猜。
const GRAPHIC_CONTRAST_MIN = 3.0;

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
  return {
    left: Math.max(0, Math.min(left, W - inkW)),
    top: Math.max(0, Math.min(top, H - inkH)),
    width: Math.min(inkW, W),
    height: Math.min(inkH, H),
  };
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
    const stats = await sharp(imageBuffer).extract(box).stats();
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
  measureLogoInkRatio,
  checkDuplicateClaims,
  checkTextProductConsistency,
  ocrTextLines,
  checkRenderedText,
  BRAND_BLUE_RGB,
  GRAPHIC_CONTRAST_MIN,
  LOGO_INK_RATIO_TARGET,
  LOGO_INK_RATIO_MIN,
  LOGO_INK_RATIO_MAX,
  MIN_TEXT_HEIGHT_RATIO,
  TEXT_HEIGHT_REGEN_FLOOR,
};
