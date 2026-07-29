// ============================================
// test-ai-reference-mode.js — 真实验证 ai_reference 新架构（Task #4 小批量验证的第一张）
//
// 用真实 Grande V2 产品图 + 真实 logo，走完整 design-agent → reference-image-gen
// 链路，实打实调 gpt-image-1，把成品写到 Desktop 给 Edwin 肉眼核对。
// 不是 mock——2026-07-24 铁律：真测试，不自欺欺人。
// ============================================

const fs = require('fs');
const os = require('os');
const path = require('path');
const { TEMPLATES } = require('./lib/design-templates');
const { buildReferenceImagePrompt } = require('./lib/design-agent');
const { generateReferenceImage } = require('./lib/reference-image-gen');
const { applyLogoOverlay } = require('./lib/compose');
const { getLogoAssetBySeries } = require('./lib/brand');

async function main() {
  if (!process.env.OPENAI_API_KEY) {
    console.error('OPENAI_API_KEY missing — this must be a REAL run, not dry-run. Aborting.');
    process.exit(1);
  }

  const row = {
    id: 'test-ai-reference-001',
    pillar: 'product',
    topic: 'Grande V2 Series',
    selling_point: 'Whisper-Quiet DC Motor',
    cta_text: 'Shop Now',
    promo_badge: '10-Year Motor Warranty',
    fb_content: 'Introducing the Grande V2 Series — engineered with a whisper-quiet DC motor and backed by a 10-year motor warranty. The air mover Malaysian homes trust.',
  };

  const template = TEMPLATES.product_intro;
  const productSource = 'https://ipozfadochzlljkxetcs.supabase.co/storage/v1/object/public/content-images/brand-assets/product/grandev2mb.png-1783860355469-8575e58f.png';

  console.log('[1/4] Resolving logo asset (wordmark_white)...');
  const logoAsset = await getLogoAssetBySeries(template.logoSeries);
  if (!logoAsset || !logoAsset.public_url) throw new Error('logo asset not resolved — check brand_assets table');
  console.log('  logo URL:', logoAsset.public_url);

  console.log('[2/4] design-agent building prompt (LLM creative direction + literal copy)...');
  const { prompt, source } = await buildReferenceImagePrompt(row, template, 'Grande V2 Series (matte black ceiling fan)', 'Warm, knowledgeable and down-to-earth — like a helpful friend who knows fans.');
  console.log(`  direction source: ${source}`);
  console.log('  --- FULL PROMPT ---\n' + prompt + '\n  --- END PROMPT ---');

  console.log('[3/4] Calling gpt-image-1 images.edit with product photo as reference image (real API call, real cost)...');
  const t0 = Date.now();
  const result = await generateReferenceImage({ prompt, productSource });
  console.log(`  took ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  if (!result.success) {
    console.error('FAILED:', result.error);
    process.exit(1);
  }

  console.log('[4/4] Overlaying real logo deterministically, writing to Desktop...');
  const finalBuffer = await applyLogoOverlay(result.buffer, {
    logoUrl: logoAsset.public_url,
    logoPosition: template.logoPosition,
    logoWidthRatio: template.logoWidthRatio,
  });
  const outPath = path.join(os.homedir(), 'Desktop', 'fanz-demo-ai-reference-v2.png');
  fs.writeFileSync(outPath, finalBuffer);
  console.log(`  Wrote ${(finalBuffer.length / 1024).toFixed(0)}KB to ${outPath}`);
  console.log('DONE — open the file on Desktop to review.');
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
