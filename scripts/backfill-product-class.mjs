// 把 product-catalog 的 product_class 写进 brand_assets.metadata。
//
// 2026-08-04 Edwin 指出的盲点:清单里**没有"分类"这一列**,我们现在的
// "适合空间"是按尺寸推的,不是 Fanz 的官方定位。所以只标规格上明显是
// 另一个物种的(HEPTA72),其余一律 unknown —— 不瞎猜,等 Fanz 确认再填准。
//
// 商用型号从选品池移出:13 篇的调性全是家用,商用款进去会写成"让你卧室凉爽"。
// unknown 不移出 —— 那是"还没确认",不是"是商用"。
import path from 'node:path';
const REPO = path.resolve(import.meta.dirname, '..');
const { createRequire } = await import('node:module');
const require = createRequire(import.meta.url);
const cat = require(path.join(REPO, 'lib/product-catalog.js'));

const APPLY = process.argv.includes('--apply');
const U = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const K = process.env.SUPABASE_SERVICE_KEY;
const H = { apikey: K, Authorization: `Bearer ${K}`, 'Content-Type': 'application/json' };

const rows = await (await fetch(`${U}/rest/v1/brand_assets?kind=eq.product&select=id,name,metadata&limit=1000`, { headers: H })).json();
const changes = [];
for (const r of rows) {
  const md = r.metadata || {};
  const model = md.catalog_model;
  if (!model) continue;
  const klass = cat.productClass(model);
  const next = {};
  if (md.product_class !== klass) next.product_class = klass;
  if (klass === 'commercial') {
    if (cat.PRODUCT_CLASS_EVIDENCE[model] && md.product_class_evidence !== cat.PRODUCT_CLASS_EVIDENCE[model]) {
      next.product_class_evidence = cat.PRODUCT_CLASS_EVIDENCE[model];
    }
    if (md.in_pool === true) {
      next.in_pool = false;
      next.pool_blocked_reason = '商用定位,暂不进家用调性的月度内容池(等 Fanz 确认商用型号清单后单独设计)';
    }
  }
  if (Object.keys(next).length) changes.push({ id: r.id, name: r.name, model, next });
}
const byClass = {};
for (const r of rows) { const m = (r.metadata || {}).catalog_model; if (m) byClass[cat.productClass(m)] = (byClass[cat.productClass(m)] || 0) + 1; }
console.log(`产品素材 ${rows.length} 行  定位分布(按素材计): ${JSON.stringify(byClass)}`);
console.log(`会改 ${changes.length} 行`);
const out = changes.filter((c) => c.next.in_pool === false);
if (out.length) console.log(`  移出选品池: ${out.map((c) => c.name).join(', ')}`);
if (!APPLY) { console.log('\n(干跑。加 --apply 写库)'); process.exit(0); }
let ok = 0;
for (const c of changes) {
  const cur = rows.find((r) => r.id === c.id).metadata || {};
  const res = await fetch(`${U}/rest/v1/brand_assets?id=eq.${c.id}`, {
    method: 'PATCH', headers: H, body: JSON.stringify({ metadata: { ...cur, ...c.next } }),
  });
  if (res.ok) ok++; else console.error(`  ❌ ${c.name}: ${res.status}`);
}
console.log(`\n已写入 ${ok}/${changes.length}`);
