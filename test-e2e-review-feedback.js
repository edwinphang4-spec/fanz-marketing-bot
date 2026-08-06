// ============================================
// 「带意见重写」全链干测 —— 真 DB + 真文案生成，**不出图**。
//
// 2026-08-06 走查发现的缺口:她在 Dashboard 点 Request Changes、写了意见,
// 意见存进 review_notes 之后就没了下文 —— Dashboard 里没有任何按钮能触发重写,
// 帖子停在 copy_done,而出图要求"没有 copy_done 剩下"→ **驳回一篇卡死整月**,
// 她还不知道为什么。
//
// 这里验 Edwin 点名的四条:
//   ① Dashboard 驳回 → 填意见 → 能触发重写
//   ② 重写是"改这一版"而不是"从零再写"
//   ③ 连驳两次,第二次模型能看到两条意见
//   ④ 驳回后整月不卡死
//
// Dashboard 那一半跑的是**真的 route 文件**(只把 '@/…' 路径别名改成相对路径,
// 逻辑一个字没动)—— 自己复刻一遍分支逻辑的话,验的就不是线上那份代码了。
//
// 跑法: node --env-file=.env test-e2e-review-feedback.js
// 花费: 2 次 gpt-4o 文本调用,无出图。跑完自动删干净。
// ============================================

const fs = require('fs');
const os = require('os');
const path = require('path');
const supabase = require('./lib/supabase');
const notes = require('./lib/review-notes');
const { buildCopywritingPrompt } = require('./lib/copywriting');
const worker = require('./lib/worker');

const DASH = '/Users/mryew/Projects/fanz-dashboard';

let pass = 0, fail = 0;
function assert(cond, name, detail) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? `\n      ${detail}` : ''}`); }
}

/** 载入 Dashboard 真实的 review route（只改路径别名，逻辑原样） */
async function loadReviewRoute() {
  const src = fs.readFileSync(path.join(DASH, 'app/api/marketing/review/route.js'), 'utf8')
    .replace("@/app/lib/supabase", path.join(DASH, 'app/lib/supabase.js'))
    // node 直接跑 ESM 时解析不到 'next/server' 的 exports 映射,指到实体文件
    .replace("from 'next/server'", "from 'next/server.js'");
  // 临时文件必须落在 Dashboard 目录里 —— 放 /tmp 的话 'next' 解析不到
  const tmp = path.join(DASH, `.review-route-${Date.now()}.mjs`);
  fs.writeFileSync(tmp, src);
  try {
    const mod = await import(tmp);
    return mod.POST;
  } finally {
    try { fs.unlinkSync(tmp); } catch (_) {}   // 无论成败都别把临时文件留在别人仓库里
  }
}

async function callOpenRouter(messages, maxTokens = 1200) {
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: process.env.MODEL || 'gpt-4o', messages, max_tokens: maxTokens, temperature: 0.7 }),
  });
  if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${await res.text()}`);
  return (await res.json()).choices[0].message.content;
}

const reject = (POST, id, review_notes, action = 'reject') =>
  POST(new Request('http://localhost/api/marketing/review', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, action, review_notes }),
  }));

