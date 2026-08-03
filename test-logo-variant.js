// logo 选色/选位规则的单元测试 —— 纯代码,零成本,不碰任何图片 API。
//
// 2026-08-03 Edwin 目检 13 张成品:4 张判错,全是「该用蓝却用了白」。
// 复算确认**测量是对的**(09-01 右上实测 [153,129,105],蓝 2.34:1 / 白 3.68:1),
// 错的是规则:旧规则「谁对比高用谁」把"看得清"当唯一标准,忽略品牌表达;
// 而米色天花板这种中间调正好卡在蓝版 3:1 门槛下,于是一路掉进白版 ——
// 但白版落在浅色/中间调上是**发虚**,不是更清楚。
//
// 新规则:品牌蓝是默认,白版只留给真正的暗背景。
const sharp = require('sharp');
const qa = require('./lib/qa-image');

let pass = 0, fail = 0;
function assert(cond, name) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}`); }
}

/** 造一张纯色图去跑真实的 pickLogoPlacement(不是复刻逻辑,是跑同一份代码) */
async function solid(rgb, W = 1024, H = 1024) {
  return sharp({ create: { width: W, height: H, channels: 3, background: { r: rgb[0], g: rgb[1], b: rgb[2] } } })
    .png().toBuffer();
}

(async () => {
  console.log('\n--- 就是判错的那 4 张的真实底色 ---');
  // 这四组 RGB 是 2026-08-03 那批成品贴 logo **之前**的右上角实测值
  const REGRESSION = [
    ['2026-09-01 卧室米色天花板', [153, 129, 105]],
    ['2026-09-03 客厅米黄天花板', [171, 136, 96]],
    ['2026-09-29 雨天客厅', [157, 136, 120]],
    ['2026-09-30 三代同堂', [151, 118, 87]],
  ];
  for (const [name, rgb] of REGRESSION) {
    const p = await qa.pickLogoPlacement(await solid(rgb));
    assert(p.variant === 'blue', `${name} → 蓝版(旧规则给白版)`);
    assert(p.scrim === true, `${name} → 加淡底衬(不是换白版)`);
    assert(p.movedFromDefault === false, `${name} → 留在默认位,不乱跳`);
  }

  console.log('\n--- 真正的暗背景仍然用白版 ---');
  // 09-14 深蓝夜景,这张旧规则判对了,不能被改坏
  const dark = await qa.pickLogoPlacement(await solid([29, 36, 54]));
  assert(dark.variant === 'white', '深蓝夜景 → 白版');
  assert(dark.scrim === false, '暗背景不加底衬');
  assert(dark.luminance <= qa.DARK_BG_LUMINANCE, `实测亮度 ${dark.luminance} ≤ 暗背景阈值 ${qa.DARK_BG_LUMINANCE}`);

  console.log('\n--- 亮背景:蓝版直接够用,不加底衬 ---');
  const bright = await qa.pickLogoPlacement(await solid([243, 230, 215]));
  assert(bright.variant === 'blue', '亮米白 → 蓝版');
  assert(bright.scrim === false, '够用就不加底衬');
  assert(bright.contrast >= qa.GRAPHIC_CONTRAST_MIN, `对比 ${bright.contrast}:1 ≥ ${qa.GRAPHIC_CONTRAST_MIN}`);

  console.log('\n--- 中间调一律不许退白版 ---');
  // 扫一遍从暗到亮,断言"只有真正暗的才用白"
  let whiteCount = 0, blueCount = 0, firstBlueLum = null;
  for (let v = 20; v <= 250; v += 10) {
    const p = await qa.pickLogoPlacement(await solid([v, v - 12, v - 25]));
    if (p.variant === 'white') {
      whiteCount++;
      assert.silent = true;
      if (p.luminance > qa.DARK_BG_LUMINANCE) {
        fail++; console.log(`  ✗ 亮度 ${p.luminance}(不算暗)却给了白版 — 这正是要根除的毛病`);
      }
    } else {
      blueCount++;
      if (firstBlueLum === null) firstBlueLum = p.luminance;
    }
  }
  assert(whiteCount > 0, `扫描里有 ${whiteCount} 档判白版(暗端)`);
  assert(blueCount > whiteCount, `蓝版 ${blueCount} 档 > 白版 ${whiteCount} 档 —— 蓝是默认`);
  console.log(`  · 白版只出现在最暗的 ${whiteCount} 档,其余 ${blueCount} 档全是蓝版`);

  console.log('\n--- 底衬确实把对比抬过门槛(实测,不是估算) ---');
  const { applyLogoOverlay } = require('./lib/compose');
  const brand = require('./lib/brand');
  let logoUrl = null;
  try { const la = await brand.getLogoAssetBySeries('lockup_blue'); logoUrl = la && la.public_url; } catch (_) {}
  if (!logoUrl) {
    console.log('  (跳过:取不到 logo 素材,需要 Supabase 凭证)');
  } else {
    for (const [name, rgb] of REGRESSION) {
      const before = qa.contrastRatio(qa.BRAND_BLUE_RGB, rgb);
      const img = await applyLogoOverlay(await solid(rgb), {
        logoUrl, logoPosition: 'top_right', logoWidthRatio: 0.12, withBackdrop: false, logoScrim: true,
      });
      const box = qa.logoFootprint(1024, 1024, { logoPosition: 'top_right', logoWidthRatio: 0.12 });
      const st = await qa.regionStats(img, { left: box.left - 30, top: box.top + Math.round(box.height / 2) - 8, width: 20, height: 16 });
      const bg2 = [st.channels[0].mean, st.channels[1].mean, st.channels[2].mean].map(Math.round);
      const after = qa.contrastRatio(qa.BRAND_BLUE_RGB, bg2);
      assert(after >= qa.GRAPHIC_CONTRAST_MIN,
        `${name}: ${before.toFixed(2)}:1 → ${after.toFixed(2)}:1 (过 ${qa.GRAPHIC_CONTRAST_MIN} 门槛)`);
      assert(after > before, `${name}: 底衬确实提高了对比度`);
    }
  }

  console.log('\n--- 底衬必须"很淡",不能变成方框 ---');
  if (logoUrl) {
    const base = await solid([153, 129, 105]);
    const img = await applyLogoOverlay(base, { logoUrl, logoPosition: 'top_right', logoWidthRatio: 0.12, withBackdrop: false, logoScrim: true });
    // 离 logo 很远的地方必须完全没被影响(方板会糊到那儿)
    const far = await qa.regionStats(img, { left: 40, top: 500, width: 60, height: 60 });
    const farRgb = [far.channels[0].mean, far.channels[1].mean, far.channels[2].mean].map(Math.round);
    assert(Math.abs(farRgb[0] - 153) <= 2, `远处底色未被波及(${farRgb[0]} vs 153)`);
    // 旧的 withBackdrop 方板会把顶部 24% 全糊掉 —— 确认我们没走那条路
    const topLeft = await qa.regionStats(img, { left: 40, top: 40, width: 60, height: 60 });
    const tlRgb = [topLeft.channels[0].mean, topLeft.channels[1].mean, topLeft.channels[2].mean].map(Math.round);
    assert(Math.abs(tlRgb[0] - 153) <= 3, `左上角未被波及(${tlRgb[0]} vs 153)—— 不是横贯顶部的方板`);
  }

  console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
})();
