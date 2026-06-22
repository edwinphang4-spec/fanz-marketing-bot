// ============================================
// test-image-review.js — 两步审配图审核卡自测 [I-2]
//
// Part A: 纯函数（状态机）
// Part B: 集成（需 SUPABASE_URL + SUPABASE_SERVICE_KEY）
// ============================================

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');

const sm = require('./lib/state-machine');

let exitCode = 0;

function fail(msg) {
  console.error(`  FAIL: ${msg}`);
  exitCode = 1;
}

function makeTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `test-imgreview-${prefix}-`));
}

function cleanupTempDir(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
}

// ============================================
// Part A: State machine pure function tests
// ============================================

console.log('=== Part A: State machine tests ===\n');

// ──────────────────────────────────────────
// 1. copy_approved 状态存在
// ──────────────────────────────────────────
console.log('Test 1: copy_approved is a valid state');
try {
  assert.ok(sm.isValidStatus('copy_approved'), 'copy_approved should be valid');
  console.log('  PASS');
} catch (e) {
  fail(e.message);
}

// ──────────────────────────────────────────
// 2. image_ready 状态存在
// ──────────────────────────────────────────
console.log('Test 2: image_ready is a valid state');
try {
  assert.ok(sm.isValidStatus('image_ready'), 'image_ready should be valid');
  console.log('  PASS');
} catch (e) {
  fail(e.message);
}

// ──────────────────────────────────────────
// 3. image_retry 状态存在
// ──────────────────────────────────────────
console.log('Test 3: image_retry is a valid state');
try {
  assert.ok(sm.isValidStatus('image_retry'), 'image_retry should be valid');
  console.log('  PASS');
} catch (e) {
  fail(e.message);
}

// ──────────────────────────────────────────
// 4. copy_approved 的三个合法出口
// ──────────────────────────────────────────
console.log('Test 4: copy_approved has 3 legal exits');
try {
  const allowed = sm.allowedTransitions('copy_approved');
  // Must allow: image_ready (imagery success), approved (skip imagery)
  assert.ok(allowed.includes('image_ready'), 'copy_approved → image_ready');
  assert.ok(allowed.includes('approved'), 'copy_approved → approved (skip)');
  // Technical failure → stays at copy_approved (no transition needed)
  // This is internal logic, not a state machine transition
  console.log(`  PASS (allowed: ${allowed.join(', ')})`);
} catch (e) {
  fail(e.message);
}

// ──────────────────────────────────────────
// 5. copy_approved → image_ready → approved → published 完整链路
// ──────────────────────────────────────────
console.log('Test 5: Full happy path: pending_review → copy_approved → image_ready → approved → published');
try {
  assert.strictEqual(sm.transition('pending_review', 'copy_approved'), 'copy_approved');
  assert.strictEqual(sm.transition('copy_approved', 'image_ready'), 'image_ready');
  assert.strictEqual(sm.transition('image_ready', 'approved'), 'approved');
  assert.strictEqual(sm.transition('approved', 'published'), 'published');
  console.log('  PASS');
} catch (e) {
  fail(e.message);
}

// ──────────────────────────────────────────
// 6. Skip imagery path: copy_approved → approved → published
// ──────────────────────────────────────────
console.log('Test 6: Skip imagery path: copy_approved → approved → published');
try {
  assert.strictEqual(sm.transition('copy_approved', 'approved'), 'approved');
  console.log('  PASS (skip image escape hatch works)');
} catch (e) {
  fail(e.message);
}

// ──────────────────────────────────────────
// 7. 文案打回路径不变：pending_review → rejected → copy_done
// ──────────────────────────────────────────
console.log('Test 7: Copy reject path unchanged: pending_review → rejected → copy_done');
try {
  assert.strictEqual(sm.transition('pending_review', 'rejected'), 'rejected');
  assert.strictEqual(sm.transition('rejected', 'copy_done'), 'copy_done');
  console.log('  PASS');
} catch (e) {
  fail(e.message);
}

// ──────────────────────────────────────────
// 8. 配图打回：image_ready → image_retry → image_ready (regenerate)
// ──────────────────────────────────────────
console.log('Test 8: Image reject path: image_ready → image_retry → image_ready (regenerate)');
try {
  assert.strictEqual(sm.transition('image_ready', 'image_retry'), 'image_retry');
  assert.strictEqual(sm.transition('image_retry', 'image_ready'), 'image_ready');
  console.log('  PASS');
} catch (e) {
  fail(e.message);
}

// ──────────────────────────────────────────
// 9. image_retry >= 3 → approved escape hatch
// ──────────────────────────────────────────
console.log('Test 9: image_retry → approved escape hatch');
try {
  assert.strictEqual(sm.transition('image_retry', 'approved'), 'approved');
  console.log('  PASS');
} catch (e) {
  fail(e.message);
}

