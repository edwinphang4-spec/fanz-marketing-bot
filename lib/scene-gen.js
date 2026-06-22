// ============================================
// scene-gen.js — Nano Banana 场景图生成节点 [I-2]
//
// 输入：content_calendar row + source_product_image
// 输出：scene_image_url + image_status = generated
//
// 流水线：scene prompt → Nano Banana (Gemini) → scene_image_url
//
// 红线：dry-run 只限"调 Nano Banana 那一下"，其余逻辑全真
// 超时：AbortController 30s
// 幂等：已 generated 不重复调 API
// ============================================

const path = require('path');
const fs = require('fs');

// ============================================
// 场景指令引擎 — 按 pillar/topic/节庆构造
// ============================================

/** 节庆 → 场景关键词映射 */
const FESTIVAL_SCENE = {
  'chinese new year': 'Chinese New Year festive home, red lanterns and gold decorations, warm interior lighting',
  'hari raya': 'Hari Raya Aidilfitri festive home, pelita lights, ketupat decorations, warm family gathering setting',
  'deepavali': 'Deepavali festive home, kolam decorations, diya lamps, warm golden lighting',
  'christmas': 'Christmas decorated living room, warm fairy lights, festive ornaments, cozy atmosphere',
  'merdeka': 'Merdeka celebration, Jalur Gemilang decorations, modern Malaysian home',
  'mid-year': 'bright and airy modern living space, summer vibe, natural daylight streaming in',
  'school holidays': 'family living room, children playing, warm and inviting home atmosphere',
  'rainy': 'cozy indoor space during rainy weather, warm lighting, windows showing rain outside',
  'hot': 'sunlit room with bright natural light, warm Malaysian afternoon, curtains drawn slightly',
};

/** 默认场景 by pillar */
const PILLAR_SCENE = {
  product: 'modern living room with elegant decor, warm ambient lighting, contemporary Malaysian home interior',
  case: 'cozy Malaysian home interior, bedroom or living area with warm natural light, real home installation setting',
  promo: 'festive event display, seasonal celebration backdrop, promotional showcase setting',
  story: 'stylish contemporary interior, lifestyle home setting, modern Malaysian apartment with tasteful decor',
};

/** 用户不可见的系统约束 */
const EDITOR_CONSTRAINT =
  'IMPORTANT: Keep the ceiling fan\'s appearance visually unchanged — do NOT alter its shape, blades, design, or color. Only change the background environment around it. The result should be photorealistic, as if the fan was photographed installed in that setting.';

// ============================================
// Build scene prompt
// ============================================

/**
 * Build the scene generation prompt from pillar and topic.
 *
 * @param {string} pillar - content pillar (product|case|promo|story)
 * @param {string} topic - topic title (used for scene keyword extraction)
 * @returns {string} full prompt for Nano Banana
 */
function buildScenePrompt(pillar, topic) {
  // Detect festival from topic text
  const topicLower = (topic || '').toLowerCase();
  let sceneKeywords = PILLAR_SCENE[pillar] || PILLAR_SCENE.product;

  // Check for festival-specific scene overrides
  for (const [keyword, scene] of Object.entries(FESTIVAL_SCENE)) {
    if (topicLower.includes(keyword)) {
      sceneKeywords = scene;
      break;
    }
  }

  return `${sceneKeywords}. ${EDITOR_CONSTRAINT}`;
}

// ============================================
// Nano Banana (Gemini) image-to-image
// ============================================

const API_TIMEOUT_MS = 30_000;
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash-image';

/**
 * Check if Nano Banana API should be called or dry-run.
 * Evaluated at call time, not module load time.
 */
function isDryRun() {
  return !process.env.GEMINI_API_KEY;
}

/**
 * Convert image file to base64
 */
function imageToBase64(filePath) {
  const data = fs.readFileSync(filePath);
  return data.toString('base64');
}

/**
 * Call Gemini Nano Banana for image-to-image editing.
 * Returns { data: Buffer, mimeType: string } or DRYRUN placeholder.
 *
 * @param {string} prompt - scene prompt
 * @param {string} imagePath - path to source product image
 * @returns {Promise<{data: Buffer, mimeType: string, dryRun?: boolean}>}
 */
