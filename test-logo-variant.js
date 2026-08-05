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
const da = require('./lib/design-agent');

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
  console.log('\n--- 判错那 4 张的真实四角实测数据(挪位优先后应零底衬)---');
  // 下面每组都是 2026-08-03 那批成品**贴 logo 之前**四个角落的实测值
  // (bgRgb 与 busyness 直接取自落库的 compose_spec.logo_placement.candidates)。
  // 用 decideLogoPlacement 跑,和线上是同一个函数,不是复刻一份逻辑。
  const score = (rows) => rows.map(([position, bgRgb, busyness]) => ({
    position, bgRgb, busyness,
    luminance: +qa.relLuminance(bgRgb).toFixed(4),
    cBlue: +qa.contrastRatio(qa.BRAND_BLUE_RGB, bgRgb).toFixed(2),
    cWhite: +qa.contrastRatio(qa.WHITE_RGB, bgRgb).toFixed(2),
  }));
  const REAL = {
    '2026-09-01 卧室': [['top_right', [153, 129, 105], 5.1], ['top_left', [174, 147, 122], 16.3],
      ['bottom_right', [90, 70, 54], 21.2], ['bottom_center', [107, 85, 67], 26.8]],
    '2026-09-03 客厅': [['top_right', [171, 136, 96], 6.7], ['top_left', [222, 191, 151], 10.2],
      ['bottom_right', [110, 79, 51], 39.9], ['bottom_center', [134, 94, 60], 60.7]],
    '2026-09-29 雨天': [['top_right', [157, 136, 120], 7.6], ['top_left', [160, 138, 120], 7.4],
      ['bottom_right', [52, 43, 33], 49.8], ['bottom_center', [126, 93, 69], 72.3]],
    '2026-09-30 三代同堂': [['top_right', [151, 118, 87], 2.7], ['top_left', [191, 153, 116], 2.6],
      ['bottom_right', [68, 45, 28], 41.7], ['bottom_center', [56, 40, 31], 48.4]],
  };
  for (const [name, rows] of Object.entries(REAL)) {
    const d = qa.decideLogoPlacement(score(rows), 'top_right');
    assert(d.variant === 'blue', `${name} → 蓝版(旧规则给白版)`);
    assert(d.scrim === false, `${name} → 零底衬(Edwin:宁可 2.8:1 干净也不要光圈)`);
  }
  // 三张左上角明显更好 → 应该挪过去;09-29 两角只差 0.07,属噪声 → 不许挪
  assert(qa.decideLogoPlacement(score(REAL['2026-09-01 卧室']), 'top_right').position === 'top_left', '09-01 挪到左上(窗帘更亮)');
  assert(qa.decideLogoPlacement(score(REAL['2026-09-03 客厅']), 'top_right').position === 'top_left', '09-03 挪到左上(天花板更浅)');
  assert(qa.decideLogoPlacement(score(REAL['2026-09-30 三代同堂']), 'top_right').position === 'top_left', '09-30 挪到左上');
  assert(qa.decideLogoPlacement(score(REAL['2026-09-29 雨天']), 'top_right').position === 'top_right',
    `09-29 两角差 0.07 属噪声 → 不挪(阈值 ${qa.MOVE_MIN_GAIN})`);

  console.log('\n--- 挪位不许挪到文字上方(09-30 的教训)---');
  // 判据是**垂直留白**不是几何相交:09-30 的 logo 框底在画布 18%、标题从 30% 起,
  // 两者根本不相交,按"重叠"判会放行 —— 但视觉上就是挤成一团。
  const H = 1024;
  const withText = (rows, textTop) => rows.map(([position, bgRgb, busyness]) => {
    const box = qa.logoFootprint(1024, H, { logoPosition: position, logoWidthRatio: 0.12 });
    const gap = Math.round(H * qa.LOGO_TEXT_MIN_GAP);
    return {
      position, bgRgb, busyness,
      luminance: +qa.relLuminance(bgRgb).toFixed(4),
      cBlue: +qa.contrastRatio(qa.BRAND_BLUE_RGB, bgRgb).toFixed(2),
      cWhite: +qa.contrastRatio(qa.WHITE_RGB, bgRgb).toFixed(2),
      overlapsText: (box.top + box.height + gap) > textTop * H,
    };
  });
  // 09-30:文字从 30% 起 → 左上只剩 12% 留白 → 不许挪过去
  const tight = qa.decideLogoPlacement(withText(REAL['2026-09-30 三代同堂'], 0.30), 'top_right');
  assert(tight.position === 'top_right', '09-30 文字太高 → 留在右上角(那里是空的)');
  assert(tight.scrim === true, '09-30 留在原位 → 用淡底衬补对比,而不是挪到文字上');
  assert(tight.variant === 'blue', '09-30 仍然是蓝版');
  // 同一张图,若文字排在 45%(留白 27%)→ 挪位恢复正常
  const loose = qa.decideLogoPlacement(withText(REAL['2026-09-30 三代同堂'], 0.45), 'top_right');
  assert(loose.position === 'top_left', '同一张图文字排低一点 → 又可以挪到左上');
  // Edwin 认可的三张不受影响
  for (const [name, top] of [['2026-09-01 卧室', 0.40], ['2026-09-03 客厅', 0.45]]) {
    const d = qa.decideLogoPlacement(withText(REAL[name], top), 'top_right');
    assert(d.position === 'top_left', `${name} 留白足够 → 挪位不受影响`);
  }
  // 提示词规定的文字区(42%)对顶部角落天然安全
  const declared = qa.decideLogoPlacement(withText(REAL['2026-09-30 三代同堂'], da.TEXT_ZONE_TOP), 'top_right');
  assert(declared.position === 'top_left', `提示词规定文字在 ${da.TEXT_ZONE_TOP * 100}% 以下时,顶部角落安全`);

  console.log('\n--- 单色背景(四角一样,无处可挪)才轮到底衬 ---');
  const flat = await qa.pickLogoPlacement(await solid([151, 118, 87]));
  assert(flat.variant === 'blue', '单色中间调 → 仍然蓝版');
  assert(flat.movedFromDefault === false, '四角一样就不挪(挪了也没收益)');
  assert(flat.scrim === true, '无处可挪且低于 2.5:1 → 这才用底衬');

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

  console.log('\n--- 底衬:确有提升,但刻意很小(实测,不是估算) ---');
  const { applyLogoOverlay } = require('./lib/compose');
  const brand = require('./lib/brand');
  let logoUrl = null;
  try { const la = await brand.getLogoAssetBySeries('lockup_blue'); logoUrl = la && la.public_url; } catch (_) {}
  if (!logoUrl) {
    console.log('  (跳过:取不到 logo 素材,需要 Supabase 凭证)');
  } else {
    for (const [name, rgb] of [['单色中间调 A', [153, 129, 105]], ['单色中间调 B', [151, 118, 87]]]) {
      const before = qa.contrastRatio(qa.BRAND_BLUE_RGB, rgb);
      const img = await applyLogoOverlay(await solid(rgb), {
        logoUrl, logoPosition: 'top_right', logoWidthRatio: 0.12, withBackdrop: false, logoScrim: true,
      });
      const box = qa.logoFootprint(1024, 1024, { logoPosition: 'top_right', logoWidthRatio: 0.12 });
      const st = await qa.regionStats(img, { left: box.left - 30, top: box.top + Math.round(box.height / 2) - 8, width: 20, height: 16 });
      const bg2 = [st.channels[0].mean, st.channels[1].mean, st.channels[2].mean].map(Math.round);
      const after = qa.contrastRatio(qa.BRAND_BLUE_RGB, bg2);
      // 第二版底衬刻意调得极淡(峰值 0.12,半径 2×),不再追求把对比抬过 3:1 ——
      // Edwin 的取舍是"看不出光圈"优先。所以只断言:确有提升、且提升幅度很小。
      assert(after > before, `${name}: ${before.toFixed(2)}:1 → ${after.toFixed(2)}:1 确有提升`);
      assert(after - before < 0.6, `${name}: 提升幅度 ${(after - before).toFixed(2)} 很小 —— 底衬是"几乎看不见"那一档`);
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
