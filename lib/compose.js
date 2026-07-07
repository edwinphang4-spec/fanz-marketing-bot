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
const { applyTextOverlays } = require('./text-overlay');
const brandKit = require('./brand-kit');

/**
 * Rasterize/resize the product image to fit a slot box, preserving alpha.
 * Returns { buffer, width, height }.
 */
async function prepareProductLayer(productPath, boxW, boxH) {
  if (!productPath || !fs.existsSync(productPath)) {
    throw new Error(`Product image not found: ${productPath}`);
  }
  const ext = path.extname(productPath).toLowerCase();
  const transparent = { r: 0, g: 0, b: 0, alpha: 0 };

  // 统一先栅格化（SVG 走 density 300），再看"实际" alpha 决定包不包白卡。
  // 不能只看文件类型/hasAlpha 元数据：现有 SVG 素材自带白底矩形，PNG 可能
  // 声明 alpha 通道却全不透明——直接压背景上会是一块生硬白板。
  const rasterized = ext === '.svg'
    ? await sharp(fs.readFileSync(productPath), { density: 300 })
        .resize(boxW, boxH, { fit: 'inside', background: transparent })
        .png()
        .toBuffer()
    : await sharp(productPath)
        .ensureAlpha()
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

  // 全不透明（实拍图 / 白底素材）：包白色圆角卡
  const inner = await sharp(rasterized)
    .resize(Math.round(boxW * 0.86), Math.round(boxH * 0.86), {
      fit: 'inside',
      background: { r: 255, g: 255, b: 255, alpha: 1 },
    })
    .flatten({ background: '#FFFFFF' })
    .png()
    .toBuffer();
  const innerMeta = await sharp(inner).metadata();
  const pad = Math.round(Math.max(innerMeta.width, innerMeta.height) * 0.06);
  const cardW = innerMeta.width + pad * 2;
  const cardH = innerMeta.height + pad * 2;
  const radius = Math.round(Math.min(cardW, cardH) * 0.08);
  const cardSvg = `<svg width="${cardW}" height="${cardH}" xmlns="http://www.w3.org/2000/svg">` +
    `<rect x="0" y="0" width="${cardW}" height="${cardH}" rx="${radius}" fill="#FFFFFF" fill-opacity="0.96"/></svg>`;
  const buffer = await sharp(Buffer.from(cardSvg))
    .composite([{ input: inner, top: pad, left: pad }])
    .png()
    .toBuffer();
  return { buffer, width: cardW, height: cardH };
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
  const slot = brandKit.PRODUCT_SLOTS[opts.productSlot] ||
    brandKit.PRODUCT_SLOTS[brandKit.DEFAULT_PRODUCT_SLOT];
  const boxW = Math.round(W * slot.w);
  const boxH = Math.round(H * slot.h);
  const product = await prepareProductLayer(opts.productPath, boxW, boxH);
  layers.push({
    input: product.buffer,
    left: Math.round(W * slot.cx - product.width / 2),
    top: Math.round(H * slot.cy - product.height / 2),
  });

  // Logo 层（左上）
  if (fs.existsSync(brandKit.LOGO.file)) {
    const logoW = Math.round(W * brandKit.LOGO.widthRatio);
    const logoBuffer = await sharp(brandKit.LOGO.file)
      .resize(logoW, null, { fit: 'inside' })
      .png()
      .toBuffer();
    layers.push({
      input: logoBuffer,
      left: Math.round(W * brandKit.LOGO.anchorX),
      top: Math.round(H * brandKit.LOGO.anchorY),
    });
  }

  // 合成基底 + 产品 + logo → 临时文件，再走文字引擎
  const stagePath = opts.outPath.replace(/\.png$/i, '') + '.stage.png';
  await base.composite(layers).png().toFile(stagePath);

  try {
    const presets = brandKit.buildTextPresets(opts.titleSlot);
    await applyTextOverlays(stagePath, opts.texts || {}, opts.outPath, { presets });
  } finally {
    try { fs.unlinkSync(stagePath); } catch (_) {}
  }

  if (!fs.existsSync(opts.outPath)) {
    throw new Error('Composition produced no output file');
  }
  return { outPath: opts.outPath, width: W, height: H };
}

module.exports = {
  composeFinal,
  prepareProductLayer,
  loadBackground,
};
