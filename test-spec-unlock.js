// ============================================
// 解锁 CFM / 功率 / 档位之后的拦截测试 —— 离线,不花钱。
//
// 2026-08-06 背景:这三项一直被无条件拦着,因为规则是在拿到 Fanz 官方 Excel
// **之前**写的。清单来了没人去解锁 —— 于是"教育帖没东西可讲"这个结论本身是假的。
//
// 解锁 ≠ 放行。改成逐条比对本篇型号在清单里的真值,写法和尺寸那套完全一致。
//
// Edwin 划的红线(这里每一条都要有断言):
//   CFM 只能横向比同尺寸的自家扇,绝不能推成"够几平方";
//   不能从 W 推电费;不能从档位推绝对风速。
//   数字本身是真的、推出来的结论是编的 —— 这类最难看出来。
// ============================================

const { checkFabricatedClaims, buildFactBoundaryBlock } = require('./lib/qa-claims');
const { airflowComparisons, conservativeAirflowComparisons } = require('./lib/product-catalog');

let pass = 0, fail = 0;
function assert(cond, name, detail) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? `\n      ${detail}` : ''}`); }
}

// DELTA56:56 吋 / 6 叶 / 9750 CFM / 37W / 6+6 档 / ABS / LED 24W
const DELTA56 = {
  catalog_model: 'DELTA56', model_code: 'DELTA56',
  size_inches: 56, blade_count: 6, color: 'Pinewood', has_led: true,
};
const ok = (t) => checkFabricatedClaims(t, DELTA56).ok;
const why = (t) => checkFabricatedClaims(t, DELTA56).blocking.join(' | ');

console.log('\n--- 解锁的三项:对得上才放行 ---');
assert(ok('The DELTA56 moves 9,750 CFM.'), '风量真值 9,750 → 放行');
assert(!ok('The DELTA56 moves 10,000 CFM.'), '风量写成 10,000 → 拦', why('The DELTA56 moves 10,000 CFM.'));
assert(ok('Rated at 37W, with a 6+6 speed range.'), '功率 37W + 档位 6+6 → 放行');
assert(!ok('This fan is rated at 55W.'), '功率写成 55W → 拦');
assert(!ok('A 9+9 speed range gives finer control.'), '档位写成 9+9 → 拦');
assert(ok('A 24W LED that dims down for the evening.'), '灯的瓦数 24W(与马达功率不同项)→ 放行');

console.log('\n--- 红线:对外推导一律拦(数字真、结论编) ---');
assert(!ok('9,750 CFM covers 40 sqm easily.'), 'CFM 推覆盖面积 → 拦');
assert(!ok('At 9,750 CFM it is enough for a big living room.'), 'CFM 推"够多大房间" → 拦');
assert(!ok('37W saves you RM20 a month.'), 'W 推电费 → 拦');
assert(!ok('It cuts your electricity bill by 30%.'), '推省电百分比 → 拦');
assert(!ok('Enough airflow for a 400 square foot living room.'), '覆盖面积(平方尺)→ 拦');

console.log('\n--- 百分比:只放行清单算得出来的风量横向对比 ---');
const real = airflowComparisons();
assert(real.length >= 4, `清单能算出 ${real.length} 对真实配对`);
assert(real.every((c) => c.more.blades > c.fewer.blades && c.more.cfm > c.fewer.cfm),
  '每一对都是叶更多且风量确实更高(反例不硬凑成结论)');
assert(new Set(real.map((c) => c.size)).size >= 4, '覆盖至少 4 个尺寸段');
assert(ok('5 blades move 33% more air than 3 at the same size.'), '33% 对得上 52 吋那对 → 放行');
assert(!ok('5 blades move 80% more air than 3.'), '80% 对不上任何一对 → 拦');
assert(!ok('7 blades move more air than 3 at the same size.'),
  '凭空说 7 叶(56 吋没有 7 叶的扇)→ 仍然拦');
assert(ok('Six blades instead of three moves noticeably more air.'),
  '定性对比不带数字 → 放行');

console.log('\n--- 一个尺寸多种基准时不许挑最好看的 ---');
// 52 吋有三台 3 叶扇(7539 / 8810),"5 叶比 3 叶多几 %"因此不是一个数。
const at52 = real.filter((c) => c.size === 52).map((c) => c.pct);
assert(at52.length > 1, `52 吋算得出不止一个百分比(${at52.join('% / ')}%)—— 所以不能只给一个数`);
const cons = conservativeAirflowComparisons();
assert(cons.every((c) => {
  const same = real.filter((r) => r.size === c.size);
  return c.pct === Math.min(...same.map((r) => r.pct));
}), '给提示词的那份每个尺寸取差距最小的一对(宁可少说)');

console.log('\n--- 没解锁的仍然全禁 ---');
assert(!ok('It spins at 330 RPM.'), '转速 → 拦(清单 47 个型号只有 2 个有值)');
assert(!ok('As quiet as 28 dB.'), '分贝 → 拦(清单里根本没这一列)');
assert(!ok('Suitable for rooms up to 225 sq ft.'), '覆盖面积 → 拦');
assert(!ok('Now at RM 899.'), '价格 → 拦');

console.log('\n--- 没指定产品时不许写这些数字 ---');
const noProd = checkFabricatedClaims('This fan moves 9,750 CFM.', null);
assert(noProd.warnings.length > 0 || !noProd.ok, '没有指定产品 → 至少要报出来无法核对');

console.log('\n--- 提示词把真值和红线都写进去了 ---');
const block = buildFactBoundaryBlock(DELTA56);
assert(/9750 CFM/.test(block), '提示词给了这台的真实风量');
assert(/6\+6/.test(block), '提示词给了这台的真实档位');
assert(/NEVER DERIVE/.test(block), '提示词有"不许推导"这一档');
assert(/same diameter/.test(block), '提示词写明只能比同尺寸的自家扇');
assert(!/RM\s?20|40 sqm/.test(block),
  '反例不给可抄的具体数字(踩过三次的老坑:提示词里的例子会被原样抄进成品)');

console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
