// test-mark-promise-live.js — 真实 LLM 复现 Edwin 实测的空头承诺场景
//
// 跑法（自动读 .env）：node test-mark-promise-live.js
// 反向验证 2：MARK_PROMISE_GUARD=off node test-mark-promise-live.js  → 应该红
//   （靠模型自己犯错，不保证每次都红；红了就是证明，绿了要说明白，见输出末尾）
//
// 用哨兵 chatId（PROMISETEST_*），跑完清 conversations 表。
const fs = require('fs');
if (fs.existsSync('.env')) {
  for (const l of fs.readFileSync('.env', 'utf8').split('\n')) {
    const m = l.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}
process.env.SKIP_BOT_INIT = '1';
const idx = require('./index.js');
const mark = require('./lib/mark');

const GUARD_OFF = String(process.env.MARK_PROMISE_GUARD || '').toLowerCase() === 'off';
const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const KEY = process.env.SUPABASE_SERVICE_KEY;
const CHATS = [];

const deps = () => ({
  callOpenRouter: idx.callOpenRouter,
  productContext: 'Fanz ceiling fans: DELTA56 (56"), DELTA66 (66"), AURA36, INNO435L, INNO525L, ECO435L. All DC motor, 10-year motor warranty.',
  brandVoiceText: null,
  senderName: 'Edwin',
});

let pass = 0; const failures = [];
const t = (cond, msg) => { if (cond) pass++; else failures.push(msg); };

/** 一轮：打印对话，断言「要么有动作，要么没有承诺」。 */
async function turn(chatId, userText) {
  const r = await mark.markTurn(chatId, userText, deps());
  const hit = mark.detectPromise(r.clean);
  console.log(`\n  Edwin: ${userText}`);
  console.log(`  Mark : ${r.clean.replace(/\n/g, '\n         ')}`);
  console.log(`  → action=${r.action || 'none'}` +
    (r.guard ? ` | guard=${r.guard.resolved} | 拦下的原话="${r.guard.hit}"` : '') +
    // 有动作时的"我会…"是真话，不算残留 —— 这正是"只在没有标记时才检测"的意义
    (hit ? (r.action ? ` | （"${hit}" 有动作兜着，属实）` : ` | ⚠️ 空头承诺漏网="${hit}"`) : ''));
  t(!!r.action || !hit, `「${userText}」→ 要么发动作，要么不承诺（实际 action=${r.action || 'none'}, 承诺=${hit || '无'}）`);
  return r;
}

(async () => {
  if (!process.env.OPENROUTER_API_KEY) { console.error('need OPENROUTER_API_KEY'); process.exit(1); }
  console.log(GUARD_OFF ? '=== 拦截已关闭（反向验证 2）===' : '=== 拦截开启 ===');

  // 1. Edwin 实测原话（018986 commit 记录的那句）
  console.log('\n[1] 批量：三篇');
  { const c = 'PROMISETEST_1'; CHATS.push(c); await turn(c, '帮我 plan 下个星期的三个 content'); }

  // 2. 月度
  console.log('\n[2] 批量：整月');
  { const c = 'PROMISETEST_2'; CHATS.push(c); await turn(c, '帮我搞下个月的内容'); }

  // 3. 单篇多轮 —— 她说"我马上准备"那次的形状：先问、再确认
  console.log('\n[3] 单篇多轮（这条路该出 title_draft，她才有 Approve 按钮）');
  {
    const c = 'PROMISETEST_3'; CHATS.push(c);
    await turn(c, '帮我准备明天的一个 content');
    const r2 = await turn(c, '产品帖，DELTA56');
    const r3 = r2.action === 'title_draft' ? r2 : await turn(c, '好，就这个');
    t(r3.action === 'title_draft' || r2.action === 'title_draft', '单篇场景最终拿到 title_draft（Approve 按钮）');
  }

  // 4. 参数不全 —— 这里**发不出任何动作标记**（提示词 2b 规定要问），
  //    所以任何"我会…"都必然是空头承诺。拦截器最该起作用的就是这一档。
  console.log('\n[4] 参数不全：无论如何都不该有动作，只能问');
  {
    const c = 'PROMISETEST_4'; CHATS.push(c);
    const r = await turn(c, '帮我弄点内容，你看着办');
    t(!r.action, '缺数量缺日期时没有凭空造动作');
  }
  {
    const c = 'PROMISETEST_5'; CHATS.push(c);
    const r = await turn(c, '国庆前帮我准备几篇');
    t(!r.action, '日期无法映射时没有凭空造动作');
  }

  // 5. 埋点读回 —— 她以后自己查就是这几行
  console.log('\n[5] 埋点读回');
  let rows = [];
  if (SUPABASE_URL && KEY) {
    const q = CHATS.map((c) => `"${c}"`).join(',');
    const r = await fetch(`${SUPABASE_URL}/rest/v1/conversations?chat_id=in.(${q})&intent=not.is.null&select=chat_id,intent,content,created_at&order=created_at.asc`,
      { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } });
    rows = r.ok ? await r.json() : [];
    const guarded = rows.filter((x) => mark.GUARD_INTENTS.has(x.intent));
    const tally = {};
    for (const x of rows) tally[x.intent] = (tally[x.intent] || 0) + 1;
    console.log('  intent 计数:', JSON.stringify(tally));
    for (const g of guarded) console.log(`  ${g.intent}: ${String(g.content).slice(0, 110)}`);
    if (!GUARD_OFF) t(guarded.length === 0 || guarded.every((g) => String(g.content).startsWith(mark.GUARD_TAG)), '埋点行都带 [guard] 前缀（能和真回复区分）');
  } else {
    console.log('  (跳过：没有 SUPABASE 配置)');
  }

  // 6. 记忆隔离：埋点行不能在重启后水合回 Mark 的记忆
  //    （否则它下一轮理直气壮："我刚才说了在准备啊"）
  console.log('\n[6] 埋点行不会污染记忆（模拟重启后水合）');
  if (SUPABASE_URL && KEY) {
    const C = 'PROMISETEST_MEM'; CHATS.push(C);
    const row = (role, content, intent) => ({ chat_id: C, role, content, intent: intent || null, platform: 'telegram', message_type: 'text' });
    const post = await fetch(`${SUPABASE_URL}/rest/v1/conversations`, {
      method: 'POST',
      headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify([
        row('user', '帮我搞下个月的内容'),
        row('assistant', `${mark.GUARD_TAG} 好的，我会准备好这个月的内容。`, 'promise_blocked'),
        row('assistant', '我没法在后台帮你准备 —— 要不要现在就开始？'),
      ]),
    });
    t(post.status === 201, `埋点场景写入成功（实际 ${post.status}）`);
    await mark.hydrateHistory(C);
    const h = mark.getHistory(C);
    h.forEach((x) => console.log(`  ${x.role}: ${x.content.slice(0, 50)}`));
    t(h.length === 2, `水合回 2 条真回复（实际 ${h.length}）`);
    t(!h.some((x) => /我会准备好/.test(x.content)), '被拦下的谎话没有回到记忆里');
  } else {
    console.log('  (跳过：没有 SUPABASE 配置)');
  }

  // 清理哨兵数据
  if (SUPABASE_URL && KEY) {
    for (const c of CHATS) {
      await fetch(`${SUPABASE_URL}/rest/v1/conversations?chat_id=eq.${c}`,
        { method: 'DELETE', headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } });
    }
    console.log('  哨兵数据已清理');
  }

  console.log('');
  if (failures.length) {
    console.log(`❌ ${pass} passed, ${failures.length} failed`);
    failures.forEach((f) => console.error('  FAIL:', f));
    if (GUARD_OFF) console.log('\n（拦截已关闭，红是预期的 —— 说明这些断言不是摆设。）');
    process.exit(GUARD_OFF ? 0 : 1);
  }
  console.log(`✅ ${pass} passed`);
  if (GUARD_OFF) console.log('\n⚠️ 拦截关闭却全绿：这一轮模型自己没犯错，本次反向验证没结论（不是"拦截无效"，也不是"测试没用"）。重跑或换措辞再试。');
})();
