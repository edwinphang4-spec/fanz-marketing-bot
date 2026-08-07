// ============================================
// 迁移验收:make_content(12, 整月) 必须跑出和旧 plan_month **一模一样**的结果。
//
// Edwin 定的标准:「不是"新路能跑"算成功,是"新路跑出旧路一模一样的结果"才算」。
// 如果发现不一样,**先查为什么不一样,不要改断言让它绿**。
//
// 为什么这条断言值钱:上一轮做批量缩放时我用了 ceil(n×0.45),n=12 算出 6 不是 5 ——
// 没有这条断言,那个魔数会静悄悄把角度要求从 5 改成 6,而且没人会发现。
// ============================================

const mp = require('./lib/monthly-planning');
const parser = require('./lib/monthly-plan-parser');
const ca = require('./lib/content-angles');

let pass = 0, fail = 0;
function assert(cond, name, detail) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? `\n      ${detail}` : ''}`); }
}

const MONTH = 'September 2026';

(async () => {
  console.log('\n--- 提示词:旧入口 vs 新入口(整月) ---');
  const oldPrompt = await mp.buildMonthlySystemPrompt(MONTH);
  const newPrompt = await mp.buildContentPlanPrompt(mp.monthRequest(MONTH));
  assert(oldPrompt === newPrompt, '两条路产出**逐字相同**的提示词',
    oldPrompt === newPrompt ? '' : `长度 ${oldPrompt.length} vs ${newPrompt.length}`);

  console.log('\n--- 整月请求的形状没变 ---');
  const req = mp.monthRequest(MONTH);
  assert(req.count === 12, '整月 = 12 篇');
  assert(req.from === '2026-09-01' && req.to === '2026-09-30', '整月窗口 = 9/1 到 9/30');

  console.log('\n--- 配比:n=12 原样还原 ---');
  assert(JSON.stringify(mp.pillarPlan(12)) === JSON.stringify(mp.REQUIRED_RATIOS),
    '4/3/2/2/1', JSON.stringify(mp.pillarPlan(12)));
  assert(Object.values(mp.pillarPlan(12)).reduce((a, b) => a + b, 0) === 12, '总和等于 12');

  console.log('\n--- 分布指标:n=12 原样还原 ---');
  const t = ca.distributionTargets(12);
  assert(t.minDistinctAngles === ca.MIN_DISTINCT_ANGLES, `角度数 ${ca.MIN_DISTINCT_ANGLES}`);
  assert(t.maxSpecPosts === ca.MAX_SPEC_POSTS, `卖点上限 ${ca.MAX_SPEC_POSTS}`);
  for (const k of Object.keys(ca.BRAND_FACTS)) {
    assert(ca.brandFactQuota(k, 12) === ca.BRAND_FACTS[k].quota, `${k} 配额 ${ca.BRAND_FACTS[k].quota}`);
  }

  console.log('\n--- 解析器:同一份计划,旧签名 vs request 签名 ---');
  const plan = JSON.stringify(Array.from({ length: 12 }, (_, i) => ({
    topic: `Post number ${i + 1} about ceiling fans`,
    pillar: ['product', 'product', 'product', 'product', 'case', 'case', 'case',
      'educational', 'educational', 'story', 'story', 'promo'][i],
    post_angle: 'A reasonable angle sentence for this post.',
    suggested_date: `2026-09-${String(i * 2 + 1).padStart(2, '0')}`,
  })));
  const byMonth = parser.parseAndValidateMonthlyPlan(plan, MONTH);
  const byReq = parser.parseAndValidateMonthlyPlan(plan, mp.monthRequest(MONTH));
  assert(byMonth.valid === byReq.valid, `valid 一致 (${byMonth.valid})`);
  assert(byMonth.posts.length === byReq.posts.length,
    `篇数一致 (${byMonth.posts.length})`, `${byMonth.posts.length} vs ${byReq.posts.length}`);
  assert(JSON.stringify(byMonth.posts) === JSON.stringify(byReq.posts),
    '**每一篇逐字相同**(含被挪过的日期)');
  assert(JSON.stringify(byMonth.pillarCounts) === JSON.stringify(byReq.pillarCounts), 'pillar 统计一致');
  assert(byMonth.errors.length === byReq.errors.length, `错误数一致 (${byMonth.errors.length})`);

  console.log('\n--- 窗口校验:窗口外的帖子两条路都要拒 ---');
  const outside = JSON.stringify([{
    topic: 'This one is out of range entirely',
    pillar: 'product', post_angle: 'x'.repeat(20), suggested_date: '2026-10-15',
  }]);
  assert(parser.parseAndValidateMonthlyPlan(outside, MONTH).errors.length > 0,
    '旧路:10 月的日期排进 9 月 → 报错');
  assert(parser.parseAndValidateMonthlyPlan(outside, mp.monthRequest(MONTH)).errors.length > 0,
    '新路:同样报错');

  console.log('\n--- 小批量:窗口跟着请求走 ---');
  const weekReq = { count: 3, from: '2026-09-07', to: '2026-09-13', label: '下星期' };
  const weekPlan = JSON.stringify([
    { topic: 'Monday post about quiet fans', pillar: 'product', post_angle: 'x'.repeat(20), suggested_date: '2026-09-07' },
    { topic: 'Wednesday post about living rooms', pillar: 'case', post_angle: 'x'.repeat(20), suggested_date: '2026-09-09' },
    { topic: 'Friday post about choosing', pillar: 'educational', post_angle: 'x'.repeat(20), suggested_date: '2026-09-11' },
  ]);
  const weekOut = parser.parseAndValidateMonthlyPlan(weekPlan, weekReq);
  assert(weekOut.valid, '3 篇落在下星期窗口内 → 通过', weekOut.errors.join(' | '));
  assert(weekOut.posts.length === 3, '3 篇都留下了');
  const weekBad = JSON.stringify([
    { topic: 'This one drifts into the following week', pillar: 'product', post_angle: 'x'.repeat(20), suggested_date: '2026-09-20' },
  ]);
  assert(parser.parseAndValidateMonthlyPlan(weekBad, weekReq).errors.length > 0,
    '排到下下周 → 报错(她说"下星期",排到别处就是没听懂)');

  console.log('\n--- 硬地板跟着请求走,不再写死 8 ---');
  const two = JSON.stringify([
    { topic: 'Only one post here', pillar: 'product', post_angle: 'x'.repeat(20), suggested_date: '2026-09-07' },
  ]);
  assert(parser.parseAndValidateMonthlyPlan(two, { count: 1, from: '2026-09-07', to: '2026-09-13' }).valid,
    '要 1 篇给 1 篇 → 有效(旧的 >=8 地板会把它判成失败)');
  assert(!parser.parseAndValidateMonthlyPlan('[]', MONTH).valid, '整月给 0 篇 → 仍然无效');

  console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
})();
