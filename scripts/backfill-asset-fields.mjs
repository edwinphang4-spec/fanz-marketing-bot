// 给"从官方清单建库"那批素材补三个字段,和老素材对齐。
//
// 2026-08-04:接选品逻辑时发现三处接口不匹配 ——
//   ① spaces 缺失:选品的"房间类型"过滤全靠它,新素材没有就永远匹配不上
//   ② model_code 缺失:copywritingProductContext 读的是 model_code,
//      新素材只有 catalog_model,不补的话文案层拿不到型号、系列规格也带不出来
//   ③ product_type 缺失:SPINOR / AXEL16 是 16" 可调角度角扇,不是常规吊扇。
//      出图提示词整条假设"自然安装在天花板、扇叶水平旋转",用角扇必然画错。
//
// 尺寸→空间的分档照抄老素材实测值(40-42 卧室/小空间/阳台;48-52 大客厅/餐厅/卧室;
// 56+ 大客厅/餐厅/商用),不另起一套。
import path from 'node:path';
const REPO = path.resolve(import.meta.dirname, '..');
const APPLY = process.argv.includes('--apply');
const U = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const K = process.env.SUPABASE_SERVICE_KEY;
const H = { apikey: K, Authorization: `Bearer ${K}`, 'Content-Type': 'application/json' };

/** 常规吊扇的尺寸→适合空间(与老素材一致) */
function spacesForSize(inch) {
  const n = Number(inch);
  if (!n) return null;
  if (n <= 36) return ['小空间(condo)', '卧室'];
  if (n <= 45) return ['卧室', '小空间(condo)', '有盖阳台'];
  if (n <= 52) return ['大客厅', '餐厅', '卧室'];
  if (n <= 62) return ['大客厅', '餐厅', '商用空间'];
  return ['大客厅', '商用空间'];          // 66"+ 旗舰:不该出现在卧室
}

/** 16 吋这一档是可调角度角扇,不是吊扇 —— 形态完全不同,单独标出来 */
function productType(model, inch) {
  if (/^SPINOR|^AXEL/i.test(model)) return 'corner';
  return Number(inch) <= 20 ? 'corner' : 'ceiling';
}

const rows = await (await fetch(`${U}/rest/v1/brand_assets?kind=eq.product&select=id,name,metadata&limit=1000`, { headers: H })).json();
const todo = rows.filter((r) => {
  const md = r.metadata || {};
  return md.catalog_model && (!md.spaces || !md.model_code || !md.product_type);
});
console.log(`产品素材 ${rows.length} 行,需要补字段的 ${todo.length} 行`);

const changes = [];
for (const r of todo) {
  const md = r.metadata || {};
  const type = productType(md.catalog_model, md.size_inches);
  const next = {};
  if (!md.model_code) next.model_code = md.catalog_model;
  if (!md.product_type) next.product_type = type;
  if (!md.spaces) {
    next.spaces = type === 'corner' ? ['小空间(condo)', '有盖阳台'] : spacesForSize(md.size_inches);
    next.spaces_source = 'derived_from_size_2026-08-04';
  }
  // 角扇先不进选品池:出图提示词假设的是天花板吊扇,画角扇会错
  if (type === 'corner' && md.in_pool === true) {
    next.in_pool = false;
    next.pool_blocked_reason = '16" 可调角度角扇,不是常规吊扇 —— 出图提示词假设天花板吊扇,需要专门的模板才能用';
  }
  if (Object.keys(next).length) changes.push({ id: r.id, name: r.name, next });
}
console.log(`\n会改 ${changes.length} 行`);
const corner = changes.filter((c) => c.next.product_type === 'corner');
if (corner.length) console.log(`  其中标为角扇并移出选品池: ${corner.map((c) => c.name).join(', ')}`);
const sample = changes.find((c) => c.next.spaces);
if (sample) console.log(`  样本 ${sample.name}: ${JSON.stringify(sample.next)}`);

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
