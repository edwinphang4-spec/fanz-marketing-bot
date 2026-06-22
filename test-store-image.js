// ============================================
// test-store-image.js — [I-4] 成品图存储自测
//
// Part A: 纯函数
// Part B: 集成（需 SUPABASE_URL + SUPABASE_SERVICE_KEY）
// ============================================

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const sharp = require('sharp');

const si = require('./lib/store-image');

let exitCode = 0;

function fail(msg) {
  console.error(`  FAIL: ${msg}`);
  exitCode = 1;
}

function makeTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `test-storeimg-${prefix}-`));
}

function cleanupTempDir(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
}

// ============================================
// Part A: Pure function tests
// ============================================

console.log('=== Part A: Pure function tests ===\n');

// ──────────────────────────────────────────
// 1. buildStoragePath: format Y/M/D/shortId.ext
// ──────────────────────────────────────────
console.log('Test 1: buildStoragePath format');
try {
  const result = si.buildStoragePath('123e4567-e89b-12d3-a456-426614174000', '.png');
  // Should be like "2026/06/22/123e4567e89b.png"
  const parts = result.split('/');
  assert.strictEqual(parts.length, 4, 'Should have 4 path segments');
  assert.ok(parts[3].endsWith('.png'), 'Should end with .png');
  assert.strictEqual(parts[3].length, 16, 'filename = 12 hex chars + .png (16 total)'); // 12 hex chars + .ext
  console.log(`  PASS (path: "${result}")`);
} catch (e) { fail(e.message); }

// ──────────────────────────────────────────
// 2. buildStoragePath: default extension .png
// ──────────────────────────────────────────
console.log('Test 2: buildStoragePath default extension');
try {
  const result = si.buildStoragePath('abc-def', null);
  assert.ok(result.endsWith('.png'), 'Should default to .png');
  console.log(`  PASS (ends with .png: "${result}")`);
} catch (e) { fail(e.message); }

// ──────────────────────────────────────────
// 3. buildStoragePath: different extensions
// ──────────────────────────────────────────
console.log('Test 3: buildStoragePath .jpg extension');
try {
  const result = si.buildStoragePath('abc-def', '.jpg');
  assert.ok(result.endsWith('.jpg'), 'Should end with .jpg');
  console.log(`  PASS (ends with .jpg: "${result}")`);
} catch (e) { fail(e.message); }

// ──────────────────────────────────────────
// 4. buildStoragePath: UUID stripped of dashes
// ──────────────────────────────────────────
console.log('Test 4: buildStoragePath UUID dash removal');
try {
  const result = si.buildStoragePath('aaa-bbb-ccc', '.png');
  const filename = path.basename(result, '.png');
  assert.ok(!filename.includes('-'), 'Filename should have no dashes');
  console.log(`  PASS (dashes removed: "${filename}")`);
} catch (e) { fail(e.message); }

// ──────────────────────────────────────────
// 5. guessMimeType: known extensions
// ──────────────────────────────────────────
console.log('Test 5: guessMimeType known extensions');
try {
  assert.strictEqual(si.guessMimeType('image.png'), 'image/png');
  assert.strictEqual(si.guessMimeType('image.jpg'), 'image/jpeg');
  assert.strictEqual(si.guessMimeType('image.jpeg'), 'image/jpeg');
  assert.strictEqual(si.guessMimeType('image.webp'), 'image/webp');
  assert.strictEqual(si.guessMimeType('image.gif'), 'image/gif');
  assert.strictEqual(si.guessMimeType('image.svg'), 'image/svg+xml');
  console.log('  PASS (all 6 types correct)');
} catch (e) { fail(e.message); }

// ──────────────────────────────────────────
// 6. guessMimeType: unknown → octet-stream
// ──────────────────────────────────────────
console.log('Test 6: guessMimeType unknown extension');
try {
  assert.strictEqual(si.guessMimeType('data.bin'), 'application/octet-stream');
  assert.strictEqual(si.guessMimeType('data'), 'application/octet-stream');
  assert.strictEqual(si.guessMimeType('data.xyz'), 'application/octet-stream');
  console.log('  PASS');
} catch (e) { fail(e.message); }

// ============================================
// Part B: Integration tests
// ============================================

console.log('\n=== Part B: Integration tests ===\n');

const tmpDir = makeTempDir('int');
let testFiles = [];