async function callNanoBanana(prompt, imagePath) {
  // dry-run: 只限这一脚，其余逻辑全真
  if (isDryRun()) {
    // Generate a minimal placeholder image (1x1 transparent PNG as data URI marker)
    // This keeps the pipeline flowing without real API calls
    return {
      data: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==',
        'base64'
      ),
      mimeType: 'image/png',
      dryRun: true,
    };
  }

  if (!fs.existsSync(imagePath)) {
    throw new Error(`Product image not found at ${imagePath}`);
  }

  const base64Image = imageToBase64(imagePath);
  const mimeType = imagePath.endsWith('.png') ? 'image/png' : 'image/jpeg';

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), API_TIMEOUT_MS);

  let response;
  try {
    response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent?key=${process.env.GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            role: 'user',
            parts: [
              { text: prompt },
              {
                inline_data: {
                  mime_type: mimeType,
                  data: base64Image,
                },
              },
            ],
          }],
          generationConfig: {
            temperature: 1.0,
            topK: 32,
            topP: 1,
            maxOutputTokens: 8192,
          },
        }),
        signal: controller.signal,
      }
    );
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Gemini API error ${response.status}: ${errText}`);
  }

  const data = await response.json();

  if (!data.candidates || data.candidates.length === 0) {
    throw new Error('Gemini returned no candidates. The model may not support image output.');
  }

  // Find image part in response
  for (const part of data.candidates[0].content.parts) {
    if (part.inline_data && part.inline_data.data) {
      return {
        data: Buffer.from(part.inline_data.data, 'base64'),
        mimeType: part.inline_data.mime_type || 'image/png',
      };
    }
  }

  throw new Error('Gemini response did not contain an image. Try a different prompt.');
}

// ============================================
// Orchestrator — generate scene image for a content_calendar row
// ============================================

/**
 * Generate a scene image for the given content_calendar row.
 * Full pipeline: idempotency check → build prompt → status=generating →
 * Nano Banana → status=generated (or failed) → store scene_image_url
 *
 * @param {string} rowId - content_calendar row UUID
 * @param {string} topic - topic title for prompt construction
 * @param {string} pillar - content pillar
 * @param {string} sourceProductImage - filename of the source product image
 * @param {string} productsDir - directory containing product images
 * @returns {Promise<{success: boolean, imageStatus?: string, sceneImageUrl?: string, dryRun?: boolean, error?: string}>}
 */
async function generateSceneImage(rowId, topic, pillar, sourceProductImage, productsDir) {
  const { updateImageRow } = require('./image-state');
  const { updateContentCalendar } = require('./supabase');
  const { selectProductImage } = require('./select-product');

  try {
    // Step 0: Read current row to check idempotency
    const { getContentCalendar } = require('./supabase');
    let row;
    try {
      row = await getContentCalendar(rowId);
    } catch (_) {
      row = null;
    }

    // If row already has image_status='generated', skip (idempotency)
    if (row && row.image_status === 'generated') {
      return {
        success: true,
        imageStatus: 'generated',
        sceneImageUrl: row.scene_image_url || null,
        idempotent: true,
      };
    }

    // Step 1: Resolve product image path
    const resolvedImage = sourceProductImage
      ? path.join(productsDir, sourceProductImage)
      : null;

    if (!resolvedImage || !fs.existsSync(resolvedImage)) {
      // Fallback: use select-product to find one
      const picked = selectProductImage(pillar, topic);
      if (picked && fs.existsSync(picked.filepath)) {
        // Also write it as source_product_image so it's persisted
        const selectProduct = require('./select-product');
        try {
          await selectProduct.writeSourceProductImage(rowId, picked.filename);
        } catch (_) {
          // non-blocking
        }
      }
    }

    const finalImagePath = (resolvedImage && fs.existsSync(resolvedImage))
      ? resolvedImage
      : selectProductImage(pillar, topic).filepath;

    // Step 2: Update status to 'generating'
    const expectedStatus = (row && row.image_status) || 'pending';
    await updateImageRow(rowId, { image_status: 'generating' }, expectedStatus);

    // Step 3: Build scene prompt
    const prompt = buildScenePrompt(pillar, topic);

    // Step 4: Call Nano Banana (or dry-run)
    let result;
    let imageUrl;
    let isDryRun = false;

    try {
      result = await callNanoBanana(prompt, finalImagePath);
      isDryRun = result.dryRun === true;

      if (isDryRun) {
        // dry-run: store marker instead of real image
        const timestamp = Date.now();
        // Create a small DRYRUN placeholder in a temp location
        const scenesDir = path.join(path.dirname(productsDir), 'scenes');
        if (!fs.existsSync(scenesDir)) {
          fs.mkdirSync(scenesDir, { recursive: true });
        }
        const placeholderFilename = `DRYRUN-${rowId.slice(0, 8)}-${timestamp}.png`;
        const placeholderPath = path.join(scenesDir, placeholderFilename);
        fs.writeFileSync(placeholderPath, result.data);
        imageUrl = placeholderFilename;
      } else {
        // Real: save scene image to scenes directory
        const scenesDir = path.join(path.dirname(productsDir), 'scenes');
        if (!fs.existsSync(scenesDir)) {
          fs.mkdirSync(scenesDir, { recursive: true });
        }
        const ext = result.mimeType === 'image/png' ? '.png' : '.jpg';
        const sceneFilename = `scene-${rowId.slice(0, 8)}-${Date.now()}${ext}`;
        const scenePath = path.join(scenesDir, sceneFilename);
        fs.writeFileSync(scenePath, result.data);
        imageUrl = sceneFilename;
      }
    } catch (apiErr) {
      // Step 5a: API call failed → status=failed
      await updateImageRow(rowId, { image_status: 'failed' }, 'generating');
      return {
        success: false,
        error: apiErr.message,
        imageStatus: 'failed',
      };
    }

    // Step 5b: Success → status=generated, store scene_image_url
    await updateImageRow(rowId, {
      image_status: 'generated',
      scene_image_url: imageUrl,
    }, 'generating');

    return {
      success: true,
      imageStatus: 'generated',
      sceneImageUrl: imageUrl,
      dryRun: isDryRun,
    };
  } catch (err) {
    // Uncaught error — try to set status to failed, but don't throw
    try {
      const { getContentCalendar } = require('./supabase');
      const currentRow = await getContentCalendar(rowId);
      if (currentRow) {
        await updateImageRow(rowId, { image_status: 'failed' }, currentRow.image_status);
      }
    } catch (_) {
      // best-effort
    }
    return {
      success: false,
      error: err.message,
      imageStatus: 'failed',
    };
  }
}

// ============================================
// Exports
// ============================================

module.exports = {
  buildScenePrompt,
  callNanoBanana,
  generateSceneImage,
  API_TIMEOUT_MS,
  PILLAR_SCENE,
  FESTIVAL_SCENE,
  EDITOR_CONSTRAINT,
};