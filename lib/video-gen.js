// ============================================
// video-gen.js — 每周动态视频生成（方案 B：动景 + 静态文案层）
//
// 实测结论驱动的架构（2026-07-24）：
//   图生视频模型（Veo / Sora）都保不住画面里已有的文字——Veo 直接抹掉，
//   Sora 重绘成乱码。所以文字绝不进视频模型，只能后期叠。
//
// 流水线：
//   ① gpt-image-2 出【无文字无 logo】纯室内场景图（产品自然装在天花板）
//   ② Veo 3.1 图生视频（只动叶片/窗帘，没有文字可糊）
//   ③ sharp 渲染【静态文案层】(logo + 标题/副标题/CTA/徽章，透明 PNG)
//   ④ ffmpeg 把静态层压在动态视频上 → 成品 mp4
//   ⑤ 上传 Supabase Storage
//
// 文案复用静态图那份（compose_spec.image_texts），保证动图与配套帖子的
// 图上文字一字不差。室内场景（不是抽象海报）——窗帘/绿植会动，海报背景是
// 死的，动起来没意义。
// ============================================

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const execFileAsync = promisify(execFile);

const brand = require('./brand');
const { pickTemplate } = require('./design-templates');
const { buildReferenceImagePrompt } = require('./design-agent');
const { uploadFile } = require('./store-image');

const W = 720, H = 1280;
const SCENE_TIMEOUT_MS = 240_000;
const VEO_POLL_MS = 10_000;
const VEO_MAX_POLLS = 60; // 10 分钟上限
const VEO_MODEL = process.env.VIDEO_MODEL || 'veo-3.1-generate-preview';

function isDryRun() {
  return !process.env.OPENAI_API_KEY || !process.env.GEMINI_API_KEY;
}

async function fetchBuffer(source) {
  if (/^https?:\/\//i.test(source)) {
    const r = await fetch(source);
    if (!r.ok) throw new Error(`asset fetch ${r.status}`);
    return Buffer.from(await r.arrayBuffer());
  }
  if (!fs.existsSync(source)) throw new Error(`asset not found: ${source}`);
  return fs.readFileSync(source);
}

/**
 * 瞬时错误重试（5xx / 网络抖动 / 超时）——视频链贵且长，单个瞬时抖动不该
 * 让整条白跑。计费/配额类错误(4xx billing/quota)不重试，直接上抛。
 */
async function withRetry(fn, label, log, tries = 3) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const msg = err.message || '';
      if (/billing|quota|insufficient|content policy|safety|moderation/i.test(msg)) throw err; // 永久失败，别重试
      if (i < tries - 1) {
        const wait = 3000 * (i + 1);
        log && log(`${label} transient error (${msg.slice(0, 80)}) — retry ${i + 1}/${tries - 1} in ${wait / 1000}s`);
        await new Promise((r) => setTimeout(r, wait));
      }
    }
  }
  throw lastErr;
}

// ── 产品解析（轻量版，产品来自已出图的行，source_product_image 一般能解析）──
async function resolveProductSource(row) {
  const name = row.source_product_image || null;
  if (name) {
    try {
      const asset = await brand.getProductAssetByName(name);
      if (asset && asset.public_url) return asset.public_url;
    } catch (_) {}
  }
  const list = await brand.listProductAssets();
  if (list.length > 0) return list[0].public_url;
  throw new Error('no product asset resolvable for video');
}

// ── 图上文案：优先复用静态图那份，缺了才重新提炼 ──
async function resolveImageTexts(row, template) {
  let spec = {};
  try { spec = typeof row.compose_spec === 'object' ? row.compose_spec : JSON.parse(row.compose_spec || '{}'); } catch (_) {}
  if (spec.image_texts && spec.image_texts.title) return spec.image_texts;
  // 兜底：重新提炼（LLM 温度>0，可能与静态图略有出入，但不阻断）
  try {
    let brandVoice = null;
    try { brandVoice = (await brand.getBrandKit()).brand_voice; } catch (_) {}
    const { texts } = await buildReferenceImagePrompt(row, template, row.source_product_image, brandVoice);
    return texts;
  } catch (_) {
    return { title: row.topic || 'Fanz', selling_point: '', cta: '', promo_badge: '' };
  }
}

