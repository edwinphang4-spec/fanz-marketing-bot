// ============================================
// test-select-product.js — 自测脚本
//
// 依赖：lib/select-product.js（prod code）
//
// Part A: 纯函数，本地可跑（不需要 DB）
// Part B: DB 集成（需要 SUPABASE_URL + SUPABASE_SERVICE_KEY）
//
// 全部 pass 则 exit code 0。
// ============================================

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');

const selectProduct = require('./lib/select-product');

let exitCode = 0;

function fail(msg) {
  console.error(`  FAIL: ${msg}`);
  exitCode = 1;
}

// ============================================
// Part A: Pure function tests (no DB needed)
// ============================================

console.log('=== Part A: Pure function tests ===\n');

// ──────────────────────────────────────────
// 1. listProductImages() 返回数组，长度 >= 5
// ──────────────────────────────────────────
console.log('Test 1: listProductImages returns array with >= 5 items');
try {
  const images = selectProduct.listProductImages();
  assert.ok(Array.isArray(images), 'Should return an array');
  assert.ok(images.length >= 5, `Expected >= 5 images, got ${images.length}`);
  console.log('  PASS');
} catch (e) {
  fail(e.message);
}

// ──────────────────────────────────────────
// 2. 每项都有 filename, filepath, ext
// ──────────────────────────────────────────
console.log('Test 2: Each item has filename, filepath, ext');
try {
  const images = selectProduct.listProductImages();
  for (const img of images) {
    assert.ok(typeof img.filename === 'string', `filename should be string, got ${typeof img.filename}`);
    assert.ok(typeof img.filepath === 'string', `filepath should be string, got ${typeof img.filepath}`);
    assert.ok(typeof img.ext === 'string', `ext should be string, got ${typeof img.ext}`);
  }
  console.log('  PASS');
} catch (e) {
  fail(e.message);
}

// ──────────────────────────────────────────
// 3. filepath 是绝对路径且文件存在
// ──────────────────────────────────────────
console.log('Test 3: filepath is absolute and file exists');
try {
  const images = selectProduct.listProductImages();
  for (const img of images) {
    assert.ok(path.isAbsolute(img.filepath), `filepath should be absolute: ${img.filepath}`);
    assert.ok(fs.existsSync(img.filepath), `File should exist: ${img.filepath}`);
  }
  console.log('  PASS');
} catch (e) {
  fail(e.message);
}

// ──────────────────────────────────────────
// 4. product pillar → fs-series / ceiling-fan / smart
// ──────────────────────────────────────────
console.log('Test 4: product pillar keyword match');
try {
  const result = selectProduct.selectProductImage('product', 'test');
  const keywords = ['fs-series', 'ceiling-fan', 'smart'];
  const matched = keywords.some(kw => result.filename.toLowerCase().includes(kw));
  assert.ok(matched, `"${result.filename}" should match one of [${keywords}]`);
  console.log(`  PASS (got: ${result.filename})`);
} catch (e) {
  fail(e.message);
}

// ──────────────────────────────────────────
// 5. case pillar → grande-l / ceiling-fan / fs-series
// ──────────────────────────────────────────
console.log('Test 5: case pillar keyword match');
try {
  const result = selectProduct.selectProductImage('case', 'test');
  const keywords = ['grande-l', 'ceiling-fan', 'fs-series'];
  const matched = keywords.some(kw => result.filename.toLowerCase().includes(kw));
  assert.ok(matched, `"${result.filename}" should match one of [${keywords}]`);
  console.log(`  PASS (got: ${result.filename})`);
} catch (e) {
  fail(e.message);
}

// ──────────────────────────────────────────
// 6. promo pillar → air-cooler / smart / grande
// ──────────────────────────────────────────
console.log('Test 6: promo pillar keyword match');
try {
  const result = selectProduct.selectProductImage('promo', 'test');
  const keywords = ['air-cooler', 'smart', 'grande'];
  const matched = keywords.some(kw => result.filename.toLowerCase().includes(kw));
  assert.ok(matched, `"${result.filename}" should match one of [${keywords}]`);
  console.log(`  PASS (got: ${result.filename})`);
} catch (e) {
  fail(e.message);
}