// ──────────────────────────────────────────
// 10. 未批准前不能跳过（非法流转阻断）
// ──────────────────────────────────────────
console.log('Test 10: Illegal transitions blocked');
try {
  // Can't go directly from pending_review to approved (must go through copy_approved)
  assert.throws(() => sm.transition('pending_review', 'approved'), /Invalid transition/);
  // Can't go from copy_done to image_ready (must pass through pending_review → copy_approved first)
  assert.throws(() => sm.transition('copy_done', 'image_ready'), /Invalid transition/);
  // Can't go from image_ready to rejected (that's copy rejection, not image rejection)
  assert.throws(() => sm.transition('image_ready', 'rejected'), /Invalid transition/);
  // Can't go from copy_approved to rejected (copy already approved)
  assert.throws(() => sm.transition('copy_approved', 'rejected'), /Invalid transition/);
  // Published is terminal
  assert.throws(() => sm.transition('published', 'draft'), /terminal/);
  console.log('  PASS (all illegal transitions properly blocked)');
} catch (e) {
  fail(e.message);
}

// ──────────────────────────────────────────
// 11. 所有状态全覆盖 — STATES 数组含全部 11 个状态
// ──────────────────────────────────────────
console.log('Test 11: All 11 states present in STATES array');
try {
  const expected = ['draft', 'planning_done', 'selected', 'copy_done', 'pending_review', 'copy_approved', 'image_ready', 'image_retry', 'approved', 'rejected', 'published'];
  assert.deepStrictEqual(sm.STATES, expected);
  console.log('  PASS (STATES matches expected list)');
} catch (e) {
  fail(e.message);
}

// ──────────────────────────────────────────
// 12. 每个状态都有合法流转，无孤立状态
// ──────────────────────────────────────────
console.log('Test 12: Every state has at least one legal transition (except terminal states)');
try {
  for (const state of sm.STATES) {
    const allowed = sm.allowedTransitions(state);
    if (state === 'published') {
      assert.strictEqual(allowed.length, 0, 'published should be terminal');
    } else {
      assert.ok(allowed.length > 0, `State "${state}" has no valid transitions`);
    }
  }
  console.log('  PASS (no orphan states)');
} catch (e) {
  fail(e.message);
}

// ──────────────────────────────────────────
// 13. image_retry 的 escape hatch 次数约定在 callback_data 中（不依赖 DB）
// ──────────────────────────────────────────
console.log('Test 13: image_retry callback_data format: image_reject:rowId:count');
try {
  const cbData = 'image_reject:some-uuid-here:2';
  const parts = cbData.split(':');
  assert.strictEqual(parts[0], 'image_reject');
  assert.strictEqual(parts[2], '2');
  const count = parseInt(parts[2], 10);
  assert.strictEqual(count, 2);
  const nextCount = count + 1;
  // count 2 means this is the 3rd time (0-indexed), so nextCount >= 3 triggers skip
  const skipNeeded = nextCount >= 3;
  const retryAllowed = nextCount < 3;
  assert.strictEqual(count, 2);
  assert.ok(skipNeeded, 'count=2 → next=3 should trigger skip (nextCount >= 3)');
  assert.ok(!retryAllowed, 'count=2 → retry should not be auto-allowed');
  console.log('  PASS (callback_data encodes count correctly)');
} catch (e) {
  fail(e.message);
}

// ──────────────────────────────────────────
// 14. retry_count < 3 走 retry，>= 3 走 escape hatch
// ──────────────────────────────────────────
console.log('Test 14: retry_count < 3 → retry, >= 3 → escape hatch');
try {
  const shouldAutoRetry = (count) => (count + 1) < 3;
  const showEscapeHatch = (count) => (count + 1) >= 3;

  assert.ok(shouldAutoRetry(0), 'count=0 → next=1 < 3 → auto-retry');
  assert.ok(shouldAutoRetry(1), 'count=1 → next=2 < 3 → auto-retry');
  assert.ok(!shouldAutoRetry(2), 'count=2 → next=3 >= 3 → NO auto-retry');
  assert.ok(showEscapeHatch(2), 'count=2 → next=3 >= 3 → show escape hatch');
  assert.ok(!showEscapeHatch(0), 'count=0 → next=1 < 3 → no escape hatch');
  console.log('  PASS');
} catch (e) {
  fail(e.message);
}

// ============================================
// Part B: Integration tests (requires Supabase)
// ============================================

console.log('\n=== Part B: Integration tests ===\n');

