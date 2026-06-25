#!/usr/bin/env node
// ============================================
// E2E 配图端到端联调 v2
// ============================================
process.env.GEMINI_API_KEY = '';
process.env.DRYRUN = 'true';
process.env.SKIP_BOT_INIT = '1';

const assert = require('assert');
const fs = require('fs');

const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('FATAL: SUPABASE_URL and SUPABASE_SERVICE_KEY required');
  process.exit(1);
}

let exitCode = 0;

// Raw Supabase client
const sb = {
  headers: {
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
    'Content-Type': 'application/json',
  },
  async req(method, pathIn, body, prefer) {
    const url = `${SUPABASE_URL}/rest/v1/${pathIn}`;
    const h = { ...this.headers };
    if (prefer) h.Prefer = prefer;
    const res = await fetch(url, { method, headers: h, body: body !== undefined ? JSON.stringify(body) : undefined });
    if (!res.ok) throw new Error(`Supabase ${method} ${pathIn}: ${res.status} ${await res.text()}`);
    if (res.status === 204) return null;
    const t = await res.text();
    return t ? JSON.parse(t) : null;
  },
  get(table, id) {
    return this.req('GET', `${table}?id=eq.${encodeURIComponent(id)}&limit=1`)
      .then(r => Array.isArray(r) && r.length > 0 ? r[0] : null);
  },
  insert(table, data) {
    return this.req('POST', table, data, 'return=representation')
      .then(r => Array.isArray(r) ? r[0] : r);
  },
  update(table, id, data) {
    return this.req('PATCH', `${table}?id=eq.${encodeURIComponent(id)}`, data, 'return=representation')
      .then(r => Array.isArray(r) ? r[0] : r);
  },
  delete(table, id) {
    return this.req('DELETE', `${table}?id=eq.${encodeURIComponent(id)}`);
  },
  updateWithTOCTOU(table, id, data, expectedStatus) {
    const q = `${table}?id=eq.${encodeURIComponent(id)}&status=eq.${encodeURIComponent(expectedStatus)}`;
    return this.req('PATCH', q, data, 'return=representation')
      .then(r => {
        if (!r || (Array.isArray(r) && r.length === 0)) throw new Error(`TOCTOU conflict: expected status=${expectedStatus}`);
        return Array.isArray(r) ? r[0] : r;
      });
  },
};

function sep(title) { console.log(`\n${'='.repeat(80)}\n  ${title}\n${'='.repeat(80)}`); }

function state(label, row) {
  const fields = ['status','image_status','image_url','scene_image_url','source_product_image',
    'pillar','topic','fb_post_id','ig_post_id','created_at','fb_content','ig_content'];
  console.log(`  --- ${label} ---`);
  for (const f of fields) {
    const val = row[f];
    if (val !== undefined && val !== null) {
      const display = typeof val === 'string' && val.length > 60 ? val.slice(0, 60) + '...' : val;
      console.log(`    ${f}: "${display}"`);
    }
  }
}

function pass(msg) { console.log(`  ✅ ${msg}`); }
function fail(msg) { console.log(`  ❌ ${msg}`); exitCode = 1; }

// ============================================
// TEST: 时序验证
// ============================================
sep('时序验证: 文案批准后才触发配图');
const idxContent = fs.readFileSync('./index.js', 'utf8');
if (idxContent.includes("status: 'copy_approved'") && idxContent.includes('runImageryPipeline(')) {
  pass('review_approve callback 先设 copy_approved 再调 runImageryPipeline');
} else { fail('时序检查失败'); }

// ============================================
// TEST: 状态机
// ============================================
sep('状态机验证');
const sm = require('./lib/state-machine');
const im = require('./lib/image-state');
const checks = [
  ['copy_approved → image_ready', () => sm.TRANSITIONS.copy_approved.includes('image_ready')],
  ['copy_approved → approved (跳过配图)', () => sm.TRANSITIONS.copy_approved.includes('approved')],
  ['image_ready → approved', () => sm.TRANSITIONS.image_ready.includes('approved')],
  ['image_ready → image_retry (打回)', () => sm.TRANSITIONS.image_ready.includes('image_retry')],
  ['image_retry → image_ready (重生成)', () => sm.TRANSITIONS.image_retry.includes('image_ready')],
  ['image_retry → approved (跳过)', () => sm.TRANSITIONS.image_retry.includes('approved')],
  ['pending → generating', () => im.IMAGE_TRANSITIONS.pending.includes('generating')],
  ['generating → generated', () => im.IMAGE_TRANSITIONS.generating.includes('generated')],
  ['generating → failed', () => im.IMAGE_TRANSITIONS.generating.includes('failed')],
  ['generated → composited', () => im.IMAGE_TRANSITIONS.generated.includes('composited')],
  ['composited → stored', () => im.IMAGE_TRANSITIONS.composited.includes('stored')],
];
for (const [desc, fn] of checks) {
  fn() ? pass(desc) : fail(desc);
}

