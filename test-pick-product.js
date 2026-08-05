// 选品规则的单元测试 —— 纯代码,零成本,不碰数据库也不出图。
//
// 2026-08-04 官方清单建库后,选品池从 4 个系列扩到 10 个。这个文件锁住三条:
//   ① 系列名要能从两种格式的素材里都推对(老素材 series="FS",新素材 "DELTA56")
//   ② 大尺寸旗舰不许配小空间(HEPTA72 配"卧室安眠"是外行错误)
//   ③ 角扇(SPINOR/AXEL16)不许进吊扇的选品池
const pp = require('./lib/pick-product');

let pass = 0, fail = 0;
const assert = (c, n) => { if (c) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n}`); } };

console.log('\n--- seriesOf:两种素材格式都要推对 ---');
const A = (catalog_model, series, extra = {}) => ({ series, metadata: { catalog_model, ...extra } });
assert(pp.seriesOf(A('DELTA56', 'DELTA56')) === 'DELTA', '新素材 DELTA56 → DELTA');
assert(pp.seriesOf(A('DELTA66', 'DELTA66')) === 'DELTA', '新素材 DELTA66 → DELTA(和 56 同系列)');
assert(pp.seriesOf(A('FS423L', 'FS')) === 'FS', '老素材 series=FS → FS');
assert(pp.seriesOf(A('GRANDE523N V2', 'GRANDE523N V2')) === 'GRANDE', 'GRANDE523N V2 → GRANDE');
assert(pp.seriesOf(A('HEPTA72', 'HEPTA72')) === 'HEPTA', 'HEPTA72 → HEPTA');
assert(pp.seriesOf(A('V605', 'V605')) === 'V605', 'V605 → V605');
assert(pp.seriesOf(A('INNO435L', 'INNO435L')) === 'INNO', 'INNO435L → INNO');
assert(pp.seriesOf(A('AURA36', 'AURA36')) === 'AURA', 'AURA36 → AURA');
// 这条是核心:两种格式必须归到同一个系列,否则"覆盖 5 个系列"是假的
assert(pp.seriesOf(A('FS563L', 'FS563L')) === pp.seriesOf(A('FS423L', 'FS')),
  '同系列的新老素材归到同一个系列名');

console.log('\n--- readHints:新系列要认得出来 ---');
for (const [text, want] of [
  ['The DELTA 56 in oakwood', 'DELTA'],
  ['HEPTA 72 for large halls', 'HEPTA'],
  ['INNO 525L review', 'INNO'],
  ['AURA Series for small rooms', 'AURA'],
  ['the V605 in matte black', 'V605'],
]) assert(pp.readHints(text).series === want, `"${text.slice(0, 26)}" → ${want}`);

console.log('\n--- readHints:房间线索 ---');
assert(pp.readHints('bedroom at 2am').spaces.includes('卧室'), '卧室认得出');
assert(pp.readHints('a commercial showroom').spaces.includes('商用空间'), '商用空间认得出');
assert(pp.readHints('covered balcony').spaces.includes('有盖阳台'), '有盖阳台认得出');

console.log('\n--- 配额常数 ---');
assert(pp.MIN_SERIES_PER_MONTH === 5, '整月至少 5 个系列');
assert(pp.MAX_POSTS_PER_SERIES === 3, '单系列最多 3 篇');

console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
