// ============================================
// test-compose.js — 确定性合成引擎测试（零 API、零 DB）
//
// 用 sharp 生成固定背景，走真实 composeFinal：
//   1) SVG 产品（透明底路径）
//   2) 无 alpha PNG 产品（白色圆角卡路径）
//   3) 不同 title_slot / product_slot
//   4) 空文字（只有产品+logo）
// 断言输出文件存在、尺寸正确。输出保留在 /tmp/compose-test/ 供人工目检。
// 运行：node test-compose.js
// ============================================

const sharp = require('sharp');
const fs = require('fs');
const path = require('path');
const { composeFinal } = require('./lib/compose');
const brandKit = require('./lib/brand-kit');

const OUT_DIR = '/tmp/compose-test';
let pass = 0, fail = 0;
const t = (cond, msg) => {
  cond ? (pass++, console.log(`PASS: ${msg}`)) : (fail++, console.error(`FAIL: ${msg}`));
};

async function makeBackground() {
  // 渐变室内色调背景 1024x1024（固定内容）
  const svg = `<svg width="1024" height="1024" xmlns="http://www.w3.org/2000/svg">
    <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#E8DCC8"/><stop offset="0.5" stop-color="#C9B08A"/>
      <stop offset="1" stop-color="#6B5B45"/></linearGradient></defs>
    <rect width="1024" height="1024" fill="url(#g)"/>
  </svg>`;
  const p = path.join(OUT_DIR, 'fixture-bg.png');
  await sharp(Buffer.from(svg)).png().toFile(p);
  return p;
}

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const bg = await makeBackground();
  const svgProduct = path.join(__dirname, 'assets', 'products', 'grande-l.svg');
  const pngProduct = path.join(__dirname, 'assets', 'products', 'fanz-product-test.png');

  // Case 1: SVG product + full texts, default slots
  const out1 = path.join(OUT_DIR, 'case1-svg-full.png');
  const r1 = await composeFinal({
    background: bg,
    productPath: svgProduct,
    texts: { title: 'Raya Bersama Fanz', selling_point: '10-year motor warranty', cta: 'DM us today' },
    outPath: out1,
  });
  t(fs.existsSync(out1), 'case1: output exists (SVG product, full texts)');
  t(r1.width === 1024 && r1.height === 1024, `case1: dimensions 1024x1024 (got ${r1.width}x${r1.height})`);

  // Case 2: PNG product without alpha → rounded white card path
  const meta = await sharp(pngProduct).metadata();
  const out2 = path.join(OUT_DIR, 'case2-png-card.png');
  await composeFinal({
    background: bg,
    productPath: pngProduct,
    texts: { title: 'Hujan atau panas, Fanz ada' },
    productSlot: 'center_right',
    titleSlot: 'bottom_center',
    outPath: out2,
  });
  t(fs.existsSync(out2), `case2: output exists (PNG hasAlpha=${meta.hasAlpha}, card path=${!meta.hasAlpha})`);

  // Case 3: alternate title slot
  const out3 = path.join(OUT_DIR, 'case3-title-top.png');
  await composeFinal({
    background: bg,
    productPath: svgProduct,
    texts: { title: 'Top title variant', cta: 'Visit our showroom' },
    titleSlot: 'top_center',
    productSlot: 'center',
    outPath: out3,
  });
  t(fs.existsSync(out3), 'case3: output exists (title_slot=top_center)');

  // Case 4: empty texts — product + logo only
  const out4 = path.join(OUT_DIR, 'case4-no-text.png');
  await composeFinal({ background: bg, productPath: svgProduct, texts: {}, outPath: out4 });
  t(fs.existsSync(out4), 'case4: output exists (no texts)');

  // Case 5: invalid slot names fall back to defaults, not crash
  const out5 = path.join(OUT_DIR, 'case5-bad-slots.png');
  await composeFinal({
    background: bg, productPath: svgProduct,
    texts: { title: 'Fallback slots' },
    productSlot: 'nonsense', titleSlot: 'nonsense',
    outPath: out5,
  });
  t(fs.existsSync(out5), 'case5: bad slot names fall back to defaults');

  // Case 6: brand kit sanity — logo file exists, presets well-formed
  t(fs.existsSync(brandKit.LOGO.file), 'brand kit: logo file present');
  const presets = brandKit.buildTextPresets('bottom_center');
  t(presets.title.anchorY === brandKit.TITLE_SLOTS.bottom_center, 'brand kit: title preset uses slot anchor');

  console.log(`\n${pass} passed, ${fail} failed — outputs in ${OUT_DIR}/`);
  process.exit(fail ? 1 : 0);
})().catch(err => { console.error('FATAL:', err); process.exit(1); });
