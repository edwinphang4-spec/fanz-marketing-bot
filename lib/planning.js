// ============================================
// content_calendar planning module
//
// Extracted from index.js for testability.
// Contains: buildPlanSystemPrompt, parsePlanResponse, plan session helpers.
// ============================================

// ============================================
// Timezone-aware date helpers
// ============================================

/** Return a Date in Asia/Kuala_Lumpur timezone. */
function getMalaysiaDate() {
  const now = new Date();
  const ms = now.getTime() + now.getTimezoneOffset() * 60_000 + 8 * 3_600_000; // UTC+8
  return new Date(ms);
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// fixed: { month(0-indexed), day } —— 只给**每年日期固定**的节日。
// 农历/回历/印度历的节日(CNY / Hari Raya / Deepavali / Wesak / Thaipusam / Muharram)
// 每年都在移动,我们手上没有当年的准确日期 —— 一律不写 fixed,
// 宁可只说"在这个季节里",也不要编一个具体日子出来。
const FESTIVALS = [
  { name: 'Chinese New Year (农历新年)', range: 'Jan-Feb', triggerMonths: [0, 1] },
  { name: 'Hari Raya Aidilfitri (开斋节)', range: 'March-April', triggerMonths: [2, 3] },
  { name: 'Deepavali (屠妖节)', range: 'Oct-Nov', triggerMonths: [9, 10] },
  { name: 'Christmas (圣诞节)', range: 'December', triggerMonths: [11], fixed: { month: 11, day: 25 } },
  { name: 'National Day / Merdeka (国庆)', range: 'August 31', triggerMonths: [7], fixed: { month: 7, day: 31 } },
  { name: 'Malaysia Day (马来西亚日)', range: 'September 16', triggerMonths: [8], fixed: { month: 8, day: 16 } },
  { name: 'Labour Day (劳动节)', range: 'May 1', triggerMonths: [4], fixed: { month: 4, day: 1 } },
  { name: 'Mid-year sales (年中促销)', range: 'June-July', triggerMonths: [5, 6] },
  { name: 'School holidays (学校假期)', range: 'March, June, December', triggerMonths: [2, 5, 11] },
  { name: 'Rainy / monsoon season (雨季)', range: 'Nov-Feb', triggerMonths: [10, 11, 0, 1] },
  { name: 'Hot / dry season (热季)', range: 'March-May', triggerMonths: [2, 3, 4] },
];

// 固定日期节日进入/退出"当前语境"的窗口(天)。
// 提前 21 天开始预热,过后 14 天内仍然提及 —— 但明确标注"已经过去了"。
// 为什么过去了还要提:不提的话模型会用自己的世界知识把它当成"快到了"再写一遍,
// 明确写出"已过"比沉默安全。
const FESTIVAL_LOOKAHEAD_DAYS = 21;
const FESTIVAL_LOOKBACK_DAYS = 14;

/** 'YYYY-MM-DD' / Date / 空 → Date(空=今天,马来西亚时区) */
function toPostDate(input) {
  if (input instanceof Date && !isNaN(input)) return input;
  if (typeof input === 'string') {
    const m = input.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  }
  return getMalaysiaDate();
}

/**
 * 按**这篇帖子的发布日期**算出季节/节庆语境。
 *
 * 2026-08-01 干测实测事故:一篇排在 9 月 28 日的帖子写出 "Malaysia's National Day
 * is near" —— Merdeka(8/31)和 Malaysia Day(9/16)那时都已经过去了。两层根因:
 *   ① 文案层用的是 getMalaysiaDate()(生成当天,8 月 1 日),不是这篇的排期日期,
 *      所以整月文案都以为"现在是八月";
 *   ② 就算把日期传对,过滤只到**月**这一级 —— 9 月任何一天都会被告知
 *      "Malaysia Day 正当时",9 月 28 日照样写错。
 * 所以两半都得修,只修①没用。
 *
 * @param {string|Date} [postDate] - 这篇帖子的 suggested_date;不传=今天
 * @returns {string} 一行行的语境描述(可直接塞进提示词)
 */
function seasonalContextFor(postDate) {
  const d = toPostDate(postDate);
  const month = d.getMonth();
  const lines = [];

  for (const f of FESTIVALS) {
    if (f.fixed) {
      // 固定日期:按天算距离,跨年取最近的一次(12 月底看 1 月 1 日那种)
      const candidates = [d.getFullYear() - 1, d.getFullYear(), d.getFullYear() + 1]
        .map((y) => new Date(y, f.fixed.month, f.fixed.day));
      let best = null;
      for (const c of candidates) {
        const diff = Math.round((c - d) / 86_400_000);
        if (diff > FESTIVAL_LOOKAHEAD_DAYS || diff < -FESTIVAL_LOOKBACK_DAYS) continue;
        if (best === null || Math.abs(diff) < Math.abs(best)) best = diff;
      }
      if (best === null) continue;
      if (best > 3) lines.push(`${f.name} — ${best} days AFTER this post goes out (${f.range}). It is upcoming; you may build anticipation.`);
      else if (best >= -1) lines.push(`${f.name} — falls on or within a day of this post (${f.range}). Treat it as happening now.`);
      else lines.push(`${f.name} — ALREADY PASSED ${Math.abs(best)} days before this post (${f.range}). Do NOT write that it is coming, near, or "this week".`);
      continue;
    }
    // 非固定日期(农历/回历/印度历 + 季节/促销档期):只到月这一级
    if (!f.triggerMonths.includes(month)) continue;
    lines.push(`${f.name} — somewhere within ${f.range}. The exact date shifts every year and we do not have this year's date, so never write that it is "tomorrow", "this week" or "near".`);
  }

  return lines.length
    ? lines.join('\n')
    : 'no major festival around this post\'s date; base it on general Malaysia weather and marketing rhythm';
}

// ============================================
// buildPlanSystemPrompt
// ============================================

function buildPlanSystemPrompt() {
  const now = getMalaysiaDate();
  const currentMonth = MONTHS[now.getMonth()];
  const currentYear = now.getFullYear();
  const currentDate = `${currentMonth} ${now.getDate()}, ${currentYear}`;
  const currentMonthNum = now.getMonth();

  const nearEvents = FESTIVALS.filter(f => f.triggerMonths.includes(currentMonthNum));
  const nearContext = nearEvents.length > 0
    ? `\nCURRENT SEASONAL HIGHLIGHTS (currently active / approaching):\n${nearEvents.map(f => `- ${f.name} (${f.range})`).join('\n')}`
    : '';

  return `You are a senior social media content strategist for Fanz Sdn Bhd, a Malaysian ceiling fan brand.

Your job: Suggest 3-5 content topics for the coming week that are relevant, timely, and aligned with the current date in Malaysia.

CURRENT DATE: ${currentDate}${nearContext}

MALAYSIA SEASONAL & CULTURAL CONTEXT (full reference):
- Hari Raya Aidilfitri (March-April) — home decoration, family gatherings
- Deepavali (Oct-Nov) — festive lighting, home preparation
- Chinese New Year (Jan-Feb) — spring cleaning, home upgrades
- Christmas (Dec) — year-end festive season
- Muharram / Awal Muharram — Islamic New Year
- National Day (Aug 31) — Merdeka campaigns
- Malaysia Day (Sep 16) — East Malaysia awareness
- School holidays (March, June, December) — family time at home
- Rainy season (Nov-Feb) — enclosed spaces, ventilation
- Hot season (March-May) — peak fan season, heat relief
- Mid-year sales (June-July) — promotion-friendly period
- Year-end sales (Nov-Dec) — year-end campaigns

BRAND & PRODUCTS:
- 10+ years in Malaysia, 10-year motor warranty
- On-site service across Malaysia & Singapore
- SIRIM certified, DC motor technology, energy efficient
- Product liability up to RM 1,000,000
- Products: FS Series 563 L (smart, large living rooms), Grande L Series (22W LED, living/dining), Smart Series (WiFi app control), AURA Series (compact, bedrooms), Inno Series (5-blade, LED dimmer, WiFi)

YOUR TASK:
Based on the CURRENT DATE and Malaysia context above, suggest 3-5 content topics for Fanz's social media this week.

For each topic, include:
1. A catchy title in English (short, punchy, like a real Fanz social media post)
2. A one-sentence explanation of why this topic works now
3. A recommended content direction from exactly one of: product, case, promo, story, educational

Pillar definitions:
- product: Feature-driven, functional selling points, concise, ends with website CTA (https://fanz.my)
- case: Lifestyle-oriented, "transform your space", real-home feel
- promo: Clear offer, urgency, engagement CTA
- story: Brand values, emotional connection, "your comfort is our priority"
- educational: Practical guides (e.g. "how to choose fan size"), problem-solving, soft CTA

Your output MUST follow this exact format — one numbered item per line block with clear separators:

===== 1 =====
Title: [catchy title in English]
Why: [one sentence explaining timeliness/relevance]
Direction: [product|case|promo|story|educational]

===== 2 =====
Title: [catchy title in English]
Why: [one sentence]
Direction: [product|case|promo|story|educational]

... and so on up to 5.

IMPORTANT:
- Titles must be in English only — Fanz posts are always in English
- Do NOT invent holidays or events that don't exist
- If no major event is near the current date, base suggestions on seasons and general marketing timing
- Keep suggestions practical for a ceiling fan brand
- No post content generation — only topic planning`;
}

// ============================================
// parsePlanResponse
// ============================================

/**
 * Parse AI output into structured plan objects.
 *
 * Supports two formats:
 *   A. Block format (explicit "===== N =====" separator):
 *        ===== 1 =====
 *        Title: ...
 *        Why: ...
 *        Direction: ...
 *   B. Numbered list format (freeform "N. Title ..."):
 *        1. Cool Title
 *        Title: Cool Title
 *        Why: ...
 *        Direction: ...
 *
 * Returns [{ number, title, description, direction }]
 *   - number: integer
 *   - title, description: strings (empty if missing)
 *   - direction: one of 'product','case','promo','story' (defaults to 'product' on unknown)
 */
function parsePlanResponse(rawText) {
  const plans = [];
  let currentPlan = null;
  let inBlock = false; // true after "===== N =====" seen — block format active

  const lines = rawText.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();

    // --- A. Block separator: "===== N ====="
    const blockMatch = trimmed.match(/^=+\s*(\d+)\s*=/);
    if (blockMatch) {
      if (currentPlan && currentPlan.number) {
        plans.push(currentPlan);
      }
      currentPlan = { number: parseInt(blockMatch[1]), title: '', description: '', direction: '' };
      inBlock = true;
      continue;
    }

    // --- B. Numbered list item: "N. Title" — only activates if NOT inside a block
    if (!inBlock) {
      const startMatch = trimmed.match(/^(\d+)[.)]\s+/);
      if (startMatch) {
        if (currentPlan && currentPlan.number) {
          plans.push(currentPlan);
        }
        currentPlan = {
          number: parseInt(startMatch[1]),
          title: trimmed.replace(/^\d+[.)]\s*/, ''),
          description: '',
          direction: '',
        };
        continue;
      }
    }

    if (!currentPlan) continue;

    // --- C. Field labels inside a plan block
    const titleMatch = trimmed.match(/^Title:\s*(.+)/i);
    const whyMatch = trimmed.match(/^Why:\s*(.+)/i);
    const directionMatch = trimmed.match(/^Direction:\s*(.+)/i);

    if (titleMatch) {
      currentPlan.title = titleMatch[1].trim();
    } else if (whyMatch) {
      currentPlan.description = whyMatch[1].trim();
    } else if (directionMatch) {
      const dir = directionMatch[1].trim().toLowerCase();
      if (['product', 'case', 'promo', 'story'].includes(dir)) {
        currentPlan.direction = dir;
      } else {
        currentPlan.direction = 'product'; // default fallback for unknown values
      }
    }
  }

  // Don't forget the last plan (must have number + title to count)
  if (currentPlan && currentPlan.number && currentPlan.title) {
    plans.push(currentPlan);
  }

  return plans;
}

