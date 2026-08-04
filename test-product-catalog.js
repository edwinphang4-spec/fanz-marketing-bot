// Fanz 官方产品清单(2026)的单元测试 —— 纯代码,零成本。
//
// 这个模块是**规格的唯一真源**,所以测试重点不是"数据对不对"(那要问 Fanz),
// 而是**有问题的数据取不出来** —— 宁可拿不到值让文案少讲,也不要把 Fanz 表格里
// 写反的数字当事实发出去。
const c = require('./lib/product-catalog');

let pass = 0, fail = 0;
function assert(cond, name) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}`); }
}

console.log('\n--- 规模 ---');
assert(Object.keys(c.CATALOG).length === 47, '47 个型号');
assert(c.allSkus().length === 144, '144 个 SKU');
assert(c.modelsByBrand('FANZ').length === 36, 'FANZ 36 型号');
assert(c.modelsByBrand('VIOZ').length === 11, 'VIOZ 11 型号');

console.log('\n--- 之前不知道、现在有真值的规格 ---');
assert(c.specsFor('FS48L').blades === 5, 'FS48L = 5 叶(之前未知,导致同型号画出不同叶数)');
assert(c.specsFor('FS62N').blades === 5, 'FS62N = 5 叶');
assert(c.specsFor('AURA36').led === '3 TONE', 'AURA36 有 LED(3 TONE 可调色温)');
assert(c.specsFor('AURA48').led === '3 TONE', 'AURA48 有 LED');
assert(c.specsFor('INNO435L').size_inch === 43, 'INNO435L = 43"');
assert(c.specsFor('INNO525L').size_inch === 52, 'INNO525L = 52"');
assert(c.specsFor('HEPTA72').blades === 7 && c.specsFor('HEPTA72').material === 'ALUMINIUM',
  'HEPTA72 = 7 叶铝合金');
assert(c.specsFor('DELTA56').blades === 6, 'DELTA56 = 6 叶');

console.log('\n--- 品牌归属(影响客服 bot 判 10 年还是 5 年保修)---');
assert(c.CATALOG['V605'].brand === 'FANZ', 'V605 属于 FANZ(名字像 VIOZ,实际不是)');
for (const m of ['WINDY MKII42', 'FF425', 'FF565', 'VETTA42L', 'AXEL16']) {
  assert(c.CATALOG[m].brand === 'VIOZ', `${m} 属于 VIOZ`);
}

console.log('\n--- 品牌差异化:WiFi ---');
const fanzWifi = c.modelsByBrand('FANZ').every((m) => c.CATALOG[m].wifi === true);
const viozWifi = c.modelsByBrand('VIOZ').every((m) => c.CATALOG[m].wifi === false);
assert(fanzWifi, 'FANZ 全系有 WiFi');
assert(viozWifi, 'VIOZ 全系没有 WiFi');

console.log('\n--- 数据有问题的取不出来(核心保障)---');
assert(c.isUsable('FS48L') === true, '正常型号可用');
assert(c.isUsable('GRANDE523L') === false, 'GRANDE523L 尺寸存疑 → 不可用');
assert(c.isUsable('GRANDE453N V2') === false, 'GRANDE453N V2 尺寸+代码存疑 → 不可用');
assert(c.isUsable('HERA42L') === false, 'HERA42L 的 LED 栏空白 → 不可用');
assert(c.isUsable('HERA52L') === false, 'HERA52L 的 LED 栏空白 → 不可用');
assert(c.specsFor('GRANDE523L') === null, '被封禁的型号 specsFor 返回 null(拿不到就不许讲)');
assert(c.isUsable('不存在的型号') === false, '未知型号不可用');

console.log('\n--- canCite:缺数据的字段不许引用 ---');
assert(c.canCite('FS48L', 'cfm') === true, 'FS48L 有 CFM → 可引用');
assert(c.canCite('FERRO56L', 'cfm') === false, 'FERRO56L 缺 CFM → 不许引用');
assert(c.canCite('GRANDE453L', 'watt') === false, 'GRANDE453L 缺马达功率 → 不许引用');
assert(c.canCite('FS48L', 'rpm') === false, 'RPM 整列都空 → 任何型号都不许引用转速');
assert(c.canCite('GRANDE523L', 'blades') === false, '被封禁型号的任何字段都不许引用');

console.log('\n--- 数据问题清单本身 ---');
const flagged = new Set(c.DATA_ISSUES.flatMap((d) => d.models));
for (const m of ['GRANDE453N V2', 'GRANDE523L', 'HERA42L', 'HERA52L', 'FERRO56L', 'FERRO56N']) {
  assert(flagged.has(m), `${m} 在 DATA_ISSUES 里`);
}
assert(c.DATA_ISSUES.every((d) => d.issue && d.models.length && d.field && d.action),
  '每条数据问题都写明了型号/字段/处置');
assert(Object.keys(c.MISSING_SPECS).length === 21, '21 个型号缺 CFM 或马达功率');
assert(c.MISSING_COLUMNS.rpm, 'RPM 整列缺失单独记录,不混进 MISSING_SPECS');

console.log('\n--- 每个型号的规格自洽 ---');
for (const [m, s] of Object.entries(c.CATALOG)) {
  if (s.led === false && s.led_watt) { fail++; console.log(`  ✗ ${m} 标了无灯却有 LED 功率`); }
  if (!s.skus.length) { fail++; console.log(`  ✗ ${m} 没有任何 SKU`); }
}
assert(true, '无灯型号不带 LED 功率 / 每个型号至少一个 SKU');

console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
