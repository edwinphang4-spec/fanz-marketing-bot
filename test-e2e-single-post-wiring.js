// ============================================
// 单篇路的「说了算不算数」干测 —— 走真实 DB + 真实文案生成，**不出图**。
//
// 验的是 2026-08-05 查出来的两条:
//   ① 老板娘说 INNO525L,出来的必须是 INNO525L(实测事故:说 INNO525L 出 DELTA56)
//   ② knowledge 角度的图上文字必须是那条知识,不是规格
//      (实测事故:教育帖图上印 "56-inch Diameter",而不是"卧室 45-56 吋")
//
// 跑法: node --env-file=.env test-e2e-single-post-wiring.js
// 花费: 3 次 gpt-4o 文本调用，无出图。跑完自动删掉建出来的行。
// ============================================

const supabase = require('./lib/supabase');
const { generateCopy } = require('./lib/generate-copy');
const { resolveAssetByModel } = require('./lib/pick-product');
const { deriveImageText } = require('./lib/design-agent');

let pass = 0, fail = 0;
function assert(cond, name, detail) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? `\n      ${detail}` : ''}`); }
}

// 她在 Telegram 里说的那句话，被 Mark 转成的草稿
const DRAFT = {
  title: 'Maximizing Comfort: How to Choose the Right Fan for Your Space',
  pillar: 'educational',
  product: 'INNO525L',
  angle: "Learn how the INNO525L's five-blade design enhances air circulation.",
  suggested_date: '',
};

async function callOpenRouter(messages, maxTokens = 1200) {
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: process.env.MODEL || 'openai/gpt-4o',
      messages, max_tokens: maxTokens, temperature: 0.7,
    }),
  });
  if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${await res.text()}`);
  return (await res.json()).choices[0].message.content;
}

(async () => {
  let rowId = null;
  try {
    console.log('\n--- ① 她指定的型号,建行时就必须落上 ---');
    const resolved = await resolveAssetByModel(DRAFT.product);
    assert(resolved !== null, `"${DRAFT.product}" 能在素材库里解析出来`);
    assert(resolved && /^INNO525L/.test(resolved.name),
      `解析结果是 INNO525L 而不是别的型号 → ${resolved && resolved.name}`);

    const row = await supabase.createContentCalendar({
      chat_id: 'drytest',
      pillar: DRAFT.pillar,
      topic: DRAFT.title,
      post_angle: DRAFT.angle,
      status: 'selected',
      ...(resolved ? { source_product_image: resolved.name } : {}),
    });
    rowId = row.id;
    assert(row.source_product_image === resolved.name,
      `建行时 source_product_image 已经是她说的那台 → ${row.source_product_image}`);

    console.log('\n--- ② 文案生成:型号 + 角度都要落回行上 ---');
    const { parsed, meta } = await generateCopy({
      row, topic: DRAFT.title, pillar: DRAFT.pillar, callLLM: callOpenRouter,
    });
    assert(meta.angle === 'knowledge', `这篇的角度是 knowledge → ${meta.angle}`);

    // 调用方落库正文(index.js 里就是这一步),否则提炼层拿不到文字
    await supabase.updateContentCalendar(rowId, {
      fb_content: parsed.fb_content,
      ig_content: parsed.ig_content,
      hashtags: parsed.hashtags,
      status: 'copy_done',
    });

    const after = await supabase.getContentCalendar(rowId);
    const spec = typeof after.compose_spec === 'string'
      ? JSON.parse(after.compose_spec || '{}') : (after.compose_spec || {});
    assert(spec.angle === 'knowledge',
      `角度写进了 compose_spec(旧版这里是空的,出图才会抓错) → ${spec.angle}`);
    assert(after.source_product_image === resolved.name,
      `型号没有被中途换掉 → ${after.source_product_image}`);

    const body = `${parsed.fb_content}\n${parsed.ig_content}`;
    assert(!/DELTA|GAZE|FS\s?\d|AURA|GRANDE|FERRO/i.test(body),
      '正文没有写成别的系列', body.slice(0, 200));
    assert(/INNO\s?525L/i.test(body), '正文写的就是 INNO525L');

    console.log('\n--- ③ 图上文字:抓知识点,不是规格 ---');
    // pipeline.js:216 的那一行 —— 出图前把 compose_spec 里的角度挂回 row
    if (!after.angle && spec.angle) after.angle = spec.angle;
    assert(after.angle === 'knowledge', '出图层拿到了角度(不再回落到 spec 角度)');

    const texts = await deriveImageText(after, {});
    console.log(`      HEADLINE: ${texts && texts.title}`);
    console.log(`      SUB:      ${texts && texts.selling_point}`);
    console.log(`      CTA:      ${texts && texts.cta}`);
    const headline = (texts && texts.title) || '';
    const sub = (texts && texts.selling_point) || '';
    assert(!/^\s*\d{2}[-\s]?inch\b/i.test(headline),
      '标题不再是干巴巴的产品规格("56-inch Diameter"那种)', headline);
    assert(/room|bedroom|size|choose|match|space|fit/i.test(`${headline} ${sub}`),
      '标题/副标题讲的是"怎么选"这条知识', `${headline} / ${sub}`);

    console.log('\n--- ④ 正文里的选尺寸区间必须对得上官方表 ---');
    const { checkFabricatedClaims } = require('./lib/qa-claims');
    const claims = checkFabricatedClaims(body, null);
    assert(claims.ok, '生成的正文过编造拦截', claims.blocking.join(' | '));
  } catch (err) {
    fail++;
    console.error('\n✗ 干测中断:', err.message);
  } finally {
    if (rowId) {
      try {
        const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
        await fetch(`${SUPABASE_URL}/rest/v1/content_calendar?id=eq.${rowId}`, {
          method: 'DELETE',
          headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` },
        });
        console.log(`\n(已删掉干测建的行 ${rowId})`);
      } catch (e) { console.error(`⚠️ 干测行 ${rowId} 没删掉,手动清一下:`, e.message); }
    }
  }
  console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
})();
