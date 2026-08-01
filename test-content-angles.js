// 内容角度分配 + 分布校验的单元测试 —— 不联网、不花钱。
//
// 这一层的价值全在"确定性":同样的 pillar 序列进去必须得到同样的角度分布,
// 而且必须满足 Edwin 定的三条硬指标(spec ≤ 3 / 至少 5 类 / 同 pillar 同角度 ≤ 2)。
// 提示词做不到这件事——所以这里的断言就是这个功能的全部保证。
const ca = require('./lib/content-angles');

let pass = 0, fail = 0;
function assert(cond, name) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}`); }
}

// 典型一个月:4 product / 3 case / 2 educational / 2 story / 1 promo + 1 festival
const MONTH = [
  { pillar: 'product', topic: 'FS 52N for the living room', suggested_date: '2026-09-01' },
  { pillar: 'product', topic: 'GAZE 40L compact bedroom fan', suggested_date: '2026-09-02' },
  { pillar: 'case', topic: 'A Johor family living room', suggested_date: '2026-09-03' },
  { pillar: 'educational', topic: 'How to choose the right fan size', suggested_date: '2026-09-04' },
  { pillar: 'story', topic: 'Ten years above Malaysian homes', suggested_date: '2026-09-08' },
  { pillar: 'product', topic: 'FERRO 56L in oakwood', suggested_date: '2026-09-09' },
  { pillar: 'case', topic: 'A condo dining area, transformed', suggested_date: '2026-09-10' },
  { pillar: 'promo', topic: 'Malaysia Day offer', suggested_date: '2026-09-11' },
  { pillar: 'educational', topic: 'Light or no light: L versus N', suggested_date: '2026-09-15' },
  { pillar: 'story', topic: 'Why we still send our own technicians', suggested_date: '2026-09-16' },
  { pillar: 'case', topic: 'A covered balcony in Penang', suggested_date: '2026-09-17' },
  { pillar: 'product', topic: 'GRANDE 52 in matt black', suggested_date: '2026-09-18' },
  { pillar: 'festival', topic: 'Happy Malaysia Day', suggested_date: '2026-09-16' },
];

console.log('\n--- 分配 ---');
const a1 = ca.planContentAnglesByDate(MONTH);
MONTH.forEach((p, i) => {
  const f = a1[i].brandFact;
  console.log(`  ${String(i + 1).padStart(2)} [${p.pillar.padEnd(11)}] ${ca.ANGLES[a1[i].angle].zh}(${a1[i].angle})`.padEnd(46)
    + (f ? `品牌事实: ${ca.BRAND_FACTS[f].zh}` : '品牌事实: 无'));
});

assert(a1.every((x) => x.angle), '每篇都分到了角度');
assert(a1.length === MONTH.length, '返回长度与入参对齐');

console.log('\n--- 硬指标 ---');
const counts = {};
a1.forEach((x) => { counts[x.angle] = (counts[x.angle] || 0) + 1; });
assert((counts.spec || 0) <= ca.MAX_SPEC_POSTS, `产品角度 ${counts.spec || 0} 篇 ≤ ${ca.MAX_SPEC_POSTS}`);
assert(Object.keys(counts).length >= ca.MIN_DISTINCT_ANGLES,
  `覆盖 ${Object.keys(counts).length} 类角度 ≥ ${ca.MIN_DISTINCT_ANGLES}`);

const productAngles = MONTH.map((p, i) => [p.pillar, a1[i].angle]).filter(([p]) => p === 'product').map(([, a]) => a);
assert(new Set(productAngles).size === productAngles.length,
  `4 篇 product 角度全不同 (${productAngles.join(', ')})`);
assert(productAngles.filter((a) => a === 'spec').length <= 1, 'product 里最多 1 篇卖点帖');

const fest = MONTH.map((p, i) => [p.pillar, a1[i]]).filter(([p]) => p === 'festival');
assert(fest.every(([, x]) => x.angle === 'timing'), '节庆帖固定 timing 角度');
assert(fest.every(([, x]) => x.brandFact === null), '节庆帖不分配任何品牌事实');

console.log('\n--- 品牌事实配额 ---');
const factTally = {};
a1.forEach((x) => { if (x.brandFact) factTally[x.brandFact] = (factTally[x.brandFact] || 0) + 1; });
for (const k of ca.BRAND_FACT_KEYS) {
  const [lo, hi] = ca.BRAND_FACTS[k].band;
  const n = factTally[k] || 0;
  assert(n >= lo && n <= hi, `${ca.BRAND_FACTS[k].zh} 分配 ${n} 篇,落在 ${lo}-${hi}`);
}
const withFact = a1.filter((x) => x.brandFact).length;
assert(withFact < MONTH.length, `${MONTH.length - withFact} 篇明确不带任何品牌事实(旧版是 0 篇)`);
assert(a1.every((x) => !x.brandFact || ca.BRAND_FACT_KEYS.includes(x.brandFact)), '每篇最多一条品牌事实');

console.log('\n--- 确定性 ---');
const a2 = ca.planContentAnglesByDate(MONTH);
assert(JSON.stringify(a1) === JSON.stringify(a2), '同样输入两次得到完全相同的分配');
// 打乱入参顺序:按日期排序后应得到同样的"日期→角度"映射
const shuffled = [...MONTH].reverse();
const a3 = ca.planContentAnglesByDate(shuffled);
const map1 = new Map(MONTH.map((p, i) => [`${p.suggested_date}|${p.topic}`, a1[i].angle]));
const map3 = new Map(shuffled.map((p, i) => [`${p.suggested_date}|${p.topic}`, a3[i].angle]));
assert([...map1].every(([k, v]) => map3.get(k) === v), '入参顺序打乱不改变每篇拿到的角度');

console.log('\n--- 尊重计划器给的角度 ---');
const seeded = MONTH.map((p, i) => (i === 0 ? { ...p, angle: 'scenario' } : p));
const a4 = ca.planContentAnglesByDate(seeded);
assert(a4[0].angle === 'scenario', '计划器给的合法角度被保留');
const bad = MONTH.map((p, i) => (i === 0 ? { ...p, angle: 'nonsense' } : p));
assert(ca.ANGLE_KEYS.includes(ca.planContentAnglesByDate(bad)[0].angle), '非法角度被替换成合法值,不抛错');

console.log('\n--- 极端输入 ---');
const allProduct = Array.from({ length: 12 }, (_, i) =>
  ({ pillar: 'product', topic: `Post ${i}`, suggested_date: `2026-09-${String(i + 1).padStart(2, '0')}` }));
const a5 = ca.planContentAngles(allProduct);
assert(a5.filter((x) => x.angle === 'spec').length <= ca.MAX_SPEC_POSTS,
  '12 篇全 product 时 spec 仍不超上限');
assert(a5.every((x) => x.angle), '12 篇全 product 时每篇仍有角度(上限剔空后放宽,不卡死)');
assert(ca.planContentAngles([]).length === 0, '空输入不崩');

console.log('\n--- 分布校验器 ---');
// 合规月
const good = MONTH.map((p, i) => ({
  pillar: p.pillar, angle: a1[i].angle,
  fb_content: a1[i].brandFact === 'warranty' ? 'Backed by our 10-year motor warranty.'
    : a1[i].brandFact === 'sirim' ? 'SIRIM certified, as always.'
    : a1[i].brandFact === 'dc_motor' ? 'The DC motor keeps it quiet.'
    : 'A quiet corner of a Malaysian home.',
}));
const gr = ca.checkAngleDistribution(good);
assert(gr.ok, `按配额写出来的一个月零报警 (${JSON.stringify(gr.detail.brandFactCounts)})`);

// 旧毛病复发:每篇都提保修 + SIRIM
const bloated = MONTH.map((p, i) => ({
  pillar: p.pillar, angle: a1[i].angle,
  fb_content: 'SIRIM certified with a 10-year motor warranty and a whisper-quiet DC motor.',
}));
const br = ca.checkAngleDistribution(bloated);
assert(!br.ok, '每篇都堆卖点会被报警');
assert(br.alerts.some((x) => x.includes('保修')), '保修超配额被点名');
assert(br.alerts.some((x) => x.includes('SIRIM')), 'SIRIM 超配额被点名');

// 信任信号全丢
const bare = MONTH.map((p, i) => ({ pillar: p.pillar, angle: a1[i].angle, fb_content: 'A nice fan for a nice room.' }));
const rr = ca.checkAngleDistribution(bare);
assert(!rr.ok, '一整月一次保修都不提也会被报警(不是越少越好)');
assert(rr.alerts.some((x) => x.includes('下限')), '欠配额被点名');

// 角度全一样
const monotone = MONTH.map((p) => ({ pillar: p.pillar, angle: 'spec', fb_content: 'x' }));
const mr = ca.checkAngleDistribution(monotone);
assert(mr.alerts.some((x) => x.includes('类角度')), '整月只有一类角度被报警');
assert(mr.alerts.some((x) => x.includes('产品角度')), '卖点帖超上限被报警');

console.log('\n--- 提炼指令按角度分流(雷3) ---');
const focuses = ca.ANGLE_KEYS.map((k) => ca.extractionFocus(k, 'product'));
assert(new Set(focuses).size === ca.ANGLE_KEYS.length, '7 类角度给出 7 条不同的提炼指令');
assert(/OFFER|DEADLINE/.test(ca.extractionFocus('spec', 'promo')), 'promo 帖走促销专用提炼');
assert(/PROBLEM/.test(ca.extractionFocus('painpoint', 'product')), '痛点角度抓问题本身');
assert(/TIP ITSELF/.test(ca.extractionFocus('knowledge', 'educational')), '知识角度抓知识点');

console.log('\n--- 提示词块 ---');
const withFactBlock = ca.angleBlock('painpoint', 'warranty');
assert(withFactBlock.includes('10-year motor warranty'), '分到保修的篇会拿到明确许可');
assert(!ca.angleBlock('aesthetic', null).includes('10-year motor warranty'),
  '没分到品牌事实的篇拿到的是明确禁止,不是清单');
assert(ca.angleBlock('aesthetic', null).includes('NO brand fact'), '未分配时明确写"一条都不提"');
assert(ca.angleBlock('nonsense', null) === '', '未知角度返回空串,不注入垃圾');

console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
