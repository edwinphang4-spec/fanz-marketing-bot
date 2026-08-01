// ============================================
// Copywriting node — generates FB + IG copy + hashtags.
//
// Exposes:
//   buildCopywritingPrompt(topic, pillar) → system prompt string
//   parseCopywritingResponse(rawText)     → { fb_content, ig_content, hashtags } | null
//   validateCopywritingResult(parsed)     → { valid, errors, keywordsHit }
//   FORBIDDEN_PLACEHOLDER_PATTERNS        → array of patterns
//   FANZ_KEYWORD_PATTERNS                 → RegExp[]
// ============================================

const { getMalaysiaDate, MONTHS, FESTIVALS } = require('./planning');

// RegExp subclass exposing .includes(needle) over the pattern's source.
// Lets external code introspect the placeholder list by literal substring.
class StringRegExp extends RegExp {
  includes(needle) {
    return typeof needle === 'string' && this.source.includes(needle);
  }
}

const FORBIDDEN_PLACEHOLDER_PATTERNS = [
  new StringRegExp('{{'),
  new StringRegExp('}}'),
  new StringRegExp('TODO', 'i'),
  new StringRegExp('lorem', 'i'),
  new StringRegExp('ipsum', 'i'),
  new StringRegExp('placeholder', 'i'),
  new StringRegExp('insert', 'i'),
];

const FANZ_KEYWORD_PATTERNS = [
  /10.*(?:year|warranty)/i,
  /warranty/i,
  /SIRIM/i,
  /on.?site|onsite/i,
  /DC/i,
  /motor/i,
  /energy/i,
  /Malaysia/i,
  /ceiling.?fan|dc.?fan|smart.?fan/i,
];

// ============================================
// buildCopywritingPrompt
// ============================================

// 硬编码的默认品牌声音（brand_kit.brand_voice 为空时用它）
// 2026-08-01 实测事故:这一段原来给了一句字面示例钩子
//   ("Use unexpected hooks: \"Bigger fan doesn't always mean better airflow\"")
// 结果整月 12 篇里 **6 篇的开头第一句就是这句话** —— 模型把示例当模板抄了,
// 连"怎么选尺寸""十年品牌历程"这种完全不同的题材都用同一句开场。
// 现在:不给可抄的句子,只给风格方向,并明确禁止复用开场。
const DEFAULT_VOICE_BLOCK = `BRAND VOICE:
- Professional, crisp, and confident — every word earns its place
- Short sentences. Rhythmic pacing.
- Not salesy, not robotic — think of a knowledgeable friend who happens to write great copy
- All copy must be in English only (Malaysia/Singapore English context)

OPENING LINE (this matters — it is the first thing anyone reads):
- Open with an unexpected hook that belongs to THIS post only. It must come out of this
  post's own topic, product and angle — if the same opening could be pasted onto a different
  post in the month, it is the wrong opening.
- Vary the ANGLE of attack between posts. Rotate across approaches like: puncture a common
  belief / a small everyday moment in a Malaysian home / a number that surprises / the question
  the reader is already asking / a blunt one-line verdict / a before-and-after contrast.
- The approaches above are directions, NOT sentences. Never reuse the wording of an example,
  a previous post, or a stock line. Write the sentence fresh every time.`;

// 兜底产品清单 —— 只列选品池里真实有素材的系列(FS/GAZE/FERRO/GRANDE)。
// 刻意不写 Smart Series / AURA / Inno:前者不是独立系列,后两者规格待 Fanz 确认,
// 写了文案就会编出库里没有的型号和尺寸。
const PRODUCT_RANGE_FALLBACK = [
  'FS Series — 42"/48"/52"/56"/62", with LED light (L) or without (N)',
  'GAZE Series — 40"/52"/66", with LED light (L) or without (N)',
  'FERRO Series — 56", with LED light (L) or without (N)',
  'GRANDE Series — 52", with integrated LED light',
];

/**
 * @param {string} topic
 * @param {string} pillar
 * @param {string} [reviewNotes]
 * @param {string} [brandVoice] - brand_kit.brand_voice；有值则替换默认声音块，
 *   让老板在 Dashboard 调语气不用改代码。语言约束（English only）始终保留。
 * @param {object} [productContext] - 素材库现货 + 本篇指定产品。
 *   { rangeLines?: string[], assigned?: {name, model_code, size_inches, has_led, color, blade_count} }
 *   不传则用 PRODUCT_RANGE_FALLBACK（只含选品池里真实存在的系列）。
 * @param {object} [angleContext] - 本篇的内容角度 + 品牌事实配额（content-angles.js 分配）。
 *   { angle: 'painpoint'|..., brandFact: 'warranty'|'sirim'|'dc_motor'|null }
 *   不传则退回旧行为（不给角度约束）—— 但整月批量一律要传，否则 13 篇会同角度。
 */
