// ============================================
// test-full-real-chain.js — 全链路真实验证:copywriting → design-agent
// (含 deriveImageText 提炼) → gpt-image-2 (ai_reference,产品图+logo 双参考)
//
// 2026-07-24 改版:模型升级 gpt-image-2 后 logo/徽章由模型直出,
// applyLogoOverlay/applyBadgeOverlay 贴层已退役——成品即 API 返回原图。
// 真实调用，真实花钱，图写到 Desktop 并在对话里展示给 Edwin。
// ============================================

const fs = require('fs');
const os = require('os');
const path = require('path');
const { buildCopywritingPrompt, parseCopywritingResponse, validateCopywritingResult } = require('./lib/copywriting');
const { TEMPLATES } = require('./lib/design-templates');
const { buildReferenceImagePrompt } = require('./lib/design-agent');
const { generateReferenceImage } = require('./lib/reference-image-gen');
const { getLogoAssetBySeries } = require('./lib/brand');

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const MODEL = process.env.MODEL || 'gpt-4o';

async function callOpenRouter(messages) {
  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://fanz-marketing-bot.railway.app',
      'X-Title': 'Fanz Marketing Bot - Full Chain Test',
    },
    body: JSON.stringify({ model: MODEL, messages, max_tokens: 1500, temperature: 0.8 }),
  });
  if (!response.ok) throw new Error(`OpenRouter API error ${response.status}: ${await response.text()}`);
  const data = await response.json();
  return data.choices[0].message.content;
}

async function main() {
  if (!process.env.OPENAI_API_KEY || !OPENROUTER_API_KEY) {
    console.error('OPENAI_API_KEY / OPENROUTER_API_KEY missing — this must be a real run.');
    process.exit(1);
  }

  const productSource = 'https://ipozfadochzlljkxetcs.supabase.co/storage/v1/object/public/content-images/brand-assets/product/Vettaoak.png-1783860373956-ca40899d.png';
  const productName = 'Vetta Series (5-blade oak wood-tone ceiling fan with integrated LED light)';
  const topic = 'Vetta Series oak edition: 5 wood-tone blades with dimmable LED for warm modern homes';
  const pillar = 'product';

  console.log('[1/4] Copywriting Agent (real LLM call)...');
  const systemPrompt = buildCopywritingPrompt(topic, pillar);
  const rawResponse = await callOpenRouter([
    { role: 'system', content: systemPrompt },
    { role: 'user', content: `Generate the post based on this brief: "${topic}"` },
  ]);
  const parsed = parseCopywritingResponse(rawResponse);
  if (!parsed) throw new Error('Failed to parse copywriting response:\n' + rawResponse);
  const validation = validateCopywritingResult(parsed);
  console.log('  FB:', parsed.fb_content.split('\n')[0]);
  console.log('  validation:', validation.valid ? 'PASS' : 'FAIL - ' + validation.errors.join('; '));

  const row = { id: 'sim-gpt2-001', pillar, topic, fb_content: parsed.fb_content, ig_content: parsed.ig_content };

  console.log('[2/4] Resolving logo asset + building design prompt...');
  const template = TEMPLATES.product_intro;
  const logoAsset = await getLogoAssetBySeries(template.logoSeries);
  if (!logoAsset || !logoAsset.public_url) throw new Error('logo asset not resolved');

  const { prompt, texts, sceneMode } = await buildReferenceImagePrompt(row, template, productName, 'Warm, knowledgeable and down-to-earth — like a helpful friend who knows fans.');
  console.log('  scene mode:', sceneMode);
  console.log('  image texts:', JSON.stringify(texts));
  console.log('  --- FULL PROMPT ---\n' + prompt + '\n  --- END PROMPT ---');

  console.log('[3/4] Calling gpt-image-2 images.edit with product + logo as reference images (real API call, real cost)...');
  const t0 = Date.now();
  const result = await generateReferenceImage({ prompt, productSource, logoSource: logoAsset.public_url });
  console.log(`  took ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  if (!result.success) { console.error('FAILED:', result.error); process.exit(1); }

  const outPath = path.join(os.homedir(), 'Desktop', 'fanz-demo-gpt2-interior.png');
  fs.writeFileSync(outPath, result.buffer);
  console.log(`[4/4] Wrote ${(result.buffer.length / 1024).toFixed(0)}KB to ${outPath} (no overlays — model output is final)`);
  console.log('DONE.');
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
