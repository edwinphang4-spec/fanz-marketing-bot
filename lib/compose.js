// ============================================
// compose.js — 确定性合成（新配图管线第 2 步）
//
// 背景（云端 URL 或 Buffer）+ 产品图（asset library）+ logo + 文字模板
// 全部用 sharp 确定性叠加：同 spec 同输出，改字/换产品/换位置零 AI 成本。
//
// 产品图处理：
//   - SVG → 透明底栅格化，直接压在背景上（干净）
//   - 位图无 alpha（实拍图）→ 包白色圆角卡再叠加（避免生硬的方形白底）
// ============================================

const sharp = require('sharp');
const fs = require('fs');
const path = require('path');
const { applyTextOverlays, wrapText, charsPerLine, buildTextSvg } = require('./text-overlay');
const brandKit = require('./brand-kit');

// 徽章(认证/保修等担责任声明)的确定性版式——2026-07-24 实测 3/3 次真实
// gpt-image-1 生成，这类小号文字每次都拼错，改成跟 logo 一样代码精确渲染。
// 位置沿用两次真实生成里模型自己选的位置(右下角)，视觉上已验证协调。
const BADGE_PRESET = {
  align: 'right', anchorX: 0.95, anchorY: 0.90,
  fontSize: 30, fontWeight: 'bold',
  fill: '#FFFFFF', stroke: '#000000', strokeWidth: 0,
  maxChars: 30, maxLines: 2, paddingX: 0.03, lineHeight: 1.25,
  fontFamily: 'sans-serif', backgroundOpacity: 0.55,
};

/**
 * Resolve an asset source (local path OR http(s) URL) to { buffer, ext }.
 * Product images now live in Supabase Storage (brand_assets) as well as the
 * committed fallback library, so compose must handle both.
 */
async function loadAsset(source) {
  const ext = path.extname((source || '').split('?')[0]).toLowerCase();
  if (/^https?:\/\//i.test(source)) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);
    try {
      const resp = await fetch(source, { signal: controller.signal });
      if (!resp.ok) throw new Error(`asset fetch failed: HTTP ${resp.status}`);
      return { buffer: Buffer.from(await resp.arrayBuffer()), ext };
    } finally {
      clearTimeout(timer);
    }
  }
  if (!source || !fs.existsSync(source)) {
    throw new Error(`Product image not found: ${source}`);
  }
  return { buffer: fs.readFileSync(source), ext };
}

/** Is this buffer an SVG (used when the URL/path carries no .svg extension)? */
function looksSvg(buffer) {
  const head = buffer.slice(0, 256).toString('utf8').trimStart();
  return head.startsWith('<svg') || (head.startsWith('<?xml') && head.includes('<svg'));
}

/** First available local product as an emergency fallback (Storage 404 mid-compose). */
function firstLocalProduct() {
  try {
    const dir = require('./select-product').PRODUCTS_DIR;
    const f = fs.readdirSync(dir).find((n) => /\.(png|jpe?g|webp|svg)$/i.test(n));
    return f ? path.join(dir, f) : null;
  } catch (_) { return null; }
}

/**
 * Rasterize/resize the product image to fit a slot box, preserving alpha.
 * Accepts a local path or a Storage URL. Returns { buffer, width, height }.
 * A resolved Storage URL that 404s mid-compose falls back to a local product
 * rather than aborting the whole image (and burning a strike).
 */
