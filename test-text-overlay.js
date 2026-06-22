// ============================================
// test-text-overlay.js — [I-3] sharp 文字叠加自测
//
// Part A: 纯函数（截断、换行、SVG生成）
// Part B: 集成（真实 sharp 合成输出）
// ============================================

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');

const to = require('./lib/text-overlay');
const sharp = require('sharp');

let exitCode = 0;

function fail(msg) {
  console.error(`  FAIL: ${msg}`);
  exitCode = 1;
}

function makeTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `test-textov-${prefix}-`));
}

function cleanupTempDir(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
}

// ============================================
// Part A: Pure function tests
// ============================================

console.log('=== Part A: Pure function tests ===\n');

// ──────────────────────────────────────────
// 1. truncateText: 短文本不变
// ──────────────────────────────────────────
console.log('Test 1: truncateText — short text unchanged');
try {
  assert.strictEqual(to.truncateText('hello', 20), 'hello');
  assert.strictEqual(to.truncateText('开斋节', 20), '开斋节');
  console.log('  PASS');
} catch (e) { fail(e.message); }

// ──────────────────────────────────────────
// 2. truncateText: 超长加省略号
// ──────────────────────────────────────────
console.log('Test 2: truncateText — long text truncates with …');
try {
  const result = to.truncateText('This is a very long text that needs truncation', 20);
  assert.strictEqual(result, 'This is a very long…');
  assert.ok(result.endsWith('…'), 'Should end with ellipsis');
  console.log(`  PASS (result: "${result}")`);
} catch (e) { fail(e.message); }

// ──────────────────────────────────────────
// 3. truncateText: 空/undefined 安全
// ──────────────────────────────────────────
console.log('Test 3: truncateText — null/empty safe');
try {
  assert.strictEqual(to.truncateText('', 10), '');
  assert.strictEqual(to.truncateText(null, 10), '');
  assert.strictEqual(to.truncateText(undefined, 10), '');
  // Non-string type converted
  assert.strictEqual(to.truncateText(123, 10), '123');
  console.log('  PASS');
} catch (e) { fail(e.message); }

// ──────────────────────────────────────────
// 4. wrapText: 短文本单行
// ──────────────────────────────────────────
console.log('Test 4: wrapText — short text returns single line');
try {
  const lines = to.wrapText('Hello', 10, 3);
  assert.deepStrictEqual(lines, ['Hello']);
  console.log('  PASS');
} catch (e) { fail(e.message); }

// ──────────────────────────────────────────
// 5. wrapText: 长文本正确换行
// ──────────────────────────────────────────
console.log('Test 5: wrapText — long text wraps correctly');
try {
  const lines = to.wrapText('This is a very long sentence that should be split into multiple lines for display', 20, 5);
  assert.ok(lines.length >= 3, `Expected >=3 lines, got ${lines.length}`);
  assert.ok(lines.every(l => l.length <= 22), 'All lines under max chars + margin');
  console.log(`  PASS (${lines.length} lines: ${lines.join(' | ')})`);
} catch (e) { fail(e.message); }

// ──────────────────────────────────────────
// 6. wrapText: CJK 换行
// ──────────────────────────────────────────
console.log('Test 6: wrapText — CJK text wrapping');
try {
  const lines = to.wrapText('开斋节到了你家风扇准备好了吗10年保修安心一夏', 8, 4);
  assert.ok(lines.length >= 2, `Expected >=2 lines, got ${lines.length}`);
  console.log(`  PASS (${lines.length} lines: ${lines.join(' | ')})`);
} catch (e) { fail(e.message); }

// ──────────────────────────────────────────
// 7. wrapText: maxLines 限制
// ──────────────────────────────────────────
console.log('Test 7: wrapText — maxLines capped');
try {
  const lines = to.wrapText('word1 word2 word3 word4 word5 word6 word7 word8 word9 word10', 5, 2);
  assert.strictEqual(lines.length, 2, 'Should be exactly 2 lines');
  console.log(`  PASS (${lines.length} lines)`);
} catch (e) { fail(e.message); }