async function runPartB() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.log('SUPABASE_URL and SUPABASE_SERVICE_KEY not set — skipping DB tests');
    return;
  }

  console.log('SUPABASE credentials detected — running DB tests\n');

  const BASE = supabaseUrl.replace(/\/+$/, '');
  const TABLE = 'content_calendar';
  const BUCKET = 'content-images';
  const allCreatedIds = [];
  const storageCleanupPaths = [];

  // Generate a test image (48x48 pixel)
  const testImagePath = path.join(tmpDir, 'test-final-image.png');
  testFiles.push(testImagePath);
  const imgData = Buffer.alloc(48 * 48 * 4, 0);
  for (let y = 0; y < 48; y++) {
    for (let x = 0; x < 48; x++) {
      const idx = (y * 48 + x) * 4;
      imgData[idx] = (x * 5) % 256;
      imgData[idx + 1] = (y * 5) % 256;
      imgData[idx + 2] = 128;
      imgData[idx + 3] = 255;
    }
  }
  await sharp(imgData, { raw: { width: 48, height: 48, channels: 4 } }).png().toFile(testImagePath);

  try {
    // ──────────────────────────────────────────
    // DB-1: Upload to Supabase Storage
    // ──────────────────────────────────────────
    console.log('DB-1: Upload file to Supabase Storage');

    try {
      const uploadResult = await si.uploadFile(testImagePath, `test/upload-${Date.now()}.png`);
      assert.ok(uploadResult.publicUrl, 'publicUrl should be present');
      assert.ok(uploadResult.path, 'path should be present');
      assert.ok(uploadResult.publicUrl.includes(BUCKET), 'URL should contain bucket name');
      storageCleanupPaths.push(uploadResult.path);
      console.log(`  ✓ Uploaded to: ${uploadResult.path}`);
      console.log(`  ✓ Public URL: ${uploadResult.publicUrl}`);
      console.log(`  PASS`);
    } catch (e) {
      fail(`Upload failed: ${e.message}`);
    }

    // ──────────────────────────────────────────
    // DB-2: Verify uploaded file is accessible via HEAD
    // ──────────────────────────────────────────
    console.log('\nDB-2: Verify uploaded URL is accessible');

    try {
      // Upload another file and verify it
      const result = await si.uploadFile(testImagePath, `test/verify-${Date.now()}.png`);
      storageCleanupPaths.push(result.path);

      const headRes = await fetch(result.publicUrl, { method: 'HEAD' });
      assert.ok(headRes.ok, `HEAD ${result.publicUrl} returned ${headRes.status}`);
      const contentType = headRes.headers.get('content-type');
      assert.ok(contentType && contentType.startsWith('image/'),
        `Content-Type should be image/*, got: ${contentType}`);
      console.log(`  ✓ HEAD ${result.publicUrl} → ${headRes.status} (${contentType})`);
      console.log(`  PASS`);
    } catch (e) {
      fail(`Verification failed: ${e.message}`);
    }

    // ──────────────────────────────────────────
    // DB-3: storeFinalImage full flow: upload + write to content_calendar
    // ──────────────────────────────────────────
    console.log('\nDB-3: storeFinalImage full flow (upload + URL write to DB)');

    try {
      // Create a row first
      const createRes = await fetch(`${BASE}/rest/v1/${TABLE}`, {
        method: 'POST',
        headers: {
          apikey: supabaseKey,
          Authorization: `Bearer ${supabaseKey}`,
          'Content-Type': 'application/json',
          Prefer: 'return=representation',
        },
        body: JSON.stringify({
          status: 'approved',
          pillar: 'product',
          topic: `test-storeimage-flow-${Date.now()}`,
          chat_id: 'test-store-image',
        }),
      });
      const createData = await createRes.json();
      const row = Array.isArray(createData) ? createData[0] : createData;
      allCreatedIds.push(row.id);
      console.log(`  ✓ Created row: ${row.id}`);

      // Run storeFinalImage
      const result = await si.storeFinalImage(row.id, testImagePath);
      assert.ok(result.success, 'storeFinalImage should succeed');
      assert.ok(result.imageUrl, 'Should return imageUrl');
      assert.ok(result.imageUrl.includes(BUCKET), 'URL should reference content-images bucket');
      assert.ok(!result.idempotent, 'Should not be idempotent on first run');
      console.log(`  ✓ Stored: ${result.imageUrl}`);

      // Verify the DB was updated
      const readRes = await fetch(`${BASE}/rest/v1/${TABLE}?id=eq.${encodeURIComponent(row.id)}&select=id,image_url`, {
        headers: {
          apikey: supabaseKey,
          Authorization: `Bearer ${supabaseKey}`,
          Accept: 'application/json',
        },
      });
      const readData = await readRes.json();
      const updatedRow = Array.isArray(readData) ? readData[0] : readData;
      assert.strictEqual(updatedRow.image_url, result.imageUrl,
        'DB image_url should match returned URL');
      console.log(`  ✓ DB image_url: ${updatedRow.image_url}`);
      console.log(`  PASS`);
    } catch (e) {
      fail(`Full flow failed: ${e.message}`);
    }

    // ──────────────────────────────────────────
    // DB-4: Idempotency — already has image_url skips upload
    // ──────────────────────────────────────────
    console.log('\nDB-4: Idempotency — row with existing image_url skips upload');

    try {
      // Create a row with pre-set image_url
      const existingUrl = 'https://example.com/already-exists.png';
      const createRes = await fetch(`${BASE}/rest/v1/${TABLE}`, {
        method: 'POST',
        headers: {
          apikey: supabaseKey,
          Authorization: `Bearer ${supabaseKey}`,
          'Content-Type': 'application/json',
          Prefer: 'return=representation',
        },
        body: JSON.stringify({
          status: 'approved',
          pillar: 'product',
          topic: `test-storeimage-idempotent-${Date.now()}`,
          chat_id: 'test-store-image',
          image_url: existingUrl,
        }),
      });
      const createData = await createRes.json();
      const row = Array.isArray(createData) ? createData[0] : createData;
      allCreatedIds.push(row.id);

      // Run storeFinalImage — should be idempotent
      const result = await si.storeFinalImage(row.id, testImagePath);
      assert.ok(result.success, 'Idempotent call should succeed');
      assert.strictEqual(result.imageUrl, existingUrl,
        'Should return existing URL, not new upload');
      assert.ok(result.idempotent, 'Should report idempotent=true');
      console.log(`  ✓ Idempotent: ${result.imageUrl} (idempotent=${result.idempotent})`);
      console.log(`  PASS`);
    } catch (e) {
      fail(`Idempotency test failed: ${e.message}`);
    }

    // ──────────────────────────────────────────
    // DB-5: Nonexistent local file → error
    // ──────────────────────────────────────────
    console.log('\nDB-5: Nonexistent local file returns error (not throw)');

    try {
      const result = await si.storeFinalImage(
        '00000000-0000-0000-0000-000000000000',
        '/nonexistent/image-fake.png'
      );
      assert.ok(!result.success, 'Should report success=false');
      assert.ok(result.error, 'Should have error message');
      assert.ok(result.error.includes('not found'), 'Error should mention file not found');
      console.log(`  ✓ Error: ${result.error}`);
      console.log(`  PASS`);
    } catch (e) {
      fail(`Should not throw, got: ${e.message}`);
    }

    // ──────────────────────────────────────────
    // DB-6: uploadFile with nonexistent file → throws
    // ──────────────────────────────────────────
    console.log('\nDB-6: uploadFile with nonexistent file throws');

    try {
      await si.uploadFile('/nonexistent/fake.png', 'test/fake.png');
      fail('Should have thrown');
    } catch (e) {
      assert.ok(e.message.includes('not found'), 'Error should mention file not found');
      console.log(`  ✓ Threw: ${e.message}`);
      console.log(`  PASS`);
    }

    // ──────────────────────────────────────────
    // Cleanup: delete uploaded storage objects
    // ──────────────────────────────────────────
    console.log('\nCLEANUP: Remove uploaded files from Storage');
    for (const storagePath of storageCleanupPaths) {
      if (!storagePath) continue;
      try {
        const delRes = await fetch(`${BASE}/storage/v1/object/${BUCKET}/${storagePath}`, {
          method: 'DELETE',
          headers: {
            apikey: supabaseKey,
            Authorization: `Bearer ${supabaseKey}`,
          },
        });
        console.log(`  DELETE ${storagePath}: HTTP ${delRes.status} ${delRes.ok ? 'OK' : 'FAIL'}`);
      } catch (e) {
        console.log(`  DELETE ${storagePath}: error ${e.message}`);
      }
    }

    // Cleanup DB rows
    console.log('');
    for (const id of allCreatedIds) {
      if (!id) continue;
      try {
        const delRes = await fetch(`${BASE}/rest/v1/${TABLE}?id=eq.${encodeURIComponent(id)}`, {
          method: 'DELETE',
          headers: {
            apikey: supabaseKey,
            Authorization: `Bearer ${supabaseKey}`,
          },
        });
        console.log(`  DELETE row ${id.slice(0, 12)}...: HTTP ${delRes.status}`);
      } catch (e) {
        console.log(`  DELETE row ${id.slice(0, 12)}...: error ${e.message}`);
      }
    }
  } catch (err) {
    console.error(`❌ Part B fatal error: ${err.message}`);
    fail(err.message);
  }
}

// ============================================
// Main
// ============================================

(async function main() {
  await runPartB();
  cleanupTempDir(tmpDir);

  console.log('');
  if (exitCode === 0) {
    console.log('=== All tests passed ===');
  } else {
    console.error(`=== Some tests FAILED (exit code ${exitCode}) ===`);
  }
  process.exit(exitCode);
})();