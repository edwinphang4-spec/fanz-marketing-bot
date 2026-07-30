// ============================================
// design-templates.js — 九模板注册表（docs/design-spec.md 的代码化）
//
// 每个 tag 决定：生成模式（composite=模板合成 / full_ai=整图 AI 生成只叠 logo）、
// logo 变体与位置（深底白/浅底蓝/高端 lockup 的铁律）、背景 prompt 约束、标题颜色。
// reference 风格摘要只取同 tag 素材（brand.js 按 series 分桶）。
//
// pickTemplate(row)：pillar → tag 映射（story 里节庆帖走 festival_illustration）。
// 任何查不到的情况回退 DEFAULT_TEMPLATE，绝不让管线炸。
// ============================================

const { isFestivalPost } = require('./festival-handler');

const BRAND_BLUE = '#274797';

const TEMPLATES = {
  product_intro: {
    tag: 'product_intro',
    mode: 'ai_reference',
    sceneSource: 'template',
    logoSeries: 'lockup_white',
    logoPosition: 'top_right',
    productSlot: 'hero_top',
    titleColor: '#FFFFFF',
    // 2026-07-24 复盘 4 款真实产品图后发现:单句 backgroundStyle 会让每次
    // 生成都在"精修同一个视觉母题",连续帖子背景长得一模一样。改数组随机
    // 轮换(design-agent.js 的 pickBackgroundStyle),而不是一句话死磕到底。
    backgroundStyle: [
      'Deep navy blue gradient backdrop with abstract flowing wave layers and subtle glowing blue light arcs, premium tech-product poster style, generous empty space in the upper half and lower-left third',
      'Charcoal-to-navy radial gradient backdrop with soft geometric light beams converging toward the product, minimalist premium tech mood, generous empty space in the upper half and lower-left third',
      'Midnight blue backdrop with a soft circular spotlight glow behind the product and fine light-catching particles drifting through the frame, cinematic premium mood, generous empty space in the upper half and lower-left third',
    ],
  },
  lifestyle: {
    tag: 'lifestyle',
    mode: 'ai_reference',
    sceneSource: 'derived',
    logoSeries: 'lockup_blue',
    logoPosition: 'top_right',
    titleColor: BRAND_BLUE,
    backgroundStyle:
      'Bright airy real Malaysian modern home interior, natural daylight, beige and warm wood tones, Scandinavian-Malay styling, clean ceiling with empty space for a ceiling fan, lower-left area uncluttered for a title',
  },
  promotion: {
    tag: 'promotion',
    mode: 'ai_reference',
    sceneSource: 'template',
    logoSeries: 'lockup_white',
    logoPosition: 'top_right',
    titleColor: '#FFFFFF',
    backgroundStyle: [
      'Vibrant saturated royal-blue gradient with radial light rays, floating gold coins and confetti accents, high-energy e-commerce sale poster feel, big open centre area for headline',
      'Bold red-to-orange gradient burst with dynamic diagonal light streaks and a radial spotlight centre, high-energy flash-sale poster mood, big open centre area for headline',
      'Deep purple-to-blue gradient with sparkling starburst light flares and subtle discount-tag accent shapes, festive high-energy promo mood, big open centre area for headline',
    ],
  },
  festival_illustration: {
    tag: 'festival_illustration',
    mode: 'full_ai',
    logoSeries: 'lockup_white',
    logoPosition: 'top_center',
    logoWidthRatio: 0.20,
    titleColor: '#FFFFFF',
    backgroundStyle: null, // full_ai 用 buildFullAiPrompt
  },
  festival_lifestyle: {
    tag: 'festival_lifestyle',
    mode: 'full_ai',
    logoSeries: 'wordmark_white',
    logoPosition: 'top_left',
    titleColor: '#FFFFFF',
    backgroundStyle: null,
  },
  educational: {
    tag: 'educational',
    // 2026-07-30 从 composite 改为 ai_reference。
    // 原因:composite 那条路要求产品图有真透明通道，而素材库为了清晰度选的是
    // 白底 JPG（4608px 的 jpg vs 330px 的透明 png，取清晰度）。整月批量实测两张
    // educational 成品因此"没有风扇"。
    // 为什么不做自动去背:哑白风扇压在白底上，阈值去背会把扇叶一起吃掉——
    // 库里正好有 Matte White 款，风险实打实。改走已验证的参考图整图重绘更稳。
    mode: 'ai_reference',
    sceneSource: 'template',
    logoSeries: 'lockup_blue',
    logoPosition: 'top_right',
    titleColor: '#1E4620', // 深绿（spec：educational 专属）
    backgroundStyle: [
      'Clean cream/off-white editorial explainer backdrop with soft botanical leaf accents in the corners, calm infographic layout, large uncluttered areas for text',
      'Pale sage-and-cream editorial backdrop with a subtle grid or thin-line diagram motif, calm teaching mood, generous clear space for text',
      'Soft warm off-white studio backdrop with a faint comparison-panel motif in muted tones, clean explainer layout, plenty of empty space for text',
    ],
  },
  feature_explainer: {
    tag: 'feature_explainer',
    mode: 'ai_reference',
    sceneSource: 'template',
    logoSeries: 'lockup_blue',
    logoPosition: 'top_right',
    titleColor: '#FFFFFF',
    backgroundStyle: [
      'Softly blurred modern bedroom interior in muted grey-beige tones with a large frosted-glass translucent panel occupying the frame, minimal futuristic product-app explainer mood',
      'Softly blurred modern living room in warm neutral tones with a large glass or acrylic explainer panel floating in frame, clean tech-editorial mood',
      'Minimalist light-grey studio backdrop with a subtle floating holographic UI/app-interface panel, soft futuristic-tech mood',
    ],
  },
  brand_trust: {
    tag: 'brand_trust',
    mode: 'ai_reference',
    sceneSource: 'template',
    logoSeries: 'lockup_blue',
    logoPosition: 'top_right',
    titleColor: BRAND_BLUE,
    backgroundStyle: [
      'Very light neutral grey studio backdrop, soft even lighting, premium minimalist product-photography mood, clean and uncluttered with space bottom-left for a bold title',
      'Soft warm cream studio backdrop with gentle diffused shadows, premium minimalist product-photography mood, clean and uncluttered with space bottom-left for a bold title',
      'Pale sage-grey studio backdrop with soft directional daylight, calm and trustworthy premium mood, clean and uncluttered with space bottom-left for a bold title',
    ],
  },
  mood_minimal: {
    tag: 'mood_minimal',
    mode: 'ai_reference',
    sceneSource: 'derived',
    logoSeries: 'lockup_blue',
    logoPosition: 'top_right',
    logoWidthRatio: 0.14,
    titleColor: BRAND_BLUE,
    backgroundStyle:
      'Serene bright bedroom or living space, soft morning light through sheer curtains, warm beige linen textures, calm editorial photography, completely uncluttered ceiling',
  },
};

