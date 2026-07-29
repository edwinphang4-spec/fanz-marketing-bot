// ============================================
// test-original-manual-prompt.js — 用 Edwin 最早那版手测 prompt(带 logo 当
// 参考图),直接跑我们的 gpt-image-1 API,跟 design-agent 自动生成版对比。
//
// 不经过 design-agent——就是原样这段 prompt + 产品图 + logo 两张参考图。
// ============================================

const fs = require('fs');
const os = require('os');
const path = require('path');

const PROMPT = `Create a premium e-commerce hero product banner for a ceiling fan, using the exact product shown in the attached product image — do not redesign, restyle, or alter the fan itself in any way; keep its exact shape, color, and details 100% accurate.

Composition: Place the fan as the clear hero subject, large and confidently filling the frame, mounted naturally on a ceiling with realistic contact shadow and ambient occlusion where the mount meets the ceiling. Studio-quality lighting that matches a high-end product photography shoot — soft key light from upper-left, subtle rim light to separate the product from the background, natural soft shadow beneath the blades.

Background: A clean, premium gradient background in deep navy blue with soft abstract light waves/arcs, similar to a modern tech-product launch poster. No literal room, no furniture — an abstract premium studio backdrop.

Typography: Add elegant, modern typography designed as part of the overall composition (not a plain text box) — a bold headline "GRANDE V2 SERIES", a smaller subheading "Whisper-Quiet DC Motor", and a small badge or tag reading "10-Year Motor Warranty". Choose type sizes, weights, and placement with real graphic-design judgement — vary hierarchy, use tasteful spacing, and let the layout breathe. White or light typography with enough contrast against the background; use a subtle graphic element (thin line, small shape, or color accent) to support the layout if it improves the design — no generic boxed text.

Logo: Place the attached logo (image 1) in the top-left corner at a natural, professional scale — do not distort or recolor it.

Format: Square 1:1, social-media-ready, e-commerce hero banner quality — think Shopee/Lazada/Amazon flagship listing image crossed with a premium tech brand poster. No watermarks other than the provided logo. No extra text, no fine print, no stock-photo look.`;

const PRODUCT_URL = 'https://ipozfadochzlljkxetcs.supabase.co/storage/v1/object/public/content-images/brand-assets/product/grandev2mb.png-1783860355469-8575e58f.png';
const LOGO_URL = 'https://ipozfadochzlljkxetcs.supabase.co/storage/v1/object/public/content-images/brand-assets/logo/logo-wordmark-white.png';

async function fetchBuffer(url) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`fetch failed: HTTP ${resp.status}`);
  return Buffer.from(await resp.arrayBuffer());
}

async function main() {
  if (!process.env.OPENAI_API_KEY) {
    console.error('OPENAI_API_KEY missing — this must be a real run.');
    process.exit(1);
  }

  const OpenAI = require('openai');
  const { toFile } = require('openai');
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  console.log('[1/3] Fetching product photo + logo...');
  const [productBuffer, logoBuffer] = await Promise.all([
    fetchBuffer(PRODUCT_URL),
    fetchBuffer(LOGO_URL),
  ]);

  // IMG_MODEL 可切换:gpt-image-1(旧,已测出 logo 张冠李戴)/ gpt-image-2
  // (Edwin 手动 ChatGPT 测试用的那一代)。input_fidelity 只有 1.x 系支持。
  const model = process.env.IMG_MODEL || 'gpt-image-1';
  const supportsFidelity = /^gpt-image-1(\.|$)/.test(model);
  console.log(`[2/3] Calling ${model} images.edit with product + logo as 2 reference images (Edwin's original manual-test prompt, unmodified)...`);
  const productFile = await toFile(productBuffer, 'product.png', { type: 'image/png' });
  const logoFile = await toFile(logoBuffer, 'logo.png', { type: 'image/png' });

  const t0 = Date.now();
  const response = await openai.images.edit({
    image: [productFile, logoFile],
    prompt: PROMPT,
    model,
    ...(supportsFidelity ? { input_fidelity: 'high' } : {}),
    quality: 'high',
    size: '1024x1024',
    background: 'opaque',
  });
  console.log(`  took ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  const first = response.data && response.data[0];
  if (!first || !first.b64_json) throw new Error(`${model} edit returned no image`);
  const buffer = Buffer.from(first.b64_json, 'base64');

  const outPath = path.join(os.homedir(), 'Desktop', `fanz-demo-original-manual-prompt-${model}.png`);
  fs.writeFileSync(outPath, buffer);
  console.log(`[3/3] Wrote ${(buffer.length / 1024).toFixed(0)}KB to ${outPath}`);
  console.log('DONE.');
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