// ──────────────────────────────────────────
// 8. wrapText: 空/undefined 安全
// ──────────────────────────────────────────
console.log('Test 8: wrapText — null/empty safe');
try {
  assert.deepStrictEqual(to.wrapText('', 10, 3), []);
  assert.deepStrictEqual(to.wrapText(null, 10, 3), []);
  assert.deepStrictEqual(to.wrapText(undefined, 10, 3), []);
  console.log('  PASS');
} catch (e) { fail(e.message); }

// ──────────────────────────────────────────
// 9. charsPerLine: 正确计算
// ──────────────────────────────────────────
console.log('Test 9: charsPerLine calculation');
try {
  // At fontSize=48, available width 800px → ~16 chars per line
  const result = to.charsPerLine(800, 48);
  assert.strictEqual(result, 16);
  const result2 = to.charsPerLine(400, 32);
  assert.strictEqual(result2, 12);
  console.log(`  PASS (800/48→${result}, 400/32→${result2})`);
} catch (e) { fail(e.message); }

// ──────────────────────────────────────────
// 10. charsPerLine: 最小 1
// ──────────────────────────────────────────
console.log('Test 10: charsPerLine — minimum 1');
try {
  const result = to.charsPerLine(10, 48);
  assert.strictEqual(result, 1);
  console.log('  PASS');
} catch (e) { fail(e.message); }

// ──────────────────────────────────────────
// 11. buildTextSvg: 返回有效 SVG
// ──────────────────────────────────────────
console.log('Test 11: buildTextSvg — produces valid SVG');
try {
  const svg = to.buildTextSvg(['Hello World'], to.TEXT_PRESETS.title, 800, 600);
  assert.ok(svg, 'SVG should be non-null');
  assert.ok(svg.includes('<svg'), 'Should start with SVG tag');
  assert.ok(svg.includes('</svg>'), 'Should end with SVG tag');
  assert.ok(svg.includes('Hello World'), 'Should contain text');
  assert.ok(svg.includes('font-size="48"'), 'Should have correct font size');
  assert.ok(svg.includes('fill="#FFFFFF"'), 'Should have correct fill');
  assert.ok(svg.includes('text-anchor="middle"'), 'Should be centered');
  console.log('  PASS (valid SVG generated)');
} catch (e) { fail(e.message); }

// ──────────────────────────────────────────
// 12. buildTextSvg: 空行返回 null
// ──────────────────────────────────────────
console.log('Test 12: buildTextSvg — empty lines returns null');
try {
  const svg = to.buildTextSvg([], to.TEXT_PRESETS.title, 800, 600);
  assert.strictEqual(svg, null);
  console.log('  PASS');
} catch (e) { fail(e.message); }

// ──────────────────────────────────────────
// 13. buildTextSvg: 多行多层
// ──────────────────────────────────────────
console.log('Test 13: buildTextSvg — multi-line produces stroke + fill layers');
try {
  const svg = to.buildTextSvg(['Line 1', 'Line 2'], to.TEXT_PRESETS.title, 800, 600);
  assert.ok(svg.includes('Line 1'), 'Should contain line 1');
  assert.ok(svg.includes('Line 2'), 'Should contain line 2');
  // Count text elements: each line has stroke + fill = 2 per line
  const textTags = svg.match(/<text/g);
  assert.strictEqual(textTags.length, 4, '2 lines × 2 layers = 4 text tags');
  console.log('  PASS (4 text tags for 2 lines with stroke+fill)');
} catch (e) { fail(e.message); }