// ──────────────────────────────────────────
// 7. story pillar → aura / ceiling-fan
// ──────────────────────────────────────────
console.log('Test 7: story pillar keyword match');
try {
  const result = selectProduct.selectProductImage('story', 'test');
  const keywords = ['aura', 'ceiling-fan'];
  const matched = keywords.some(kw => result.filename.toLowerCase().includes(kw));
  assert.ok(matched, `"${result.filename}" should match one of [${keywords}]`);
  console.log(`  PASS (got: ${result.filename})`);
} catch (e) {
  fail(e.message);
}

// ──────────────────────────────────────────
// 8. 幂等性：相同参数返回相同结果
// ──────────────────────────────────────────
console.log('Test 8: Same params produce same result (idempotency)');
try {
  const r1 = selectProduct.selectProductImage('product', 'same-topic');
  const r2 = selectProduct.selectProductImage('product', 'same-topic');
  assert.strictEqual(r1.filename, r2.filename, 'Two calls with same params should return same filename');
  console.log(`  PASS (filename: ${r1.filename})`);
} catch (e) {
  fail(e.message);
}

// ──────────────────────────────────────────
// 9. 确定性：不同 topic 可能不同，但同 topic 始终一致
// ──────────────────────────────────────────
console.log('Test 9: Determinism — same topic = same result, different topics may differ');
try {
  const rA = selectProduct.selectProductImage('product', 'topic-a');
  const rB = selectProduct.selectProductImage('product', 'topic-b');
  const rB2 = selectProduct.selectProductImage('product', 'topic-b');

  // Each call returns a valid result
  assert.ok(rA.filename, 'topic-a should return a result');
  assert.ok(rB.filename, 'topic-b should return a result');

  // topic-b is deterministic
  assert.strictEqual(rB.filename, rB2.filename, 'topic-b called twice should return the same filename');

  // Just report what happened (they may or may not differ depending on hash)
  const diff = rA.filename !== rB.filename ? 'different (as expected with >1 image)' : 'same (possible hash collision)';
  console.log(`  PASS (topic-a: ${rA.filename}, topic-b: ${rB.filename} — ${diff})`);
} catch (e) {
  fail(e.message);
}

// ──────────────────────────────────────────
// 10. 空目录 → "No product images found"
// ──────────────────────────────────────────
console.log('Test 10: Empty directory throws "No product images found"');
const tmpEmptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-empty-prod-'));
try {
  assert.throws(() => {
    selectProduct.listProductImages(tmpEmptyDir);
  }, (err) => {
    return err.message.includes('No product images found');
  }, 'Should throw with "No product images found"');
  console.log('  PASS');
} catch (e) {
  fail(e.message);
} finally {
  try {
    fs.rmdirSync(tmpEmptyDir);
  } catch (_) { /* ignore */ }
}

// ──────────────────────────────────────────
// 11. 非图片文件过滤 (.txt 不被返回)
// ──────────────────────────────────────────
console.log('Test 11: Non-image files are filtered out');
const tmpMixedDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-mixed-dir-'));
try {
  // Write a .txt file
  fs.writeFileSync(path.join(tmpMixedDir, 'readme.txt'), 'not an image');
  // Copy one real SVG into temp dir (从 assets/products 复制一个)
  const realProductsDir = selectProduct.PRODUCTS_DIR;
  const svgFiles = fs.readdirSync(realProductsDir).filter(f => f.endsWith('.svg'));
  if (svgFiles.length > 0) {
    fs.copyFileSync(path.join(realProductsDir, svgFiles[0]), path.join(tmpMixedDir, svgFiles[0]));
  }

  const result = selectProduct.listProductImages(tmpMixedDir);
  const hasTxt = result.some(img => img.filename === 'readme.txt');
  assert.strictEqual(hasTxt, false, 'Should not include .txt files');
  assert.ok(result.length > 0, 'Should still include image files');
  assert.ok(result.every(img => ['.svg', '.png', '.jpg', '.jpeg', '.webp'].includes(img.ext)),
    'All returned items should have valid image extensions');
  console.log(`  PASS (${result.length} images returned, no .txt files)`);
} catch (e) {
  fail(e.message);
} finally {
  try {
    fs.rmSync(tmpMixedDir, { recursive: true, force: true });
  } catch (_) { /* ignore */ }
}

