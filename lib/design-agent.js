// ============================================
// design-agent.js — 电商设计师 Agent（AI 原生整图生成的 prompt 写手）
//
// 2026-07-24 架构转向:贴纸式合成(背景生成+代码贴产品+代码贴文字)被 Edwin
// 判定"太差/没有设计感"。改为把产品图+logo 当参考图直接喂给 images.edit
// (gpt-image-2),一次性生成整张成品——光影/排版/logo/徽章全由模型完成。
//
// Prompt 结构照搬 Edwin 手测验证过的分段写法(Composition/Typography/Logo/
// Format 四段,简洁不堆警告)——2026-07-24 实证:旧版堆满留空坐标警告的
// prompt 反而让模型顾此失彼(字体打架/角落照撞);Edwin 那版简洁分段 prompt
// 在 gpt-image-2 上 logo/小字/排版一次全对。
//
// 本文件只负责"创意/艺术指导"这一小段(镜头角度/打光/构图语言)；营销文案
// 原文一律逐字硬编码进最终 prompt,不经 LLM 转述——从架构上杜绝文字幻觉
// (LLM 只负责视觉方向,不负责文案内容)。LLM 调用失败 → 退回模板自带的
// backgroundStyle 直接当创意指导，不阻断管线。
// ============================================

const { extractTextsFromRow } = require('./text-overlay');

const AGENT_TIMEOUT_MS = 30_000;

/** logoPosition enum → 自然语言方位（"top-left corner" 等）。 */
function humanizePosition(logoPosition) {
  const map = {
    top_left: 'top-left corner',
    top_right: 'top-right corner',
    top_center: 'top centre',
    bottom_center: 'bottom centre',
  };
  return map[logoPosition] || map.top_left;
}

/**
 * template.backgroundStyle 可以是一句话,也可以是候选数组——2026-07-24 复盘
 * 4 款真实产品图后发现:product_intro/promotion 等 sceneSource='template' 的
 * 模板每次都在"精修同一句话",背景视觉母题（深蓝渐变+波纹+光弧）完全没变,
 * 天天发同款背景。数组时随机轮换一个变体,避免连续帖子撞脸。
 */
function pickBackgroundStyle(template) {
  const style = template && template.backgroundStyle;
  if (Array.isArray(style)) {
    if (style.length === 0) return null;
    return style[Math.floor(Math.random() * style.length)];
  }
  return style || null;
}

/**
 * Typography 段——照搬 Edwin 手测验证过的写法,文案逐字嵌入(LLM 不转述)。
 * promo_badge 重新交回给模型画:gpt-image-2 实测小字拼写全对(旧模型
 * 3/3 拼错才被迫代码贴,那套 applyBadgeOverlay 补丁已随模型升级退役)。
 */
function typographyBlock(texts) {
  const items = [];
  if (texts.title) items.push(`a bold headline "${texts.title}"`);
  if (texts.selling_point) items.push(`a smaller subheading "${texts.selling_point}"`);
  if (texts.cta) items.push(`a call-to-action "${texts.cta}" styled as a clearly clickable filled button`);
  if (texts.promo_badge) items.push(`a small badge or tag reading "${texts.promo_badge}"`);
  if (items.length === 0) return '';
  return (
    `\n\nTypography: Add elegant, modern typography designed as part of the overall composition ` +
    `(not a plain text box) — ${items.join(', ')}. Render every text exactly as written, character ` +
    `for character. Choose type sizes, weights, and placement with real graphic-design judgement — ` +
    `vary hierarchy, use tasteful spacing, let the layout breathe, and keep ONE consistent typeface ` +
    `family across all text. Ensure enough contrast against the background; use a subtle graphic ` +
    `element (thin line, small shape, or colour accent) to support the layout if it improves the ` +
    `design — no generic boxed text.`
  );
}

/**
 * 产品规格段——把素材库(brand_assets.metadata)里人工确认过的规格写成硬约束。
 *
 * 为什么要这一段:2026-07-30 线上探针实测,模型只看参考图会自己发挥——
 * 哑黑扇叶被画成木纹,无灯款被凭空加了一圈 LED。参考图管不住的地方,
 * 用文字明确堵住("恰好 3 叶""此款无灯,不要画灯")比事后重生成便宜得多。
 *
 * must_match 由建库脚本按"叶数/有无灯/真实木色"拼好；缺 metadata(本地兜底
 * 图、未确认的老素材)时整段省略，退回原来的行为，不阻断。
 */