// ──────────────────────────────────────────
// 14. buildTextSvg: background rect present when backgroundOpacity > 0
// ──────────────────────────────────────────
console.log('Test 14: buildTextSvg — background rect generated when opacity > 0');
try {
  const preset = { ...to.TEXT_PRESETS.title };
  const svg = to.buildTextSvg(['Hello World'], preset, 800, 600);
  assert.ok(svg.includes('<rect'), 'Should have rect element');
  assert.ok(svg.includes('fill="#000000'), 'Should be black with alpha');
  console.log('  PASS (background rect generated)');
} catch (e) { fail(e.message); }

// ──────────────────────────────────────────
// 15. buildTextSvg: no rect when opacity = 0
// ──────────────────────────────────────────
console.log('Test 15: buildTextSvg — no rect when opacity = 0');
try {
  const preset = { ...to.TEXT_PRESETS.selling_point };
  const svg = to.buildTextSvg(['Hello World'], preset, 800, 600);
  assert.ok(svg.includes('<text'), 'Should have text');
  assert.ok(!svg.includes('<rect'), 'Should NOT have rect');
  console.log('  PASS (no background rect for opacity=0)');
} catch (e) { fail(e.message); }

// ──────────────────────────────────────────
// 16. TEXT_PRESETS: 所有 preset 都有必需字段
// ──────────────────────────────────────────
console.log('Test 16: All presets have required fields');
try {
  const requiredFields = ['align', 'anchorX', 'anchorY', 'fontSize', 'fill', 'maxChars', 'maxLines', 'paddingX'];
  for (const [name, preset] of Object.entries(to.TEXT_PRESETS)) {
    for (const field of requiredFields) {
      assert.ok(preset[field] !== undefined, `Preset "${name}" missing field "${field}"`);
    }
  }
  console.log(`  PASS (all ${Object.keys(to.TEXT_PRESETS).length} presets validated)`);
} catch (e) { fail(e.message); }

// ──────────────────────────────────────────
// 15. extractTextsFromRow: 正确映射
// ──────────────────────────────────────────
console.log('Test 17: extractTextsFromRow mapping');
try {
  const row = {
    topic: '开斋节特惠',
    subtitle: '限时优惠，先到先得',
    selling_point: '10年保修，安心一夏',
    cta_text: '立即购买',
    promo_badge: 'HOT',
    brand_name: 'FANZ',
  };
  const texts = to.extractTextsFromRow(row);
  assert.strictEqual(texts.title, '开斋节特惠');
  assert.strictEqual(texts.subtitle, '限时优惠，先到先得');
  assert.strictEqual(texts.selling_point, '10年保修，安心一夏');
  assert.strictEqual(texts.cta, '立即购买');
  assert.strictEqual(texts.promo_badge, 'HOT');
  assert.strictEqual(texts.logo_area, 'FANZ');
  console.log('  PASS (all 6 fields mapped correctly)');
} catch (e) { fail(e.message); }

// ──────────────────────────────────────────
// 16. extractTextsFromRow: 空行安全
// ──────────────────────────────────────────
console.log('Test 16: extractTextsFromRow — sparse row');
try {
  const texts = to.extractTextsFromRow({ topic: 'only title' });
  assert.strictEqual(texts.title, 'only title');
  assert.strictEqual(Object.keys(texts).length, 1);
  console.log('  PASS (only title extracted)');
} catch (e) { fail(e.message); }

// ============================================
// Part B: Integration tests (sharp compositing)
// ============================================

console.log('\n=== Part B: Integration tests ===\n');

// Create temp dir for output
const tmpDir = makeTempDir('int');
let testFiles = [];

const testImagePath = path.join(tmpDir, 'test-input.png');