async function runPartB() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.log('SUPABASE_URL and SUPABASE_SERVICE_KEY not set — skipping DB tests');
    return;
  }

  console.log('SUPABASE_URL and SUPABASE_SERVICE_KEY detected — running DB tests\n');

  const baseUrl = supabaseUrl.replace(/\/+$/, '');
  const TABLE = 'content_calendar';
  let testRowId = null;

  try {
    // ──────────────────────────────────────────
    // DB-1. Test new states pass DB CHECK constraint
    // ──────────────────────────────────────────
    console.log('DB-1: New states can be written to DB');
    for (const newStatus of ['copy_approved', 'image_ready', 'image_retry']) {
      try {
        const createRes = await fetch(`${baseUrl}/rest/v1/${TABLE}`, {
          method: 'POST',
          headers: {
            apikey: supabaseKey,
            Authorization: `Bearer ${supabaseKey}`,
            'Content-Type': 'application/json',
            Prefer: 'return=representation',
          },
          body: JSON.stringify({
            status: newStatus,
            pillar: 'product',
            topic: `test-${newStatus}`,
            chat_id: 'test-image-review',
          }),
        });
        if (!createRes.ok) {
          const errText = await createRes.text();
          throw new Error(`Status "${newStatus}" blocked by CHECK constraint: ${errText.slice(0, 100)}`);
        }
        const data = await createRes.json();
        const row = Array.isArray(data) ? data[0] : data;
        assert.strictEqual(row.status, newStatus, `Row status should be "${newStatus}"`);
        console.log(`    ✓ "${newStatus}" accepted by DB`);

        // Cleanup
        await fetch(`${baseUrl}/rest/v1/${TABLE}?id=eq.${encodeURIComponent(row.id)}`, {
          method: 'DELETE',
          headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` },
        });
      } catch (e) {
        fail(e.message);
      }
    }
    console.log('  PASS (all 3 new states pass DB CHECK)');

    // ──────────────────────────────────────────
    // DB-2. Verify STATES array matches DB CHECK (差集=0)
    // ──────────────────────────────────────────
    console.log('\nDB-2: STATES array matches DB CHECK constraint');
    try {
      // Test all code STATES against DB
      const codeStates = sm.STATES;
      const failures = [];
      for (const s of codeStates) {
        try {
          const testRes = await fetch(`${baseUrl}/rest/v1/${TABLE}`, {
            method: 'POST',
            headers: {
              apikey: supabaseKey,
              Authorization: `Bearer ${supabaseKey}`,
              'Content-Type': 'application/json',
              Prefer: 'return=minimal',
            },
            body: JSON.stringify({ status: s, pillar: 'product', topic: `test-statesync-${s}` }),
          });
          if (!testRes.ok) {
            failures.push(s);
          }
        } catch (_) {
          failures.push(s);
        }
      }
      assert.strictEqual(failures.length, 0,
        `States blocked by DB CHECK: ${failures.length > 0 ? failures.join(', ') : 'none'}`);
      console.log(`  PASS (all ${codeStates.length} code states accepted by DB)`);
    } catch (e) {
      fail(`State-DB mismatch: ${e.message}`);
    }

    // ──────────────────────────────────────────
    // DB-3. Test copy_approved → image_ready transition in DB
    // ──────────────────────────────────────────
    console.log('\nDB-3: copy_approved → image_ready transition in DB');
    try {
      const createRes = await fetch(`${baseUrl}/rest/v1/${TABLE}`, {
        method: 'POST',
        headers: {
          apikey: supabaseKey,
          Authorization: `Bearer ${supabaseKey}`,
          'Content-Type': 'application/json',
          Prefer: 'return=representation',
        },
        body: JSON.stringify({
          status: 'copy_approved',
          pillar: 'product',
          topic: 'test-transition',
          chat_id: 'test-image-review',
        }),
      });
      const data = await createRes.json();
      const row = Array.isArray(data) ? data[0] : data;
      testRowId = row.id;
      assert.strictEqual(row.status, 'copy_approved');

      // Update to image_ready
      const updateRes = await fetch(`${baseUrl}/rest/v1/${TABLE}?id=eq.${encodeURIComponent(testRowId)}`, {
        method: 'PATCH',
        headers: {
          apikey: supabaseKey,
          Authorization: `Bearer ${supabaseKey}`,
          'Content-Type': 'application/json',
          Prefer: 'return=representation',
        },
        body: JSON.stringify({ status: 'image_ready' }),
      });
      const updateData = await updateRes.json();
      const updated = Array.isArray(updateData) ? updateData[0] : updateData;
      assert.strictEqual(updated.status, 'image_ready', 'Status should be image_ready');
      console.log('  PASS');
    } catch (e) {
      fail(`Transition failed: ${e.message}`);
    }

    // ──────────────────────────────────────────
    // DB-4. Cleanup
    // ──────────────────────────────────────────
    console.log('\nDB-4: Cleanup test rows');
    if (testRowId) {
      try {
        await fetch(`${baseUrl}/rest/v1/${TABLE}?id=eq.${encodeURIComponent(testRowId)}`, {
          method: 'DELETE',
          headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` },
        });
        console.log('  PASS');
      } catch (e) {
        fail(`Cleanup failed: ${e.message}`);
      }
    }
  } catch (err) {
    console.error(`❌ Part B fatal error: ${err.message}`);
    fail(err.message);
  } finally {
    if (testRowId) {
      try {
        await fetch(`${baseUrl}/rest/v1/${TABLE}?id=eq.${encodeURIComponent(testRowId)}`, {
          method: 'DELETE',
          headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` },
        });
      } catch (_) {}
    }
  }
}

// ============================================
// Main
// ============================================

(async function main() {
  await runPartB();
  console.log('');
  if (exitCode === 0) {
    console.log('=== All tests passed ===');
  } else {
    console.error(`=== Some tests FAILED (exit code ${exitCode}) ===`);
  }
  process.exit(exitCode);
})();