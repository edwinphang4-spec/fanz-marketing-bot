// ============================================
// test-copy-to-design-agent.js — 模拟:copywriting Agent 写文案 → design Agent 写图片 prompt
//
// 只测两个 LLM 环节(便宜),不调 gpt-image-1(不产生图像生成费用)。
// 真实调用 OpenRouter,不是 mock。
// ============================================

const {
  buildCopywritingPrompt,
  parseCopywritingResponse,
  validateCopywritingResult,
} = require('./lib/copywriting');
const { TEMPLATES } = require('./lib/design-templates');
const { buildReferenceImagePrompt } = require('./lib/design-agent');

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const MODEL = process.env.MODEL || 'gpt-4o';

async function callOpenRouter(messages) {
  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://fanz-marketing-bot.railway.app',
      'X-Title': 'Fanz Marketing Bot - Copy to Design Agent Simulation',
    },
    body: JSON.stringify({ model: MODEL, messages, max_tokens: 1500, temperature: 0.8 }),
  });
  if (!response.ok) throw new Error(`OpenRouter API error ${response.status}: ${await response.text()}`);
  const data = await response.json();
  return data.choices[0].message.content;
}

async function main() {
  if (!OPENROUTER_API_KEY) {
    console.error('OPENROUTER_API_KEY missing — need a real key for this simulation.');
    process.exit(1);
  }

  const topic = 'AURA Series: the compact DC fan built for small bedrooms and condo units';
  const pillar = 'product';

  console.log('=== STEP 1: Copywriting Agent (real LLM call) ===');
  console.log(`Topic: ${topic}\nPillar: ${pillar}\n`);

  const systemPrompt = buildCopywritingPrompt(topic, pillar);
  const rawResponse = await callOpenRouter([
    { role: 'system', content: systemPrompt },
    { role: 'user', content: `Generate the post based on this brief: "${topic}"` },
  ]);

  const parsed = parseCopywritingResponse(rawResponse);
  if (!parsed) throw new Error('Failed to parse copywriting response:\n' + rawResponse);

  const validation = validateCopywritingResult(parsed);
  console.log('--- FB VERSION ---\n' + parsed.fb_content);
  console.log('\n--- IG VERSION ---\n' + parsed.ig_content);
  console.log('\n--- HASHTAGS ---\n' + parsed.hashtags);
  console.log(`\nvalidation: ${validation.valid ? 'PASS' : 'FAIL — ' + validation.errors.join('; ')}`);
  console.log(`brand keywords hit: ${validation.keywordsHit.join(', ') || '(none)'}`);

  // 模拟 content_calendar row —— 注意:selling_point / cta_text / promo_badge
  // 目前在真实管线里没有任何环节从 fb_content/ig_content 自动提炼,只有
  // Dashboard 手动编辑会填。这里刻意留空，如实反映现状（不是漏了，是真的
  // 还没接这一段）。
  const row = {
    id: 'sim-001',
    pillar,
    topic,
    fb_content: parsed.fb_content,
    ig_content: parsed.ig_content,
  };

  console.log('\n\n=== STEP 2: Design Agent (real LLM call → creative direction + literal prompt assembly) ===');
  const template = TEMPLATES.product_intro;
  const { prompt, source } = await buildReferenceImagePrompt(
    row,
    template,
    'AURA Series (compact ceiling fan)',
    'Warm, knowledgeable and down-to-earth — like a helpful friend who knows fans.'
  );
  console.log(`creative direction source: ${source}\n`);
  console.log('--- FULL IMAGE-GEN PROMPT (would go to gpt-image-1) ---');
  console.log(prompt);
  console.log('--- END PROMPT ---');

  console.log('\n\nNOTE: row.selling_point / row.cta_text / row.promo_badge were empty on this row —');
  console.log('design-agent.deriveImageText() extracted headline/subheading/CTA/badge straight from');
  console.log('fb_content above. If any of those fields were set manually (Dashboard edit), they would');
  console.log('be respected as-is and this derivation step would be skipped entirely.');
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