function buildCopywritingPrompt(topic, pillar, reviewNotes, brandVoice, productContext, angleContext) {
  const now = getMalaysiaDate();
  const currentDate = `${MONTHS[now.getMonth()]} ${now.getDate()}, ${now.getFullYear()}`;
  const currentMonthNum = now.getMonth();

  const activeSeasons = FESTIVALS
    .filter(f => f.triggerMonths.includes(currentMonthNum))
    .map(f => `${f.name} (${f.range})`)
    .join('; ') || 'no major festival; base on general Malaysia weather/marketing rhythm';

  // 产品清单:优先用调用方传进来的素材库现货,否则用兜底清单。
  //
  // 2026-07-30 实测事故:这里原来写死了 Smart Series / AURA / Inno,文案就真写了
  // "36\" AURA Series",出图时标题被提炼成 "Whisper Quiet 36\" AURA" 印在图上,
  // 而画面里是 FS 563L(56 吋)—— 图文对不上。计划器那层已经收口过一次,文案层
  // 是同一个根因的下一层。
  const rangeBlock = ((productContext && productContext.rangeLines) || PRODUCT_RANGE_FALLBACK)
    .map((l) => `- ${l}`).join('\n');

  // 本篇已经在规划时定了具体型号 → 明确告诉文案写哪一台,别自由发挥成别的型号。
  const a = productContext && productContext.assigned;
  const assignedBlock = a
    ? `\n\nTHIS POST'S PRODUCT (write about THIS exact model — do not name a different model or size):\n` +
      `- ${a.name}${a.model_code ? ` (model ${a.model_code})` : ''}` +
      `${a.size_inches ? `, ${a.size_inches}\" diameter` : ''}` +
      `${a.color ? `, ${a.color} finish` : ''}` +
      `${a.has_led === true ? ', with integrated LED light' : a.has_led === false ? ', no light' : ''}` +
      `${a.blade_count ? `, ${a.blade_count} blades` : ''}` +
      `\n- Any size or feature you mention must match this model. Do not invent other sizes.`
    : '';

  // 事实边界 —— 2026-08-01 实测事故:文案写出 "suitable for rooms up to 225 sq ft",
  // 而系统里没有任何房间尺寸数据,这个数字是编的。这些帖子要发到 Fanz 官方
  // Facebook 给真实客户看,客户照着买了不合适会去投诉 Fanz。
  // 提示词先划边界,qa-claims 再在生成后代码层兜底。
  const factBoundary = require('./qa-claims').buildFactBoundaryBlock(
    productContext && productContext.assigned
  );

  // 已确认的真实规格(按系列)+ Fanz 官方选尺寸表。
  // 2026-08-01 去 Fanz 官方账号实地看内容时发现:我们以为"没有"的数据,
  // Fanz 自己早就公开发过。规格严格按系列隔离 —— Grande 的 6 段风速/正反转
  // 只属于 Grande,绝不能外溢到 FS/GAZE/FERRO(它们尚无官方规格图)。
  const pf = require('./product-facts');
  const assignedSeries = a && a.model_code ? String(a.model_code).split(/[\s\d]/)[0] : null;
  const seriesFacts = assignedSeries ? pf.seriesFactsBlock(assignedSeries) : '';
  // 选尺寸表只在真的在讲"怎么选尺寸"时给,免得每篇都往里塞表格
  const needsSizeGuide = /size|inch|how to choose|which fan|room|bedroom|living/i.test(String(topic || ''))
    || String(pillar || '').toLowerCase() === 'educational';
  const sizeGuide = needsSizeGuide ? pf.roomSizeGuideBlock() : '';

  // 内容角度 + 品牌事实配额（雷1 + 雷2 的提示词面）。
  // 分配本身是代码算的（content-angles.planContentAngles），这里只把结果翻译成
  // 模型看得懂的约束。没传 angleContext 就完全不注入 —— 单篇即兴生成不受影响。
  const ca = require('./content-angles');
  const angleSection = angleContext && angleContext.angle
    ? ca.angleBlock(angleContext.angle, angleContext.brandFact || null)
    : '';

  const voiceBlock = (brandVoice && brandVoice.trim())
    ? `BRAND VOICE (set in Brand Kit):\n${brandVoice.trim()}\n- All copy must be in English only (Malaysia/Singapore English context)`
    : DEFAULT_VOICE_BLOCK;

  let prompt = `You are a senior social media copywriter for Fanz Sdn Bhd, a Malaysian ceiling fan brand.

${voiceBlock}

BRAND FACTS — these exist, but whether YOU may use one is decided per post, not by you:
- 10-year motor warranty
- SIRIM certified
- DC motor technology
- On-site service across Malaysia & Singapore
- Product liability insurance up to RM 1,000,000
- 10+ years serving Malaysian homes

HOW TO USE THEM — read this carefully:
- They are rationed across the month by the brief below (CONTENT ANGLE section). Whatever it
  allots you is the maximum: one fact, or none. There is no case where you may add a second.
- Fanz's own recent posts (July 2026) mention NONE of them. A post that lists its brand's
  credentials reads like an advert; a post that doesn't reads like a brand worth following.
- Never open a post with one, and never end with a stack of them.
${angleSection}

PRODUCT RANGE (these are the ONLY models that exist as marketing assets — never name any other series):
${rangeBlock}${assignedBlock}${seriesFacts}${sizeGuide}
${factBoundary}

CURRENT CONTEXT:
- Current date (Malaysia): ${currentDate}
- Active seasonal / festival context: ${activeSeasons}

YOUR TASK:
Generate a social media post for this topic and content pillar.

Topic: "${topic}"
Pillar: ${pillar}

OUTPUT FORMAT — you MUST use these exact section headers (the system parses them automatically):

📱 FACEBOOK VERSION
(1-3 SHORT paragraphs, plain sentences. No bullet lists. No website URL.)

📸 INSTAGRAM VERSION
(Same shape, slightly tighter. No bullet lists. No website URL.)

#⃣ HASHTAGS
(6-7 hashtags from the approved library below)

COPY STRUCTURE — match how Fanz actually writes today (their July 2026 posts):
1. OPENING (1-2 sentences) — this post's own hook. See the OPENING LINE rules above.
2. BODY (1-2 short sentences) — what this post is actually about. Plain prose.
   NO ✌️ bullets. NO feature lists. NO stacking of brand facts.
3. CLOSING — a short question + DM invitation, in Fanz's own voice. Vary the wording,
   e.g. the shape of "Not sure which fan suits your room? DM us today."
   Do NOT use "Get yours today", and do NOT put a website URL anywhere.

Real Fanz examples of the target shape (study the SHAPE, never copy the words):
- "AURA Series - As your small space companion, it brings together comfort, airflow, and a
   clean design that suits modern compact homes. // Perfect for creating a more comfortable
   and refreshing home environment. // Not sure which fan suits your room? DM us today."
- "Spinor Series-- Discover why a corner fan is the smart choice for saving space, improving
   airflow and keeping your home comfortable"
Note what is absent from both: no warranty, no SIRIM, no DC-motor line, no bullets, no URL.

⚠️ CRITICAL: Hashtags go ONLY in the #⃣ HASHTAGS section below.
Do NOT append hashtags to the end of 📱 FACEBOOK VERSION or 📸 INSTAGRAM VERSION content.
The #⃣ HASHTAGS section must contain all hashtags and nothing else.

HASHTAG GUIDELINES:
Pick from this brand-approved hashtag library, 6-7 per post:

Always include: #FANZ #Fanz
Brand slogans: #TheAirExpert #TheAirMover
Product category: #CeilingFan #DCFan #SmartFan
Market: #Malaysia #Singapore #CeilingFanMalaysia
Lifestyle: #CozyHome #HomeAppliance #RenovationMalaysia #InteriorDesignMalaysia
Series (add if relevant, ONLY for the series this post is actually about): #GrandeSeries #FSSeries #GazeSeries #FerroSeries
Seasonal/festival: add relevant tags based on current date

EMOJI USAGE:
At most ONE emoji per post, placed at the end of a sentence — this is how Fanz writes now.
Do not sprinkle emoji through the copy and never use them as bullet markers.
If you use one, pick from: ✨ (brand polish) ❄️ 🍃 (cool air, natural fresh).
Never use ✌️ as a bullet marker and never use 🌐 — there is no website URL in these posts.

PILLAR-STYLE GUIDES — the pillar sets the TYPE of post; the CONTENT ANGLE above sets what it
is actually about. Where they seem to disagree, the angle wins.

product — This model, concretely. What it is and who it is for. Prose, no bullet list.
case — Lifestyle storytelling. Paint the space. Show don't tell. Soft CTA.
promo — Clear offer and a sense of timing. Engagement-driving CTA (DM us, tell us your room type).
  Only state discount figures or end dates that you were actually given — we have no promotional
  terms on file, so if none were supplied, describe the offer without inventing numbers.
story — Brand values, emotional connection. Less product, more heart.
educational — Practical how-to. Help first, sell second. Soft CTA.

SPECIAL RULE — FESTIVE GREETING POSTS (Hari Raya, CNY, Deepavali, Wesak, Muharram,
Christmas, New Year, Merdeka, Malaysia Day, Agong's birthday):
- A greeting and NOTHING else. No product name. No model. No feature. No warranty.
  No SIRIM. No CTA. No website. Just the wish, warmly and respectfully written.
- Fanz's own festive posts are pure greetings — their Muharram post reads only
  "May the holy month of Muharram bring you faith, peace, and strength." Match that.
- 1-2 short sentences is the right length. Do not pad it.
- Keep the hashtags to the brand + festival tags only.

FINAL CHECKS BEFORE OUTPUT:
- Is the language 100% English? (No Chinese-Malay mixing)
- Do NOT put hashtags at the end of FB or IG version — they go ONLY in #⃣ HASHTAGS section
- Are hashtags from the approved library?
- No placeholders, no TODOs, no lorem ipsum.
- Did you stay inside this post's CONTENT ANGLE, and use at most the ONE brand fact it was
  allotted (or none, if it was allotted none)? Count them before you output.`;

  // NEW: Append revision context if reviewNotes is provided
  if (reviewNotes && typeof reviewNotes === 'string' && reviewNotes.trim()) {
    prompt += `\n\nREVISION CONTEXT — The previous version of this post was rejected by the reviewer. Please address these specific revision notes in your new version:\n"${reviewNotes}"\n\nDO NOT simply rephrase — actively incorporate the feedback above.\nDO NOT leave placeholders or TODOs.`;
  }

  return prompt;
}

