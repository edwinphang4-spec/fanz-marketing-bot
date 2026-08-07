// ============================================
// 「她要什么」的请求模型 + 批量缩放 —— 离线,不花钱。
//
// 2026-08-08:她说"帮我 plan 下个星期的三个 content",Mark 给了三个主题然后说
// "我会继续跟进" —— 数据库里什么都没有。不是要补一条"支持三篇"的命令
// (补命令永远补不完),是把所有说法收成同一个请求:{count, from, to, ...}。
//
// 两条铁律钉在这里:
//   ① 日期由**代码**算 —— 让模型算日期是我们栽过的地方(9/28 说国庆快到了)
//   ② 算完必须**显示** —— "下星期"本身有歧义(周一起还是周日起?今天周五算哪周?),
//      这种代码也算不准。显示比猜准更重要。
// ============================================

const cr = require('./lib/content-request');
const ca = require('./lib/content-angles');

let pass = 0, fail = 0;
function assert(cond, name, detail) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? `\n      ${detail}` : ''}`); }
}

// 固定"今天" = 2026-09-04(周五,马来西亚时间)。不固定的话这份测试每天结果都不同。
const NOW = Date.parse('2026-09-04T03:00:00Z');

console.log('\n--- 日期由代码算 ---');
const nw = cr.resolveWhen('next_week', NOW);
assert(nw.from === '2026-09-07' && nw.to === '2026-09-13',
  '下星期 = 9/7(周一) 到 9/13(周日)', JSON.stringify(nw));
const tw = cr.resolveWhen('this_week', NOW);
assert(tw.from === '2026-08-31' && tw.to === '2026-09-06',
  '这星期 = 8/31 到 9/6(周五当天落在本周内)', JSON.stringify(tw));
assert(cr.resolveWhen('this_month', NOW).from === '2026-09-01'
  && cr.resolveWhen('this_month', NOW).to === '2026-09-30', '这个月 = 9/1 到 9/30');
assert(cr.resolveWhen('next_month', NOW).from === '2026-10-01', '下个月 = 10/1 起');
assert(cr.resolveWhen('2026-09-20', NOW).from === '2026-09-20', '具体日期原样');
assert(cr.resolveWhen('2026-09-08..2026-09-14', NOW).to === '2026-09-14', '区间写法认得');

console.log('\n--- 认不出就返回 null,由调用方去问(不许猜) ---');
for (const bad of ['下星期', 'soon', '', null, '国庆前']) {
  if (cr.resolveWhen(bad, NOW) !== null) { fail++; console.log(`  ✗ "${bad}" 不该被猜成一个范围`); }
}
assert(['下星期', 'soon', '', null, '国庆前'].every((b) => cr.resolveWhen(b, NOW) === null),
  '认不出的说法一律 null —— 猜一个范围比问一句贵得多');

console.log('\n--- 跨年/跨月边界 ---');
const dec = Date.parse('2026-12-30T03:00:00Z');   // 周三
assert(cr.resolveWhen('next_month', dec).from === '2027-01-01', '12 月的下个月是 2027-01');
assert(cr.resolveWhen('next_week', dec).from === '2027-01-04', '跨年那周也算得对');
const sun = Date.parse('2026-09-06T03:00:00Z');   // 周日
assert(cr.resolveWhen('this_week', sun).from === '2026-08-31',
  '周日算作上一周的第 7 天(周一为一周之始)');

console.log('\n--- 歧义要标出来,调用方必须显示 ---');
assert(cr.resolveWhen('next_week', NOW).ambiguous === true, '"下星期"标为需显示');
assert(cr.resolveWhen('this_month', NOW).ambiguous === false, '"这个月"没有歧义');
const built = cr.buildRequest({ count: 3, when: 'next_week' }, NOW);
const desc = cr.describeRequest(built.request);
assert(/3 篇/.test(desc), '确认句写出数量(她说"几篇"我理解成 3、她以为 5 —— 只有写出来才拦得住)');
assert(/9月7日 到 9月13日/.test(desc), '确认句写出算出来的日期', desc);
assert(/下星期/.test(desc), '同时保留她说的原话,好对照');

console.log('\n--- 缺数量/缺日期都不替她填默认值 ---');
assert(cr.buildRequest({ when: 'next_week' }, NOW).need === 'count', '缺数量 → 去问她');
assert(cr.buildRequest({ count: 3, when: '国庆前' }, NOW).need === 'when', '缺日期 → 去问她');
assert(cr.buildRequest({ count: 999, when: 'next_week' }, NOW).request.count === 31,
  '数量上限兜底(一次几百篇是误解,不是需求)');

console.log('\n--- 批量缩放:n=12 必须原样还原成现在的行为 ---');
// Edwin 定的验收标准:不是"新路能跑"算成功,是"新路跑出旧路一模一样的结果"才算。
const t12 = ca.distributionTargets(12);
assert(t12.minDistinctAngles === ca.MIN_DISTINCT_ANGLES,
  `n=12 角度数还原成 ${ca.MIN_DISTINCT_ANGLES}`, JSON.stringify(t12));
assert(t12.maxSpecPosts === ca.MAX_SPEC_POSTS, `n=12 卖点上限还原成 ${ca.MAX_SPEC_POSTS}`);
for (const k of ['warranty', 'sirim', 'dc_motor']) {
  assert(ca.brandFactQuota(k, 12) === ca.BRAND_FACTS[k].quota,
    `n=12 ${k} 配额还原成 ${ca.BRAND_FACTS[k].quota}`);
}

console.log('\n--- 小批量:算得出来,而且不荒谬 ---');
const t3 = ca.distributionTargets(3);
assert(t3.minDistinctAngles === 2, '3 篇要 2 类角度(不能三胞胎,但也不可能要 5 类)');
assert(t3.minDistinctAngles <= 3, '要求的角度数不超过篇数 —— 否则永远满足不了');
assert(t3.maxSpecPosts === 1, '3 篇最多 1 篇卖点帖');
assert(['warranty', 'sirim', 'dc_motor'].every((k) => ca.brandFactQuota(k, 3) === 0),
  '3 篇一条品牌事实都不配 —— 3 篇塞 3 条正是当初要拆的"每篇都在喊保修"');
assert(ca.distributionTargets(1).minDistinctAngles === 1, '1 篇只要求 1 类(谈批内多样性没有意义)');

console.log('\n--- 缩放必须从基准值推,不许写死 ---');
// 改了基准值缩放要跟着变,否则又是两处真源。
assert(ca.MONTH_BASELINE === 12, '基准批量是 12');
for (const n of [1, 2, 3, 4, 6, 8, 12, 13, 20]) {
  const t = ca.distributionTargets(n);
  if (t.minDistinctAngles > n) { fail++; console.log(`  ✗ n=${n} 要求 ${t.minDistinctAngles} 类角度,超过篇数`); }
  if (t.maxSpecPosts < 1) { fail++; console.log(`  ✗ n=${n} 卖点上限 < 1`); }
}
assert([1, 2, 3, 4, 6, 8, 12, 13, 20].every((n) => ca.distributionTargets(n).minDistinctAngles <= n),
  '任何批量下"要求的角度数"都不超过篇数');
assert([1, 2, 3, 4, 6, 8, 12, 13, 20].every((n, i, arr) => {
  if (i === 0) return true;
  return ca.distributionTargets(n).minDistinctAngles >= ca.distributionTargets(arr[i - 1]).minDistinctAngles;
}), '批量越大要求越严(单调不降)');

console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