// ============================================
// Selection helpers
// ============================================

/**
 * Find a plan by number in the session.
 * Returns the plan object or null if not found.
 */
function findPlanByNumber(session, num) {
  if (!session || !Array.isArray(session.plans)) return null;
  return session.plans.find(p => p.number === num) || null;
}

/**
 * Validate a selection input.
 * Returns { valid: true, plan, number } or { valid: false, message }.
 */
function validateSelection(session, rawText) {
  if (!session) {
    return { valid: false, message: 'Session expired or not found. Please send /plan to start over.' };
  }

  if (!/^[1-9]\d{0,2}$/.test(rawText)) {
    return { valid: false, message: 'Please reply with a number only.' };
  }

  const num = parseInt(rawText, 10);
  const plan = findPlanByNumber(session, num);

  if (!plan) {
    return { valid: false, message: `Please reply with a number between 1-${session.plans.length}. Or send /plan to start over.` };
  }

  return { valid: true, plan, number: num };
}

/**
 * Build the payload for content_calendar creation from a selected plan.
 */
function createSelectionPayload(plan, chatId) {
  return {
    chat_id: String(chatId),
    pillar: plan.direction,
    topic: plan.title,
    status: 'selected',
  };
}

module.exports = {
  buildPlanSystemPrompt,
  parsePlanResponse,
  findPlanByNumber,
  validateSelection,
  createSelectionPayload,
  getMalaysiaDate,
  seasonalContextFor,
  toPostDate,
  MONTHS,
  FESTIVALS,
};