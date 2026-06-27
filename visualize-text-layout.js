// ============================================
// visualize-text-layout.js — I-3 文字排版可视化
// 用纯色背景模拟场景图，渲染全部 presets
// ============================================
const path = require('path');
const fs = require('fs');
const sharp = require('sharp');

const to = require('./lib/text-overlay');

const OUTPUT_DIR = '/root/fanz-bots/marketing-bot/assets/text-preview';
const IMG_W = 800;
const IMG_H = 800;
const BG_COLOR = { r: 30, g: 40, b: 60 }; // 深蓝色

// 真实 Fanz 营销文案（来自产品数据库 + 节庆内容）
const SAMPLE_TEXTS = {
  title: '开斋节凉爽攻略',
  subtitle: '全屋清凉一夏 · 智能节能新体验',
  promo_badge: 'RM 50 OFF',
  selling_point: '10年马达保修 · 马新上门服务\nSIRIM认证 · 节能静音',
  cta: '立即咨询 017-707 1366',
  logo_area: 'FANZ',
};

// 长文本版本（测试截断和换行极限）
const LONG_TEXTS = {
  title: '2026 开斋节家居风扇选购指南 — 全屋清凉方案',
  subtitle: 'FS系列563大客厅专用 · Grande L带灯款 · Smart WiFi智能款 · AURA紧凑型卧室款',
  promo_badge: 'HARI RAYA PROMO - RM 50 OFF',
  selling_point: '10年马达保修 · 马新上门服务 · SIRIM认证 · 节能静音 · DC马达低噪 · 产品责任险RM1,000,000',
  cta: '📞 立即咨询 017-707 1366 | 官网 fanz.com.my',
  logo_area: 'Fanz Sdn Bhd | 10 Years in Malaysia',
};

// ============================================
// 1. 生成纯色背景
// ============================================
async function createBackground(color, w, h, label) {
  const svg = `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
    <rect width="100%" height="100%" fill="rgb(${color.r},${color.g},${color.b})" />
    <rect x="0" y="0" width="${w}" height="${h}" fill="none" stroke="#444" stroke-width="1" stroke-dasharray="10,10" />
  </svg>`;
  const p = path.join(OUTPUT_DIR, `_bg_${label}.png`);
  await sharp(Buffer.from(svg)).png().toFile(p);
  return p;
}

// ============================================
// 2. 渲染单个 preset （单个文字元素）
// ============================================
async function renderSinglePreset(bgPath, presetName, text, label) {
  const texts = {};
  texts[presetName] = text;

  const outPath = path.join(OUTPUT_DIR, `preset_${label}.png`);
  const result = await to.applyTextOverlays(bgPath, texts, outPath);
  return { path: outPath, preset: presetName, textElements: result.textElements };
}

// ============================================
// 3. 渲染全部 preset 组合
// ============================================
async function renderAllTexts(bgPath, textsObj, label) {
  const outPath = path.join(OUTPUT_DIR, `combined_${label}.png`);
  const result = await to.applyTextOverlays(bgPath, textsObj, outPath);
  return { path: outPath, textElements: result.textElements };
}

// ============================================
// 4. 渲染带辅助参考线的排版诊断图
// ============================================
async function renderDiagnostic(bgPath, textsObj, label) {
  const outPath = path.join(OUTPUT_DIR, `diagnostic_${label}.png`);
  const w = IMG_W;
  const h = IMG_H;

  // Build reference lines SVG
  let refSvg = `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">\n`;

  // Anchor lines for each preset
  const presets = [
    { name: 'title',     anchorY: 0.08, color: '#FF6B6B' },
    { name: 'promo_badge', anchorY: 0.05, color: '#FFD93D' },
    { name: 'subtitle',  anchorY: 0.28, color: '#6BCB77' },
    { name: 'selling_point', anchorY: 0.55, color: '#4D96FF' },
    { name: 'cta',       anchorY: 0.85, color: '#FF6B6B' },
    { name: 'logo_area', anchorY: 0.92, color: '#888' },
  ];

  for (const p of presets) {
    const y = Math.round(h * p.anchorY);
    // Horizontal reference line
    refSvg += `  <line x1="0" y1="${y}" x2="${w}" y2="${y}" stroke="${p.color}" stroke-width="1" stroke-dasharray="4,4" opacity="0.5"/>\n`;
    // Label
    refSvg += `  <text x="10" y="${y - 4}" font-family="monospace" font-size="11" fill="${p.color}" opacity="0.7">${p.name} (anchorY=${p.anchorY})</text>\n`;
  }

  // Center vertical line
  refSvg += `  <line x1="${w/2}" y1="0" x2="${w/2}" y2="${h}" stroke="#666" stroke-width="1" stroke-dasharray="2,2" opacity="0.3"/>\n`;
  // 8% padding margins
  const marginX = Math.round(w * 0.08);
  refSvg += `  <line x1="${marginX}" y1="0" x2="${marginX}" y2="${h}" stroke="#555" stroke-width="1" stroke-dasharray="2,2" opacity="0.3"/>\n`;
  refSvg += `  <line x1="${w - marginX}" y1="0" x2="${w - marginX}" y2="${h}" stroke="#555" stroke-width="1" stroke-dasharray="2,2" opacity="0.3"/>\n`;

  refSvg += `</svg>`;

  // Composite: background + reference lines + text overlays
  const bgBuffer = await sharp(bgPath).png().toBuffer();
  const refBuffer = Buffer.from(refSvg);

  // Get text overlays
  const overlays = [];
  for (const [presetName, text] of Object.entries(textsObj)) {
    const preset = to.TEXT_PRESETS[presetName];
    if (!preset) continue;
    const cleanText = String(text || '').trim();
    if (!cleanText) continue;

    const availableWidth = w * (1 - preset.paddingX * 2);
    const cpl = to.charsPerLine(availableWidth, preset.fontSize);
    const maxCharsPerLine = Math.min(cpl, preset.maxChars);
    const lines = to.wrapText(cleanText, maxCharsPerLine, preset.maxLines);
    if (lines.length === 0) continue;

    const svg = to.buildTextSvg(lines, preset, w, h);
    if (svg) {
      overlays.push({ input: Buffer.from(svg), top: 0, left: 0 });
    }
  }

  await sharp(bgBuffer)
    .composite([
      { input: refBuffer, top: 0, left: 0 },
      ...overlays,
    ])
    .png()
    .toFile(outPath);

  return { path: outPath };
}