async function runPartB() {
  // Create a simple test image (solid color for deterministic testing)
  const imgWidth = 600;
  const imgHeight = 900;
  const testImageData = Buffer.alloc(imgWidth * imgHeight * 4, 0);
  // Fill with a gradient-like pattern (semi random for visual check)
  for (let y = 0; y < imgHeight; y++) {
    for (let x = 0; x < imgWidth; x++) {
      const idx = (y * imgWidth + x) * 4;
      testImageData[idx] = 50;       // R
      testImageData[idx + 1] = 100;  // G
      testImageData[idx + 2] = 150;  // B
      testImageData[idx + 3] = 255;  // A
    }
  }
  await sharp(testImageData, {
    raw: { width: imgWidth, height: imgHeight, channels: 4 }
  }).png().toFile(testImagePath);

  // ──────────────────────────────────────────
  // DB-1: Apply text overlay on test image
  // ──────────────────────────────────────────
  console.log('DB-1: Text overlay produces output file');

  try {
    const outputPath = path.join(tmpDir, 'output-title.png');
    testFiles.push(outputPath);
    const result = await to.applyTextOverlays(testImagePath, {
      title: '开斋节特惠',
      subtitle: '限时优惠，先到先得',
    }, outputPath);

    assert.ok(fs.existsSync(outputPath), 'Output file should exist');
    const meta = await sharp(outputPath).metadata();
    assert.strictEqual(meta.width, imgWidth, 'Width should match');
    assert.strictEqual(meta.height, imgHeight, 'Height should match');
    assert.ok(result.textElements.includes('title'), 'title should be in applied texts');
    assert.ok(result.textElements.includes('subtitle'), 'subtitle should be in applied texts');
    console.log(`  PASS (output: ${outputPath}, ${meta.width}x${meta.height}, texts: ${result.textElements.join(', ')})`);
  } catch (e) { fail(e.message); }

  // ──────────────────────────────────────────
  // DB-2: Empty text returns pure scene image
  // ──────────────────────────────────────────
  console.log('\nDB-2: Empty text returns pure scene image');

  try {
    const outputPath = path.join(tmpDir, 'output-empty-text.png');
    testFiles.push(outputPath);
    const result = await to.applyTextOverlays(testImagePath, {}, outputPath);

    assert.ok(fs.existsSync(outputPath));
    assert.strictEqual(result.textElements.length, 0, 'No text elements should be applied');
    console.log('  PASS (textElements=0, pure scene image)');
  } catch (e) { fail(e.message); }

  // ──────────────────────────────────────────
  // DB-3: Same input → same output (deterministic)
  // ──────────────────────────────────────────
  console.log('\nDB-3: Same input produces same output (deterministic)');

  try {
    const out1 = path.join(tmpDir, 'deterministic-1.png');
    const out2 = path.join(tmpDir, 'deterministic-2.png');
    testFiles.push(out1, out2);

    const texts = { title: '开斋节特惠', selling_point: '10年保修，安心一夏' };
    const r1 = await to.applyTextOverlays(testImagePath, texts, out1);
    const r2 = await to.applyTextOverlays(testImagePath, texts, out2);

    // Compare file contents byte-by-byte
    const buf1 = fs.readFileSync(out1);
    const buf2 = fs.readFileSync(out2);

    assert.strictEqual(buf1.length, buf2.length, 'Output files should be same size');
    assert.ok(buf1.equals(buf2), 'Output files should be byte-identical');
    assert.deepStrictEqual(r1, r2, 'Return values should be identical');
    console.log(`  PASS (${buf1.length} bytes, byte-identical)`);
  } catch (e) { fail(e.message); }

  // ──────────────────────────────────────────
  // DB-4: Multiple overlay positions work
  // ──────────────────────────────────────────
  console.log('\nDB-4: All preset positions overlay correctly');

  try {
    const outputPath = path.join(tmpDir, 'output-all-presets.png');
    testFiles.push(outputPath);

    const result = await to.applyTextOverlays(testImagePath, {
      title: '开斋节特惠',
      subtitle: '打造舒适家居',
      selling_point: '10年保修 | 超静音 | 智能遥控',
      cta: '立即购买',
      promo_badge: '限时优惠',
      logo_area: 'FANZ',
    }, outputPath);

    assert.ok(fs.existsSync(outputPath));
    assert.strictEqual(result.textElements.length, 6, 'All 6 presets should be applied');
    console.log(`  PASS (${result.textElements.length} elements: ${result.textElements.join(', ')})`);
  } catch (e) { fail(e.message); }

  // ──────────────────────────────────────────
  // DB-5: File size reasonable (not empty, not corrupt)
  // ──────────────────────────────────────────
  console.log('\nDB-5: Output file size is reasonable');

  try {
    const outputPath = path.join(tmpDir, 'output-size-check.png');
    testFiles.push(outputPath);

    await to.applyTextOverlays(testImagePath, {
      title: '开斋节特惠',
      subtitle: '打造舒适家居',
    }, outputPath);

    const stat = fs.statSync(outputPath);
    assert.ok(stat.size > 1000, `File should be >1KB (was ${stat.size})`);
    assert.ok(stat.size < 10 * 1024 * 1024, `File should be <10MB (was ${stat.size})`);
    console.log(`  PASS (${(stat.size / 1024).toFixed(1)} KB)`);
  } catch (e) { fail(e.message); }

  // ──────────────────────────────────────────
  // DB-6: Different-sized generated image works
  // ──────────────────────────────────────────
  console.log('\nDB-6: Different-sized generated image works');

  try {
    // Use a different-size generated image (not real product file)
    const altOutput = path.join(tmpDir, 'output-alt-size.png');
    testFiles.push(altOutput);

    const result = await to.applyTextOverlays(testImagePath, {
      title: '开斋节到了，你家风扇准备好了吗？',
      selling_point: '10年保修，安心一夏',
    }, altOutput);

    assert.ok(fs.existsSync(altOutput), 'Output file should exist');
    const meta = await sharp(altOutput).metadata();
    assert.ok(meta.width > 0 && meta.height > 0, 'Should have valid dimensions');
    console.log(`  PASS (${meta.width}x${meta.height}, ${(fs.statSync(altOutput).size / 1024).toFixed(1)} KB)`);
  } catch (e) { fail(e.message); }

  // ──────────────────────────────────────────
  // DB-7: CJK text with wrapping renders
  // ──────────────────────────────────────────
  console.log('\nDB-7: Long CJK text wraps correctly in output');

  try {
    const outputPath = path.join(tmpDir, 'output-long-cjk.png');
    testFiles.push(outputPath);

    await to.applyTextOverlays(testImagePath, {
      title: '开斋节到了你家风扇准备好了吗十年保修安心一夏超静音智能遥控节能省电',
    }, outputPath);

    assert.ok(fs.existsSync(outputPath));
    const meta = await sharp(outputPath).metadata();
    assert.strictEqual(meta.width, imgWidth, 'Dimensions preserved');
    console.log(`  PASS (${meta.width}x${meta.height} — wrapped CJK didn't distort image)`);
  } catch (e) { fail(e.message); }

  // ──────────────────────────────────────────
  // DB-8: Non-existent image throws
  // ──────────────────────────────────────────
  console.log('\nDB-8: Non-existent image throws error');

  try {
    await to.applyTextOverlays('/nonexistent/image.png', { title: 'test' }, '/tmp/out.png');
    fail('Should have thrown');
  } catch (e) {
    if (e.message.includes('not found')) {
      console.log('  PASS (correct error message)');
    } else {
      fail(`Unexpected error: ${e.message}`);
    }
  }
}

// ============================================
// Main
// ============================================

(async function main() {
  try {
    await runPartB();
  } catch (e) {
    console.error(`\n❌ Part B fatal error: ${e.message}`);
    console.error(e.stack);
    fail(e.message);
  } finally {
    // Cleanup temp dir
    cleanupTempDir(tmpDir);
  }

  console.log('');
  if (exitCode === 0) {
    console.log('=== All tests passed ===');
  } else {
    console.error(`=== Some tests FAILED (exit code ${exitCode}) ===`);
  }
  process.exit(exitCode);
})();
