// ============================================
// pipeline.js — 配图流水线编排 [I-5]
//
// 编排 I-2 (scene gen) → I-3 (text overlay) → I-4 (store image)
// 输出 final image URL 用于审核卡
// ============================================

const path = require('path');
const fs = require('fs');
const supabase = require('./supabase');
const { generateSceneImage } = require('./scene-gen');
const { applyTextOverlays, extractTextsFromRow } = require('./text-overlay');
const { storeFinalImage } = require('./store-image');
const { PRODUCTS_DIR } = require('./select-product');

// ============================================
// Pipeline
// ============================================

/**
 * Run the full imagery pipeline for a content_calendar row:
 *   I-2: Generate scene image (product + background)
 *   I-3: Overlay text (title, selling point, etc.)
 *   I-4: Upload final image to Supabase Storage → public URL
 *
 * @param {string} rowId - content_calendar row UUID
 * @returns {Promise<{success: boolean, imageUrl?: string, error?: string, isDryRun?: boolean}>}
 */
async function runImageryPipeline(rowId) {
  try {
    // Step 0: Read the row
    const row = await supabase.getContentCalendar(rowId);
    if (!row) {
      return { success: false, error: 'Row not found' };
    }

    // ─── Step 1: I-2 Generate scene image ───
    const sourceImage = row.source_product_image || null;
    const sceneResult = await generateSceneImage(
      rowId,
      row.topic || '',
      row.pillar || 'product',
      sourceImage,
      PRODUCTS_DIR
    );

    if (!sceneResult.success) {
      return {
        success: false,
        error: sceneResult.error || 'Scene generation failed',
      };
    }

    // Dry-run mode — skip text overlay and storage, return dry-run marker
    if (sceneResult.dryRun) {
      await supabase.updateContentCalendar(rowId, { status: 'image_ready' });
      return {
        success: true,
        imageUrl: sceneResult.sceneImageUrl || '(dry-run)',
        isDryRun: true,
      };
    }

    // Determine scene image path
    const scenesDir = path.join(path.dirname(PRODUCTS_DIR), 'scenes');
    const sceneFilename = sceneResult.sceneImageUrl;
    const scenePath = path.join(scenesDir, sceneFilename);

    if (!sceneFilename || !fs.existsSync(scenePath)) {
      return {
        success: false,
        error: `Scene image not found on disk: ${sceneFilename}`,
      };
    }

    // ─── Step 2: I-3 Apply text overlay ───
    const overlayDir = path.join(scenesDir, 'overlays');
    if (!fs.existsSync(overlayDir)) {
      fs.mkdirSync(overlayDir, { recursive: true });
    }
    const overlayFilename = `final-${rowId.replace(/-/g, '').slice(0, 12)}-${Date.now()}.png`;
    const overlayPath = path.join(overlayDir, overlayFilename);

    const texts = extractTextsFromRow(row);
    await applyTextOverlays(scenePath, texts, overlayPath);

    if (!fs.existsSync(overlayPath)) {
      return {
        success: false,
        error: 'Text overlay produced no output file',
      };
    }

    // ─── Step 3: I-4 Store final image to Supabase Storage ───
    const storeResult = await storeFinalImage(rowId, overlayPath);

    if (!storeResult.success) {
      return {
        success: false,
        error: storeResult.error || 'Image storage failed',
      };
    }

    // ─── Step 4: Update status ───
    await supabase.updateContentCalendar(rowId, { status: 'image_ready' });

    return {
      success: true,
      imageUrl: storeResult.imageUrl,
      isDryRun: false,
    };
  } catch (err) {
    return {
      success: false,
      error: err.message,
    };
  }
}

module.exports = {
  runImageryPipeline,
};