// ============================================
// parseCopywritingResponse
// ============================================

// 头行对前导符号免疫：模型有时输出 "📱 **FACEBOOK VERSION**"（加粗/emoji/横线
// 组合随温度漂移），旧正则要求 emoji 后紧跟字母，撞上加粗就整段解析失败
//（实证 2026-07-12，属存量 flaky）。改为忽略行首所有非字母字符。
const SECTION_PATTERNS = {
  fb_content: /^[^A-Za-z]*FACEBOOK\s*VERSION/i,
  ig_content: /^[^A-Za-z]*INSTAGRAM\s*VERSION/i,
  hashtags: /^[^A-Za-z]*HASHTAGS/i,
};

function parseCopywritingResponse(rawText) {
  if (!rawText || typeof rawText !== 'string') return null;

  const lines = rawText.split('\n');

  // Locate each section header's line index
  const headerHits = []; // { key, lineIndex }
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const [key, pattern] of Object.entries(SECTION_PATTERNS)) {
      if (pattern.test(line)) {
        headerHits.push({ key, lineIndex: i });
        break; // one header per line
      }
    }
  }

  if (headerHits.length === 0) return null;

  // Sort by line index so we can slice between consecutive headers
  headerHits.sort((a, b) => a.lineIndex - b.lineIndex);

  const sections = { fb_content: '', ig_content: '', hashtags: '' };
  for (let i = 0; i < headerHits.length; i++) {
    const { key, lineIndex } = headerHits[i];
    const nextLine = i + 1 < headerHits.length ? headerHits[i + 1].lineIndex : lines.length;
    const body = lines.slice(lineIndex + 1, nextLine).join('\n').trim();
    sections[key] = body;
  }

  return sections;
}