function productSpecBlock(meta) {
  if (!meta) return '';
  const trim = (s) => String(s).trim().replace(/\.+$/, '');
  const parts = [];
  if (meta.appearance) parts.push(`This exact model: ${trim(meta.appearance)}`);
  if (meta.must_match) parts.push(`It MUST have: ${trim(meta.must_match)}`);
  if (parts.length === 0) return '';
  return ` ${parts.join('. ')}. Do not add, remove, or restyle any of these features.`;
}

/** Logo 段——logo 是第二张参考图,模型直接画进构图(gpt-image-2 实测保真)。 */
function logoBlock(logoPosition) {
  return (
    `\n\nLogo: Place the attached logo (second image) in the ${humanizePosition(logoPosition)} at a ` +
    `natural, professional scale — do not distort, recolor, or redraw it; reproduce it exactly as provided.`
  );
}

/** Format 收尾段——产品保真/整机入画/光影融合/规格,一段讲完不重复。 */
function formatBlock() {
  return (
    `\n\nFormat: Square 1:1, social-media-ready, e-commerce hero banner quality — think Shopee/Lazada ` +
    `flagship listing image crossed with a premium tech brand poster. Reproduce the product from the ` +
    `attached product image with 100% accurate shape, colour, and detail — do not redesign or alter it. ` +
    `Keep the entire product visible in frame, integrated with realistic unified lighting and a natural ` +
    `contact shadow — it must look photographed together, never pasted on. No watermarks other than the ` +
    `provided logo. No extra text, no fine print, no stock-photo look.`
  );
}

/**
 * 场景模式:interior(真实马来西亚室内实景,场景内容从文案读出) vs
 * poster(抽象海报背景,用模板 backgroundStyle)。
 *
 * 2026-07-24 Edwin 定调:"多用房间/室内背景,偶尔可以海报风,多数要结合
 * 文案内容来搭配"——所以图形派模板也默认多数走 interior(权重可调,默认
 * 75%),只偶尔出海报;实景派模板(sceneSource='derived')永远 interior。
 */
const INTERIOR_WEIGHT = Number(process.env.DESIGN_INTERIOR_WEIGHT || 0.75);

function chooseSceneMode(template) {
  if (template && template.sceneSource === 'derived') return 'interior';
  return Math.random() < INTERIOR_WEIGHT ? 'interior' : 'poster';
}

/** Deterministic fallback creative direction when the LLM call fails/unavailable. */
function fallbackDirection(template, productName, sceneMode) {
  if (sceneMode === 'interior') {
    return (
      'Bright, airy real Malaysian modern home interior with the fan mounted naturally on the ' +
      'ceiling, natural daylight, warm wood and beige tones, believable furniture and textures, ' +
      'uncluttered composition with generous breathing room for typography.'
    );
  }
  return (
    pickBackgroundStyle(template) ||
    `Premium commercial product photography backdrop for ${productName || 'the product'}, clean and modern, brand-appropriate colours.`
  );
}

/**
 * LLM 写"创意指导"段落(场景/镜头/打光/构图)——不涉及文案的文字内容,
 * 但会"读"文案来定场景(interior 模式:文案讲卧室就出卧室、讲客厅就出客厅)。
 * @returns {Promise<{direction: string, source: 'llm'|'fallback', sceneMode: string}>}
 */
