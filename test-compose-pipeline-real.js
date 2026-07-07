// ============================================
// test-compose-pipeline-real.js — 合成管线真实链路验证
//
// 真实 OpenRouter（prompt 导出）+ 真实图像生成 + 真实 Storage 上传 +
// 真实 DB 划痕行。划痕计划 status='draft'（线上 worker 只吃
// in_production 计划和 image_retry 行，draft+copy_approved 安全）。
//
// 流程：建划痕 → 全链路生成 → 断言背景在云端/成品在云端/状态正确 →
//       （若 compose_spec 列已存在）改字 recomposeOnly，断言复用背景 →
//       清理划痕。
// 运行：source .env && node test-compose-pipeline-real.js
// ============================================

const supabase = require('./lib/supabase');
const plans = require('./lib/supabase-plans');
const { runImageryPipeline } = require('./lib/pipeline');

let pass = 0, fail = 0;
const t = (cond, msg) => { cond ? (pass++, console.log(`PASS: ${msg}`)) : (fail++, console.error(`FAIL: ${msg}`)); };

(async () => {
  if (!process.env.OPENAI_API_KEY || !process.env.SUPABASE_URL) {
    console.error('need real keys — source .env first');
    process.exit(1);
  }

  let planId, rowId;
  try {
    // ── 划痕数据 ──
    const plan = await plans.createContentPlan({
      month: 'SCRATCH compose-test',
      status: 'draft',
      chat_id: 999999999, // 测试占位，非真实 chat；管线不发 Telegram
    });
    planId = plan.id;
    const row = await supabase.createContentCalendar({
      plan_id: planId,
      topic: 'Beat the Malaysian heat in style',
      pillar: 'product',
      fb_content:
        'The afternoon heat is no joke lately. A good ceiling fan keeps your ' +
        'living room cool and your electricity bill happy — no aircon guilt. ' +
        'Our Grande L Series moves serious air quietly, so the whole family ' +
        'can nap, work or lepak in comfort.',
    });
    rowId = row.id;
    // 代码层状态机不允许直接建 copy_approved —— 测试划痕用 REST 直写
    // （DB CHECK 允许该值；这正是 Dashboard 审批后的真实状态）
    const patch = await fetch(`${process.env.SUPABASE_URL}/rest/v1/content_calendar?id=eq.${rowId}`, {
      method: 'PATCH',
      headers: {
        apikey: process.env.SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ status: 'copy_approved' }),
    });
    if (!patch.ok) throw new Error(`scratch status patch failed: HTTP ${patch.status}`);
    console.log(`scratch plan ${planId.slice(0, 8)} row ${rowId.slice(0, 8)}`);

    // ── 全链路真实生成 ──
    const started = Date.now();
    const result = await runImageryPipeline(rowId);
    const secs = Math.round((Date.now() - started) / 1000);
    t(result.success === true, `pipeline succeeded in ${secs}s (${result.error || 'ok'})`);
    t(!result.isDryRun, 'not a dry run (real image API used)');

    const after = await supabase.getContentCalendar(rowId);
    t(after.status === 'image_ready', `status image_ready (got ${after.status})`);
    t(after.image_status === 'generated', `image_status generated (got ${after.image_status})`);
    t(/^https:\/\/.+backgrounds\//.test(after.scene_image_url || ''),
      `background stored in cloud (${(after.scene_image_url || '').slice(0, 80)})`);
    t(/^https:\/\//.test(after.image_url || ''), `final image URL set`);

    // 背景与成品都真实可访问
    for (const [name, url] of [['background', after.scene_image_url], ['final', after.image_url]]) {
      const r = url ? await fetch(url, { method: 'HEAD' }) : { ok: false, status: 'no-url' };
      t(r.ok, `${name} image publicly accessible (HTTP ${r.status})`);
    }

    // 成品下载留档供目检
    if (after.image_url) {
      const img = await fetch(after.image_url);
      require('fs').writeFileSync('/tmp/compose-test/real-final.png', Buffer.from(await img.arrayBuffer()));
      console.log('final image saved to /tmp/compose-test/real-final.png');
    }

    // ── recompose（仅当 compose_spec 列已迁移）──
    const specSaved = after.compose_spec != null;
    if (specSaved) {
      // 模拟 Dashboard edit_compose：改字 + [recompose]
      await supabase.updateContentCalendar(rowId, {
        compose_spec: {
          ...after.compose_spec,
          texts: { title: 'Recompose test title', cta: 'Edited via test' },
        },
      });
      const started2 = Date.now();
      const r2 = await runImageryPipeline(rowId, { recomposeOnly: true, fresh: true });
      const secs2 = Math.round((Date.now() - started2) / 1000);
      t(r2.success === true, `recompose succeeded in ${secs2}s (${r2.error || 'ok'})`);
      const after2 = await supabase.getContentCalendar(rowId);
      t(after2.scene_image_url === after.scene_image_url,
        'recompose reused the same background (no AI call)');
      t(after2.image_url !== after.image_url, 'recompose produced a new final image');
      t(secs2 <= 30, `recompose is fast (${secs2}s, no generation)`);
      if (after2.image_url) {
        const img2 = await fetch(after2.image_url);
        require('fs').writeFileSync('/tmp/compose-test/real-recompose.png', Buffer.from(await img2.arrayBuffer()));
      }
    } else {
      console.log('SKIP: compose_spec column not migrated yet — recompose reuse untestable (falls back to regeneration by design)');
    }
  } finally {
    // ── 清理划痕（成品/背景文件留在 Storage，行删了就无引用，可忽略）──
    const del = async (table, id) => {
      const r = await fetch(`${process.env.SUPABASE_URL}/rest/v1/${table}?id=eq.${id}`, {
        method: 'DELETE',
        headers: {
          apikey: process.env.SUPABASE_SERVICE_KEY,
          Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
        },
      });
      if (!r.ok) console.error(`cleanup ${table} failed: HTTP ${r.status}`);
    };
    try { if (rowId) await del('content_calendar', rowId); } catch (e) { console.error('cleanup row:', e.message); }
    try { if (planId) await del('content_plans', planId); } catch (e) { console.error('cleanup plan:', e.message); }
    // verify cleanup
    try {
      const gone = rowId ? await supabase.getContentCalendar(rowId) : null;
      console.log('cleanup verified:', gone ? 'ROW STILL EXISTS' : 'scratch removed');
    } catch (_) { console.log('cleanup verified: scratch removed'); }
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(err => { console.error('FATAL:', err); process.exit(1); });