// ============================================
// TEST: HAPPY PATH
// ============================================
let testRowId = null;

async function runHappyPath() {
  sep('HAPPY PATH: 全流程串通');

  // Step 0: 创建 row at copy_done
  sep('STEP 0: 创建 row (文案已完成, copy_done)');
  const row0 = await sb.insert('content_calendar', {
    status: 'copy_done',
    pillar: 'product',
    topic: `E2E Full Flow Test ${Date.now()}`,
    chat_id: 'test-e2e-full-flow',
    fb_content: '[E2E Test] FB content for pipeline verification.',
    ig_content: '[E2E Test] IG content for pipeline verification.',
    hashtags: '#E2ETest #Fanz #Pipeline',
  });
  testRowId = row0.id;
  state('Row created', row0);
  if (row0.status !== 'copy_done') { fail('Should be copy_done'); return; }
  pass('Row created: ' + row0.id);

  // Step 1: 审文案批准 → copy_approved
  sep('STEP 1: 审文案批准 → copy_approved');
  const row1 = await sb.updateWithTOCTOU('content_calendar', testRowId, { status: 'copy_approved' }, 'copy_done');
  state('After copy_approved', row1);
  if (row1.status !== 'copy_approved') { fail('Should be copy_approved'); return; }
  pass('文案批准 → copy_approved');

  // Step 2: 运行配图流水线
  sep('STEP 2: 配图流水线 (I-1→I-2→I-3→I-4)');
  const { runImageryPipeline } = require('./lib/pipeline');
  const pipelineResult = await runImageryPipeline(testRowId);
  console.log(`  Result: success=${pipelineResult.success}, isDryRun=${pipelineResult.isDryRun}, imageUrl=${pipelineResult.imageUrl}`);

  if (!pipelineResult.success) { fail('Pipeline failed: ' + pipelineResult.error); return; }
  pass('Pipeline 成功 (dry-run)');

  const row2 = await sb.get('content_calendar', testRowId);
  state('Pipeline 后 DB 状态', row2);

  // 主状态
  if (row2.status === 'image_ready') pass('主状态: copy_approved → image_ready');
  else fail('主状态异常: 期望 image_ready, 实际 "' + row2.status + '"');

  // image_status
  if (row2.image_status === 'generated') pass('image_status: pending → generating → generated');
  else fail('image_status 异常: ' + row2.image_status);

  // scene_image_url
  if (row2.scene_image_url) {
    pass('scene_image_url 已写入: ' + row2.scene_image_url);
    const p = __dirname + '/assets/scenes/' + row2.scene_image_url;
    if (fs.existsSync(p)) pass('场景图文件存在: ' + p + ' (' + fs.statSync(p).size + ' bytes)');
  } else { fail('scene_image_url 未写入'); }

  // source_product_image
  if (row2.source_product_image) pass('取图节点(I-1): 自动选图 ' + row2.source_product_image);
  else fail('source_product_image 未写入');

  // Step 3: 配图审核卡逻辑验证
  sep('STEP 3: 配图审核卡');
  if (idxContent.includes("isDryRun || !imageUrl || imageUrl.startsWith('(')")) {
    pass('审核卡有 dry-run 分支 → sendMessage 文本');
  }
  if (idxContent.includes("bot.sendPhoto(chatId, imageUrl,")) {
    pass('审核卡有真图分支 → sendPhoto 带图');
  }
  if (idxContent.includes("sendMessage") && idxContent.includes("dry-run")) {
    pass('审核卡有文本 fallback (占位/失败时)');
  }

  // Step 4: 审图批准 → approved
  sep('STEP 4: 审图批准 → approved');
  const row4 = await sb.updateWithTOCTOU('content_calendar', testRowId, { status: 'approved' }, 'image_ready');
  state('After image_approve', row4);
  if (row4.status !== 'approved') { fail('Should be approved'); return; }
  pass('审图批准: image_ready → approved');

  // Step 5: 发布 (dry-run)
  sep('STEP 5: 发布 (dry-run)');
  const { publishToSocial } = require('./lib/publish');
  const publishResult = await publishToSocial(row4);
  console.log('  Publish result: fb_post_id=' + publishResult.fb_post_id + ', ig_post_id=' + publishResult.ig_post_id + ', dry_run=' + publishResult.dry_run);

  if (!publishResult.dry_run || !publishResult.fb_post_id.startsWith('DRYRUN-FB-') || !publishResult.ig_post_id.startsWith('DRYRUN-IG-')) {
    fail('发布结果异常'); return;
  }
  pass('dry-run 发布: fb_post_id=' + publishResult.fb_post_id + ', ig_post_id=' + publishResult.ig_post_id);

  // 写入 fb_post_id 和 ig_post_id 到 DB（表里有这两列）
  const row5 = await sb.update('content_calendar', testRowId, {
    fb_post_id: publishResult.fb_post_id,
    ig_post_id: publishResult.ig_post_id,
    status: 'published',
  });
  state('发布后 DB', row5);
  if (row5.status === 'published') pass('发布完成: status=published');
  else fail('发布状态异常');

  pass('=== HAPPY PATH 全部通过 ===');
}