async function deriveCreativeDirection(row, template, productName, brandVoice) {
  const sceneMode = chooseSceneMode(template);
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return { direction: fallbackDirection(template, productName, sceneMode), source: 'fallback', sceneMode };

  const copy = ((row.fb_content || row.ig_content) || '').slice(0, 500);
  const sceneBrief = sceneMode === 'interior'
    ? 'REAL INTERIOR scene. Set the fan inside a realistic Malaysian home interior, mounted naturally ' +
      'on the actual ceiling of the room. Read the post copy and choose the room type, mood and time of ' +
      'day it implies (living room / bedroom / condo / dining area...). Real furniture, real textures, ' +
      'natural believable light — photographic, NOT an abstract poster backdrop.'
    : `ABSTRACT POSTER scene, no literal room or furniture: ${pickBackgroundStyle(template) || 'clean premium gradient backdrop in brand-appropriate colours'}`;

  const userParts = [
    `Product: ${productName || '(unnamed ceiling fan)'}`,
    `Content pillar: ${row.pillar || 'product'}`,
    `Post topic: ${row.topic || '(none)'}`,
    copy ? `Post copy (ground the scene in what this actually says):\n${copy}` : null,
    `Scene brief (follow its mode strictly): ${sceneBrief}`,
  ].filter(Boolean);
  if (brandVoice) userParts.push(`Brand voice/tone: ${brandVoice}`);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AGENT_TIMEOUT_MS);
  try {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://fanz-marketing-bot.railway.app',
        'X-Title': 'Fanz Marketing Bot - Design Agent',
      },
      body: JSON.stringify({
        model: process.env.DESIGN_AGENT_MODEL || process.env.MODEL || 'gpt-4o',
        messages: [
          {
            role: 'system',
            content:
              'You are a senior e-commerce product photography art director, the kind who shoots ' +
              'hero banners for premium home-appliance brands (Dyson, Xiaomi, Balmuda tier). Given a ' +
              'product, content pillar, the post copy and a scene brief, write ONE tight paragraph ' +
              '(4-6 sentences) of creative direction for an AI image model that will receive the real ' +
              'product photo and brand logo as reference images and generate one complete hero banner. ' +
              'Follow the scene brief\'s mode strictly: a REAL INTERIOR brief means a believable ' +
              'photographic room grounded in what the post copy describes; an ABSTRACT POSTER brief ' +
              'means a graphic backdrop with no room. Cover: camera angle (e.g. slightly-below eye ' +
              'level for a ceiling-mounted fan), lighting setup, shadow/reflection treatment, the scene ' +
              'or background specifics and colour palette, composition (negative space, rule of thirds). ' +
              'The brief is an anchor, not a script — invent your own specific execution so consecutive ' +
              'posts do not all look alike. Do NOT mention any text/headline content — text is handled ' +
              'separately. Do NOT invent product specs. Reply with the paragraph only.',
          },
          { role: 'user', content: userParts.join('\n') },
        ],
        max_tokens: 300,
        temperature: 0.8,
      }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`OpenRouter ${res.status}`);
    const data = await res.json();
    const text = (data.choices?.[0]?.message?.content || '').trim();
    if (!text) throw new Error('empty creative direction');
    return { direction: text, source: 'llm', sceneMode };
  } catch (err) {
    console.error('[design-agent] creative direction failed, using fallback:', err.message);
    return { direction: fallbackDirection(template, productName, sceneMode), source: 'fallback', sceneMode };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 从完整文案(fb_content/ig_content)提炼海报级短文案(标题/副标题/CTA/徽章)。
 *
 * 2026-07-24 实测发现:row.topic 常常是内部 brief("AURA Series: the compact
 * DC fan built for small bedrooms and condo units"),不是能印在图上的标题；
 * selling_point/cta_text/promo_badge 目前也没有任何环节自动填——只有
 * Dashboard 手改过才有值。这一步把 copywriting agent 已经写好的正式文案
 * 压缩成适合印在图上的钩子标题+一句卖点+一个 CTA 动词短语(+可选信任徽章)。
 *
 * @param {object} row - content_calendar row (fb_content/ig_content/topic/pillar)
 * @returns {Promise<{title: string, selling_point?: string, cta?: string, promo_badge?: string}|null>}
 *   null → 调用方退回 extractTextsFromRow 的原始字段（不阻断管线）。
 */
async function deriveImageText(row) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  const copy = (row.fb_content || row.ig_content || '').trim();
  if (!apiKey || !copy) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AGENT_TIMEOUT_MS);
  try {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://fanz-marketing-bot.railway.app',
        'X-Title': 'Fanz Marketing Bot - Design Agent (image text)',
      },
      body: JSON.stringify({
        model: process.env.DESIGN_AGENT_MODEL || process.env.MODEL || 'gpt-4o',
        messages: [
          {
            role: 'system',
            content:
              'You are a senior e-commerce poster copy editor for a Malaysian ceiling fan brand. ' +
              'Given a full social-media post, extract ULTRA-SHORT text for a hero product banner — ' +
              'not the post itself, just the handful of words that would sit on top of the image. ' +
              'Output EXACTLY these labeled lines and nothing else:\n' +
              'HEADLINE: 3-6 words, punchy, the single biggest hook — never a full sentence. Anchor it in a ' +
              'concrete, specific feature or benefit actually named in the post (a function, sound level, size, ' +
              'warranty length, price/deal, etc). Avoid vague style adjectives on their own ("elegant", ' +
              '"sophisticated", "premium") — pair them with something concrete if you use them at all.\n' +
              'SUBHEADING: up to 6 words, one concrete feature or benefit\n' +
              'CTA: 2-4 words, an action phrase (e.g. "Shop Now", "Get Yours Today")\n' +
              'BADGE: only include this line if the post names a genuine trust signal worth a badge ' +
              '(warranty/certification/guarantee), 2-5 words — omit the entire line otherwise\n' +
              'Do not invent facts absent from the post. No quotation marks, no trailing punctuation.',
          },
          { role: 'user', content: `Pillar: ${row.pillar || 'product'}\n\nFull post:\n${copy.slice(0, 800)}` },
        ],
        max_tokens: 150,
        temperature: 0.6,
      }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`OpenRouter ${res.status}`);
    const data = await res.json();
    const text = (data.choices?.[0]?.message?.content || '').trim();
    if (!text) throw new Error('empty image-text extraction');

    const grab = (label) => {
      const m = text.match(new RegExp(`^${label}:\\s*(.+)$`, 'im'));
      return m ? m[1].trim().replace(/^["']|["']$/g, '').replace(/[.!]+$/, '') : null;
    };
    const title = grab('HEADLINE');
    if (!title) throw new Error('no HEADLINE parsed from: ' + text.slice(0, 200));
    const selling_point = grab('SUBHEADING');
    const cta = grab('CTA');
    const promo_badge = grab('BADGE');
    return {
      title,
      ...(selling_point ? { selling_point } : {}),
      ...(cta ? { cta } : {}),
      ...(promo_badge ? { promo_badge } : {}),
    };
  } catch (err) {
    console.error('[design-agent] image-text extraction failed, falling back to raw row fields:', err.message);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Build the full image-generation prompt for AI-native reference-image
 * compositing (product photo + logo → one complete hero banner).
 *
 * @param {object} row - content_calendar row
 * @param {object} template - design-templates.js template entry
 * @param {string} [productName]
 * @param {string} [brandVoice] - kit.brand_voice
 * @param {object} [productMeta] - brand_assets.metadata（素材库的结构化规格）
 * @returns {Promise<{prompt: string, source: 'llm'|'fallback', texts: object}>}
 *   The prompt refers to image[0] as the product photo and image[1] as the
 *   logo — reference-image-gen.js must keep that attachment order.
 */
async function buildReferenceImagePrompt(row, template, productName, brandVoice, productMeta) {
  const rawTexts = extractTextsFromRow(row);
  // Dashboard 手改过(selling_point/cta/badge 任一有值)就尊重原样,不覆盖；
  // 否则说明这篇帖子还没人手动配过图上文字——从正式文案里提炼短版本，
  // 而不是把 row.topic 这种内部 brief 原样糊上去。
  let texts = rawTexts;
  if (!rawTexts.selling_point && !rawTexts.cta && !rawTexts.promo_badge) {
    const derived = await deriveImageText(row);
    if (derived) texts = derived;
  }

  const { direction, source, sceneMode } = await deriveCreativeDirection(row, template, productName, brandVoice);
  // 分段结构照搬 Edwin 手测验证版:开头一句产品保真 → 创意指导(场景/构图)
  // → Typography → Logo → Format。简洁、单声道、不堆警告。
  const prompt =
    `Create a premium e-commerce hero product banner for a ceiling fan, using the exact product ` +
    `shown in the attached product image — do not redesign, restyle, or alter the fan itself in ` +
    `any way; keep its exact shape, color, and details 100% accurate.` +
    `${productSpecBlock(productMeta)}\n\n` +
    `Composition & Background: ${direction}` +
    `${typographyBlock(texts)}${logoBlock(template.logoPosition)}${formatBlock()}`;
  return { prompt, source, texts, sceneMode };
}

module.exports = { buildReferenceImagePrompt, deriveCreativeDirection, deriveImageText };