// ──────────────────────────────────────────
// 12. 不带 topic 且无关键字匹配时返回 images[0]
// ──────────────────────────────────────────
console.log('Test 12: No topic and no keyword match returns first file (images[0])');
try {
  const expectedFirst = selectProduct.listProductImages()[0];
  // Use an unknown pillar so keyword matching yields nothing, falling through to images[0]
  const noTopic = selectProduct.selectProductImage('unknown');
  assert.strictEqual(noTopic.filename, expectedFirst.filename,
    `Without topic and no keyword match, should return first file (${expectedFirst.filename}), got ${noTopic.filename}`);
  console.log(`  PASS (got: ${noTopic.filename})`);
} catch (e) {
  fail(e.message);
}

// ============================================
// Part B: DB integration (requires SUPABASE_URL + SUPABASE_SERVICE_KEY)
// ============================================
console.log('\n=== Part B: DB integration tests ===\n');

async function runPartB() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.log('SUPABASE_URL and SUPABASE_SERVICE_KEY not set — skipping DB tests');
    return;
  }

  console.log('SUPABASE_URL and SUPABASE_SERVICE_KEY detected — running DB tests\n');
  const supabase = require('./lib/supabase');

  let testRowId = null;

  // ──────────────────────────────────────────
  // 13. 创建测试行 → writeSourceProductImage → SELECT 确认
  // ──────────────────────────────────────────
  console.log('Test 13: writeSourceProductImage writes source_product_image');
  try {
    const created = await supabase.createContentCalendar({
      topic: 'select-product integration test',
      pillar: 'product',
      status: 'draft',
    });
    testRowId = created.id;
    assert.ok(testRowId, 'Should have created a row');

    const testImage = 'test-product-image.svg';
    const updated = await selectProduct.writeSourceProductImage(testRowId, testImage);
    assert.strictEqual(updated.source_product_image, testImage,
      `source_product_image should be "${testImage}", got "${updated.source_product_image}"`);

    // Also verify via SELECT separately
    const fetched = await supabase.getContentCalendar(testRowId);
    assert.strictEqual(fetched.source_product_image, testImage,
      `SELECT should confirm source_product_image = "${testImage}"`);

    console.log(`  PASS (row ${testRowId}, source_product_image = "${testImage}")`);
  } catch (e) {
    fail(e.message);
  }

  // ──────────────────────────────────────────
  // 14. 清理测试行
  // ──────────────────────────────────────────
  console.log('Test 14: Cleanup test row');
  if (testRowId) {
    try {
      const baseUrl = supabaseUrl.replace(/\/+$/, '');
      const res = await fetch(`${baseUrl}/rest/v1/content_calendar?id=eq.${encodeURIComponent(testRowId)}`, {
        method: 'DELETE',
        headers: {
          apikey: supabaseKey,
          Authorization: `Bearer ${supabaseKey}`,
        },
      });
      if (!res.ok && res.status !== 204) {
        const errText = await res.text();
        throw new Error(`DELETE failed ${res.status}: ${errText}`);
      }
      console.log('  PASS (test row cleaned up)');
    } catch (e) {
      fail(`Cleanup failed: ${e.message}`);
    }
  } else {
    console.log('  SKIP (no test row to clean)');
  }
}

// Run Part B and then exit with appropriate code
runPartB().then(() => {
  console.log('');
  if (exitCode === 0) {
    console.log('=== All tests passed ===');
  } else {
    console.error(`=== Some tests FAILED (exit code ${exitCode}) ===`);
  }
  process.exit(exitCode);
});