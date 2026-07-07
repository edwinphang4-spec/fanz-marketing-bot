// ============================================
// text-overlay.js — sharp 文字叠加 [I-3]
//
// 输入：场景图 + key 文字（按预设位置）
// 输出：叠加文字的最终配图
//
// 文字内容/字体/字号/颜色/位置由模板规则确定（确定性，不交给AI）
// 红黄条款：空文字返回纯场景图；同输入同输出
// ============================================

const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

// ============================================
// 文字位置预设模板
// ============================================

const TEXT_PRESETS = {
  title: {
    align: 'center',
    anchorX: 0.5,        // center
    anchorY: 0.08,        // 8% from top
    fontSize: 48,
    fontWeight: 'bold',
    fill: '#FFFFFF',
    stroke: '#000000',
    strokeWidth: 2.5,
    maxChars: 60,
    maxLines: 2,
    paddingX: 0.08,       // 8% margin from edges
    lineHeight: 1.4,
    fontFamily: 'sans-serif',
    backgroundOpacity: 0.3,
  },
  subtitle: {
    align: 'center',
    anchorX: 0.5,
    anchorY: 0.28,        // below title area
    fontSize: 32,
    fontWeight: 'normal',
    fill: '#FFFFFF',
    stroke: '#000000',
    strokeWidth: 1.8,
    maxChars: 100,
    maxLines: 3,
    paddingX: 0.08,
    lineHeight: 1.4,
    fontFamily: 'sans-serif',
    backgroundOpacity: 0,
  },
  promo_badge: {
    align: 'right',
    anchorX: 0.92,        // right edge (8% from right)
    anchorY: 0.05,        // top
    fontSize: 28,
    fontWeight: 'bold',
    fill: '#FFD700',
    stroke: '#8B6914',
    strokeWidth: 1.5,
    maxChars: 30,
    maxLines: 1,
    paddingX: 0.03,
    lineHeight: 1.2,
    fontFamily: 'sans-serif',
    backgroundOpacity: 0.4,
  },
  selling_point: {
    align: 'center',
    anchorX: 0.5,
    anchorY: 0.55,        // middle area
    fontSize: 36,
    fontWeight: 'normal',
    fill: '#FFFFFF',
    stroke: '#000000',
    strokeWidth: 2,
    maxChars: 80,
    maxLines: 3,
    paddingX: 0.08,
    lineHeight: 1.4,
    fontFamily: 'sans-serif',
    backgroundOpacity: 0,
  },
  cta: {
    align: 'center',
    anchorX: 0.5,
    anchorY: 0.85,        // bottom but above logo
    fontSize: 30,
    fontWeight: 'bold',
    fill: '#FFFFFF',
    stroke: '#000000',
    strokeWidth: 2,
    maxChars: 50,
    maxLines: 1,
    paddingX: 0.08,
    lineHeight: 1.2,
    fontFamily: 'sans-serif',
    backgroundOpacity: 0,
  },
  logo_area: {
    align: 'right',
    anchorX: 0.95,
    anchorY: 0.92,        // bottom-right
    fontSize: 20,
    fontWeight: 'normal',
    fill: '#CCCCCC',
    stroke: '#000000',
    strokeWidth: 1,
    maxChars: 30,
    maxLines: 1,
    paddingX: 0.03,
    lineHeight: 1.2,
    fontFamily: 'sans-serif',
    backgroundOpacity: 0,
  },
};

// ============================================
// Text processing
// ============================================

/**
 * Truncate text to maxChars, preferring to break at word boundaries.
 * For CJK text (no spaces), break at maxChars directly.
 */
function truncateText(text, maxChars) {
  if (text == null) return '';
  if (typeof text !== 'string') return String(text);
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars).trimEnd() + '…';
}

/**
 * Wrap text into lines based on available width and font size.
 * For CJK characters, each char is roughly 1em wide.
 * Returns array of lines.
 */
function wrapText(text, maxCharsPerLine, maxLines) {
  if (!text) return [];

  const truncated = truncateText(text, maxCharsPerLine * maxLines);
  const lines = [];
  let remaining = truncated;

  while (remaining.length > 0 && lines.length < maxLines) {
    if (remaining.length <= maxCharsPerLine) {
      lines.push(remaining);
      break;
    }

    // For mixed text, try to break at space or punctuation boundary
    let breakAt = maxCharsPerLine;

    // Try to find a good break point (punctuation or space)
    for (let i = maxCharsPerLine; i > maxCharsPerLine * 0.6; i--) {
      const ch = remaining[i];
      const prevCh = remaining[i - 1];
      // Break after punctuation or space
      if (ch === ' ' || ch === '\u3000' || ch === ',' || ch === '.' ||
          ch === '，' || ch === '。' || ch === '！' || ch === '？' ||
          ch === '、' || ch === '；' || ch === '：' || ch === ')' ||
          ch === '）' || ch === '"' || ch === '”' || ch === '\'') {
        // Include the punctuation at end of current line, break after it
        breakAt = i + 1;
        break;
      }
      // Break before punctuation (left side)
      if (prevCh === ' ' || prevCh === '\u3000' || prevCh === '(' ||
          prevCh === '（' || prevCh === '"' || prevCh === '“' ||
          prevCh === '\'') {
        breakAt = i;
        break;
      }
    }

    lines.push(remaining.slice(0, breakAt).trimEnd());
    remaining = remaining.slice(breakAt).trimStart();
  }

  return lines;
}