async function prepareProductLayer(productSource, boxW, boxH) {
  if (!productSource) return null; // full_ai 模式/无产品帖：干净跳过产品层
  let loaded;
  try {
    loaded = await loadAsset(productSource);
  } catch (fetchErr) {
    const fallback = firstLocalProduct();
    if (!fallback) throw fetchErr;
    console.error(`[compose] product source failed (${fetchErr.message}) — using local fallback ${path.basename(fallback)}`);
    loaded = await loadAsset(fallback);
  }
  const { buffer: srcBuffer } = loaded;
  const ext = loaded.ext || (looksSvg(srcBuffer) ? '.svg' : '');
  const transparent = { r: 0, g: 0, b: 0, alpha: 0 };

  // 先栅格化到原始尺寸（SVG 走 density 300），暂不缩放。
  const rasterizedFull = ext === '.svg'
    ? await sharp(srcBuffer, { density: 300 }).ensureAlpha().png().toBuffer()
    : await sharp(srcBuffer).ensureAlpha().png().toBuffer();

  // 裁掉素材自带的透明留白再缩放进框——很多导出图把风扇塞进一个正方形画布，
  // 四周留一大圈空气（2026-07-24 真实效果图评审实证：不裁的话 fit:inside
  // 会把这圈空气也当作"内容"一起缩小，风扇看起来像悬空的小贴纸）。
  // trim 失败（罕见：整图全透明等边界情况）就退回原图，不让合成炸。
  let trimmedSource = rasterizedFull;
  try {
    trimmedSource = await sharp(rasterizedFull).trim({ threshold: 8 }).toBuffer();
  } catch (_) {}

  const rasterized = await sharp(trimmedSource)
    .resize(boxW, boxH, { fit: 'inside', background: transparent })
    .png()
    .toBuffer();

  const stats = await sharp(rasterized).stats();
  const alphaChannel = stats.channels[3];
  const hasRealTransparency = alphaChannel && alphaChannel.min < 250;

  if (hasRealTransparency) {
    const meta = await sharp(rasterized).metadata();
    return { buffer: rasterized, width: meta.width, height: meta.height };
  }

  // 全不透明（实拍图 / 白底素材）：跳过产品层，合成继续（背景+logo+文字）
  // 旧行为是包白色圆角卡，但卡片会覆盖精心生成的背景，视觉体验差。
  // 返回 null 通知 composeFinal 跳过该层。
  return null;
}

/**
 * Fetch a background into a Buffer. Accepts an http(s) URL (Supabase Storage)
 * or a local file path.
 */
async function loadBackground(source) {
  if (Buffer.isBuffer(source)) return source;
  if (/^https?:\/\//i.test(source)) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);
    try {
      const resp = await fetch(source, { signal: controller.signal });
      if (!resp.ok) throw new Error(`background fetch failed: HTTP ${resp.status}`);
      return Buffer.from(await resp.arrayBuffer());
    } finally {
      clearTimeout(timer);
    }
  }
  if (!fs.existsSync(source)) throw new Error(`Background not found: ${source}`);
  return fs.readFileSync(source);
}

/**
 * Resolve the logo bytes + placement for a WxH canvas. Returns an array of
 * sharp composite layer descriptors ({ input, left, top }) — empty if no logo
 * is available. Shared by composeFinal (composite/full_ai) and
 * applyLogoOverlay (ai_reference — 2026-07-24: 实测 gpt-image-1 会把 logo
 * 参考图张冠李戴/画错，所以 ai_reference 模式不再把 logo 当参考图喂给模型，
 * 改成让模型留白，这里用确定性代码把真 logo 精确贴上去，100% 保真).
 *
 * @param {number} W - canvas width
 * @param {number} H - canvas height
 * @param {object} opts - { logoUrl, logoWidthRatio, logoPosition, withBackdrop }
 * @param {boolean} [opts.withBackdrop] - add an opaque backing plate behind the
 *   logo first. Needed for ai_reference: 2026-07-24 实测 2/2 次真实生成，即使
 *   prompt 明确要求"留白"，模型仍会把标题文字画进 logo 该待的角落——纯靠文字
 *   指令管不住模型的排版，只能用不透明底板保证 logo 区域永远干净可读。
 *   composite/full_ai 模式背景是可控的纯色/渐变生成图，不会撞车，不需要。
 */
