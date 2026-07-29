// ============================================
// test-video-ab.js — 图生视频 A/B:Veo 3.1 vs Sora 2
//
// 首帧 = 批次③成品海报(Vetta 橡木客厅图),1:1 → 720x1280 竖屏
// (中央原图 + 上下模糊延展,Reels/TikTok 标准做法)。
// 动效:风扇叶片平滑旋转、窗帘微飘、镜头/文字/logo 全静止。
// 两家并行真实调用,各出一条 8s,存 Desktop。
// ============================================

const fs = require('fs');
const os = require('os');
const path = require('path');
const sharp = require('sharp');

const SRC_IMAGE = path.join(os.homedir(), 'Desktop', 'fanz-batch-3-promo-vettaoak.png');
const FRAME_PATH = '/tmp/fanz-video-frame-916.png';

const MOTION_PROMPT =
  'The ceiling fan blades spin smoothly and continuously at a realistic medium speed, with natural motion blur. ' +
  'The sheer curtains sway very gently as if touched by the breeze. Warm lighting stays unchanged. ' +
  'Camera is completely static — a locked-off shot, no zoom, no pan. ' +
  'All text, the logo, the button and the badge remain perfectly still, sharp and unchanged throughout. ' +
  'Subtle, premium, seamless-loop-friendly motion. No people appear.';

async function buildFrame() {
  const src = fs.readFileSync(SRC_IMAGE);
  const bg = await sharp(src).resize(720, 1280, { fit: 'cover' }).blur(40).modulate({ brightness: 0.75 }).toBuffer();
  const fg = await sharp(src).resize(720, 720).toBuffer();
  await sharp(bg).composite([{ input: fg, left: 0, top: 280 }]).png().toFile(FRAME_PATH);
  console.log('[frame] built 720x1280 first frame at', FRAME_PATH);
}

// ── Veo 3.1 (Gemini API, predictLongRunning + poll) ──
async function runVeo() {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY missing');
  const model = 'veo-3.1-generate-preview';
  const imageB64 = fs.readFileSync(FRAME_PATH).toString('base64');

  const startRes = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:predictLongRunning?key=${key}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        instances: [{ prompt: MOTION_PROMPT, image: { bytesBase64Encoded: imageB64, mimeType: 'image/png' } }],
        parameters: { aspectRatio: '9:16', resolution: '720p', durationSeconds: 8 },
      }),
    }
  );
  if (!startRes.ok) throw new Error(`veo start ${startRes.status}: ${(await startRes.text()).slice(0, 300)}`);
  const op = await startRes.json();
  console.log('[veo] operation:', op.name);

  let result = null;
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 10_000));
    const pollRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/${op.name}?key=${key}`);
    if (!pollRes.ok) throw new Error(`veo poll ${pollRes.status}`);
    const st = await pollRes.json();
    if (st.error) throw new Error(`veo failed: ${JSON.stringify(st.error).slice(0, 300)}`);
    if (st.done) { result = st; break; }
    if (i % 3 === 0) console.log(`[veo] still generating... (${(i + 1) * 10}s)`);
  }
  if (!result) throw new Error('veo timed out after 10min');

  const resp = result.response || {};
  const samples = resp.generateVideoResponse?.generatedSamples || resp.generatedVideos || [];
  const first = samples[0] || {};
  const uri = first.video?.uri || first.uri;
  if (!uri) throw new Error('veo: no video uri in response — keys: ' + JSON.stringify(Object.keys(resp)) + ' / ' + JSON.stringify(resp).slice(0, 400));

  const dlUrl = uri.includes('key=') ? uri : `${uri}${uri.includes('?') ? '&' : '?'}key=${key}`;
  const dl = await fetch(dlUrl);
  if (!dl.ok) throw new Error(`veo download ${dl.status}`);
  const buf = Buffer.from(await dl.arrayBuffer());
  const out = path.join(os.homedir(), 'Desktop', 'fanz-video-veo31.mp4');
  fs.writeFileSync(out, buf);
  return `${out} (${(buf.length / 1024 / 1024).toFixed(1)}MB)`;
}

// ── Sora 2 (OpenAI videos API) ──
async function runSora() {
  const OpenAI = require('openai');
  const { toFile } = require('openai');
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const frame = await toFile(fs.readFileSync(FRAME_PATH), 'frame.png', { type: 'image/png' });
  let video = await openai.videos.create({
    model: 'sora-2',
    prompt: MOTION_PROMPT,
    input_reference: frame,
    size: '720x1280',
    seconds: '8',
  });
  console.log('[sora] job:', video.id, video.status);

  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 10_000));
    video = await openai.videos.retrieve(video.id);
    if (video.status === 'completed') break;
    if (video.status === 'failed') throw new Error(`sora failed: ${JSON.stringify(video.error || {}).slice(0, 300)}`);
    if (i % 3 === 0) console.log(`[sora] ${video.status}... (${(i + 1) * 10}s, progress=${video.progress ?? '?'})`);
  }
  if (video.status !== 'completed') throw new Error('sora timed out after 10min');

  const content = await openai.videos.downloadContent(video.id);
  const buf = Buffer.from(await content.arrayBuffer());
  const out = path.join(os.homedir(), 'Desktop', 'fanz-video-sora2.mp4');
  fs.writeFileSync(out, buf);
  return `${out} (${(buf.length / 1024 / 1024).toFixed(1)}MB)`;
}

async function main() {
  if (!process.env.OPENAI_API_KEY || !process.env.GEMINI_API_KEY) {
    console.error('OPENAI_API_KEY / GEMINI_API_KEY missing');
    process.exit(1);
  }
  await buildFrame();

  console.log('Launching Veo 3.1 and Sora 2 in parallel (each ~2-8 min)...');
  const [veo, sora] = await Promise.allSettled([runVeo(), runSora()]);

  console.log('\n===== VIDEO A/B SUMMARY =====');
  console.log(veo.status === 'fulfilled' ? `  ✓ Veo 3.1:  ${veo.value}` : `  ✗ Veo 3.1:  ${veo.reason.message}`);
  console.log(sora.status === 'fulfilled' ? `  ✓ Sora 2:   ${sora.value}` : `  ✗ Sora 2:   ${sora.reason.message}`);
}

main().catch((err) => { console.error('FATAL:', err); process.exit(1); });