// ── ① 无文字场景图 ──
async function genTextFreeScene(productSource, productName, log) {
  // 测试缝：VIDEO_SCENE_OVERRIDE 指向本地图片时直接读它，跳过 gpt-image-2
  // （用于 OpenAI 宕机时验证后半段流程；生产环境该变量始终未设，无影响）。
  const override = process.env.VIDEO_SCENE_OVERRIDE;
  if (override && fs.existsSync(override)) {
    log && log(`scene: using override file ${override} (gpt-image-2 bypassed)`);
    return fs.readFileSync(override);
  }
  const OpenAI = require('openai');
  const { toFile } = require('openai');
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const prompt =
    `Create a premium e-commerce lifestyle scene, portrait orientation, using the exact ceiling fan ` +
    `shown in the attached product image — do not redesign or alter the fan; keep its exact shape, ` +
    `colour and details 100% accurate. Mount the fan naturally on the ceiling of a bright, upscale ` +
    `modern Malaysian living room with warm wood accents, a large window with greenery outside, sheer ` +
    `curtains, a light sofa and a wooden coffee table. Natural warm daylight, realistic contact shadow, ` +
    `photographed together — never pasted on. IMPORTANT: absolutely NO text, NO letters, NO numbers, ` +
    `NO logo, NO watermark, NO graphic overlays anywhere — a clean photographic scene only. Keep the ` +
    `lower-left third and the top-left corner relatively clean and uncluttered.`;
  const productFile = await toFile(await fetchBuffer(productSource), 'product.png', { type: 'image/png' });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SCENE_TIMEOUT_MS);
  try {
    log && log('scene: gpt-image-2 generating text-free room...');
    const resp = await openai.images.edit(
      { image: [productFile], prompt, model: 'gpt-image-2', quality: 'high', size: `${W}x${H}`, background: 'opaque' },
      { signal: controller.signal }
    );
    const first = resp.data && resp.data[0];
    if (!first || !first.b64_json) throw new Error('gpt-image-2 returned no scene');
    return Buffer.from(first.b64_json, 'base64');
  } finally {
    clearTimeout(timer);
  }
}

// ── ② Veo 3.1 图生视频 ──
async function animateScene(sceneBuffer, log) {
  const key = process.env.GEMINI_API_KEY;
  const motion =
    'The ceiling fan blades spin smoothly and continuously at a realistic medium speed with natural ' +
    'motion blur. Sheer curtains and leaves outside sway very gently. Warm daylight unchanged. Camera ' +
    'is completely static — a locked-off shot, no zoom, no pan. Subtle, premium, seamless-loop motion. No people.';
  const startRes = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${VEO_MODEL}:predictLongRunning?key=${key}`,
    {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        instances: [{ prompt: motion, image: { bytesBase64Encoded: sceneBuffer.toString('base64'), mimeType: 'image/png' } }],
        parameters: { aspectRatio: '9:16', resolution: '720p', durationSeconds: 8 },
      }),
    }
  );
  if (!startRes.ok) throw new Error(`veo start ${startRes.status}: ${(await startRes.text()).slice(0, 200)}`);
  const op = await startRes.json();
  log && log(`veo: job ${op.name} started`);
  for (let i = 0; i < VEO_MAX_POLLS; i++) {
    await new Promise((r) => setTimeout(r, VEO_POLL_MS));
    const st = await (await fetch(`https://generativelanguage.googleapis.com/v1beta/${op.name}?key=${key}`)).json();
    if (st.error) throw new Error(`veo failed: ${JSON.stringify(st.error).slice(0, 200)}`);
    if (st.done) {
      const resp = st.response || {};
      const samples = resp.generateVideoResponse?.generatedSamples || resp.generatedVideos || [];
      const uri = samples[0]?.video?.uri || samples[0]?.uri;
      if (!uri) throw new Error('veo: no video uri in response');
      const dl = await fetch(uri.includes('key=') ? uri : `${uri}${uri.includes('?') ? '&' : '?'}key=${key}`);
      if (!dl.ok) throw new Error(`veo download ${dl.status}`);
      return Buffer.from(await dl.arrayBuffer());
    }
    if (i % 3 === 0) log && log(`veo: still generating (${(i + 1) * 10}s)`);
  }
  throw new Error('veo timed out');
}