const DEFAULT_TEMPLATE = TEMPLATES.lifestyle;

/** pillar → 模板。story 里的节庆帖走 festival_illustration。 */
function pickTemplate(row) {
  const pillar = ((row && row.pillar) || '').toLowerCase();
  if (pillar === 'product') return TEMPLATES.product_intro;
  if (pillar === 'case') return TEMPLATES.lifestyle;
  if (pillar === 'educational') return TEMPLATES.educational;
  if (pillar === 'promo' || pillar === 'promotion') return TEMPLATES.promotion;
  if (pillar === 'story') {
    try { if (isFestivalPost(row)) return TEMPLATES.festival_illustration; } catch (_) {}
    return TEMPLATES.brand_trust;
  }
  return DEFAULT_TEMPLATE;
}

/**
 * full_ai 模式的完整海报 prompt（festival 类）：
 * AI 出整图含节庆排版文字，字体跟节日走；顶部中央留 logo 空位；
 * 禁品牌字样（logo 我们确定性叠）、禁吊扇产品。
 */
function buildFullAiPrompt(row, template) {
  const headline = (row && row.topic) || 'Festive Greetings';
  const angle = (row && row.post_angle) ? `\nContext for the design mood: ${row.post_angle}` : '';
  return (
    `Design a complete festive social-media poster (square 1:1) for a Malaysian home brand.\n` +
    `- Feature the headline text "${headline}" as beautifully typeset display typography that matches the festival's traditional style (e.g. brush calligraphy for Chinese festivals, elegant script or ornamental type for Raya/Deepavali/Christmas). Optionally add one short tasteful blessing line.\n` +
    `- Rich festive illustration or scene appropriate to the festival, with colours drawn from that festival's traditional palette.${angle}\n` +
    `- Leave a clear empty margin at the ${template.logoPosition === 'top_center' ? 'top centre' : 'top left'} for a brand logo. Do NOT draw any logo, brand name, or watermark text.\n` +
    `- Do NOT include any ceiling fan or physical product. No photographic humans. High polish, print-quality vector-illustration finish.`
  );
}

module.exports = { TEMPLATES, DEFAULT_TEMPLATE, pickTemplate, buildFullAiPrompt, BRAND_BLUE };
