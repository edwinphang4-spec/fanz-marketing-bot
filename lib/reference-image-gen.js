// ============================================
// reference-image-gen.js — AI 原生整图生成（产品图 + logo 当参考图）
//
// 2026-07-24 架构转向：不再"生成背景 + 代码贴产品/logo/文字"三层拼贴，
// 而是把真实产品照片 + logo 作为参考图喂给 images.edit，一次性生成
// 含真实光影/阴影/排版的完整成品图。
//
// 模型版本是本次返工的最大教训：最初写死 gpt-image-1（旧代），实测
// logo 张冠李戴 2/2 次（"grande"/"S"圈）、小字拼错 3/3 次——于是被迫
// 加了一堆代码贴 logo/徽章的补丁，越贴越丑。后来 A/B 实证：同 prompt
// 同参考图换 gpt-image-2（Edwin 手动 ChatGPT 测试用的那一代），logo/
// 小字/排版一次全对。补丁全拆，logo 恢复参考图直出。
// ============================================

const path = require('path');

// 2026-07-30 上调:原本 240s 是按"实测最长 ~166s"定的，但加了产品硬约束/
// 排版/品牌色之后 prompt 变长，实测连续三次 209s / 224s / >240s（最后一次真的
// 被 abort 掉，白烧一次生成）。整月 13 篇要是卡在这条线上会反复重试烧钱，
// 上限抬到 300s 并允许环境变量覆盖。
const API_TIMEOUT_MS = Number(process.env.IMAGE_EDIT_TIMEOUT_MS || 300_000);
const QUALITY = process.env.GPT_IMAGE_QUALITY || 'high';
const EDIT_MODEL = process.env.IMAGE_EDIT_MODEL || 'gpt-image-2';

function isDryRun() {
  return !process.env.OPENAI_API_KEY;
}

/** Fetch a local path or http(s) URL into a Buffer. */
async function fetchBuffer(source) {
  if (/^https?:\/\//i.test(source)) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);
    try {
      const resp = await fetch(source, { signal: controller.signal });
      if (!resp.ok) throw new Error(`asset fetch failed: HTTP ${resp.status}`);
      return Buffer.from(await resp.arrayBuffer());
    } finally {
      clearTimeout(timer);
    }
  }
  const fs = require('fs');
  if (!fs.existsSync(source)) throw new Error(`Asset not found: ${source}`);
  return fs.readFileSync(source);
}

function mimeFor(source) {
  const ext = path.extname((source || '').split('?')[0]).toLowerCase();
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.webp') return 'image/webp';
  return 'image/png';
}

/**
 * Generate one complete hero-banner image via multi-image reference edit:
 * image[0] = product photo, image[1] = logo. The prompt (design-agent) refers
 * to them as "the attached product image" and "the attached logo (second
 * image)" — keep that order stable.
 *
 * @param {object} opts
 * @param {string} opts.prompt - full prompt from design-agent.buildReferenceImagePrompt
 * @param {string} opts.productSource - local path or URL of the product photo
 * @param {string} [opts.logoSource] - local path or URL of the logo (omit → product only)
 * @param {string} [opts.size]
 * @returns {Promise<{success: boolean, buffer?: Buffer, error?: string, dryRun?: boolean}>}
 */
async function generateReferenceImage({ prompt, productSource, logoSource, size }) {
  if (isDryRun()) return { success: true, dryRun: true };
  if (!productSource) return { success: false, error: 'generateReferenceImage: productSource required' };

  const OpenAI = require('openai');
  const { toFile } = require('openai');
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  let productBuffer, logoBuffer;
  try {
    [productBuffer, logoBuffer] = await Promise.all([
      fetchBuffer(productSource),
      logoSource ? fetchBuffer(logoSource) : Promise.resolve(null),
    ]);
  } catch (err) {
    return { success: false, error: `reference asset fetch failed: ${err.message}` };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), API_TIMEOUT_MS);
  try {
    const productExt = path.extname(productSource.split('?')[0]) || '.png';
    const images = [await toFile(productBuffer, `product${productExt}`, { type: mimeFor(productSource) })];
    if (logoBuffer) {
      const logoExt = path.extname(logoSource.split('?')[0]) || '.png';
      images.push(await toFile(logoBuffer, `logo${logoExt}`, { type: mimeFor(logoSource) }));
    }

    // input_fidelity 只有 gpt-image-1.x 系支持；gpt-image-2 传了会报错
    const supportsFidelity = /^gpt-image-1(\.|$|-)/.test(EDIT_MODEL) && EDIT_MODEL !== 'gpt-image-1-mini';

    const response = await openai.images.edit(
      {
        image: images,
        prompt,
        model: EDIT_MODEL,
        ...(supportsFidelity ? { input_fidelity: 'high' } : {}),
        quality: QUALITY,
        size: size || '1024x1024',
        background: 'opaque',
      },
      { signal: controller.signal }
    );

    const first = response.data && response.data[0];
    if (!first || !first.b64_json) throw new Error(`${EDIT_MODEL} edit returned no image`);
    return { success: true, buffer: Buffer.from(first.b64_json, 'base64') };
  } catch (err) {
    if (err.name === 'AbortError') {
      return { success: false, error: `${EDIT_MODEL} edit timed out after ${API_TIMEOUT_MS / 1000}s` };
    }
    return { success: false, error: err.message };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { generateReferenceImage };
