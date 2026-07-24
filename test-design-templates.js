// test-design-templates.js — 九模板引擎验证
// 跑法: source .env && node test-design-templates.js
// 覆盖: pillar→模板映射 / 背景约束注入 / full_ai prompt 要素 /
//       真库 logo 四变体查询 / 真实合成探针(深底白字标·浅底蓝字标·full_ai 只叠logo)
const fs = require('fs');
const os = require('os');
const path = require('path');
const sharp = require('sharp');
const { TEMPLATES, pickTemplate, buildFullAiPrompt } = require('./lib/design-templates');
const { buildBackgroundPrompt } = require('./lib/background-gen');
const { getLogoAssetBySeries } = require('./lib/brand');
const { composeFinal } = require('./lib/compose');

let pass = 0, fail = 0;
const t = (c, m) => c ? (pass++, console.log('  PASS:', m)) : (fail++, console.error('  FAIL:', m));

(async () => {
  console.log('\n[1] pillar → 模板映射');
  t(pickTemplate({ pillar: 'product' }).tag === 'product_intro', 'product → product_intro');
  t(pickTemplate({ pillar: 'case' }).tag === 'lifestyle', 'case → lifestyle');
  t(pickTemplate({ pillar: 'educational' }).tag === 'educational', 'educational → educational');
  t(pickTemplate({ pillar: 'promo' }).tag === 'promotion', 'promo → promotion');
  t(pickTemplate({ pillar: 'story', topic: 'Merdeka Day Celebration' }).tag === 'festival_illustration', 'story+节庆 → festival_illustration');
  t(pickTemplate({ pillar: 'story', topic: '10 Years of Trust' }).tag === 'brand_trust', 'story 非节庆 → brand_trust');
  t(pickTemplate({}).tag === 'lifestyle', '未知 → 默认 lifestyle');

  console.log('\n[2] composite 背景约束注入');
  for (const tag of ['product_intro', 'educational', 'promotion']) {
    const tpl = TEMPLATES[tag];
    const p = buildBackgroundPrompt('a scene', 'brand style anchor', null, tpl.backgroundStyle);
    const kw = { product_intro: /navy blue gradient/i, educational: /cream|infographic/i, promotion: /royal-blue|gold coins/i }[tag];
    t(kw.test(p) && /TEMPLATE ART DIRECTION/.test(p), `${tag} 约束句注入`);
    t(/no.*fan|without.*fan|fan/i.test(p) || /HARD|STRICT|RULES/i.test(p), `${tag} 保留硬约束段`);
  }

  console.log('\n[3] full_ai prompt 要素(festival)');
  const fp = buildFullAiPrompt({ topic: 'Happy Chinese New Year 2027', post_angle: 'year of the goat' }, TEMPLATES.festival_illustration);
  t(/Happy Chinese New Year 2027/.test(fp), '标题文字进 prompt');
  t(/top centre.*logo|logo.*top centre/i.test(fp), '顶部中央留 logo 空位');
  t(/Do NOT draw any logo|brand name/i.test(fp), '禁画品牌字样');
  t(/Do NOT include any ceiling fan/i.test(fp), '禁产品');

  console.log('\n[4] 真库 logo 四变体查询');
  for (const s of ['lockup_blue', 'lockup_white', 'wordmark_blue', 'wordmark_white']) {
    const a = await getLogoAssetBySeries(s);
    t(!!(a && a.public_url), `${s} → 激活资产带 URL${a ? '' : ' (missing!)'}`);
  }

  console.log('\n[5] 真实合成探针');
  const tmp = os.tmpdir();
  const mkBg = async (color, f) => { await sharp({ create: { width: 800, height: 800, channels: 3, background: color } }).png().toFile(f); return f; };
  // 深底 + 白字标 + 白标题(product_intro 风格)
  const darkBg = await mkBg({ r: 20, g: 35, b: 80 }, path.join(tmp, 'tpl-dark.png'));
  const wmWhite = await getLogoAssetBySeries('wordmark_white');
  const out1 = path.join(tmp, 'tpl-out-dark.png');
  await composeFinal({ background: darkBg, productSource: null, texts: { title: 'GRANDE L SERIES' }, titleSlot: 'bottom_left', colors: { title: '#FFFFFF', stroke: '#1A1A1A', cta_fill: '#274797', cta_stroke: '#1A1A1A' }, logoUrl: wmWhite.public_url, logoPosition: 'top_left', outPath: out1 });
  t(fs.existsSync(out1) && fs.statSync(out1).size > 10000, '深底+白字标+白标题合成产出');
  // 浅底 + 蓝字标(lifestyle 风格, top_right)
  const lightBg = await mkBg({ r: 245, g: 242, b: 235 }, path.join(tmp, 'tpl-light.png'));
  const wmBlue = await getLogoAssetBySeries('wordmark_blue');
  const out2 = path.join(tmp, 'tpl-out-light.png');
  await composeFinal({ background: lightBg, productSource: null, texts: { title: 'Breeze In Style' }, titleSlot: 'bottom_left', colors: { title: '#274797', stroke: '#FFFFFF', cta_fill: '#274797', cta_stroke: '#FFFFFF' }, logoUrl: wmBlue.public_url, logoPosition: 'top_right', outPath: out2 });
  t(fs.existsSync(out2) && fs.statSync(out2).size > 10000, '浅底+蓝字标(右上)合成产出');
  // full_ai 模式:空 texts + null product → 只叠 lockup_white 顶部居中
  const festBg = await mkBg({ r: 12, g: 60, b: 50 }, path.join(tmp, 'tpl-fest.png'));
  const lkWhite = await getLogoAssetBySeries('lockup_white');
  const out3 = path.join(tmp, 'tpl-out-fest.png');
  await composeFinal({ background: festBg, productSource: null, texts: {}, colors: {}, logoUrl: lkWhite.public_url, logoPosition: 'top_center', logoWidthRatio: 0.16, outPath: out3 });
  t(fs.existsSync(out3) && fs.statSync(out3).size > 5000, 'full_ai 模式(零产品零文字)只叠 lockup 产出');
  console.log('  探针输出:', out1, out2, out3);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FATAL:', e); process.exit(1); });
