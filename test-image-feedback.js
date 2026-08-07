// ============================================
// 配图反馈是否真的到达出图提示词 —— 离线,不出图,不花钱。
//
// 2026-08-06 走查发现:她在 Dashboard 说"换成傍晚的客厅",系统存了 [scene]、
// worker 也传了 topicOverride —— 但 topicOverride **只被已退役的合成链路读取**。
// 现在除节庆外全部走 ai_reference,那条分支根本没接这个参数:
// 随机重出一张,然后把 marker 当作"已消费"清掉。
// 界面显示"已重新生成",她的话一个字都没用上。
//
// 这比没有这个功能糟得多 —— 她会以为 AI 听不懂她说话,而不是功能坏了。
//
// 所以这里断言的是**那句话有没有出现在最终提示词里**,而不是"有没有报成功"。
// ============================================

const { buildReferenceImagePrompt } = require('./lib/design-agent');
const { buildFullAiPrompt, TEMPLATES, pickTemplate } = require('./lib/design-templates');
const { parseImageMarker } = require('./lib/worker');

let pass = 0, fail = 0;
function assert(cond, name, detail) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? `\n      ${detail}` : ''}`); }
}

const FEEDBACK = 'The headline is too large — make it much smaller. Use warmer wood tones. Move the fan lower.';

const ROW = {
  id: 'test', pillar: 'product', topic: 'DELTA56 in a bright living room',
  fb_content: 'A short post about the DELTA56 Pinewood in a bright Malaysian living room.',
  source_product_image: 'DELTA56 Pinewood',
};
const META = { model_code: 'DELTA56', catalog_model: 'DELTA56', size_inches: 56, blade_count: 6, color: 'Pinewood', has_led: true };

(async () => {
  console.log('\n--- marker 解析 ---');
  assert(parseImageMarker('[img] text too big').feedback === 'text too big',
    '[img] 解析出意见');
  assert(parseImageMarker('[scene] warm evening room').feedback === 'warm evening room',
    '[scene] 也走同一条通道(旧数据/旧入口不掉队)');
  assert(parseImageMarker('[product-next]').feedback == null, '[product-next] 不带意见');
  assert(parseImageMarker('').raw === false, '空 review_notes 不算 marker');
  assert(parseImageMarker('[img] x').raw === true, '[img] 用完要清 marker');

  console.log('\n--- ai_reference:意见必须进提示词(这是根本修复) ---');
  // 不联网:没有 OPENROUTER_API_KEY 时 deriveCreativeDirection 会走 fallback,
  // 提示词照样完整构建 —— 我们要验的是"意见有没有被拼进去",不是创意写得好不好。
  const saved = process.env.OPENROUTER_API_KEY;
  delete process.env.OPENROUTER_API_KEY;
  try {
    const withFb = await buildReferenceImagePrompt(
      ROW, TEMPLATES.lifestyle, 'DELTA56 Pinewood', null, META, null,
      { imageFeedback: FEEDBACK }
    );
    assert(withFb.prompt.includes(FEEDBACK), 'ai_reference 提示词里有她的原话',
      withFb.prompt.slice(-200));
    assert(/REVIEWER FEEDBACK/.test(withFb.prompt), '有明确的"审核意见"段落');
    assert(/overrides anything above/.test(withFb.prompt), '写明这段压过上面的通用规则');
    assert(withFb.prompt.indexOf(FEEDBACK) > withFb.prompt.length * 0.6,
      '意见排在提示词靠后(通用规则在前,这一张的具体要求在后)');

    const noFb = await buildReferenceImagePrompt(
      ROW, TEMPLATES.lifestyle, 'DELTA56 Pinewood', null, META, null, {}
    );
    assert(!/REVIEWER FEEDBACK/.test(noFb.prompt), '没有意见时完全不注入(首次出图不受影响)');

    console.log('\n--- 知识版式那条分支也要接上(它是另一段 prompt) ---');
    const kRow = { ...ROW, pillar: 'educational', angle: 'knowledge' };
    assert(pickTemplate(kRow).tag === 'knowledge_explainer', '知识帖路由到 knowledge_explainer');
    const kFb = await buildReferenceImagePrompt(
      kRow, TEMPLATES.knowledge_explainer, 'DELTA56 Pinewood', null, META, null,
      { imageFeedback: FEEDBACK }
    );
    assert(kFb.prompt.includes(FEEDBACK), '知识版式的提示词里也有她的原话');
    assert(/comparison panel/i.test(kFb.prompt), '(确认走的确实是知识版式那段,不是回落)');
  } finally {
    if (saved) process.env.OPENROUTER_API_KEY = saved;
  }

  console.log('\n--- 节庆(full_ai)那条也要接上 ---');
  const fest = buildFullAiPrompt(
    { topic: 'Selamat Hari Malaysia' }, TEMPLATES.festival_illustration, FEEDBACK
  );
  assert(fest.includes(FEEDBACK), '节庆提示词里有她的原话');
  assert(!buildFullAiPrompt({ topic: 'x' }, TEMPLATES.festival_illustration).includes('REVIEWER'),
    '节庆没有意见时不注入');

  // ── 重出时不许把她认可的文字换掉 ──
  // 2026-08-06 实证:她写 "Keep the same wording",字号/光线都照办了,
  // 文字却全换了(Lazy afternoon sanctuary → Lazy afternoon breeze)。
  // 因为提炼层每次重出都从正文重新压一遍短句,跟她的意见毫无关系。
  // 她想要的往往只是"字小一点",代价却是丢掉一句已经认可的标题。
  if (!process.env.OPENROUTER_API_KEY) {
    console.log('\n--- 重出时保留图上文字 --- (SKIP: 无 OPENROUTER_API_KEY)');
  } else {
    console.log('\n--- 重出时保留图上文字(真调 LLM) ---');
    const { deriveImageText } = require('./lib/design-agent');
    const CUR = { title: 'Lazy afternoon sanctuary', selling_point: 'Cool with Pinewood finish', cta: 'Drop us a message' };
    const same = (r) => r && r.title === CUR.title && r.selling_point === CUR.selling_point && r.cta === CUR.cta;
    const row = { pillar: 'product', fb_content: 'A post about the DELTA56 in a living room.', angle: 'scenario' };

    const keep = await deriveImageText(row, { currentTexts: CUR,
      imageFeedback: 'The headline is far too large — make it smaller and lower. Warm evening mood. Keep the same wording.' });
    assert(same(keep), '她说"保持原文字" → 三行逐字不变', JSON.stringify(keep));

    const colour = await deriveImageText(row, { currentTexts: CUR,
      imageFeedback: 'The wood tone looks too orange, make it paler.' });
    assert(same(colour), '她只提颜色 → 文字同样不动(改颜色不是改文案)', JSON.stringify(colour));

    const retitle = await deriveImageText(row, { currentTexts: CUR,
      imageFeedback: 'Change the headline to "Evening calm, all night" — everything else stays.' });
    assert(retitle && retitle.title === 'Evening calm, all night', '她明确要求换标题 → 标题照改');
    assert(retitle && retitle.selling_point === CUR.selling_point && retitle.cta === CUR.cta,
      '但副标题和 CTA 保持不变(只动她点名的那一行)');
  }

  console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
})();
