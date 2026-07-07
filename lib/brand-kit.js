// ============================================
// brand-kit.js — 品牌模板配置（确定性合成的唯一事实源）
//
// Design MD（Edwin 确认的版式）：logo 左上、主文案中下、产品居中偏上
// （吊扇从天花板悬挂，产品位天然在上半部；背景 prompt 会要求留出天花板空间）。
//
// Fanz 正式素材（透明底 logo / 品牌色 / 字体）到手后只改这个文件 +
// 替换 assets/brand/ 下的文件，管线其余部分零改动。
// ============================================

const path = require('path');

const BRAND_DIR = path.join(__dirname, '..', 'assets', 'brand');

// ── Logo ──
// 占位：文字版 FANZ wordmark（等 Fanz 提供正式透明底 PNG 后同名替换）
const LOGO = {
  file: path.join(BRAND_DIR, 'fanz-logo.png'),
  // top-left, width as ratio of canvas width
  anchorX: 0.05,
  anchorY: 0.045,
  widthRatio: 0.22,
};

// ── 产品位预设（画布比例坐标，产品按 fit-contain 缩放进框）──
const PRODUCT_SLOTS = {
  top_center:   { cx: 0.50, cy: 0.36, w: 0.62, h: 0.46 },
  center:       { cx: 0.50, cy: 0.46, w: 0.62, h: 0.50 },
  center_right: { cx: 0.66, cy: 0.42, w: 0.52, h: 0.46 },
};
const DEFAULT_PRODUCT_SLOT = 'top_center';

// ── 文字版式（沿用 text-overlay 的 preset 结构；主文案中下）──
// title_slot 决定 title 的锚点，其余元素相对固定。
const TITLE_SLOTS = {
  bottom_center: 0.72,
  middle_center: 0.50,
  top_center: 0.10,
};
const DEFAULT_TITLE_SLOT = 'bottom_center';

/**
 * Build the text preset table for a given title slot.
 * Mirrors text-overlay TEXT_PRESETS shape so applyTextOverlays can consume it.
 */
function buildTextPresets(titleSlot) {
  const titleY = TITLE_SLOTS[titleSlot] ?? TITLE_SLOTS[DEFAULT_TITLE_SLOT];
  return {
    title: {
      align: 'center', anchorX: 0.5, anchorY: titleY,
      fontSize: 52, fontWeight: 'bold',
      fill: '#FFFFFF', stroke: '#1A1A1A', strokeWidth: 2.5,
      maxChars: 60, maxLines: 2, paddingX: 0.08, lineHeight: 1.35,
      fontFamily: 'sans-serif', backgroundOpacity: 0.35,
    },
    selling_point: {
      align: 'center', anchorX: 0.5, anchorY: Math.min(titleY + 0.12, 0.86),
      fontSize: 32, fontWeight: 'normal',
      fill: '#FFFFFF', stroke: '#1A1A1A', strokeWidth: 1.8,
      maxChars: 80, maxLines: 2, paddingX: 0.08, lineHeight: 1.35,
      fontFamily: 'sans-serif', backgroundOpacity: 0,
    },
    cta: {
      align: 'center', anchorX: 0.5, anchorY: 0.94,
      fontSize: 28, fontWeight: 'bold',
      fill: '#FFD700', stroke: '#1A1A1A', strokeWidth: 1.8,
      maxChars: 50, maxLines: 1, paddingX: 0.08, lineHeight: 1.2,
      fontFamily: 'sans-serif', backgroundOpacity: 0.3,
    },
    promo_badge: {
      align: 'right', anchorX: 0.95, anchorY: 0.06,
      fontSize: 28, fontWeight: 'bold',
      fill: '#FFD700', stroke: '#8B6914', strokeWidth: 1.5,
      maxChars: 30, maxLines: 1, paddingX: 0.03, lineHeight: 1.2,
      fontFamily: 'sans-serif', backgroundOpacity: 0.4,
    },
  };
}

module.exports = {
  BRAND_DIR,
  LOGO,
  PRODUCT_SLOTS,
  DEFAULT_PRODUCT_SLOT,
  TITLE_SLOTS,
  DEFAULT_TITLE_SLOT,
  buildTextPresets,
};
