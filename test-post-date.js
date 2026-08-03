// 帖子日期语境的单元测试 —— 不联网、不花钱。
//
// 2026-08-01 干测实测事故:排在 9 月 28 日的帖子写出 "Malaysia's National Day is near",
// 而 Merdeka(8/31)和 Malaysia Day(9/16)那时都已经过去了。两层根因:
//   ① 文案层用生成当天的日期,不是这篇的排期日期;
//   ② 就算日期传对了,节庆过滤只到"月"这一级 —— 9 月任意一天都会被告知
//      "Malaysia Day 正当时"。
// 只修 ① 没用,所以这里两半都要断言。
const { seasonalContextFor, toPostDate, getMalaysiaDate } = require('./lib/planning');
const { buildCopywritingPrompt } = require('./lib/copywriting');

let pass = 0, fail = 0;
function assert(cond, name) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}`); }
}

console.log('\n--- toPostDate ---');
assert(toPostDate('2026-09-28').getMonth() === 8, "'2026-09-28' 解析成 9 月");
assert(toPostDate('2026-09-28').getDate() === 28, "'2026-09-28' 解析成 28 号");
assert(toPostDate(null) instanceof Date, '空值退回今天,不抛错');
assert(toPostDate('rubbish') instanceof Date, '垃圾字符串退回今天,不抛错');
const asDate = new Date(2026, 8, 16);
assert(toPostDate(asDate) === asDate, 'Date 对象原样返回');

console.log('\n--- 就是那篇出错的帖子:9 月 28 日 ---');
const sep28 = seasonalContextFor('2026-09-28');
assert(!/is upcoming|you may build anticipation/.test(sep28), '9/28 不会被告知有国庆将至');
assert(/ALREADY PASSED/.test(sep28), '9/28 明确告知 Malaysia Day 已经过去');
assert(/Malaysia Day/.test(sep28) && /12 days/.test(sep28), '9/28 距 9/16 已过 12 天');
assert(!/National Day \/ Merdeka/.test(sep28), '9/28 早已超出 Merdeka(8/31)的回看窗口');

console.log('\n--- 各时点 ---');
const sep01 = seasonalContextFor('2026-09-01');
assert(/Malaysia Day.*15 days AFTER/s.test(sep01), '9/1 → Malaysia Day 还有 15 天,可以预热');
// 9/1 距 Merdeka(8/31)只差一天 —— 落在 >= -1 的宽限里，按"正在发生"处理。
// 国庆隔天发一篇仍然当节庆写是对的，不该被判成"已经过去了"。
assert(/Merdeka.*Treat it as happening now/s.test(sep01), '9/1 → Merdeka 昨天,仍按"正在发生"');
// 但再往后就必须翻面
assert(/Merdeka.*ALREADY PASSED 4 days/s.test(seasonalContextFor('2026-09-04')), '9/4 → Merdeka 已过 4 天');

const sep16 = seasonalContextFor('2026-09-16');
assert(/Malaysia Day.*Treat it as happening now/s.test(sep16), '9/16 当天 → 正在发生');

const aug25 = seasonalContextFor('2026-08-25');
assert(/Merdeka.*6 days AFTER/s.test(aug25), '8/25 → Merdeka 还有 6 天');

const jun10 = seasonalContextFor('2026-06-10');
assert(!/Merdeka|Malaysia Day|Christmas/.test(jun10), '6 月不会提到任何固定日期节日');
assert(/Mid-year sales/.test(jun10), '6 月仍然给出年中促销这类季节性语境');

const dec20 = seasonalContextFor('2026-12-20');
assert(/Christmas.*5 days AFTER/s.test(dec20), '12/20 → 圣诞还有 5 天');

console.log('\n--- 农历/回历节日不许被说成"快到了" ---');
const feb05 = seasonalContextFor('2026-02-05');
assert(/Chinese New Year/.test(feb05), '2 月给出农历新年语境');
assert(/shifts every year/.test(feb05), '农历新年标注"日期每年移动"');
assert(!/days AFTER/.test(feb05.split('\n').find((l) => /Chinese New Year/.test(l)) || ''),
  '农历新年不给具体天数(我们没有当年真实日期,不许编)');
const oct10 = seasonalContextFor('2026-10-10');
assert(/Deepavali/.test(oct10) && /never write that it is "tomorrow"/.test(oct10),
  'Deepavali 明确禁止写成"就在明天"');

console.log('\n--- 传进提示词 ---');
const p28 = buildCopywritingPrompt('Limited Time Offer', 'promo', undefined, undefined, undefined, undefined, '2026-09-28');
assert(p28.includes('September 28, 2026'), '提示词写的是这篇的发布日,不是今天');
assert(/ALREADY PASSED/.test(p28), '"已过"的警告确实进了提示词');
assert(/Write as if it is that date — not today/.test(p28), '明确要求以发布日为准写作');

const today = getMalaysiaDate();
const pNoDate = buildCopywritingPrompt('Some topic', 'product');
assert(pNoDate.includes(`${today.getDate()}, ${today.getFullYear()}`),
  '不传日期时退回今天(即兴单篇生成的正确行为)');

console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
