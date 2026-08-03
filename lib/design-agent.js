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
const { BRAND_BLUE } = require('./design-templates');

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
 * Typography 段——文案逐字嵌入(LLM 不转述)。
 *
 * 2026-07-30 Edwin 目检反馈后收紧三点:
 *  ① 字号字重收敛:上一版"bold headline"被画成占满左半边的超大粗体,
 *     真实 Fanz 帖子克制得多 → 改为中等字号/中等字重 + 明确面积上限。
 *  ② 品牌蓝必须出现:整张图只有棕米金、一点蓝都没有,"不像 Fanz 发的"。
 *     ai_reference 分支原本完全没把品牌色喂给模型(kit.colors 只在旧的
 *     合成分支用)——这里显式传入。
 *  ③ 徽章取消:金色盾牌是电商促销贴纸风,跟 Fanz 简洁专业调性不搭,而且
 *     常和副标题重复同一件事(保修说两遍)。只在 Dashboard 手工设了
 *     promo_badge 时才画,且明确要求排版式小标签而非贴纸。
 */
function typographyBlock(texts, brandBlue) {
  const items = [];
  if (texts.title) items.push(`a headline "${texts.title}"`);
  if (texts.selling_point) items.push(`a smaller subheading "${texts.selling_point}"`);
  if (texts.cta) items.push(`a call-to-action "${texts.cta}" styled as a clean filled button`);
  if (texts.promo_badge) items.push(`a small flat typographic tag reading "${texts.promo_badge}"`);
  if (items.length === 0) return '';
  const blue = brandBlue || '#274797';
  return (
    `\n\nTypography: Add restrained, modern editorial typography as part of the composition ` +
    `(not a plain text box) — ${items.join(', ')}. Render every text exactly as written, character ` +
    `for character.\n` +
    `- Keep it understated: the headline should be medium weight and medium size, occupying at most ` +
    `about one third of the image width and no more than two lines. Do NOT set it oversized, ` +
    `ultra-bold, or spanning half the canvas.\n` +
    `- Use ONE consistent clean sans-serif family across all text, with generous breathing room ` +
    `and clear hierarchy between headline, subheading and button.\n` +
    `- Brand colour: Fanz brand blue ${blue} must be visibly present as a deliberate accent — for ` +
    `example the call-to-action button fill, a thin rule under the headline, or a small colour ` +
    `accent within the scene styling. The image must read as a Fanz post, not a generic homeware ad.\n` +
    `- No promotional stickers, seals, shields, ribbons, starbursts or badge graphics of any kind. ` +
    `Do not repeat the same claim in two places.`
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
  return ` ${parts.join('. ')}. Do not add, remove, or restyle any of these features.${scaleBlock(meta)}`;
}

/**
 * 尺寸感段——按库里的真实英寸约束画面比例。
 *
 * 2026-07-30 Edwin 目检:42 寸的卧室扇被画成"像 56 寸塞进小房间",压迫感太强。
 * 模型没有尺寸概念,参考图也不含比例信息 → 用文字把真实尺寸和"相对房间多大"
 * 说清楚。库里 size_inches 是人工确认过的,拿来直接用。
 */
function scaleBlock(meta) {
  const inches = Number(meta && meta.size_inches);
  if (!inches) return '';
  const tier = inches <= 42
    ? `a compact ${inches}-inch fan — it should read as small and unobtrusive, spanning roughly a ` +
      `quarter to a third of the room's visible width`
    : inches <= 52
      ? `a mid-size ${inches}-inch fan — it should span roughly a third of the room's visible width`
      : `a large ${inches}-inch fan — it may span up to about half the room's visible width`;
  return (
    ` Scale: this is ${tier}. Keep the fan's size believable relative to the ceiling, walls and ` +
    `furniture around it; it must never look oversized for the room or dominate the frame.`
  );
}

/**
 * Logo 段——logo 是第二张参考图,模型直接画进构图。
 *
 * 2026-07-30 Edwin 目检修:上一版出图里 logo 变成"白色 fanz + 黑色方框底",
 * 花朵图标和 THE AIR MOVER 都不见了。两个原因:
 *  ① 模板挂的是 wordmark(只有 fanz 三个字母)而不是三件套 lockup → 已改模板;
 *  ② 白色 logo 落在米色亮墙上不可读,模型就自己垫了个黑底方框 → 这里明确
 *     禁止加任何底板,并改由 pickLogoSeries 按场景明暗选蓝版/白版。
 */
function logoBlock(logoPosition) {
  return (
    `\n\nLogo area: Leave the ${humanizePosition(logoPosition)} completely clean and empty — reserve ` +
    `roughly the outer 22% of the width and 18% of the height there as quiet, uncluttered scene ` +
    `(plain wall, ceiling or sky), with no headline, subheading, button, furniture detail or busy ` +
    `texture intruding into it.\n` +
    `- Do NOT draw, paint, letter or imply ANY logo, brand mark, flower symbol, brand name, ` +
    `wordmark, tagline or watermark anywhere in the image. The real Fanz logo is composited in ` +
    `afterwards by code — anything you draw there would be a duplicate and would be wrong.`
  );
}

/**
 * 按场景明暗选 logo 变体:亮场景用蓝版,暗场景用白版。
 *
 * 为什么不写死在模板里:场景模式(室内实景 / 抽象海报)是生成时随机决定的
 * (INTERIOR_WEIGHT),模板却只能配一个固定变体——上一版 product_intro 配了
 * 白色 logo,结果抽到明亮卧室,白 logo 不可读,模型自己加黑底方框。
 *
 * @param {string} sceneMode - 'interior' | 'poster'
 * @param {object} template
 * @returns {string} brand_assets.series
 */
function pickLogoSeries(sceneMode, template) {
  if (sceneMode === 'interior') return 'lockup_blue';   // 明亮实景 → 品牌蓝
  if (sceneMode === 'poster') return 'lockup_white';    // 深色海报底 → 白色
  return (template && template.logoSeries) || 'lockup_blue';
}

/** Format 收尾段——产品保真/整机入画/光影融合/规格,一段讲完不重复。 */
function formatBlock() {
  return (
    `\n\nFormat: Square 1:1, social-media-ready, e-commerce hero banner quality — think Shopee/Lazada ` +
    `flagship listing image crossed with a premium tech brand poster. Reproduce the product from the ` +
    `attached product image with 100% accurate shape, colour, and detail — do not redesign or alter it. ` +
    `Keep the entire product visible in frame, integrated with realistic unified lighting and a natural ` +
    `contact shadow — it must look photographed together, never pasted on. No watermarks, no logos, no ` +
    `brand marks. No extra text beyond the typography specified above, no fine print, no stock-photo look.`
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
 * 2026-08-01 加内容角度(雷3):提炼层原本永远抓"最显眼的东西",而最显眼的
 * 永远是那三条卖点 —— 干测实测 12 篇里 4 篇副标题都是 "10-Year Motor Warranty"、
 * 3 篇是 "Integrated LED Light",即使正文已经不再逐篇提保修。根因是这一层
 * 不知道"这篇的重点是什么",只知道"哪句话像广告词"。现在按 row.angle 指定
 * 该抓什么:知识角度抓知识点、场景角度抓场景感受、痛点角度抓问题本身。
 *
 * @param {object} row - content_calendar row (fb_content/ig_content/topic/pillar/angle)
 * @returns {Promise<{title: string, selling_point?: string, cta?: string, promo_badge?: string}|null>}
 *   null → 调用方退回 extractTextsFromRow 的原始字段（不阻断管线）。
 */
async function deriveImageText(row, opts = {}) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  const copy = (row.fb_content || row.ig_content || '').trim();
  if (!apiKey || !copy) return null;

  // 整月已经用过的图上文字 —— 由调用方(pipeline)从同一个 plan 的兄弟行里读出来。
  //
  // 2026-08-01 干测:光靠提示词把 CTA 写散,4 篇撞句只降到 3 篇。根因不是模型
  // 不听话 —— Fanz 自己的真实收尾就是 "DM us today",文案层每篇都这么结尾是**对的**,
  // 提炼层照抄也就顺理成章。这不是措辞问题,是缺少"整月已经用过什么"这个输入。
  // 给它真实的已用清单,比把话说得更重有用。
  const usedBlock = (() => {
    const used = [
      ['CTA', (opts.avoidCtas || [])],
      ['HEADLINE', (opts.avoidTitles || [])],
      ['SUBHEADING', (opts.avoidSubheads || [])],
    ].filter(([, v]) => v.length);
    if (!used.length) return '';
    return '\n\nALREADY USED ON OTHER IMAGES THIS MONTH — every line below is taken. Yours must be ' +
      'different from all of them (different words, not a re-ordering):\n' +
      used.map(([label, vals]) => `${label} already used: ${vals.map((v) => `"${v}"`).join(', ')}`).join('\n');
  })();

  const isFestival = String(row.pillar || '').toLowerCase() === 'festival'
    || row.is_festival === true;
  const focus = isFestival
    ? 'This is a festive greeting post. The image carries the GREETING ONLY. Put the wish in the ' +
      'headline, leave the subheading empty or a single warm line, and output NO CTA at all — ' +
      'Fanz never puts a call-to-action on a festive greeting.'
    : require('./content-angles').extractionFocus(row.angle, row.pillar);

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
              'WHAT TO PULL OUT FOR THIS POST (this overrides your instinct to grab whatever ' +
              'sounds most like advertising copy):\n' + focus + '\n\n' +
              'Output EXACTLY these labeled lines and nothing else:\n' +
              'HEADLINE: 3-6 words, punchy, the single biggest hook — never a full sentence. It must be ' +
              'the point of THIS post as described above, taken from words actually in the post. Avoid vague ' +
              'style adjectives on their own ("elegant", "sophisticated", "premium").\n' +
              'SUBHEADING: up to 6 words, a DIFFERENT part of the same point — not a second slogan\n' +
              // 2026-08-01 又踩一次同一个坑:这一行原本给了三个字面 CTA 例子
              // ("DM Us Today" 等),干测 13 篇里 4 篇的 CTA 就是其中第一个 ——
              // 和当初"示例钩子被抄成 6 篇同一句开场"一模一样的失败模式。
              // 结论:任何印在成品上的文字,提示词里都不许出现可抄的成句。
              // 2026-08-03:上一版写"把本篇的收尾句压缩成按钮",结果模型压缩的是
              // 收尾句的**问句那一半**("Not sure which fan suits your room? DM us today."
              // → "Not sure which fan"),12 条里 3 条是半截问句。按钮上印半句话是坏的。
              'CTA: 2-4 words, and it MUST be a complete instruction or invitation that works on a ' +
              'button — an imperative verb phrase. Never a question, never a sentence fragment, never ' +
              'a clause starting with "Not sure", "Wondering", "Curious" or "Is your". Most posts end ' +
              'with a question followed by an invitation; take the INVITATION half, not the question. ' +
              'Vary the wording between posts and avoid "Shop Now" / "Get Yours Today".\n' +
              'Never repeat the same claim across HEADLINE and SUBHEADING.\n' +
              'Do NOT reach for the brand credentials (warranty, SIRIM, DC motor, LED light) unless the ' +
              'post is genuinely about one of them — they are the single biggest cause of a month of ' +
              'identical-looking images.\n' +
              'Do not invent facts absent from the post. Never write a number that does not literally ' +
              'appear in the post text. No quotation marks, no trailing punctuation.' + usedBlock,
          },
          { role: 'user', content: `Pillar: ${row.pillar || 'product'}\nContent angle: ${row.angle || '(unspecified)'}\n\nFull post:\n${copy.slice(0, 800)}` },
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
    // 2026-07-30 起不再自动提炼徽章文案:提示词已不要求 BADGE 行,
    // 这里保留 grab 只为兼容模型偶尔多吐一行——真吐了也不用。
    const promo_badge = null;
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
 * @param {object} [brandColors] - kit.colors（品牌色板，取 brand blue 做强调色）
 * @returns {Promise<{prompt, source, texts, sceneMode, logoSeries}>}
 *   The prompt refers to image[0] as the product photo and image[1] as the
 *   logo — reference-image-gen.js must keep that attachment order.
 *   logoSeries 是"这张图该用哪个 logo 变体"——由实际场景明暗决定，
 *   调用方(pipeline)据此取素材，不要再用 template.logoSeries 写死的那个。
 */
async function buildReferenceImagePrompt(row, template, productName, brandVoice, productMeta, brandColors, opts = {}) {
  const rawTexts = extractTextsFromRow(row);
  // Dashboard 手改过(selling_point/cta/badge 任一有值)就尊重原样,不覆盖；
  // 否则说明这篇帖子还没人手动配过图上文字——从正式文案里提炼短版本，
  // 而不是把 row.topic 这种内部 brief 原样糊上去。
  let texts = rawTexts;
  if (!rawTexts.selling_point && !rawTexts.cta && !rawTexts.promo_badge) {
    const derived = await deriveImageText(row, opts);
    if (derived) texts = derived;
  }

  // 出图前先查一遍编造 —— qa-image 在成品上也会查，但那是**烧完一次出图钱之后**
  // (一次 ~215 秒 + 一次生成费)。提炼层是最容易编数字的一环(它在"压缩成短句"
  // 时会顺手加个漂亮的数字)，在这里拦掉最便宜。
  try {
    const { checkFabricatedClaims } = require('./qa-claims');
    for (const f of ['title', 'selling_point', 'cta', 'promo_badge']) {
      if (!texts[f]) continue;
      const c = checkFabricatedClaims(texts[f], productMeta);
      if (!c.ok) {
        console.error(`[design-agent] 图上「${f}」含无依据声明，已丢弃该字段: ${c.blocking.join(' | ')}`);
        texts = { ...texts, [f]: undefined };
        delete texts[f];
      }
    }
    // 标题被丢掉就整份退回原始字段(topic 当标题)，不能出一张没标题的图
    if (!texts.title) texts = rawTexts;
  } catch (err) {
    console.error('[design-agent] 图上文字事实检查失败(不阻断):', err.message);
  }

  const { direction, source, sceneMode } = await deriveCreativeDirection(row, template, productName, brandVoice);
  const brandBlue = (brandColors && (brandColors.brand || brandColors.accent)) || BRAND_BLUE;
  // 分段结构照搬 Edwin 手测验证版:开头一句产品保真 → 创意指导(场景/构图)
  // → Typography → Logo → Format。简洁、单声道、不堆警告。
  const prompt =
    `Create a premium e-commerce hero product banner for a ceiling fan, using the exact product ` +
    `shown in the attached product image — do not redesign, restyle, or alter the fan itself in ` +
    `any way; keep its exact shape, color, and details 100% accurate.` +
    `${productSpecBlock(productMeta)}\n\n` +
    `Composition & Background: ${direction}` +
    `${typographyBlock(texts, brandBlue)}${logoBlock(template.logoPosition)}${formatBlock()}`;
  return { prompt, source, texts, sceneMode, logoSeries: pickLogoSeries(sceneMode, template) };
}

module.exports = { buildReferenceImagePrompt, deriveCreativeDirection, deriveImageText, pickLogoSeries };