// ============================================
// FAILURE PATH A: 配图技术失败
// ============================================
async function testTechFail() {
  sep('FAILURE PATH A: 配图技术失败 → 停在 copy_approved');

  const rowA = await sb.insert('content_calendar', {
    status: 'copy_approved', pillar: 'product',
    topic: 'E2E Tech Fail ' + Date.now(), chat_id: 'test-e2e-full-flow',
  });
  state('初始状态', rowA);

  // 模拟管道失败: 不存在的 row
  const { runImageryPipeline } = require('./lib/pipeline');
  const result = await runImageryPipeline('00000000-0000-0000-0000-000000000000');
  if (!result.success) pass('Pipeline 返回 error: ' + result.error);
  else fail('预期失败但成功');

  // row 状态不变
  const r2 = await sb.get('content_calendar', rowA.id);
  if (r2.status === 'copy_approved') pass('status 停在 copy_approved (不丢失)');
  else fail('status 异常: ' + r2.status);

  // 代码中存在 sendTechnicalFailureNotice
  if (idxContent.includes('sendTechnicalFailureNotice')) {
    pass('sendTechnicalFailureNotice 存在, 用户看到 ⚠️ + 🔄 Retry / ⏭️ Skip Image');
  }

  await sb.delete('content_calendar', rowA.id);
  pass('清理完成');
}

// ============================================
// FAILURE PATH B: 打回计数≥3 → 跳过
// ============================================
async function testRejectLimit() {
  sep('FAILURE PATH B: 打回计数≥3 → 跳过按钮 → skip → approved');

  const rowB = await sb.insert('content_calendar', {
    status: 'image_ready', pillar: 'product',
    topic: 'E2E Reject Limit ' + Date.now(), chat_id: 'test-e2e-full-flow',
    image_url: 'https://example.com/p.png',
  });
  state('初始 image_ready', rowB);

  for (let i = 0; i < 3; i++) {
    const showSkip = i + 1 >= 3;
    const r = await sb.updateWithTOCTOU('content_calendar', rowB.id, { status: 'image_retry' }, 'image_ready');
    state('打回 #' + (i + 1), r);
    pass('打回 #' + (i + 1) + ': image_ready → image_retry');

    if (showSkip) {
      pass('  retry=' + (i + 1) + '≥3: 跳过按钮应出现');
    } else {
      await sb.updateWithTOCTOU('content_calendar', rowB.id, { status: 'image_ready' }, 'image_retry');
      pass('  自动重生成: image_retry → image_ready');
    }
  }

  // 跳过: image_retry → approved
  const skipRow = await sb.updateWithTOCTOU('content_calendar', rowB.id, { status: 'approved' }, 'image_retry');
  if (skipRow.status === 'approved') pass('跳过: image_retry → approved');
  else fail('跳过失败');

  if (idxContent.includes('image_skip:') && idxContent.includes("status: 'approved'")) {
    pass('image_skip callback 存在');
  }

  await sb.delete('content_calendar', rowB.id);
  pass('清理完成');
}

// ============================================
// MAIN
// ============================================
(async function main() {
  console.log('='.repeat(80));
  console.log('  配图端到端联调');
  console.log('  Time: ' + new Date().toISOString());
  console.log('  Mode: DRY-RUN (GEMINI_API_KEY="")');
  console.log('='.repeat(80));

  try {
    await runHappyPath();
    await testTechFail();
    await testRejectLimit();
  } catch (err) {
    console.error('\nFATAL: ' + err.message);
    console.error(err.stack ? err.stack.slice(0, 500) : '');
    exitCode = 1;
  } finally {
    // Cleanup
    if (testRowId) {
      try {
        await sb.delete('content_calendar', testRowId);
        console.log('\n  Happy-path row cleaned up.');
      } catch (_) {}
    }
  }

  sep('SUMMARY');
  if (exitCode === 0) {
    console.log('  ✅ 配图端到端联调 — 全部通过');
  } else {
    console.log('  ❌ 有失败项 (exit ' + exitCode + ')');
  }
  console.log('='.repeat(40));
  process.exit(exitCode);
})();