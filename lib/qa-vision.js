// ============================================
// qa-vision.js — 成品的视觉自检（**只报警,永不拦截**）
//
// 为什么只报警:建库时实测过视觉模型的可靠性 ——
//   · 把无灯款的灰色机身盖误判成"有灯"6 次
//   · 低清图数错叶数(同一型号不同颜色被数成 4 叶和 5 叶)
// 拿这种精度当闸门会误杀,每误杀一次白烧 ~215 秒 + 一次出图钱。
// 所以这里产出的只是提示,给人审核时优先看哪几张,绝不触发重生成。
//
// 能量化的部分(logo 占比/对比度/图文一致/卖点重复)在 qa-image.js,那些是
// 100% 可靠的代码判定,才有资格当闸门。
// ============================================

const VISION_MODEL = process.env.QA_VISION_MODEL || 'openai/gpt-4o';
const TIMEOUT_MS = Number(process.env.QA_VISION_TIMEOUT_MS || 45_000);

const SYSTEM = `You are a quality checker for a ceiling fan brand's marketing images.
You will be given a finished social-media image and the confirmed specs of the fan that
should appear in it. Report ONLY what you can actually see. Reply with strict JSON:
{
  "blade_count": <integer you can count, or null if genuinely unclear>,
  "has_light": <true|false|null — is there an illuminated/white light lens under the motor housing?>,
  "blade_colour": "<short phrase for what you see: matte black / matte white / dark wood / pale wood>",
  "forbidden": [<any of: "gold badge", "sticker seal", "ribbon", "starburst", "box behind logo",
                 "duplicate claim", "watermark", "extra logo" — empty array if none>],
  "notes": "<one short sentence, or empty>"
}
Rules:
- Count blades carefully; one may be hidden behind the motor housing.
- "box behind logo" means a solid rectangle/plate painted behind the brand logo.
- Do not guess. Use null when you cannot tell.`;

/**
 * 视觉自检一张成品图。
 *
 * @param {Buffer} imageBuffer
 * @param {object} productMeta - brand_assets.metadata（人工确认过的真值）
 * @returns {Promise<{warnings: string[], observed: object|null, error?: string}>}
 *   warnings 永远只是提示;调用方不得据此重生成。
 */
async function visionCheck(imageBuffer, productMeta) {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) return { warnings: [], observed: null, error: 'OPENROUTER_API_KEY missing' };

  const known = productMeta
    ? `Confirmed specs (human-verified, treat as truth):
- Model: ${productMeta.model_code || 'unknown'}
- Size: ${productMeta.size_inches ? productMeta.size_inches + ' inch' : 'unknown'}
- Colour: ${productMeta.color || 'unknown'}
- Light: ${productMeta.has_led === true ? 'YES, has an LED light' : productMeta.has_led === false ? 'NO light' : 'unknown'}
- Blades: ${productMeta.blade_count || 'unknown (do not assume)'}`
    : 'No confirmed specs available — just report what you see.';

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      signal: controller.signal,
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: VISION_MODEL,
        messages: [
          { role: 'system', content: SYSTEM },
          { role: 'user', content: [
            { type: 'text', text: known },
            { type: 'image_url', image_url: { url: `data:image/png;base64,${imageBuffer.toString('base64')}` } },
          ] },
        ],
        max_tokens: 350,
        temperature: 0.1,
      }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const raw = (await res.json()).choices[0].message.content.trim().replace(/^```json\s*|\s*```$/g, '');
    const observed = JSON.parse(raw);

    const warnings = [];
    if (productMeta) {
      if (productMeta.blade_count && observed.blade_count &&
          Number(observed.blade_count) !== Number(productMeta.blade_count)) {
        warnings.push(`vision counted ${observed.blade_count} blades, library says ${productMeta.blade_count} (vision can miscount — verify by eye)`);
      }
      if (typeof productMeta.has_led === 'boolean' && typeof observed.has_light === 'boolean' &&
          observed.has_light !== productMeta.has_led) {
        warnings.push(`vision sees light=${observed.has_light}, library says ${productMeta.has_led} (grey hub caps are often misread — verify by eye)`);
      }
    }
    if (Array.isArray(observed.forbidden) && observed.forbidden.length) {
      warnings.push(`possible forbidden elements: ${observed.forbidden.join(', ')}`);
    }
    return { warnings, observed };
  } catch (err) {
    return { warnings: [], observed: null, error: err.message };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { visionCheck };
