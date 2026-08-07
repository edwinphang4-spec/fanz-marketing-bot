// ============================================
// 跨月记忆 —— 离线,不联网不花钱(供给层用假数据,只验加工与拼装)。
//
// 2026-08-07 Edwin 查出来的缺口:记忆的作用域全部锁死在 plan_id 上 ——
// 规划器完全不看历史、选品轮换只在本批内、查重只查同一个 plan、知识点没人记。
// 上个月推过 DELTA56 三次,这个月照样能再推三次,**两次都能过查重**。
//
// 最讽刺的是 Mark 早就有记忆(取最近 40 行、不限月份),但那份记忆只有对话看得到,
// 真正生成 12 篇内容的路径从头到尾不知道 ——
// 「能力做出来了,但没接到真正需要它的地方」。
// ============================================

const hist = require('./lib/content-history');
const { checkMonthlyRepetition, formatRepetitionReport } = require('./lib/qa-content');
const { explainerPanel } = require('./lib/design-templates');

let pass = 0, fail = 0;
function assert(cond, name, detail) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? `\n      ${detail}` : ''}`); }
}

const ROWS = [
  { id: 'a', suggested_date: '2026-07-05', pillar: 'product', topic: 'Say Goodbye to Noisy Fans with FS Series',
    source_product_image: 'DELTA56 Pinewood', fb_content: 'Tired of a rattling fan?\nSecond line.',
    compose_spec: { image_texts: { title: 'Quiet Nights', cta: 'DM us today' }, teaching_key: 'blade_count_airflow_56in' } },
  { id: 'b', suggested_date: '2026-07-12', pillar: 'educational', topic: 'Choosing the Right Fan Size',
    source_product_image: 'DELTA56 Pinewood', compose_spec: { teaching_key: 'light_vs_no_light_42in' } },
  { id: 'c', suggested_date: '2026-07-20', pillar: 'case', topic: 'A Living Room That Breathes',
    source_product_image: 'GAZE52N Pinewood', compose_spec: {} },
  { id: 'd', suggested_date: '2026-01-02', pillar: 'product', topic: 'Ancient history post',
    source_product_image: 'AURA36 Oakwood', compose_spec: {} },
  { id: 'e', suggested_date: '2026-07-25', pillar: 'promo', topic: 'Rejected one',
    status: 'rejected', source_product_image: 'INNO525L Pinewood', compose_spec: {} },
];

console.log('\n--- 规划器能看到"最近讲过什么" ---');
const block = hist.coveredBlock(ROWS);
assert(/ALREADY COVERED/.test(block), '有"已经讲过"这一段');
assert(block.includes('Say Goodbye to Noisy Fans with FS Series'), '列出了历史标题');
assert(block.includes('DELTA56 Pinewood'), '带上用过的型号(避免连月推同一台)');
assert(!block.includes('Rejected one'), '被驳回的那篇不算数(她已经否掉了)');
assert(!/fb_content|Tired of a rattling/.test(block),
  '只给标题和产品,不给正文 —— 给多了它会去模仿上个月的措辞,反而更像');
assert(hist.coveredBlock([]) === '', '没有历史时返回空串(不往提示词塞空段落)');

console.log('\n--- 选品:最近用过的降权 ---');
const usage = hist.recentSkuUsage(ROWS, 60);
assert(usage.get('DELTA56 Pinewood') === 2, 'DELTA56 最近 60 天用了 2 次');
assert(usage.get('GAZE52N Pinewood') === 1, 'GAZE52N 用了 1 次');
assert(!usage.has('AURA36 Oakwood'), '半年前那篇不在 60 天窗口内');
assert(!usage.has('INNO525L Pinewood'), '被驳回的不计入用量');

console.log('\n--- 知识点:讲过的下次避开 ---');
const keys = hist.recentTeachingKeys(ROWS);
assert(keys.has('blade_count_airflow_56in'), '记住了"56 吋叶数对比"讲过');
assert(keys.has('light_vs_no_light_42in'), '记住了"42 吋有灯无灯"讲过');
assert(keys.size === 2, '只记有 teaching_key 的那些');
// key 要按尺寸区分 —— 56 吋讲过不代表 66 吋那篇也不能讲
const p56 = explainerPanel({ catalog_model: 'DELTA56' });
const p66 = explainerPanel({ catalog_model: 'DELTA66' });
assert(p56 && p66 && p56.teachingKey !== p66.teachingKey,
  '不同尺寸是不同的知识点(56 吋讲过,66 吋仍可讲)',
  `${p56 && p56.teachingKey} vs ${p66 && p66.teachingKey}`);

console.log('\n--- 查重:跨月撞句要能报出来 ---');
const thisMonth = [
  { topic: 'New post', pillar: 'product', fb_content: 'Fresh opening line.',
    imageTexts: { title: 'Quiet Nights', cta: 'DM us today' } },
  { topic: 'Another', pillar: 'case', fb_content: 'Another opening.',
    imageTexts: { title: 'Quiet Nights', cta: 'DM us today' } },
];
const histRows = hist.repetitionRows(ROWS);
const onlyThisMonth = checkMonthlyRepetition(thisMonth);
const withHistory = checkMonthlyRepetition([...thisMonth, ...histRows], { scopeLabel: '近 90 天' });
assert(onlyThisMonth.ok === true || onlyThisMonth.alerts.length === 0,
  '只看本月:2 次没超上限,不报', JSON.stringify(onlyThisMonth.alerts));
assert(!withHistory.ok && withHistory.alerts.some((a) => /Quiet Nights/.test(a)),
  '加上历史:同一个标题第 3 次出现被报出来');
assert(withHistory.alerts.some((a) => a.includes('近 90 天')),
  '报告口径说的是"近 90 天"而不是"整月"');

console.log('\n--- 口径必须跟着范围走 ---');
// 范围变了口径没变的话,她翻遍这个月也找不到那三篇,只会以为系统在乱报。
const rep = formatRepetitionReport(withHistory, 12, '近 90 天');
assert(/近 90 天内容查重/.test(rep), '报告标题也用同一个口径');
assert(!/整月内容查重/.test(rep), '不再谎称"整月"');
const repMonth = formatRepetitionReport(checkMonthlyRepetition([
  { topic: 'x', pillar: 'product', fb_content: 'same', imageTexts: { title: 'T' } },
  { topic: 'y', pillar: 'product', fb_content: 'same', imageTexts: { title: 'T' } },
  { topic: 'z', pillar: 'product', fb_content: 'same', imageTexts: { title: 'T' } },
]));
assert(repMonth && /整月/.test(repMonth), '没有历史时仍然说"整月"(默认口径不变)');

console.log('\n--- 记忆是增益,读不到不该挡住出内容 ---');
assert(hist.recentSkuUsage(null) instanceof Map, '历史为 null 时返回空 Map,不抛错');
assert(hist.recentTeachingKeys(undefined).size === 0, '历史为 undefined 时返回空集合');
assert(hist.repetitionRows(null).length === 0, '历史为 null 时返回空数组');

console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
