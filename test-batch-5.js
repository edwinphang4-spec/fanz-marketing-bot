// ============================================
// test-batch-5.js — 小批量稳定性验证:5 篇不同 pillar × 不同产品 × 不同文案
// 全链路真实跑(copywriting → design-agent → gpt-image-2 双参考图直出)。
//
// 场景模式用生产默认权重(75% 室内实景 / 25% 海报),不强制——顺便验证
// 混合比例的真实观感。单条失败不中断批次,最后汇总。
// ============================================

const fs = require('fs');
const os = require('os');
const path = require('path');
const { buildCopywritingPrompt, parseCopywritingResponse, validateCopywritingResult } = require('./lib/copywriting');
const { TEMPLATES, pickTemplate } = require('./lib/design-templates');
const { buildReferenceImagePrompt } = require('./lib/design-agent');
const { generateReferenceImage } = require('./lib/reference-image-gen');
const { getLogoAssetBySeries } = require('./lib/brand');

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const MODEL = process.env.MODEL || 'gpt-4o';

const BATCH = [
  {
    tag: 'product-grandev2',
    pillar: 'product',
    topic: 'Grande V2 Series: the whisper-silent DC fan built for master bedrooms',
    productName: 'Grande V2 Series (3-blade matte black ceiling fan)',
    productSource: 'https://ipozfadochzlljkxetcs.supabase.co/storage/v1/object/public/content-images/brand-assets/product/grandev2mb.png-1783860355469-8575e58f.png',
  },
  {
    tag: 'case-spinor',
    pillar: 'case',
    topic: 'How the Spinor oscillating fan keeps a compact KL condo kitchen-dining corner cool while cooking',
    productName: 'Spinor Series (oscillating rotary-head ceiling fan)',
    productSource: 'https://ipozfadochzlljkxetcs.supabase.co/storage/v1/object/public/content-images/brand-assets/product/Spinor__1_-removebg-preview.png-1783860368931-9e8b7309.png',
  },
  {
    tag: 'promo-vettaoak',
    pillar: 'promo',
    topic: 'Merdeka month special: Vetta Series oak edition promo with free installation',
    productName: 'Vetta Series (5-blade oak wood-tone ceiling fan with integrated LED light)',
    productSource: 'https://ipozfadochzlljkxetcs.supabase.co/storage/v1/object/public/content-images/brand-assets/product/Vettaoak.png-1783860373956-ca40899d.png',
  },
  {
    tag: 'story-ferro',
    pillar: 'story',
    topic: '10+ years of keeping Malaysian families cool — the FERRO Series carries that promise forward',
    productName: 'FERRO Series (56-inch 3-blade ceiling fan, oak wood-tone finish, integrated LED light)',
    productSource: 'https://ipozfadochzlljkxetcs.supabase.co/storage/v1/object/public/content-images/brand-assets/product/FERRO_56_L_OAK-1783445389353-d80859ae.jpg',
  },
  {
    tag: 'case-vettamb-bedroom',
    pillar: 'case',
    topic: 'Vetta Series matte black: turning a warm master bedroom into a cool night retreat',
    productName: 'Vetta Series (5-blade matte black ceiling fan with integrated LED light)',
    productSource: 'https://ipozfadochzlljkxetcs.supabase.co/storage/v1/object/public/content-images/brand-assets/product/Vettamb.png-1783860376162-d21e80fe.png',
  },
];

async function callOpenRouter(messages) {
  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://fanz-marketing-bot.railway.app',
      'X-Title': 'Fanz Marketing Bot - Batch 5 Validation',
    },
    body: JSON.stringify({ model: MODEL, messages, max_tokens: 1500, temperature: 0.8 }),
  });
  if (!response.ok) throw new Error(`OpenRouter API error ${response.status}: ${await response.text()}`);
  const data = await response.json();
  return data.choices[0].message.content;
}

async function runOne(item, index) {
  console.log(`\n===== [${index + 1}/5] ${item.tag} (pillar=${item.pillar}) =====`);

  const systemPrompt = buildCopywritingPrompt(item.topic, item.pillar);
  const rawResponse = await callOpenRouter([
    { role: 'system', content: systemPrompt },
    { role: 'user', content: `Generate the post based on this brief: "${item.topic}"` },
  ]);
  const parsed = parseCopywritingResponse(rawResponse);
  if (!parsed) throw new Error('copywriting parse failed');
  const validation = validateCopywritingResult(parsed);
  console.log(`  copy: ${parsed.fb_content.split('\n')[0].slice(0, 100)}`);
  console.log(`  copy validation: ${validation.valid ? 'PASS' : 'FAIL - ' + validation.errors.join('; ')}`);

  const row = { id: `batch5-${item.tag}`, pillar: item.pillar, topic: item.topic, fb_content: parsed.fb_content, ig_content: parsed.ig_content };
  const template = pickTemplate(row);
  console.log(`  template: ${template.tag} (mode=${template.mode})`);
  if (template.mode !== 'ai_reference') {
    console.log('  SKIP image: template not ai_reference (festival/educational legacy path)');
    return { tag: item.tag, skipped: true };
  }

  const logoAsset = await getLogoAssetBySeries(template.logoSeries);
  if (!logoAsset || !logoAsset.public_url) throw new Error(`logo not resolved for series ${template.logoSeries}`);

  const { prompt, texts, sceneMode } = await buildReferenceImagePrompt(
    row, template, item.productName,
    'Warm, knowledgeable and down-to-earth — like a helpful friend who knows fans.'
  );
  console.log(`  scene mode: ${sceneMode}`);
  console.log(`  image texts: ${JSON.stringify(texts)}`);

  const t0 = Date.now();
  const result = await generateReferenceImage({ prompt, productSource: item.productSource, logoSource: logoAsset.public_url });
  console.log(`  image gen took ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  if (!result.success) throw new Error(result.error);

  const outPath = path.join(os.homedir(), 'Desktop', `fanz-batch-${index + 1}-${item.tag}.png`);
  fs.writeFileSync(outPath, result.buffer);
  console.log(`  saved: ${outPath}`);
  return { tag: item.tag, sceneMode, outPath, texts };
}

async function main() {
  if (!process.env.OPENAI_API_KEY || !OPENROUTER_API_KEY) {
    console.error('OPENAI_API_KEY / OPENROUTER_API_KEY missing — this must be a real run.');
    process.exit(1);
  }

  const results = [];
  for (let i = 0; i < BATCH.length; i++) {
    try {
      results.push(await runOne(BATCH[i], i));
    } catch (err) {
      console.error(`  FAILED [${BATCH[i].tag}]: ${err.message}`);
      results.push({ tag: BATCH[i].tag, error: err.message });
    }
  }

  console.log('\n===== BATCH SUMMARY =====');
  for (const r of results) {
    if (r.error) console.log(`  ✗ ${r.tag}: ${r.error}`);
    else if (r.skipped) console.log(`  - ${r.tag}: skipped (legacy path)`);
    else console.log(`  ✓ ${r.tag}: ${r.sceneMode} → ${path.basename(r.outPath)}`);
  }
  const failed = results.filter((r) => r.error).length;
  console.log(`\n${results.length - failed}/${results.length} completed, ${failed} failed`);
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