// ============================================
// Main
// ============================================
async function main() {
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    console.log(`Created output dir: ${OUTPUT_DIR}`);
  }

  console.log('=== I-3 文字排版可视化 ===\n');
  console.log(`Canvas: ${IMG_W}x${IMG_H} 深蓝色背景`);

  // Create background
  const bgPath = await createBackground(BG_COLOR, IMG_W, IMG_H, 'dark');
  console.log(`Background: ${bgPath}\n`);

  // ──────────────────────────────────────
  // Part A: 单个 preset 渲染
  // ──────────────────────────────────────
  console.log('--- Part A: 单个 Preset 渲染 ---\n');
  for (const [presetName, text] of Object.entries(SAMPLE_TEXTS)) {
    const label = presetName;
    const result = await renderSinglePreset(bgPath, presetName, text, label);
    const preset = to.TEXT_PRESETS[presetName];
    console.log(`[${presetName}]`);
    console.log(`  Text: "${text}"`);
    console.log(`  Font: ${preset.fontSize}px ${preset.fontWeight}, align=${preset.align}`);
    console.log(`  Position: anchorX=${preset.anchorX}, anchorY=${preset.anchorY}`);
    console.log(`  Background: opacity=${preset.backgroundOpacity}`);
    console.log(`  Output: ${result.path}\n`);
  }

  // ──────────────────────────────────────
  // Part B: 全部文本组合渲染
  // ──────────────────────────────────────
  console.log('--- Part B: 全部组合渲染 ---\n');

  // 短文本版本
  const shortResult = await renderAllTexts(bgPath, SAMPLE_TEXTS, 'short');
  console.log(`Short texts combined: ${shortResult.path}`);
  console.log(`Applied elements: ${shortResult.textElements.join(', ')}\n`);

  // 长文本版本（截断/换行测试）
  const longResult = await renderAllTexts(bgPath, LONG_TEXTS, 'long');
  console.log(`Long texts combined: ${longResult.path}`);
  console.log(`Applied elements: ${longResult.textElements.join(', ')}\n`);

  // ──────────────────────────────────────
  // Part C: 诊断图（含参考线）
  // ──────────────────────────────────────
  console.log('--- Part C: 排版诊断图（含参考线） ---\n');
  const diagResult = await renderDiagnostic(bgPath, SAMPLE_TEXTS, 'diagnostic');
  console.log(`Diagnostic: ${diagResult.path}\n`);

  const diagResultLong = await renderDiagnostic(bgPath, LONG_TEXTS, 'diagnostic_long');
  console.log(`Diagnostic (long): ${diagResultLong.path}\n`);

  // ──────────────────────────────────────
  // Summary
  // ──────────────────────────────────────
  console.log('=== 生成总结 ===');
  const files = fs.readdirSync(OUTPUT_DIR).filter(f => f.endsWith('.png'));
  console.log(`Total files: ${files.length}`);
  for (const f of files) {
    const stats = fs.statSync(path.join(OUTPUT_DIR, f));
    console.log(`  ${f} (${(stats.size / 1024).toFixed(1)} KB)`);
  }
  console.log(`\nOutput directory: ${OUTPUT_DIR}`);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
