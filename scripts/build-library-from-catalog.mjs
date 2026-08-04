// ============================================
// build-library-from-catalog.mjs
//
// 把 Fanz 官方清单 Excel 里**逐 SKU 内嵌的产品照**建进 brand_assets。
//
// 2026-08-04:发现 "Fanz Product List 2026.xlsx" 里嵌了 140 张图,每张按
// xdr:anchor 精确锚定在它那一行的 SKU 上 —— 也就是说产品图不用再一张张问 Fanz 要。
//
// ⚠️ 这个脚本**必须留在仓库里**。上一次建库(2026-07-30,56 SKU)的脚本写在
// 临时目录里,跑完就丢了,这次要重建整个流程只能从头写。写完就提交。
//
// 用法:
//   node scripts/build-library-from-catalog.mjs --photos <dir> --manifest <json>   # 干跑
//   node scripts/build-library-from-catalog.mjs ... --apply                        # 写库
//   加 --no-vision 跳过 AI 读图(省钱,但入池的图会缺 appearance/must_match)
//
// 入池规则(全部满足才 in_pool=true):
//   ① 分辨率 ≥ 800×400 —— 低清图当参考图会毁掉出图质量(实测 VETTA 只有 401px)
//   ② 该型号在清单里没有 do_not_use 级数据问题(product-catalog.isUsable)
//   ③ 品牌是 FANZ —— VIOZ 是另一个品牌(5 年保修、无 WiFi),放进 Fanz 帖子的
//      选品池会造出"给 VIOZ 产品宣传 10 年保修"这种事实错误
//   ④ AI 读图复核颜色与标注一致(不一致的入库但不进池,等人工看图确认)
// ============================================

import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const REPO = path.resolve(import.meta.dirname, '..');
const { createRequire } = await import('node:module');
const require = createRequire(import.meta.url);
const catalog = require(path.join(REPO, 'lib/product-catalog.js'));

const args = process.argv.slice(2);
const argv = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const APPLY = args.includes('--apply');
const NO_VISION = args.includes('--no-vision');
const PHOTOS = argv('--photos');
const MANIFEST = argv('--manifest');
if (!PHOTOS || !MANIFEST) {
  console.error('用法: --photos <dir> --manifest <photo_manifest.json> [--apply] [--no-vision]');
  process.exit(1);
}

const MIN_W = 800, MIN_H = 400;
const BUCKET = 'content-images';
const U = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const K = process.env.SUPABASE_SERVICE_KEY;
const H = { apikey: K, Authorization: `Bearer ${K}`, 'Content-Type': 'application/json' };

const TITLE = (s) => String(s || '').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());

/** AI 读图:描述外观 + **反向核对**标注的颜色对不对 */
async function describe(file, expect) {
  const b64 = fs.readFileSync(file).toString('base64');
  const ext = path.extname(file).slice(1).replace('jpg', 'jpeg');
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: process.env.VISION_MODEL || 'gpt-4o',
      max_tokens: 320,
      temperature: 0,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text:
`This is a product photo of a ceiling fan. Answer ONLY with these labelled lines:

BLADES: <integer — count the blades you can actually see>
COLOUR: <the dominant blade/body finish in plain words, e.g. matte black, matte white, oakwood, pinewood, greywood, silver, bronze>
HAS_LIGHT: <yes|no — is there a light lens/housing under the motor?>
APPEARANCE: <one sentence describing blade shape, finish and motor housing, for an image-generation prompt>

The product is labelled: ${expect.blades ?? '?'} blades, "${expect.colour}", ${expect.led ? 'with light' : 'no light'}.
Do NOT copy the label — report what you SEE. If what you see differs from the label, still report what you see.` },
          { type: 'image_url', image_url: { url: `data:image/${ext};base64,${b64}` } },
        ],
      }],
    }),
  });
  if (!res.ok) throw new Error(`vision ${res.status}`);
  const txt = (await res.json()).choices[0].message.content;
  const grab = (k) => (txt.match(new RegExp(`^${k}:\\s*(.+)$`, 'im')) || [])[1]?.trim() || null;
  return {
    blades: parseInt(grab('BLADES'), 10) || null,
    colour: grab('COLOUR'),
    hasLight: /^y/i.test(grab('HAS_LIGHT') || ''),
    appearance: grab('APPEARANCE'),
    raw: txt,
  };
}

