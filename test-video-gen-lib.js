// 真实验证 lib/video-gen.generatePostVideo：喂一个"已出图"形态的 row，
// 跑完整方案 B 并上传 Storage，把返回的 videoUrl 下载回 Desktop 肉眼核对。
const fs = require('fs');
const os = require('os');
const path = require('path');
const { generatePostVideo } = require('./lib/video-gen');

async function main() {
  // 模拟一个 image_ready 的 content_calendar row（含 compose_spec.image_texts，
  // 就像静态图管线跑完后落库的样子）
  const row = {
    id: 'video-lib-test-0001',
    pillar: 'promo',
    topic: 'Merdeka special: Vetta oak edition with free installation',
    source_product_image: 'Vettaoak.png',
    compose_spec: {
      image_texts: {
        title: 'Free Installation This Month',
        selling_point: '10-Year Motor Warranty',
        cta: 'Discover Now',
        promo_badge: 'SIRIM Certified',
      },
    },
  };

  console.log('Running generatePostVideo (real: gpt-image-2 + Veo + ffmpeg + storage upload)...');
  const t0 = Date.now();
  const result = await generatePostVideo(row, { log: (m) => console.log('  [vid]', m) });
  console.log(`took ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  console.log('result:', JSON.stringify(result));
  if (!result.success) process.exit(1);
  if (result.dryRun) { console.log('(dry-run — no keys)'); return; }

  // 下载回 Desktop 核对
  const resp = await fetch(result.videoUrl);
  const buf = Buffer.from(await resp.arrayBuffer());
  const out = path.join(os.homedir(), 'Desktop', 'fanz-video-lib-test.mp4');
  fs.writeFileSync(out, buf);
  console.log(`downloaded ${(buf.length / 1024).toFixed(0)}KB → ${out}`);
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1); });