// ── ③ 静态文案层（透明 PNG）──
function wrapWords(str, maxChars) {
  const words = String(str || '').trim().split(/\s+/);
  const lines = [];
  let cur = '';
  for (const w of words) {
    if (!cur) { cur = w; }
    else if ((cur + ' ' + w).length <= maxChars) { cur += ' ' + w; }
    else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  return lines.slice(0, 3);
}

async function buildOverlay(texts, template, log) {
  const sharp = require('sharp');
  log && log('overlay: rendering static text/logo layer...');
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const gold = '#F0C24B';

  const headlineLines = wrapWords(texts.title || 'Fanz', 14);
  const hlSize = headlineLines.length >= 3 ? 62 : 70;
  const lineH = hlSize + 8;
  const hlTop = 560;
  const headlineSvg = headlineLines.map((ln, i) =>
    `<text x="56" y="${hlTop + i * lineH}" font-family="Arial, sans-serif" font-size="${hlSize}" font-weight="800" fill="#FFFFFF">${esc(ln)}</text>`
  ).join('');

  let y = hlTop + headlineLines.length * lineH + 20;
  const parts = [headlineSvg];
  if (texts.selling_point) {
    parts.push(`<rect x="58" y="${y - 30}" width="300" height="3" fill="${gold}"/>`);
    parts.push(`<text x="56" y="${y}" font-family="Arial, sans-serif" font-size="30" font-weight="600" fill="#FFFFFF">${esc(texts.selling_point)}</text>`);
    y += 54;
  }
  if (texts.cta) {
    const ctaW = Math.max(200, 44 + String(texts.cta).length * 16), ctaH = 62;
    parts.push(`<rect x="56" y="${y}" width="${ctaW}" height="${ctaH}" rx="31" fill="${gold}"/>`);
    parts.push(`<text x="${56 + ctaW / 2}" y="${y + ctaH / 2 + 9}" text-anchor="middle" font-family="Arial, sans-serif" font-size="27" font-weight="700" fill="#1a1a1a">${esc(texts.cta)}</text>`);
    y += ctaH + 20;
  }
  if (texts.promo_badge) {
    const bW = Math.max(220, 60 + String(texts.promo_badge).length * 13), bH = 50;
    parts.push(`<rect x="56" y="${y}" width="${bW}" height="${bH}" rx="25" fill="none" stroke="#FFFFFF" stroke-width="2"/>`);
    parts.push(`<text x="80" y="${y + bH / 2 + 8}" font-family="Arial, sans-serif" font-size="23" font-weight="600" fill="#FFFFFF">✓ ${esc(texts.promo_badge)}</text>`);
  }

  const svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
    <defs><filter id="sh" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="2" stdDeviation="6" flood-color="#000000" flood-opacity="0.55"/>
    </filter></defs>
    <g filter="url(#sh)">${parts.join('')}</g>
  </svg>`;
  let overlay = await sharp(Buffer.from(svg)).png().toBuffer();

  // logo 左上（按模板 series 挑变体，查不到跳过——logo 缺失不该拖垮视频）
  try {
    const la = await brand.getLogoAssetBySeries(template.logoSeries);
    const logoUrl = la && la.public_url;
    if (logoUrl) {
      const logoW = Math.round(W * 0.28);
      const logo = await sharp(await fetchBuffer(logoUrl)).resize(logoW, null, { fit: 'inside' }).png().toBuffer();
      overlay = await sharp(overlay).composite([{ input: logo, left: 44, top: 48 }]).png().toBuffer();
    }
  } catch (e) {
    log && log(`overlay: logo skipped (${e.message})`);
  }
  return overlay;
}

// ── ④ ffmpeg 叠加 ──
async function compositeOverlay(sceneVideoPath, overlayPath, outPath) {
  await execFileAsync('ffmpeg', ['-y', '-loglevel', 'error',
    '-i', sceneVideoPath, '-i', overlayPath,
    '-filter_complex', '[0:v][1:v]overlay=0:0:format=auto',
    '-c:a', 'copy', '-pix_fmt', 'yuv420p', outPath], { timeout: 120_000 });
}

/**
 * Generate a dynamic video for one content_calendar row (method B).
 *
 * @param {object} row - content_calendar row (must be image_ready+, have source_product_image)
 * @param {object} [opts]
 * @param {Function} [opts.log] - progress logger (msg) => void
 * @returns {Promise<{success: boolean, videoUrl?: string, dryRun?: boolean, error?: string}>}
 */
async function generatePostVideo(row, opts = {}) {
  const log = opts.log || (() => {});
  try {
    const template = pickTemplate(row);
    const [productSource, texts] = await Promise.all([
      resolveProductSource(row),
      resolveImageTexts(row, template),
    ]);

    if (isDryRun()) return { success: true, dryRun: true };

    // ① scene  ② overlay 可并行（无依赖），scene 带瞬时重试
    const [sceneBuffer, overlayBuffer] = await Promise.all([
      withRetry(() => genTextFreeScene(productSource, row.source_product_image || 'ceiling fan', log), 'scene', log),
      buildOverlay(texts, template, log),
    ]);

    // ② veo（带瞬时重试）
    const sceneVideoBuffer = await withRetry(() => animateScene(sceneBuffer, log), 'veo', log);

    // ④ ffmpeg
    const short = (row.id || 'unknown').replace(/-/g, '').slice(0, 12);
    const ts = Date.now();
    const tmpVideo = path.join(os.tmpdir(), `vid-scene-${short}-${ts}.mp4`);
    const tmpOverlay = path.join(os.tmpdir(), `vid-ov-${short}-${ts}.png`);
    const tmpFinal = path.join(os.tmpdir(), `vid-final-${short}-${ts}.mp4`);
    fs.writeFileSync(tmpVideo, sceneVideoBuffer);
    fs.writeFileSync(tmpOverlay, overlayBuffer);
    try {
      log('ffmpeg: compositing overlay onto video...');
      await compositeOverlay(tmpVideo, tmpOverlay, tmpFinal);

      // ⑤ upload
      const now = new Date();
      const storagePath = `videos/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${short}-${ts}.mp4`;
      const { publicUrl } = await uploadFile(tmpFinal, storagePath);
      log(`uploaded: ${publicUrl}`);
      return { success: true, videoUrl: publicUrl };
    } finally {
      for (const p of [tmpVideo, tmpOverlay, tmpFinal]) { try { fs.unlinkSync(p); } catch (_) {} }
    }
  } catch (err) {
    return { success: false, error: err.message };
  }
}

module.exports = { generatePostVideo };
