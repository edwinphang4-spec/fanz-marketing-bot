// test-mark-promise.js — 空头承诺拦截：检测器单测 + 拦截链路（假 LLM，确定性）
//
// 不打网络、不打库、不花钱，每次结果一样。跑法：
//   node test-mark-promise.js
// 反向验证（确认测试真的能红）：
//   MARK_LIB=/tmp/mark-mutated.js node test-mark-promise.js   ← 故意删掉一条正则的副本
//   见文件末尾说明。
process.env.SUPABASE_URL = '';
process.env.SUPABASE_SERVICE_KEY = '';   // 让 logConversation 直接短路，测试不落库

const mark = require(process.env.MARK_LIB || './lib/mark');

let pass = 0; const failures = [];
const t = (cond, msg) => { if (cond) pass++; else failures.push(msg); };

// ── A. 检测器单测 ──────────────────────────────
// 正例：第一人称 + 将来 + 干活，且这一轮没有动作标记 → 必须检出
const PROMISES = [
  '我会继续跟进这几篇内容的准备和发布。',          // Edwin 实测原话 1
  '我会准备好这个月的内容。',                      // Edwin 实测原话 2
  '好的，我马上准备。',                            // Edwin 实测原话 3
  '好的，我这就去问 Fanz 的销售。',
  '接下来我会安排好排期。',
  '稍后我来整理一份完整的清单。',
  '让我来处理这几篇。',
  '整理好之后再发给你。',
  '我先弄好三篇产品帖。',
  '我晚点把文案写好。',
  "I'll get these ready for you.",
  'I will prepare the drafts tonight.',
  "I'm going to line up three posts.",
  'Leave it with me.',
  "I'll follow up on the schedule.",
  'Let me draft the copy and send it over.',
  "I'll keep you posted.",
  'Saya akan sediakan kandungan bulan ini.',
  'Nanti saya hantar draf kepada awak.',
  'Biar saya uruskan yang ini.',
];

// 负例：合法的将来时 —— 提议问句、建议语气、主语不是 Mark、能力陈述
const INNOCENT = [
  '要不要我现在就帮你排整个月？',
  '要几篇？什么时候发？',
  '我会建议先做产品帖，这个月产品线还没覆盖。',
  '我会说实话，这个主题偏窄。',
  '销售团队会跟你确认价格。',
  '我可以帮你排下个月的内容。',
  'DELTA 有 DELTA56 和 DELTA66，你想推哪个？',
  '我等你确认。',
  '我先问你一句：这批要几篇？',
  '这个月已经排了 12 篇。',
  "I'd suggest a product post for DELTA56.",
  "I'll need to know how many posts you want.",
  'Which dates do you mean — this week?',
  'Let me know how many you need.',
  'Nanti kita boleh bincang lagi.',
];

for (const s of PROMISES) t(mark.detectPromise(s), `应检出承诺：${s}`);
for (const s of INNOCENT) t(!mark.detectPromise(s), `不该误伤：${s}（检出「${mark.detectPromise(s)}」）`);

// 混合段落：承诺句要被摘出来，有用内容要留下
{
  const mixed = '这个月可以走三条线：DELTA56 产品帖、雨季静音教育帖、客户案例。我会准备好这三篇。';
  t(!!mark.detectPromise(mixed), '混合段落检出承诺');
  const kept = mark.stripPromises(mixed);
  t(/DELTA56/.test(kept), '兜底保留有用内容（三条线还在）');
  t(!mark.detectPromise(kept), '兜底删干净承诺句');
}

// ── B. 拦截链路（假 LLM，确定性）────────────────
const LIE = '好的，我会准备好这个月的内容。';
const DRAFT_MARKER = '||MARK||{"action":"title_draft","title":"DELTA56 静音实测","pillar":"product","product":"DELTA56","angle":"雨季夜里也能睡好","suggested_date":""}||END||';
const deps = (fn) => ({ callOpenRouter: fn, productContext: 'DELTA56, DELTA66, AURA36', brandVoiceText: null, senderName: 'Tester' });

