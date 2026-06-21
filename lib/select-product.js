// ============================================
// SelectProduct — 取产品图节点 [I-1]
//
// 从产品图目录按 pillar 简单规则选一张白底产品图，
// 记录 source_product_image 到 content_calendar。
//
// 本期规则：读目录动态选图，不写死文件名。
// ============================================

const path = require('path');
const fs = require('fs');

const PRODUCTS_DIR = path.resolve(__dirname, '..', 'assets', 'products');

// Valid image extensions
const IMAGE_EXTS = ['.svg', '.png', '.jpg', '.jpeg', '.webp'];

/**
 * List all product images in the given directory.
 * @param {string} [dir] - Optional directory path. Defaults to PRODUCTS_DIR.
 * Returns array of { filename, filepath, ext } sorted alphabetically.
 * Throws if directory doesn't exist or is empty.
 */
function listProductImages(dir) {
  const targetDir = dir || PRODUCTS_DIR;
  if (!fs.existsSync(targetDir)) {
    throw new Error(`Products directory not found: ${targetDir}`);
  }
  const files = fs.readdirSync(targetDir);
  const images = files
    .filter(f => {
      const ext = path.extname(f).toLowerCase();
      return IMAGE_EXTS.includes(ext);
    })
    .map(f => ({
      filename: f,
      filepath: path.join(targetDir, f),
      ext: path.extname(f).toLowerCase(),
    }))
    .sort((a, b) => a.filename.localeCompare(b.filename));

  if (images.length === 0) {
    throw new Error(`No product images found in ${targetDir}. Add product images and try again.`);
  }

  return images;
}

/**
 * Pillar-to-product mapping for deterministic selection.
 * Simple keyword matching on filename, fallback to first available.
 */
const PILLAR_KEYWORDS = {
  product: ['fs-series', 'ceiling-fan', 'smart'],
  case: ['grande-l', 'ceiling-fan', 'fs-series'],
  promo: ['air-cooler', 'smart', 'grande'],
  story: ['aura', 'ceiling-fan'],
};

/**
 * Select a product image based on pillar and topic.
 * Uses deterministic hash for reproducibility (same pillar+topic = same image).
 *
 * @param {string} pillar - content pillar (product|case|promo|story)
 * @param {string} [topic] - optional topic string for deterministic selection
 * @returns {{ filename: string, filepath: string, ext: string }}
 */
function selectProductImage(pillar, topic) {
  const images = listProductImages();

  // Try pillar-based keyword match first
  const keywords = PILLAR_KEYWORDS[pillar] || [];
  for (const kw of keywords) {
    const match = images.find(img => img.filename.toLowerCase().includes(kw));
    if (match) return match;
  }

  // Fallback: deterministic selection using topic hash or first available
  if (topic && images.length > 1) {
    let hash = 0;
    for (let i = 0; i < topic.length; i++) {
      hash = ((hash << 5) - hash) + topic.charCodeAt(i);
      hash |= 0; // Convert to 32-bit int
    }
    const idx = Math.abs(hash) % images.length;
    return images[idx];
  }

  return images[0]; // Default to first
}

/**
 * Write source_product_image to content_calendar.
 *
 * @param {string} rowId - content_calendar row UUID
 * @param {string} sourceImage - filename of the selected product image
 * @returns {Promise<object>} updated row
 */
async function writeSourceProductImage(rowId, sourceImage) {
  const supabase = require('./supabase');
  const result = await supabase.updateContentCalendar(rowId, {
    source_product_image: sourceImage,
  });
  return result;
}

module.exports = {
  PRODUCTS_DIR,
  listProductImages,
  selectProductImage,
  writeSourceProductImage,
};