// ============================================
// validateCopywritingResult
// ============================================

function validateCopywritingResult({ fb_content, ig_content, hashtags }) {
  const errors = [];

  if (!fb_content || !fb_content.trim()) errors.push('fb_content is empty');
  if (!ig_content || !ig_content.trim()) errors.push('ig_content is empty');
  if (!hashtags || !hashtags.trim()) errors.push('hashtags is empty');

  const allText = [fb_content, ig_content, hashtags].filter(Boolean).join(' ');

  for (const pattern of FORBIDDEN_PLACEHOLDER_PATTERNS) {
    if (pattern.test(allText)) {
      errors.push(`forbidden placeholder detected (pattern: ${pattern.source})`);
    }
  }

  // keywordsHit 只做信号统计,**不再当作硬校验**。
  //
  // 2026-08-01 拆强制卖点时发现的隐藏强制令:这里原本"一个品牌关键词都没命中
  // 就判失败"。品牌事实现在按整月配额分配,大多数帖子本来就该一条都不提;
  // 而节庆帖("May Muharram bring you faith, peace, and strength.")按设计
  // 连产品都不能提 —— 照旧规则会被整篇判掉。整月配额由
  // content-angles.checkAngleDistribution 在整月层面校验,单篇不该管这件事。
  const keywordsHit = [];
  for (const pattern of FANZ_KEYWORD_PATTERNS) {
    if (pattern.test(allText)) {
      keywordsHit.push(pattern.source);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    keywordsHit,
  };
}

module.exports = {
  buildCopywritingPrompt,
  parseCopywritingResponse,
  validateCopywritingResult,
  FORBIDDEN_PLACEHOLDER_PATTERNS,
  FANZ_KEYWORD_PATTERNS,
};
