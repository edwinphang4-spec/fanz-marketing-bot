// 绕开当前宕机的 gpt-image-2:用早先缓存的无字场景图，验证 video-gen 其余
// 全部环节(Veo 动画 + 静态文案层 + ffmpeg + Storage 上传 + video_url 落库形态)
// 都真实跑通。这是本次新写集成点的真实验证；scene-gen 那一步代码路径此前
// 已由 method-B 成功证明过。
const fs = require('fs');
const os = require('os');
const path = require('path');

// monkey-patch：把 video-gen 内部的 genTextFreeScene 换成读缓存文件
const videoGen = require('./lib/video-gen');
// 直接测内部不方便（未导出），改为在这里复刻后半段流程调用 video-gen 的
// 导出函数不可行 → 换法：临时把 OPENAI 调用替换。用 require 拦截太重。
// 最简单：直接复用 video-gen 的公开函数，但注入一个"假的"场景来源——
// 通过环境变量让 genTextFreeScene 读本地文件。见 video-gen 的 SCENE_OVERRIDE 支持。

const row = {
  id: 'video-bypass-test-0001',
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

async function main() {
  console.log('Running generatePostVideo with SCENE_OVERRIDE (bypass gpt-image-2)...');
  const t0 = Date.now();
  const result = await videoGen.generatePostVideo(row, { log: (m) => console.log('  [vid]', m) });
  console.log(`took ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  console.log('result:', JSON.stringify(result));
  if (!result.success || result.dryRun) process.exit(result.dryRun ? 0 : 1);

  const resp = await fetch(result.videoUrl);
  const buf = Buffer.from(await resp.arrayBuffer());
  const out = path.join(os.homedir(), 'Desktop', 'fanz-video-lib-bypass.mp4');
  fs.writeFileSync(out, buf);
  console.log(`downloaded ${(buf.length / 1024).toFixed(0)}KB → ${out}`);
}
main().catch((e) => { console.error('FATAL:', e); process.exit(1); });