/** 颜色名归一:AI 说 "matte black" / 标注 "MATTE BLACK" 视为一致 */
const colourKey = (s) => String(s || '').toLowerCase().replace(/[^a-z]/g, '');
function colourMatches(seen, label) {
  const a = colourKey(seen), b = colourKey(label);
  if (!a || !b) return false;
  if (a === b || a.includes(b) || b.includes(a)) return true;
  const fam = (x) => x.includes('black') ? 'black' : x.includes('white') ? 'white'
    : x.includes('oak') ? 'oak' : x.includes('pine') ? 'pine' : x.includes('grey') || x.includes('gray') ? 'grey'
    : x.includes('silver') ? 'silver' : x.includes('bronze') ? 'bronze' : x.includes('wood') ? 'wood' : x;
  const fa = fam(a), fb = fam(b);
  // "wood" 是笼统词:AI 说 wood、标注是 oak/pine 时不算冲突,但也不算确认
  if (fa === 'wood' || fb === 'wood') return null;
  return fa === fb;
}

async function upload(localPath, storagePath) {
  const buf = fs.readFileSync(localPath);
  const ct = localPath.endsWith('.png') ? 'image/png' : 'image/jpeg';
  const r = await fetch(`${U}/storage/v1/object/${BUCKET}/${storagePath}`, {
    method: 'POST', headers: { apikey: K, Authorization: `Bearer ${K}`, 'Content-Type': ct }, body: buf,
  });
  if (!r.ok && r.status !== 409) throw new Error(`upload ${r.status}: ${(await r.text()).slice(0, 160)}`);
  return `${U}/storage/v1/object/public/${BUCKET}/${storagePath}`;
}

const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
const existing = await (await fetch(`${U}/rest/v1/brand_assets?kind=eq.product&select=name,metadata`, { headers: H })).json();
// 去重必须按 **catalog_model + 颜色**,不能按 name 字符串。
// 实测:现有素材叫 "FS 423L Matte Black"(带空格),清单型号是 "FS423L",
// 按名字比对永远不相等,结果会给同一个 SKU 建出两条素材。
// 现有 63 行已经在导入清单时补过 catalog_model,所以这里比得准。
const haveSku = new Set(
  existing
    .filter((e) => e.metadata && e.metadata.catalog_model)
    .map((e) => `${e.metadata.catalog_model}|${colourKey(e.metadata.color)}`)
);

const plan = [];
for (const m of manifest) {
  const file = path.join(PHOTOS, m.file);
  if (!fs.existsSync(file)) continue;
  const meta = await sharp(file).metadata();
  const spec = catalog.CATALOG[m.model];
  const name = `${m.model} ${TITLE(m.colour)}`;
  const reasons = [];
  if (meta.width < MIN_W || meta.height < MIN_H) reasons.push(`低清 ${meta.width}x${meta.height}`);
  if (!catalog.isUsable(m.model)) reasons.push('清单数据存疑(do_not_use)');
  if (spec && spec.brand !== 'FANZ') reasons.push(`${spec.brand} 品牌,不进 Fanz 选品池`);
  if (haveSku.has(`${m.model}|${colourKey(m.colour)}`)) reasons.push('素材库已有该 SKU(且现有图分辨率更高)');
  plan.push({ ...m, file, w: meta.width, h: meta.height, name, spec, reasons });
}

const poolCandidates = plan.filter((p) => p.reasons.length === 0);
console.log(`清单图 ${plan.length} 张  →  入池候选 ${poolCandidates.length} 张`);
const grouped = {};
for (const p of plan) (grouped[p.reasons[0] || '入池候选'] ||= []).push(p);
for (const [k, v] of Object.entries(grouped)) console.log(`  ${k}: ${v.length} 张`);

