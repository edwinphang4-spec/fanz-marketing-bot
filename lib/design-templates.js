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
    // 2026-08-03 Edwin 目检 09-16:白 logo 落在米白中心面板上几乎看不见,
    // 而且 top_center 正好是标题的位置,被字压住。改为品牌蓝 + 右上角,
    // 并且 pipeline 现在会实测背景再定夺(这两个值只是量不到时的兜底)。
    logoSeries: 'lockup_blue',
    // 2026-08-06:0.20 → 0.12。这才是节庆图 logo 压住画面的真因 ——
    // 0.20 宽的 lockup 在 1024 画布上占到 **27% 高**(46px 到 278px),
    // 而 buildFullAiPrompt 只要求模型把四角外侧 **20% 高** 留白。
    // 我们贴的比我们要求留的大 —— 多出来的那 7% 必然压在插画上。
    // 收到 0.12(Edwin 认可的 10-14% 区间)后框底落在 18%,真正待在留白区内。
    logoWidthRatio: 0.12,
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
  // ── 知识帖专属版式（2026-08-06）──
  //
  // Edwin 走完一轮的原话:"教育帖跟普通产品帖版式完全一样,没有任何『这是在教你
  // 东西』的信号。图 90% 是场景照,信息只有『56吋』三个字。"
  //
  // 查出来是三层都没做:
  //   ① educational 模板虽然写了 explainer 背景,但 chooseSceneMode 对它是
  //      75% 掷骰子走 interior —— 走了 interior 那三条背景整个不用,出的是卧室实景;
  //   ② titleColor 只在代码叠字那条路生效,ai_reference 是模型画字,深绿从没用上;
  //   ③ 排版指令(标题+副标题+CTA按钮)对所有模板是同一段,不分 pillar。
  //
  // 所以这里不是改 educational 的参数,是**另起一个模板**:信息图是主体,
  // 产品降为配角,场景模式写死不掷骰子。
  knowledge_explainer: {
    tag: 'knowledge_explainer',
    mode: 'ai_reference',
    sceneSource: 'template',
    // 写死 poster —— 知识帖绝不能抽到"卧室实景",那正是它看起来像产品帖的原因
    forceSceneMode: 'poster',
    logoSeries: 'lockup_blue',
    logoPosition: 'top_right',
    titleColor: '#1E4620',
    backgroundStyle: [
      'Clean flat editorial infographic canvas in cream and off-white, generous margins, a calm teaching layout with clear zones for a comparison panel — no room, no furniture, no photographic interior',
      'Pale sage-and-cream flat explainer canvas with thin-line grid motif, calm instructional layout with a large clear central band for a comparison panel — no room, no furniture',
      'Soft warm off-white flat diagram canvas with subtle muted panel blocks, clean teaching layout with generous clear space for a side-by-side comparison — no room, no furniture',
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

/**
 * pillar(+角度)→ 模板。story 里的节庆帖走 festival_illustration。
 *
 * 2026-08-06:路由第一次看 angle 而不只看 pillar。知识角度的帖子要的是
 * "信息图当主体",和普通产品帖不是同一种东西 —— 只按 pillar 路由,它永远
 * 拿到和产品帖一样的版式。row.angle 由 pipeline 从 compose_spec 挂回来。
 */
function pickTemplate(row) {
  const pillar = ((row && row.pillar) || '').toLowerCase();
  const angle = ((row && row.angle) || '').toLowerCase();
  if (angle === 'knowledge') return TEMPLATES.knowledge_explainer;
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
 * 知识帖信息图的**面板内容** —— 由清单真值算出来，不问模型。
 *
 * 这一层是版式能不能成立的关键。Edwin 的判断:"如果没想清楚信息图里放什么，
 * 做出来会是个漂亮的空壳。" 空壳的成因就是把内容交给模型即兴发挥 ——
 * 它会画出好看的方框，里面填的是编的数字。
 *
 * 所以面板里的每一个字都从 product-catalog 取真值，模型只负责画。
 * 取不到就返回 null，调用方退回普通版式(宁可没有信息图，也不要假信息图)。
 *
 * @returns {{kind, caption, left, right}|null}
 */
function explainerPanel(productMeta) {
  let pc;
  try { pc = require('./product-catalog'); } catch (_) { return null; }
  const said = productMeta && (productMeta.catalog_model || productMeta.model_code);
  if (!said) return null;
  const norm = (s) => String(s).toUpperCase().replace(/[^A-Z0-9]/g, '');
  const model = pc.specsFor(said)
    ? said
    : Object.keys(pc.CATALOG).find((k) => norm(k) === norm(said));
  const spec = model && pc.specsFor(model);
  if (!spec) return null;

  // ① 同尺寸叶数对比 —— 信息量最大的一种，优先。本篇这台必须是其中一方，
  //    否则图讲的是别人家的事。
  const pair = pc.airflowComparisons()
    .filter((c) => c.more.model === model || c.fewer.model === model)
    .sort((a, b) => a.pct - b.pct)[0];
  if (pair) {
    return {
      kind: 'airflow_compare',
      caption: `At the same ${pair.size}", more blades move more air`,
      left: [`${pair.fewer.blades} BLADES`, pair.fewer.model, `${pair.fewer.cfm.toLocaleString()} CFM`],
      right: [`${pair.more.blades} BLADES`, pair.more.model, `${pair.more.cfm.toLocaleString()} CFM`],
    };
  }

  // ② 有灯 / 无灯 —— 同型号两个版本，是真实存在的二选一
  const sameSizeSeries = Object.entries(pc.CATALOG).filter(([m, s]) =>
    pc.isUsable(m) && s.size_inch === spec.size_inch && m !== model);
  const sibling = sameSizeSeries.find(([, s]) => Boolean(s.led) !== Boolean(spec.led));
  if (sibling && pc.canCite(model, 'led')) {
    const [sibModel, sibSpec] = sibling;
    const withLed = spec.led ? [model, spec] : [sibModel, sibSpec];
    const noLed = spec.led ? [sibModel, sibSpec] : [model, spec];
    // 两栏第三行必须是**同一类信息**。
    // 2026-08-06 Edwin 目检:上一版左边写 "3-tone LED"(规格)、右边写
    // "Ceiling light stays yours"(生活场景),不但英文别扭,而且两边根本不对仗 ——
    // 对比图两栏放不同类的东西,读者没法比。改成两边都讲灯这一项规格。
    return {
      kind: 'light_choice',
      caption: 'Same fan, two versions',
      left: ['WITH LIGHT', withLed[0], withLed[1].led === '3 TONE' ? '3-TONE LED' : 'LED BUILT IN'],
      right: ['NO LIGHT', noLed[0], 'NO LED FITTED'],
    };
  }
  return null;
}

/**
 * 知识帖的排版指令 —— 和普通帖完全不同的一段。
 *
 * Edwin 要验的四条里有三条落在这里:一眼看出在教东西 / 信息图是主体不是角落 /
 * 图上文字是知识不是规格。所以占比和字高都写成硬数字，不写"要突出"。
 */
function explainerLayoutBlock(panel, headline, brandBlue) {
  const col = (side, lines) =>
    `  · ${side} column: "${lines[0]}" as the column label, "${lines[1]}" as the model name beneath it, ` +
    `and "${lines[2]}" as the large figure — the figure is the biggest text in the column.`;
  return (
    `\n\nTHIS IS A TEACHING GRAPHIC, NOT A PRODUCT PHOTO. The single most important thing about ` +
    `this image is that a viewer scrolling past can tell within one second that it explains ` +
    `something. Build it as a flat editorial infographic.\n` +
    `- INFOGRAPHIC PANEL (the main subject): a clean side-by-side comparison panel occupying ` +
    `between 45% and 55% of the total image area, horizontally centred, sitting in the middle band ` +
    `of the canvas. Two columns of equal width separated by a thin vertical rule, with a small ` +
    `"vs" marker on the rule.\n` +
    col('Left', panel.left) + '\n' + col('Right', panel.right) + '\n' +
    `  · A short caption under the panel reading "${panel.caption}".\n` +
    `  · The two columns are parallel: same structure, same kind of information, same type size ` +
    `on each line. Never let one side carry a specification and the other a lifestyle phrase.\n` +
    `  · Render every one of those strings EXACTLY as written, character for character and digit ` +
    `for digit. These are real published figures — a wrong digit is a false claim, not a typo.\n` +
    `- HEADLINE: "${headline}" set above the panel. Its cap height must be at least 7% of the image ` +
    `height — clearly the largest type on the canvas. Keep it to one or two lines.\n` +
    `- THE FAN IS A SUPPORTING ELEMENT, NOT THE SUBJECT: show the product from the attached image ` +
    `small and quiet — at most about one fifth of the image width, tucked into a lower corner or ` +
    `beside the panel as a reference. Do NOT stage it in a room, do NOT make it the hero, do NOT ` +
    `let it overlap the panel. No bedroom, no living room, no furniture, no interior photography.\n` +
    // 2026-08-06 我自己引入的回归:这一段替换掉了原来的 typographyBlock,
    // 而"全图统一一种无衬线"那条规则只写在被替换掉的那一段里 ——
    // 实测第二张出了衬线标题配无衬线面板。规则跟着版式走,不能留在旧段里。
    `- TYPE: use ONE consistent clean sans-serif family for every piece of text on the canvas — ` +
    `headline, column labels, model names, figures and caption alike. Do not mix a serif headline ` +
    `with a sans-serif panel.\n` +
    `- Flat vector-style graphic finish. Brand colour ${brandBlue || '#274797'} as the accent on the ` +
    `column labels, the rule and the caption. Calm cream/off-white ground.\n` +
    `- No promotional stickers, seals, badges, ribbons or starbursts. No call-to-action button — ` +
    `a teaching graphic does not sell in the last line.`
  );
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
    // 2026-08-03:上一版只让模型在一个位置留白,而标题恰恰就写在那儿(09-16 实测
    // "Celebrate" 压住了 logo)。现在要求**四个角全部留白**——贴 logo 时会实测背景
    // 挑一个最合适的角落,所以每个角都得是干净的浅色区域。
    `- Keep ALL FOUR CORNERS clear: no headline text, no ribbons, no dense ornament within the ` +
    `outer 25% of the width and 20% of the height at each corner. Those areas must stay calm, ` +
    `light-toned background so a brand logo can be placed into one of them afterwards. ` +
    `Centre the festive typography well inside the frame, away from every corner.\n` +
    `- Do NOT draw any logo, brand name, or watermark text.\n` +
    // 2026-08-06 Edwin 目检马来西亚日那张:"不像 Fanz 品牌体系"。查出来两处 ——
    // ① 这段 prompt 从头到尾只说"a Malaysian home brand",没给任何品牌线索,
    //    模型只能出一张通用节庆贺图;
    // ② deriveImageText 里那个"节庆图只留祝福语、不要 CTA"的分支**从未生效** ——
    //    它认的是 row.pillar==='festival',但节庆帖落库时 pillar 被映射成 story,
    //    而且节庆走 full_ai 根本不经过 deriveImageText。所以那条规矩只能写在这里。
    `- Brand cue: work Fanz brand blue ${BRAND_BLUE} into the palette as a deliberate secondary ` +
    `accent — a border, a base band, or the blessing line's colour — so the poster reads as this ` +
    `brand's festive post rather than a generic greeting card. Keep the festival's own traditional ` +
    `colours dominant; the blue is the second voice, not the first.\n` +
    `- The greeting is the WHOLE message: no product, no model name, no feature, no call-to-action, ` +
    `no "shop now", no phone number, no website. Fanz's own festive posts are pure greetings.\n` +
    `- Do NOT include any ceiling fan or physical product. No photographic humans. High polish, print-quality vector-illustration finish.`
  );
}

module.exports = {
  TEMPLATES, DEFAULT_TEMPLATE, pickTemplate, buildFullAiPrompt, BRAND_BLUE,
  explainerPanel, explainerLayoutBlock,
};