async function buildLogoLayer(W, H, opts) {
  let logoBytes = null;
  if (opts.logoUrl) {
    const { buffer } = await loadAsset(opts.logoUrl);
    logoBytes = buffer;
  } else if (fs.existsSync(brandKit.LOGO.file)) {
    logoBytes = fs.readFileSync(brandKit.LOGO.file);
  }
  if (!logoBytes) return [];

  const logoW = Math.round(W * (opts.logoWidthRatio || brandKit.LOGO.widthRatio));
  const logoBuffer = await sharp(logoBytes).resize(logoW, null, { fit: 'inside' }).png().toBuffer();
  const lm = await sharp(logoBuffer).metadata();
  // 四种命名位置（design-templates 的 logoPosition）；未指定沿用 brand-kit 锚点
  const margin = Math.round(W * 0.045);
  let left = Math.round(W * brandKit.LOGO.anchorX);
  let top = Math.round(H * brandKit.LOGO.anchorY);
  if (opts.logoPosition === 'top_right') { left = W - lm.width - margin; top = margin; }
  else if (opts.logoPosition === 'top_center') { left = Math.round((W - lm.width) / 2); top = margin; }
  else if (opts.logoPosition === 'bottom_center') { left = Math.round((W - lm.width) / 2); top = H - lm.height - margin; }
  else if (opts.logoPosition === 'top_left') { left = margin; top = margin; }

  const layers = [];
  if (opts.withBackdrop) {
    // 2026-07-24 三次实测:design-agent 里"标题从 22% 高度之后起笔"这条
    // 正向指令是概率性的,不是保证——同一份 prompt 有时遵守,有时标题第一行
    // 照样探进 logo 区,只是这次被不透明底板吃掉半个词("Whis|per Quiet")。
    // 纯靠 prompt measure 治不了根,干脆把底板高度下限定在 24% 画布高度
    // （比承诺的 22% 安全区再多留 2% 缓冲），不管模型这次听不听话都能兜住。
    const pad = Math.round(logoW * 0.3);
    const rectX = Math.max(0, left - pad);
    const rectY = Math.max(0, top - pad);
    const rectW = Math.min(W - rectX, lm.width + pad * 2);
    const rectH = Math.min(H - rectY, Math.max(lm.height + pad * 2, Math.round(H * 0.24) - rectY));
    const backdrop = Buffer.from(
      `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">` +
      `<rect x="${rectX}" y="${rectY}" width="${rectW}" height="${rectH}" rx="${Math.round(pad * 0.5)}" fill="#0a1628" fill-opacity="1"/>` +
      `</svg>`
    );
    layers.push({ input: backdrop, left: 0, top: 0 });
  }
  layers.push({ input: logoBuffer, left, top });
  return layers;
}

/**
 * Composite the real logo onto an already-finished image buffer (ai_reference
 * mode: the AI image already contains product/background/typography and left
 * the logo area blank per the prompt; this is the deterministic top-up pass).
 *
 * @param {Buffer} imageBuffer
 * @param {object} opts - { logoUrl, logoWidthRatio, logoPosition }
 * @returns {Promise<Buffer>}
 */
/**
 * 量出"logo 要落的那块画面"实际有多亮，据此决定用蓝版还是白版 logo。
 *
 * 2026-07-30:原先按场景模式(室内/海报)猜明暗——但室内也可能是傍晚暗调房间，
 * 猜错就会出现"蓝 logo 压在暗墙上看不清"，而这正是上一版模型自己垫黑底方框
 * 的根本原因。直接采样像素亮度比猜可靠。
 *
 * @param {Buffer} imageBuffer - 已生成的成品图(未贴 logo)
 * @param {object} opts - { logoPosition, logoWidthRatio }
 * @returns {Promise<'blue'|'white'>} 亮底→blue，暗底→white；采样失败→blue
 */