/**
 * Calculate how many characters fit per line given a pixel width.
 * Width per char depends on the actual text: CJK ~1em, Latin ~0.6em.
 * The old all-CJK estimate halved the budget for English copy, forcing
 * premature wraps and mid-word breaks ("Malaysi / an").
 */
function charsPerLine(maxWidthPx, fontSize, sampleText) {
  let avg = 1; // CJK default
  const text = String(sampleText || '');
  if (text.length > 0) {
    let total = 0;
    for (const ch of text) {
      total += (ch.charCodeAt(0) > 0x2E80) ? 1 : 0.6;
    }
    avg = total / text.length;
  }
  return Math.max(1, Math.floor(maxWidthPx / (fontSize * avg)));
}

/**
 * Estimate pixel width of wrapped text lines.
 * CJK chars ~1em, Latin ~0.6em. Used for background rect sizing.
 */
function estimateTextWidth(lines, fontSize) {
  let maxWidth = 0;
  for (const line of lines) {
    let width = 0;
    for (const ch of line) {
      width += (ch.charCodeAt(0) > 0x2E80) ? fontSize : fontSize * 0.6;
    }
    maxWidth = Math.max(maxWidth, width);
  }
  return maxWidth;
}

// ============================================
// SVG generation
// ============================================

/**
 * Build SVG string for a single text element.
 */
function buildTextSvg(lines, preset, imageWidth, imageHeight) {
  const fontSize = preset.fontSize;
  const fontFamily = preset.fontFamily || 'sans-serif';
  const fontWeight = preset.fontWeight || 'normal';
  const fill = preset.fill || '#FFFFFF';
  const stroke = preset.stroke || 'none';
  const strokeWidth = preset.strokeWidth || 0;
  const lineHeight = preset.lineHeight || 1.4;
  const align = preset.align || 'center';

  if (lines.length === 0) return null;

  // Calculate text block dimensions
  const textBlockHeight = lines.length * fontSize * lineHeight;

  // Calculate Y position
  let posY = Math.round(imageHeight * preset.anchorY);
  // Center the text block vertically if multiple lines
  if (lines.length > 1) {
    posY = Math.round(posY - textBlockHeight / 2 + fontSize * 0.35);
  }

  // Calculate X position based on alignment
  let textAnchor, xPos;
  switch (align) {
    case 'left':
      textAnchor = 'start';
      xPos = Math.round(imageWidth * preset.paddingX);
      break;
    case 'right':
      textAnchor = 'end';
      xPos = Math.round(imageWidth * preset.anchorX);
      break;
    case 'center':
    default:
      textAnchor = 'middle';
      xPos = Math.round(imageWidth * preset.anchorX);
      break;
  }

  // Build SVG
  const svgWidth = imageWidth;
  const svgHeight = imageHeight;

  // Create text lines with stroke + fill for readability
  let textElements = '';
  // Background box for readability if opacity > 0
  let bgRect = '';
  if (preset.backgroundOpacity && preset.backgroundOpacity > 0) {
    const rectPadding = fontSize * 0.5;
    const textWidth = estimateTextWidth(lines, fontSize);
    const textBlockH = textBlockHeight;
    let rectX, rectW;

    switch (align) {
      case 'left':
        rectX = Math.round(xPos - rectPadding);
        rectW = Math.round(textWidth + rectPadding * 2);
        break;
      case 'right':
        rectX = Math.round(xPos - textWidth - rectPadding);
        rectW = Math.round(textWidth + rectPadding * 2);
        break;
      case 'center':
      default:
        rectX = Math.round(xPos - textWidth / 2 - rectPadding);
        rectW = Math.round(textWidth + rectPadding * 2);
        break;
    }

    // posY is the first line's BASELINE: glyphs rise ~0.8em above it and the
    // last line descends ~0.2em below its own baseline. Box the visual extent,
    // not baseline..baseline+blockHeight (the old math left the top of the text
    // outside the box and a dead band below it).
    const visualTop = posY - fontSize * 0.8;
    const visualH = (lines.length - 1) * fontSize * lineHeight + fontSize;
    const rectY = Math.round(visualTop - rectPadding);
    const rectH = Math.round(visualH + rectPadding * 2);
    const alpha = Math.round(preset.backgroundOpacity * 255).toString(16).padStart(2, '0');
    const borderRadius = Math.round(fontSize * 0.3);

    bgRect = `  <rect x="${rectX}" y="${rectY}" width="${rectW}" height="${rectH}"`
           + ` fill="#000000${alpha}" rx="${borderRadius}" />\n`;
  }

  lines.forEach((line, i) => {
    const yOffset = i * fontSize * lineHeight;
    const y = posY + yOffset;

    // Stroke (outline) layer
    textElements += `  <text x="${xPos}" y="${y}" text-anchor="${textAnchor}"
    font-family="${fontFamily}" font-size="${fontSize}" font-weight="${fontWeight}"
    fill="${stroke}" stroke="${stroke}" stroke-width="${strokeWidth * 2}"
    stroke-linejoin="round" paint-order="stroke">${escapeXml(line)}</text>\n`;

    // Fill layer
    textElements += `  <text x="${xPos}" y="${y}" text-anchor="${textAnchor}"
    font-family="${fontFamily}" font-size="${fontSize}" font-weight="${fontWeight}"
    fill="${fill}" stroke="none">${escapeXml(line)}</text>\n`;
  });

  const svg = `<svg width="${svgWidth}" height="${svgHeight}" xmlns="http://www.w3.org/2000/svg">
${bgRect}
${textElements}
</svg>`;

  return svg;
}