(async () => {
  let rowId = null, skipId = null;
  try {
    // ── 意见账本(纯函数,先单独验) ──
    console.log('\n--- 意见累积账本 ---');
    let acc = notes.appendNote('', '太长了');
    acc = notes.appendNote(acc, '别提保修');
    assert(notes.noteCount(acc) === 2, '两条意见都在(追加不是覆盖)');
    assert(/\[#1 /.test(acc) && /\[#2 /.test(acc), '带序号');
    assert(/后面的|LATER note wins/i.test(notes.formatForPrompt(acc)), '提示词说明后面的优先于前面的');
    let five = ''; for (let i = 0; i < 5; i++) five = notes.appendNote(five, `意见${i}`);
    assert(notes.atLimit(five), '累到 5 条触发上限');
    assert(!notes.atLimit(acc), '2 条不触发上限');
    assert(notes.parseNotes('[scene] warm evening room').length === 0,
      '配图的动作标记不会被当成文案意见(两套东西共用一列)');

    // ── 建一篇待审的帖子 ──
    const POST = await loadReviewRoute();
    const row = await supabase.createContentCalendar({
      chat_id: 'drytest-fb', pillar: 'product',
      topic: 'The DELTA56 in a Malaysian living room',
      status: 'selected', source_product_image: 'DELTA56 Pinewood',
    });
    rowId = row.id;
    const ORIGINAL = 'Looking for a fan that fits a big living room? The DELTA56 Pinewood spans 56 inches '
      + 'and moves 9,750 CFM, so the air actually reaches the far corner. Its warm pinewood finish sits '
      + 'quietly against neutral walls. Drop us a DM to see it in your space.';
    await supabase.updateContentCalendar(rowId, { fb_content: ORIGINAL, ig_content: ORIGINAL, status: 'copy_done' });

    console.log('\n--- ① Dashboard 驳回 → 意见落库 + 能被认领 ---');
    let res = await reject(POST, rowId, '太长了，砍掉一半');
    assert(res.status === 200, `Dashboard 驳回 API 返回 200`, `实际 ${res.status}`);
    let after = await supabase.getContentCalendar(rowId);
    assert(after.status === 'rejected', `状态进入可被 worker 认领的 rejected → ${after.status}`);
    assert(notes.noteCount(after.review_notes) === 1, '意见记了 1 条');

    console.log('\n--- ④ 这时整月不该被卡死 ---');
    // start-imagery 的判据:active = 非 rejected;有 copy_done 就拒绝开工
    const monthRows = [{ status: 'rejected' }, { status: 'copy_approved' }, { status: 'copy_approved' }];
    const active = monthRows.filter((r) => r.status !== 'rejected');
    assert(active.filter((r) => r.status === 'copy_done').length === 0,
      '被驳回的那篇不再算作"待审",出图不会被它挡住');
    assert(active.filter((r) => r.status === 'copy_approved').length === 2, '其余两篇照常可以出图');

    console.log('\n--- ② worker 认领 → 带意见重写(真调 LLM) ---');
    worker.start({
      sendMessage: async () => {},
      sendPhoto: async () => {},
      rewriteCopy: async (r) => {
        const { generateCopy } = require('./lib/generate-copy');
        const { parsed } = await generateCopy({
          row: r, topic: r.topic, pillar: r.pillar,
          reviewNotes: (r.review_notes || '').trim() || null,
          previousVersion: r.fb_content, callLLM: callOpenRouter,
        });
        await supabase.updateContentCalendar(r.id, {
          fb_content: parsed.fb_content, ig_content: parsed.ig_content,
          hashtags: parsed.hashtags, status: 'copy_done',
        });
        return { ok: true };
      },
    });
    await worker.processCopyRewrites();
    worker.stop();

    after = await supabase.getContentCalendar(rowId);
    assert(after.status === 'copy_done', `重写完回到待审队列 → ${after.status}`);
    assert(after.fb_content !== ORIGINAL, '正文确实变了');
    assert(after.fb_content.length < ORIGINAL.length, '按"太长了"改短了',
      `原 ${ORIGINAL.length} 字 → 新 ${after.fb_content.length} 字`);
    assert(/DELTA56/i.test(after.fb_content), '她没抱怨的部分(型号)保留了 —— 是改这一版,不是从零再写');
    assert(notes.noteCount(after.review_notes) === 1, '意见没被清掉(批准时才清)');
    console.log(`      新版本: ${after.fb_content.slice(0, 150)}…`);

    console.log('\n--- ③ 再驳一次 → 模型看得到两条 ---');
    res = await reject(POST, rowId, '别提保修');
    after = await supabase.getContentCalendar(rowId);
    assert(res.status === 200 && after.status === 'rejected', '第二次驳回被接受');
    assert(notes.noteCount(after.review_notes) === 2, `两条意见都在 → ${notes.noteCount(after.review_notes)}`);
    const prompt = buildCopywritingPrompt(
      after.topic, after.pillar, after.review_notes, null, undefined, undefined, null, after.fb_content
    );
    assert(/太长了/.test(prompt) && /别提保修/.test(prompt), '两条意见都进了提示词');
    assert(/THE VERSION SHE IS LOOKING AT/.test(prompt), '上一版正文进了提示词');
    assert(/EDIT THAT VERSION/.test(prompt), '明确要求改这一版而不是重写');
    assert(prompt.includes(after.fb_content.slice(0, 60)), '提示词里的"上一版"就是她正在看的那一版');

    console.log('\n--- 跳过这篇:不重写,也不卡住整月 ---');
    const s = await supabase.createContentCalendar({
      chat_id: 'drytest-fb', pillar: 'product', topic: 'Skip me', status: 'selected',
    });
    skipId = s.id;
    await supabase.updateContentCalendar(skipId, { fb_content: 'x', status: 'copy_done' });
    await reject(POST, skipId, '不要这篇', 'skip');
    const sAfter = await supabase.getContentCalendar(skipId);
    assert(sAfter.status === 'rejected' && /^\[skip\]/.test(sAfter.review_notes || ''),
      '跳过的帖子标记成 [skip]');
    assert(notes.parseNotes(sAfter.review_notes).length === 0,
      '[skip] 不会被 worker 当成待重写的意见');
  } catch (err) {
    fail++;
    console.error('\n✗ 干测中断:', err.message, '\n', err.stack.split('\n').slice(1, 3).join('\n'));
  } finally {
    const { SUPABASE_URL: u, SUPABASE_SERVICE_KEY: k } = process.env;
    for (const id of [rowId, skipId].filter(Boolean)) {
      try {
        await fetch(`${u}/rest/v1/content_calendar?id=eq.${id}`, {
          method: 'DELETE', headers: { apikey: k, Authorization: `Bearer ${k}` },
        });
      } catch (e) { console.error(`⚠️ 干测行 ${id} 没删掉,手动清一下:`, e.message); }
    }
    console.log('\n(干测建的行已清)');
  }
  console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
})();
