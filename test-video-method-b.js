// ============================================
// test-video-method-b.js — 方案 B:动景 + 静态文案层
//
// ① gpt-image-2 出【无文字无 logo】纯场景图(产品在客厅,叶片可动)
// ② Veo 3.1 图生视频(只动叶片/窗帘,没有文字可糊)
// ③ sharp 渲染【静态文案层】(logo+标题+按钮+徽章,透明 PNG,100% 清晰)
// ④ ffmpeg 把静态层压在动态视频上 → 成品 mp4
//
// 实测结论驱动:视频模型会抹掉(Veo)或改写成乱码(Sora)图上已有文字,
// 所以文字绝不能进视频模型,只能后期叠。
// ============================================

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const DESK = path.join(os.homedir(), 'Desktop');
const SCENE_PATH = '/tmp/fanz-mb-scene.png';
const OVERLAY_PATH = '/tmp/fanz-mb-overlay.png';
const SCENE_VIDEO = '/tmp/fanz-mb-scene.mp4';
const FINAL_VIDEO = path.join(DESK, 'fanz-video-method-b.mp4');

const PRODUCT_URL = 'https://ipozfadochzlljkxetcs.supabase.co/storage/v1/object/public/content-images/brand-assets/product/Vettaoak.png-1783860373956-ca40899d.png';
const LOGO_URL = 'https://ipozfadochzlljkxetcs.supabase.co/storage/v1/object/public/content-images/brand-assets/logo/logo-wordmark-white.png';

const W = 720, H = 1280;

// 图上文案（跟 batch-3 一致，方便对比）
const TEXT = {
  headline: ['Free', 'Installation', 'This Month'],
  sub: '10-Year Motor Warranty',
  cta: 'Discover Now',
  badge: 'SIRIM Certified',
};

const SCENE_PROMPT =
  `Create a premium e-commerce lifestyle scene, portrait orientation, using the exact ceiling fan ` +
  `shown in the attached product image — do not redesign or alter the fan; keep its exact shape, ` +
  `colour and details 100% accurate. Mount the fan naturally on the ceiling of a bright, upscale ` +
  `modern Malaysian living room with warm wood accents, a large window with greenery outside, a ` +
  `light sofa and a wooden coffee table. Natural warm daylight, realistic contact shadow, ` +
  `photographed together — never pasted on. IMPORTANT: absolutely NO text, NO letters, NO numbers, ` +
  `NO logo, NO watermark, NO graphic overlays anywhere in the image — a clean photographic scene ` +
  `only. Keep the lower-left third and the top-left corner relatively clean and uncluttered.`;

const MOTION_PROMPT =
  'The ceiling fan blades spin smoothly and continuously at a realistic medium speed with natural ' +
  'motion blur. Sheer curtains and leaves outside sway very gently. Warm daylight unchanged. Camera ' +
  'is completely static — a locked-off shot, no zoom, no pan. Subtle, premium, seamless-loop motion. No people.';