(async () => {
  // B1 关键设计：有动作标记时不拦 —— 承诺是真的
  {
    const c = 'T_B1';
    const turn = await mark.markTurn(c, '帮我准备一篇 DELTA56 的', deps(async () => `${LIE}\n${DRAFT_MARKER}`));
    t(turn.action === 'title_draft', 'B1 带标记的承诺照常放行（action 保留）');
    t(!turn.guard, 'B1 带标记时拦截器完全没跑');
    t(/我会准备好/.test(turn.clean), 'B1 文字原样送出，没被改写');
    mark.__clear(c);
  }

  // B2 承诺 + 无标记 → 重生成一次，第二次给出标记 → 采纳
  {
    const c = 'T_B2';
    let n = 0;
    const turn = await mark.markTurn(c, '帮我准备一篇 DELTA56 的', deps(async () => (++n === 1 ? LIE : `好，先看这个角度。\n${DRAFT_MARKER}`)));
    t(n === 2, 'B2 只重生成一次');
    t(turn.action === 'title_draft', 'B2 重生成后拿到 title_draft（她能收到 Approve 按钮）');
    t(turn.guard && turn.guard.resolved === 'retry', 'B2 guard 记为 retry');
    t(!mark.detectPromise(turn.clean), 'B2 最终文字里没有承诺');
    const hist = mark.getHistory(c);
    t(!/我会准备好/.test(hist[hist.length - 1].content), 'B2 记忆里存的是最终版，不是被拦下的谎话');
    mark.__clear(c);
  }

  // B3 重生成还在承诺 → 兜底：删承诺句 + 明说做不到
  {
    const c = 'T_B3';
    let n = 0;
    const turn = await mark.markTurn(c, '帮我搞下个月的内容', deps(async () => { n++; return LIE; }));
    t(n === 2, 'B3 重生成一次后不再重试（不会无限循环）');
    t(turn.guard && turn.guard.resolved === 'fallback', 'B3 guard 记为 fallback');
    t(!mark.detectPromise(turn.clean), 'B3 兜底后没有承诺句');
    t(/没法在后台/.test(turn.clean), 'B3 兜底明说做不到（不是只问"要不要开始"）');
    t(turn.action === null, 'B3 兜底不会凭空造动作');
    const hist = mark.getHistory(c);
    t(!/我会准备好/.test(hist[hist.length - 1].content), 'B3 记忆里没留下承诺');
    mark.__clear(c);
  }

  // B4 英文兜底走英文
  {
    const c = 'T_B4';
    const turn = await mark.markTurn(c, 'plan next month for me', deps(async () => "Sure, I'll get these ready for you."));
    t(/background/.test(turn.clean), 'B4 英文对话给英文兜底');
    mark.__clear(c);
  }

  // B5 反向验证 2：关掉拦截，谎话原样送出 —— 证明上面几条不是摆设
  {
    const c = 'T_B5';
    process.env.MARK_PROMISE_GUARD = 'off';
    const turn = await mark.markTurn(c, '帮我搞下个月的内容', deps(async () => LIE));
    delete process.env.MARK_PROMISE_GUARD;
    t(/我会准备好/.test(turn.clean), 'B5 关掉拦截后谎话确实会送出（测试能变红）');
    t(!turn.guard, 'B5 关掉后 guard 不介入');
    mark.__clear(c);
  }

  // B6 埋点：只提议标题却没发 title_draft
  {
    t(mark.detectTitleProposal('标题：DELTA56 静音实测'), 'B6 识别「标题：」提案');
    t(mark.detectTitleProposal('可以叫「雨季夜里也能睡好」'), 'B6 识别引号里的标题');
    t(!mark.detectTitleProposal('要几篇？什么时候发？'), 'B6 纯提问不算标题提案');
  }

  console.log(failures.length ? `❌ ${pass} passed, ${failures.length} failed` : `✅ ${pass} passed`);
  if (failures.length) { failures.forEach((f) => console.error('  FAIL:', f)); process.exit(1); }
})();

// 反向验证 1（确认单测能红）：
//   sed 's#/\\\\bI.?ll\\\\b/i,##' lib/mark.js > /tmp/mark-mutated.js
//   MARK_LIB=/tmp/mark-mutated.js node test-mark-promise.js   → 应该红