/**
 * Escape XML special characters for safe SVG embedding.
 */
function escapeXml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// ============================================
// Main function
// ============================================

/**
 * Apply text overlays onto a scene image.
 *
 * @param {string} imagePath - Path to the source scene image
 * @param {Object} texts - Object mapping preset name to text string
 *   e.g. { title: '开斋节特惠', selling_point: '10年保修' }
 * @param {string} outputPath - Where to save the result
 * @param {Object} [options] - Optional override
 * @param {Object} [options.dimensions] - Override width/height (if not reading from file)
 * @param {Object} [options.presets] - Override preset table (e.g. brand-kit layout);
 *   falls back to the module-level TEXT_PRESETS when omitted.
 * @returns {Promise<{width: number, height: number, textElements: string[]}>}
 */
async function applyTextOverlays(imagePath, texts, outputPath, options = {}) {
  if (!imagePath || !fs.existsSync(imagePath)) {
    throw new Error(`Image not found: ${imagePath}`);
  }

  // Read image metadata
  const metadata = await sharp(imagePath).metadata();
  const imageWidth = metadata.width;
  const imageHeight = metadata.height;

  if (!imageWidth || !imageHeight) {
    throw new Error(`Could not determine image dimensions: ${imagePath}`);
  }

  // Build compositing layers
  const appliedTexts = [];
  const overlays = [];
  const presetTable = options.presets || TEXT_PRESETS;

  for (const [presetName, text] of Object.entries(texts)) {
    const preset = presetTable[presetName];
    if (!preset) continue;

    const cleanText = String(text || '').trim();
    if (!cleanText) continue;

    // Calculate chars per line (width estimate based on the actual text)
    const availableWidth = imageWidth * (1 - preset.paddingX * 2);
    const cpl = charsPerLine(availableWidth, preset.fontSize, cleanText);
    const maxCharsPerLine = Math.min(cpl, preset.maxChars);

    // Wrap text into lines
    const lines = wrapText(cleanText, maxCharsPerLine, preset.maxLines);
    if (lines.length === 0) continue;

    // Build SVG for this element
    const svg = buildTextSvg(lines, preset, imageWidth, imageHeight);
    if (!svg) continue;

    overlays.push({
      input: Buffer.from(svg),
      top: 0,
      left: 0,
    });

    appliedTexts.push(presetName);
  }

  // No overlays — return pure scene image
  if (overlays.length === 0) {
    await sharp(imagePath).toFile(outputPath);
    return {
      width: imageWidth,
      height: imageHeight,
      textElements: [],
    };
  }

  // Composite all text overlays
  await sharp(imagePath)
    .composite(overlays)
    .toFile(outputPath);

  return {
    width: imageWidth,
    height: imageHeight,
    textElements: appliedTexts,
  };
}

// ============================================
// Utility: get text from content_calendar row
// ============================================

/**
 * Extract display text from a content_calendar row for text overlay.
 * Maps row fields to text overlay presets.
 *
 * @param {Object} row - content_calendar row
 * @returns {Object} texts object for applyTextOverlays
 */
function extractTextsFromRow(row) {
  const texts = {};

  if (row.topic) texts.title = row.topic;
  if (row.subtitle) texts.subtitle = row.subtitle;
  if (row.selling_point) texts.selling_point = row.selling_point;
  if (row.cta_text) texts.cta = row.cta_text;
  if (row.promo_badge) texts.promo_badge = row.promo_badge;
  if (row.brand_name) texts.logo_area = row.brand_name;

  return texts;
}

// ============================================
// Exports
// ============================================

module.exports = {
  applyTextOverlays,
  extractTextsFromRow,
  TEXT_PRESETS,
  // Exposed for testing
  truncateText,
  wrapText,
  charsPerLine,
  buildTextSvg,
};