async function pickLogoVariantByBrightness(imageBuffer, opts = {}) {
  try {
    const meta = await sharp(imageBuffer).metadata();
    const W = meta.width, H = meta.height;
    const ratio = opts.logoWidthRatio || brandKit.LOGO.widthRatio;

    // 采样框必须和 buildLogoLayer 的落点几何一致(同 margin 0.045、同尺寸)。
    // 2026-07-30 第一版把框放大到 21% 且 margin 用 0.03,结果在"米色天花板 +
    // 深橄榄墙"的卧室里把下方深墙也采进来,均值被拉到 129 → 误判成暗底选了
    // 白 logo,实际白 logo 压在亮天花板上反而更不清楚。只量 logo 真正覆盖的
    // 那一小块,外扩一点点余量即可。
    const logoW = Math.round(W * ratio);
    const pad = Math.round(logoW * 0.08);
    const margin = Math.round(W * 0.045);
    const boxW = Math.min(W, logoW + pad * 2);
    const boxH = Math.min(H, logoW + pad * 2);   // lockup 近正方形
    const pos = opts.logoPosition || 'top_right';
    let left = W - logoW - margin - pad, top = margin - pad;
    if (pos === 'top_left') { left = margin - pad; top = margin - pad; }
    else if (pos === 'top_center') { left = Math.round((W - logoW) / 2) - pad; top = margin - pad; }
    else if (pos === 'bottom_center') { left = Math.round((W - logoW) / 2) - pad; top = H - logoW - margin - pad; }
    left = Math.max(0, Math.min(left, W - boxW));
    top = Math.max(0, Math.min(top, H - boxH));

    const stats = await sharp(imageBuffer)
      .extract({ left, top, width: boxW, height: boxH })
      .greyscale()
      .stats();
    const mean = stats.channels[0].mean;   // 0(黑) - 255(白)
    // 阈值 100 —— 定这个数是实测目检出来的,不是算的:
    //   实测同一张傍晚卧室(角落亮度 129)蓝白两版并排看,蓝版明显更清楚,
    //   白版在暖棕底上发灰发虚。原因是灰度对比度忽略了色相对比:品牌蓝压在
    //   暖棕上是互补色对比,读起来扎实;白色只有明度对比,中间调上就发虚。
    //   所以策略改成"品牌蓝优先,只有真暗底才退白版"(也符合品牌用色惯例:
    //   主色能用就用,反白只在深底上用)。
    // 实测样本:深蓝海报底 44 → 白;暖色室内角落 129 / 133 / 164 / 175 → 蓝。
    // 100 落在 44 与 129 之间的空档里。
    return mean >= 100 ? 'blue' : 'white';
  } catch (_) {
    return 'blue';
  }
}

async function applyLogoOverlay(imageBuffer, opts) {
  const meta = await sharp(imageBuffer).metadata();
  // withBackdrop 默认 true 是为 gpt-image-1 时代留的（那代模型管不住，会把标题
  // 画进 logo 角落，只能用不透明底板兜）。gpt-image-2 听得懂"这个角落留空"，
  // 而 Edwin 明确不要 logo 底下有方框 → 调用方传 false 关掉。
  const withBackdrop = opts.withBackdrop !== false;
  const logoLayers = await buildLogoLayer(meta.width, meta.height, { ...opts, withBackdrop });
  if (logoLayers.length === 0) return imageBuffer;
  return sharp(imageBuffer).composite(logoLayers).png().toBuffer();
}

/**
 * Composite a compliance/trust badge (warranty, certification, etc.) onto an
 * already-finished image buffer using the same deterministic SVG text engine
 * as text-overlay.js — reused here instead of gpt-image-1 rendering it,
 * because 3/3 real runs misspelled this specific small-text element
 * ("Warraniv" / "Warramy" / "Lertified sssurance") even with verbatim text
 * given. Bottom-right placement mirrors where the model itself put it.
 *
 * @param {Buffer} imageBuffer
 * @param {string} badgeText
 * @returns {Promise<Buffer>}
 */
async function applyBadgeOverlay(imageBuffer, badgeText) {
  const clean = String(badgeText || '').trim();
  if (!clean) return imageBuffer;

  const meta = await sharp(imageBuffer).metadata();
  const { width: W, height: H } = meta;
  const availableWidth = W * (1 - BADGE_PRESET.paddingX * 2);
  const cpl = charsPerLine(availableWidth, BADGE_PRESET.fontSize, clean);
  const maxCharsPerLine = Math.min(cpl, BADGE_PRESET.maxChars);
  const lines = wrapText(clean, maxCharsPerLine, BADGE_PRESET.maxLines);
  if (lines.length === 0) return imageBuffer;

  const svg = buildTextSvg(lines, BADGE_PRESET, W, H);
  if (!svg) return imageBuffer;
  return sharp(imageBuffer).composite([{ input: Buffer.from(svg) }]).png().toBuffer();
}

/**
 * Compose the final image.
 *
 * @param {object} opts
 * @param {Buffer|string} opts.background - buffer, URL, or local path
 * @param {string} opts.productPath - absolute path to product asset
 * @param {object} opts.texts - { title?, selling_point?, cta?, promo_badge? }
 * @param {string} [opts.productSlot] - key of brandKit.PRODUCT_SLOTS
 * @param {string} [opts.titleSlot] - key of brandKit.TITLE_SLOTS
 * @param {string} opts.outPath - output PNG path
 * @returns {Promise<{outPath: string, width: number, height: number}>}
 */
