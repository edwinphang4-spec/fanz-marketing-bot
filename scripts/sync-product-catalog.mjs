// ============================================
// sync-product-catalog.mjs — 把 lib/product-catalog.js 的 47 型号同步进
// Supabase 的 products 表(Dashboard 产品页的数据源)。
//
// 为什么要这个脚本:Dashboard 的 products 表原本只有 4 行**系列级的旧数据**
// ("FS Series 563 L"/"Grande L Series"/...),和两个 bot 实际使用的 47 型号
// 目录是两套账,而且那 4 行已经过时 —— 老板娘看那页做判断会看到错的产品线。
//
// 单一事实源仍然是 lib/product-catalog.js(从 Fanz 官方 Excel 脚本生成)。
// 这张表只是它的**镜像**,供 Dashboard 读。目录更新后重跑本脚本:
//   node scripts/sync-product-catalog.mjs          # dry-run,只看会写什么
//   node scripts/sync-product-catalog.mjs --go     # 真写
//
// ⚠️ price 一律留空:目录里没有价格,绝不编造(报错价格 = 钱的纠纷)。
// ⚠️ do_not_use(BLOCKED)的型号不同步 —— 规格存疑的不该出现在她的界面上。
// ============================================
import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const catalog = require('../lib/product-catalog.js');

for (const line of fs.readFileSync(new URL('../.env', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}
const U = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const K = process.env.SUPABASE_SERVICE_KEY;
const H = { apikey: K, Authorization: `Bearer ${K}`, 'Content-Type': 'application/json' };

/** 型号 → 系列名(去掉尺寸数字和后缀:GRANDE453L → GRANDE, INNO525L → INNO)。 */
function seriesOf(model) {
  const m = String(model).match(/^([A-Z]+)/);
  return m ? m[1] : model;
}

/** 规格 → 一行人话(只写目录里真有的字段,缺的不编)。 */
function featuresOf(spec) {
  const bits = [];
  if (spec.size_inch) bits.push(`${spec.size_inch}"`);
  if (spec.blades) bits.push(`${spec.blades} 叶`);
  if (spec.motor) bits.push(`${spec.motor} 马达`);
  if (spec.material) bits.push(spec.material);
  if (spec.led) bits.push(`LED ${spec.led}${spec.led_watt ? ` ${spec.led_watt}` : ''}`);
  if (spec.dimmable) bits.push('可调光');
  if (spec.wifi) bits.push('WiFi');
  if (spec.speed) bits.push(`风速 ${spec.speed}`);
  if (spec.cfm) bits.push(`${spec.cfm} CFM`);
  const skus = (spec.skus || []).map((s) => s.colour).filter(Boolean);
  if (skus.length) bits.push(`颜色:${skus.join('/')}`);
  return bits.join(' · ');
}

const rows = Object.entries(catalog.CATALOG)
  .filter(([model]) => catalog.isUsable(model)) // BLOCKED 的不同步
  .map(([model, spec]) => ({
    model,
    series: `${spec.brand} ${seriesOf(model)}`,   // 品牌没有独立列,并进 series —— 两品牌保修不同,必须看得见
    price: null,                                  // 目录无价格,绝不编造
    features: featuresOf(spec),
    warranty_terms: spec.brand === 'VIOZ' ? 'Motor 5 years (VIOZ) · Receiver 2 years' : 'Motor 10 years (FANZ) · Receiver/LED 2 years',
    is_smart: !!spec.wifi,
  }));

const go = process.argv[2] === '--go';
const get = async (q) => (await fetch(`${U}/rest/v1/${q}`, { headers: H })).json();

(async () => {
  if (!U || !K) { console.error('need SUPABASE_URL + SUPABASE_SERVICE_KEY'); process.exit(1); }
  const before = await get('products?select=model');
  const blocked = [...catalog.BLOCKED];
  console.log(`目录可用型号 ${rows.length} / 全部 ${Object.keys(catalog.CATALOG).length}`);
  console.log(`不同步的 ${blocked.length} 个(规格存疑,do_not_use): ${blocked.join(', ')}`);
  console.log(`表内现有 ${before.length} 行:`, before.map((r) => r.model).join(', ').slice(0, 120));
  console.log('样例写入行:', JSON.stringify(rows[0]));

  const byBrand = rows.reduce((a, r) => { const b = r.series.split(' ')[0]; a[b] = (a[b] || 0) + 1; return a; }, {});
  console.log('按品牌:', JSON.stringify(byBrand));
  if (!go) { console.log('\n(dry-run,加 --go 才写库)'); return; }

  // 全量替换:表是目录的镜像,旧的系列级假数据必须清掉
  const del = await fetch(`${U}/rest/v1/products?id=not.is.null`, { method: 'DELETE', headers: H });
  console.log('清空旧行:', del.status);
  const ins = await fetch(`${U}/rest/v1/products`, { method: 'POST', headers: H, body: JSON.stringify(rows) });
  console.log('写入:', ins.status, ins.ok ? '' : (await ins.text()).slice(0, 200));

  const after = await get('products?select=model,series,warranty_terms&order=model');
  console.log(`\n复核:表内 ${after.length} 行`);
  const vioz = after.filter((r) => /VIOZ/.test(r.series));
  console.log(`  FANZ ${after.length - vioz.length} / VIOZ ${vioz.length}`);
  console.log(`  VIOZ 保修文案抽查: ${vioz[0] ? vioz[0].warranty_terms : '(无)'}`);
  const bad = [];
  if (after.length !== rows.length) bad.push(`行数不符(${after.length} vs ${rows.length})`);
  if (vioz.some((r) => !/5 years/.test(r.warranty_terms))) bad.push('VIOZ 保修年限写错');
  if (after.some((r) => /Series 563 L|Grande L Series|Smart Series|AURA Series$/.test(r.model))) bad.push('旧的系列级假数据还在');
  console.log(bad.length ? `❌ ${bad.join(' / ')}` : '✅ 复核通过');
})();