async function fetchBuffer(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`fetch ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}

// ── ① 无文字场景图 ──
async function genScene() {
  const OpenAI = require('openai');
  const { toFile } = require('openai');
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const productFile = await toFile(await fetchBuffer(PRODUCT_URL), 'product.png', { type: 'image/png' });
  console.log('[1/4] gpt-image-2 generating text-free scene...');
  const resp = await openai.images.edit({
    image: [productFile], prompt: SCENE_PROMPT, model: 'gpt-image-2',
    quality: 'high', size: `${W}x${H}`, background: 'opaque',
  });
  fs.writeFileSync(SCENE_PATH, Buffer.from(resp.data[0].b64_json, 'base64'));
  console.log('  scene saved:', SCENE_PATH);
}

// ── ③ 静态文案层（透明 PNG）──
async function buildOverlay() {
  const sharp = require('sharp');
  console.log('[3/4] building static text/logo overlay...');

  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const gold = '#F0C24B';
  // 文案块锚在下半部左侧（跟 batch-3 版式一致）
  const hlY = 560, lineH = 78;
  const headlineSvg = TEXT.headline.map((ln, i) =>
    `<text x="56" y="${hlY + i * lineH}" font-family="Arial, sans-serif" font-size="70" font-weight="800" fill="#FFFFFF">${esc(ln)}</text>`
  ).join('');
  const subY = hlY + TEXT.headline.length * lineH + 24;
  const ctaY = subY + 54, ctaH = 62, ctaW = 250;
  const badgeY = ctaY + ctaH + 20, badgeH = 50;

  const svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
    <defs><filter id="sh" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="2" stdDeviation="6" flood-color="#000000" flood-opacity="0.55"/>
    </filter></defs>
    <g filter="url(#sh)">
      ${headlineSvg}
      <rect x="58" y="${subY - 34}" width="300" height="3" fill="${gold}"/>
      <text x="56" y="${subY}" font-family="Arial, sans-serif" font-size="30" font-weight="600" fill="#FFFFFF">${esc(TEXT.sub)}</text>
      <rect x="56" y="${ctaY}" width="${ctaW}" height="${ctaH}" rx="31" fill="${gold}"/>
      <text x="${56 + ctaW / 2}" y="${ctaY + ctaH / 2 + 9}" text-anchor="middle" font-family="Arial, sans-serif" font-size="27" font-weight="700" fill="#1a1a1a">${esc(TEXT.cta)}</text>
      <rect x="56" y="${badgeY}" width="270" height="${badgeH}" rx="25" fill="none" stroke="#FFFFFF" stroke-width="2"/>
      <text x="80" y="${badgeY + badgeH / 2 + 8}" font-family="Arial, sans-serif" font-size="24" font-weight="600" fill="#FFFFFF">✓ ${esc(TEXT.badge)}</text>
    </g>
  </svg>`;

  const base = await sharp(Buffer.from(svg)).png().toBuffer();
  // logo 左上
  const logoBuf = await fetchBuffer(LOGO_URL);
  const logoW = Math.round(W * 0.28);
  const logo = await sharp(logoBuf).resize(logoW, null, { fit: 'inside' }).png().toBuffer();
  await sharp(base).composite([{ input: logo, left: 44, top: 48 }]).png().toFile(OVERLAY_PATH);
  console.log('  overlay saved:', OVERLAY_PATH);
}

// ── ② Veo 3.1 图生视频 ──
async function genSceneVideo() {
  const key = process.env.GEMINI_API_KEY;
  const model = 'veo-3.1-generate-preview';
  const imageB64 = fs.readFileSync(SCENE_PATH).toString('base64');
  console.log('[2/4] Veo 3.1 animating the text-free scene...');
  const startRes = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:predictLongRunning?key=${key}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ instances: [{ prompt: MOTION_PROMPT, image: { bytesBase64Encoded: imageB64, mimeType: 'image/png' } }],
        parameters: { aspectRatio: '9:16', resolution: '720p', durationSeconds: 8 } }) }
  );
  if (!startRes.ok) throw new Error(`veo start ${startRes.status}: ${(await startRes.text()).slice(0, 300)}`);
  const op = await startRes.json();
  let result = null;
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 10_000));
    const st = await (await fetch(`https://generativelanguage.googleapis.com/v1beta/${op.name}?key=${key}`)).json();
    if (st.error) throw new Error(`veo failed: ${JSON.stringify(st.error).slice(0, 300)}`);
    if (st.done) { result = st; break; }
    if (i % 3 === 0) console.log(`  still generating... (${(i + 1) * 10}s)`);
  }
  if (!result) throw new Error('veo timed out');
  const resp = result.response || {};
  const samples = resp.generateVideoResponse?.generatedSamples || resp.generatedVideos || [];
  const uri = samples[0]?.video?.uri || samples[0]?.uri;
  if (!uri) throw new Error('veo: no uri — ' + JSON.stringify(resp).slice(0, 300));
  const dl = await fetch(uri.includes('key=') ? uri : `${uri}${uri.includes('?') ? '&' : '?'}key=${key}`);
  fs.writeFileSync(SCENE_VIDEO, Buffer.from(await dl.arrayBuffer()));
  console.log('  scene video saved:', SCENE_VIDEO);
}

// ── ④ ffmpeg 叠加 ──
function overlayOntoVideo() {
  console.log('[4/4] ffmpeg compositing static overlay onto video...');
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error',
    '-i', SCENE_VIDEO, '-i', OVERLAY_PATH,
    '-filter_complex', '[0:v][1:v]overlay=0:0:format=auto',
    '-c:a', 'copy', '-pix_fmt', 'yuv420p', FINAL_VIDEO]);
  console.log('  FINAL:', FINAL_VIDEO);
}

async function main() {
  if (!process.env.OPENAI_API_KEY || !process.env.GEMINI_API_KEY) {
    console.error('OPENAI_API_KEY / GEMINI_API_KEY missing'); process.exit(1);
  }
  await genScene();
  await buildOverlay();       // 与视频生成无依赖，可先备好
  await genSceneVideo();
  overlayOntoVideo();
  console.log('\nDONE — method B final video on Desktop.');
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1); });