if (!APPLY) {
  console.log('\n=== 入池候选(按型号)===');
  const byModel = {};
  for (const p of poolCandidates) (byModel[p.model] ||= []).push(p.colour);
  for (const [m, cs] of Object.entries(byModel)) console.log(`  ${m.padEnd(16)} ${cs.join(', ')}`);
  console.log('\n(干跑,未上传未写库。加 --apply 执行)');
  process.exit(0);
}

let uploaded = 0, inserted = 0, conflicts = [];
for (const p of plan) {
  try {
    const ext = path.extname(p.file);
    const storagePath = `brand-assets/product/catalog2026/${p.model.replace(/\s+/g, '_')}_${colourKey(p.colour)}${ext}`;
    const publicUrl = await upload(p.file, storagePath);
    uploaded++;

    let vision = null, colourOk = null;
    const wantVision = p.reasons.length === 0 && !NO_VISION;
    if (wantVision) {
      try {
        vision = await describe(p.file, { blades: p.spec?.blades, colour: p.colour, led: p.spec?.led });
        colourOk = colourMatches(vision.colour, p.colour);
        if (colourOk === false) conflicts.push({ ...p, vision });
      } catch (e) { console.error(`  vision 失败 ${p.name}: ${e.message}`); }
    }

    const s = p.spec || {};
    const sku = (s.skus || []).find((x) => x.colour === p.colour);
    const metadata = {
      catalog_model: p.model,
      brand: s.brand || null,
      product_code: sku ? sku.code : null,
      color: TITLE(p.colour),
      size_inches: s.size_inch ?? null,
      blade_count: s.blades ?? null,
      has_led: s.led === false ? false : Boolean(s.led),
      led_type: typeof s.led === 'string' ? s.led : null,
      led_watt: s.led_watt ?? null,
      led_dimmable: s.dimmable ?? null,
      wifi: s.wifi ?? null,
      cfm: s.cfm ?? null,
      motor_type: s.motor ?? null,
      motor_watt: s.watt ?? null,
      fan_speed: s.speed ?? null,
      blade_material: s.material ?? null,
      px: `${p.w}x${p.h}`,
      low_res: p.w < MIN_W || p.h < MIN_H,
      appearance: vision?.appearance || null,
      vision_blades: vision?.blades ?? null,
      vision_colour: vision?.colour || null,
      vision_has_light: vision ? vision.hasLight : null,
      colour_verified: colourOk,
      in_pool: p.reasons.length === 0 && colourOk !== false,
      pool_blocked_reason: p.reasons[0] || (colourOk === false ? 'AI 读图颜色与标注不符,待人工核实' : null),
      source: 'Fanz Product List 2026.xlsx (embedded photo)',
      source_row_image: p.src,
      built_by: 'build-library-from-catalog 2026-08-04',
      catalog_source: 'Fanz Product List 2026.xlsx (2026-08-04)',
    };
    if (metadata.blade_count && vision?.blades && vision.blades !== metadata.blade_count) {
      metadata.blade_count_conflict = `清单 ${metadata.blade_count} 叶 / AI 数到 ${vision.blades} 叶`;
    }

    const r = await fetch(`${U}/rest/v1/brand_assets`, {
      method: 'POST', headers: { ...H, Prefer: 'return=representation' },
      body: JSON.stringify({
        kind: 'product', name: p.name, series: p.model,
        storage_path: storagePath, public_url: publicUrl,
        is_active: true, metadata,
      }),
    });
    if (r.ok) inserted++;
    else console.error(`  插入失败 ${p.name}: ${r.status} ${(await r.text()).slice(0, 140)}`);
    process.stdout.write(`  ${inserted}/${plan.length}\r`);
  } catch (e) {
    console.error(`  ${p.name}: ${e.message}`);
  }
}
console.log(`\n上传 ${uploaded} / 入库 ${inserted}`);
if (conflicts.length) {
  console.log(`\n⚠️ AI 读图与标注冲突 ${conflicts.length} 处(已入库但未进池,需人工开图核实):`);
  for (const c of conflicts) console.log(`   ${c.name.padEnd(28)} 标注 ${c.colour} / AI 看到 ${c.vision.colour}`);
}