async function composeFinal(opts) {
  const bgBuffer = await loadBackground(opts.background);
  const base = sharp(bgBuffer);
  const meta = await base.metadata();
  const W = meta.width;
  const H = meta.height;
  if (!W || !H) throw new Error('Could not determine background dimensions');

  const layers = [];

  // 产品层
  let productSlot = opts.productSlot;
  let slot = brandKit.PRODUCT_SLOTS[productSlot];
  if (!slot) { productSlot = brandKit.DEFAULT_PRODUCT_SLOT; slot = brandKit.PRODUCT_SLOTS[productSlot]; }

  // 文字/产品避让：文字在中间(middle_center)时，产品让到更小更高的上方框，
  // 彻底躲开中部文字带（旧 top_center 底部仍会探到 0.5，压住文字）。
  const titleSlot = opts.titleSlot || brandKit.DEFAULT_TITLE_SLOT;
  if (titleSlot === 'middle_center') {
    slot = { cx: 0.5, cy: 0.26, w: 0.5, h: 0.32 };
  }

  const boxW = Math.round(W * slot.w);
  const boxH = Math.round(H * slot.h);
  const productName = path.basename((opts.productSource || opts.productPath || 'unknown').split('?')[0]);
  const product = await prepareProductLayer(opts.productSource || opts.productPath, boxW, boxH);
  if (product) {
    layers.push({
      input: product.buffer,
      left: Math.round(W * slot.cx - product.width / 2),
      top: Math.round(H * slot.cy - product.height / 2),
    });
  } else {
    console.warn(`[compose] product layer skipped — no real transparency detected (${productName}); composing background + logo + text only`);
  }

  // Logo 层（左上）— 优先用 brand_kit 的 logo（Storage URL），退回本地占位文件
  try {
    const logoLayers = await buildLogoLayer(W, H, opts);
    layers.push(...logoLayers);
  } catch (logoErr) {
    // logo 失败不该拖垮整张图
    console.error('[compose] logo layer skipped:', logoErr.message);
  }

  // 合成基底 + 产品 + logo → 临时文件，再走文字引擎
  const stagePath = opts.outPath.replace(/\.png$/i, '') + '.stage.png';
  await base.composite(layers).png().toFile(stagePath);

  const hasText = Object.values(opts.texts || {}).some((v) => v && String(v).trim());
  try {
    if (hasText) {
      const fontFamily = opts.fonts && opts.fonts.family;
      const presets = brandKit.buildTextPresets(titleSlot, opts.colors, fontFamily);
      await applyTextOverlays(stagePath, opts.texts || {}, opts.outPath, { presets });
    } else {
      fs.copyFileSync(stagePath, opts.outPath); // full_ai：文字已在图里，跳过文字引擎
    }
  } finally {
    try { fs.unlinkSync(stagePath); } catch (_) {}
  }

  if (!fs.existsSync(opts.outPath)) {
    throw new Error('Composition produced no output file');
  }
  return { outPath: opts.outPath, width: W, height: H };
}

/**
 * 开机字体自检：渲染一段 SVG 文字并检查是否产生了任何非透明像素。
 * 容器缺字体时 sharp 静默输出空白字形（July 批次线上全员无字的根因），
 * 这个探针让问题在启动日志里炸出来而不是溜进成品。
 */
async function canRenderText() {
  const svg = '<svg width="200" height="80" xmlns="http://www.w3.org/2000/svg">' +
    '<text x="10" y="50" font-family="sans-serif" font-size="40" fill="#000">Ag</text></svg>';
  try {
    const buf = await sharp(Buffer.from(svg)).png().toBuffer();
    const stats = await sharp(buf).stats();
    const alpha = stats.channels[3];
    return Boolean(alpha && alpha.max > 0);
  } catch (_) {
    return false;
  }
}

module.exports = {
  composeFinal,
  prepareProductLayer,
  loadBackground,
  applyLogoOverlay,
  pickLogoVariantByBrightness,
  applyBadgeOverlay,
  canRenderText,
};
