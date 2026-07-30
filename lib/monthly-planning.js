// ============================================
// Monthly Planning node — generates a full month of content.
//
// Exposes:
//   buildMonthlySystemPrompt(targetMonthStr) → Promise<system prompt string>
//   plannerProductSeries()                    → Promise<string[]> 现货系列清单
//   getMalaysiaDate()                         → Date in UTC+8
// ============================================

const brand = require('./brand');

// ============================================
// Timezone-aware date helpers
// ============================================

/** Return a Date in Asia/Kuala_Lumpur timezone. */
function getMalaysiaDate() {
  const now = new Date();
  const ms = now.getTime() + now.getTimezoneOffset() * 60_000 + 8 * 3_600_000; // UTC+8
  return new Date(ms);
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

// ============================================
// Malaysia festival calendar
// ============================================

const MALAYSIA_FESTIVALS_BY_MONTH = [
  // January
  [{ festival: 'Chinese New Year', note: 'Spring cleaning, home upgrades, festive decoration' }],
  // February
  [{ festival: 'Chinese New Year', note: 'Spring cleaning, home upgrades, festive decoration' },
   { festival: 'Thaipusam', note: 'Public holiday in select states' }],
  // March
  [{ festival: 'Hari Raya Aidilfitri', note: 'Home decoration, family gatherings, festive season' },
   { festival: 'School holidays', note: 'Family time at home' }],
  // April
  [{ festival: 'Hari Raya Aidilfitri', note: 'Home decoration, family gatherings, festive season' }],
  // May
  [{ festival: 'Labour Day', note: 'Public holiday, rest & home time' },
   { festival: 'Wesak Day', note: 'Buddhist celebration, public holiday' }],
  // June
  [{ festival: 'Agong\'s Birthday', note: 'Public holiday' },
   { festival: 'School holidays', note: 'Family time at home' },
   { festival: 'Mid-year sales', note: 'Promotion-friendly period' }],
  // July
  [{ festival: 'Muharram / Awal Muharram', note: 'Islamic New Year' },
   { festival: 'Mid-year sales', note: 'Promotion-friendly period' }],
  // August
  [{ festival: 'National Day / Merdeka', note: 'August 31 — Merdeka campaigns, patriotic themes' }],
  // September
  [{ festival: 'Malaysia Day', note: 'September 16 — East Malaysia awareness' }],
  // October
  [{ festival: 'Deepavali', note: 'Festive lighting, home preparation, family gatherings' }],
  // November
  [{ festival: 'Deepavali', note: 'Festive lighting, home preparation, family gatherings' },
   { festival: 'School holidays', note: 'Family time at home' },
   { festival: 'Year-end sales', note: 'Year-end campaigns' }],
  // December
  [{ festival: 'Christmas', note: 'Year-end festive season, home decoration' },
   { festival: 'School holidays', note: 'Family time at home' },
   { festival: 'Year-end sales', note: 'Year-end campaigns' }],
];

const ALL_PILLARS = ['product', 'case', 'educational', 'story', 'promo', 'festival'];

const REQUIRED_RATIOS = {
  product: 4,
  case: 3,
  educational: 2,
  story: 2,
  promo: 1,
};

// 兜底产品清单 —— 只在素材库读不到时使用（DB 挂了/库为空）。
//
// 2026-07-30 重写:旧清单写死了 Smart Series / AURA / Inno，但——
//   · Smart Series 在 Fanz 的产品图库里没有任何对应素材，发票上也从未出现，
//     判定它不是独立系列（只是带 WiFi 款的营销叫法）→ 移除，不当系列写帖子。
//     具体哪些型号真有 WiFi 未经 Fanz 确认，因此这里不做任何 WiFi 宣称。
//   · AURA（有无 LED 未确认）和 Inno（型号 53 vs 435 冲突）暂不在选品池，
//     计划里写了它们就必然配不到对应产品图。
// 真源是 brand_assets 里 metadata.in_pool=true 的素材（见 plannerProductSeries）。
const PRODUCT_SERIES_FALLBACK = [
  'FS Series — 42"/48"/52"/56"/62", with LED light (L) or without (N)',
  'GAZE Series — 40"/52"/66", with LED light (L) or without (N)',
  'FERRO Series — 56", with LED light (L) or without (N)',
  'GRANDE Series — 52" with integrated LED light',
];

/**
 * 从素材库现货推导"这个月能写哪些系列"。
 *
 * 只认 metadata.in_pool===true 的行（系列/尺寸/LED/颜色全部人工确认、
 * 非低清）。选品池之外的产品不给计划器看见——写了就配不到图。
 *
 * @returns {Promise<string[]>} 每行一个系列的描述，DB 不可用时退回兜底清单
 */
async function plannerProductSeries() {
  try {
    const assets = await brand.listProductAssets();
    const pool = assets.filter((a) => a && a.metadata && a.metadata.in_pool === true);
    if (pool.length === 0) return PRODUCT_SERIES_FALLBACK;

    const bySeries = new Map();
    for (const a of pool) {
      const md = a.metadata || {};
      const s = a.series || md.model_code || 'Fanz';
      if (!bySeries.has(s)) bySeries.set(s, { sizes: new Set(), led: false, noLed: false, colors: new Set() });
      const e = bySeries.get(s);
      if (md.size_inches) e.sizes.add(Number(md.size_inches));
      if (md.has_led === true) e.led = true;
      if (md.has_led === false) e.noLed = true;
      if (md.color) e.colors.add(md.color);
    }

    return [...bySeries.entries()]
      .sort((a, b) => b[1].sizes.size - a[1].sizes.size)
      .map(([s, e]) => {
        const sizes = [...e.sizes].sort((x, y) => x - y).map((n) => `${n}"`).join('/');
        const light = e.led && e.noLed ? 'with LED light (L) or without (N)'
          : e.led ? 'with integrated LED light' : 'without light';
        const colors = [...e.colors].sort().join(', ');
        return `${s} Series — ${sizes}, ${light}; finishes: ${colors}`;
      });
  } catch (err) {
    console.error('[monthly-planning] product pool read failed, using fallback list:', err.message);
    return PRODUCT_SERIES_FALLBACK;
  }
}

const BRAND_SELLING_POINTS = [
  '10-year motor warranty',
  'SIRIM certified — Malaysian quality assurance',
  'DC motor technology — energy efficient, whisper quiet',
  'On-site service across Malaysia & Singapore',
  'Product liability insurance up to RM 1,000,000',
  '10+ years serving Malaysian homes',
];

// ============================================
// buildMonthlySystemPrompt
// ============================================

/**
 * Build the system prompt for monthly content planning.
 *
 * 2026-07-30 改为 async:产品系列清单现在从素材库选品池实时读，
 * 不再写死——写死会让计划出现库里没有的系列（AURA/Inno/Smart），
 * 配图阶段必然对不上。
 *
 * @param {string} targetMonthStr - e.g. "July 2026"
 * @returns {Promise<string>}
 */
async function buildMonthlySystemPrompt(targetMonthStr) {
  const productSeries = await plannerProductSeries();
  const now = getMalaysiaDate();
  const currentDate = `${MONTHS[now.getMonth()]} ${now.getDate()}, ${now.getFullYear()}`;

  // Parse target month
  const [monthName, yearStr] = targetMonthStr.split(' ');
  const targetMonthIndex = MONTHS.indexOf(monthName);
  const targetYear = parseInt(yearStr, 10);

  // Get festivals for the target month
  const monthFestivals = (targetMonthIndex >= 0 && targetMonthIndex < 12)
    ? MALAYSIA_FESTIVALS_BY_MONTH[targetMonthIndex]
    : [];
  const festivalContext = monthFestivals.length > 0
    ? `\nFESTIVALS & EVENTS IN ${targetMonthStr.toUpperCase()}:\n${monthFestivals.map(f => `- ${f.festival}: ${f.note}`).join('\n')}`
    : '\nNo major public festivals this month. Base content on seasonal and marketing timing.';

  const daysInMonth = new Date(targetYear, targetMonthIndex + 1, 0).getDate();

  return `You are a senior social media content strategist for Fanz Sdn Bhd, a Malaysian ceiling fan brand.

Your job: Generate a FULL MONTH content calendar for ${targetMonthStr} (${daysInMonth} days). Create exactly 12 regular posts that hit specific pillar counts, plus 0-2 extra festival posts.

CURRENT DATE (Malaysia): ${currentDate}
TARGET MONTH: ${targetMonthStr}${festivalContext}

SEASONAL CONTEXT:
- Rainy / monsoon season (Nov-Feb) — enclosed spaces, ventilation needs
- Hot / dry season (March-May) — peak fan season, heat relief
- School holidays (March, June, December) — family time at home
- Mid-year sales (June-July) — promotion-friendly period
- Year-end sales (Nov-Dec) — year-end campaigns

BRAND: Fanz Sdn Bhd — premium ceiling fan brand in Malaysia & Singapore.
- 10+ years serving Malaysian homes
- 10-year motor warranty (biggest trust signal)
- SIRIM certified
- DC motor technology — energy efficient, whisper quiet
- On-site service across Malaysia & Singapore
- Product liability insurance up to RM 1,000,000

PRODUCT SERIES — these are the ONLY fan models currently available as marketing assets:
${productSeries.map(s => `- ${s}`).join('\n')}

CRITICAL PRODUCT RULES:
- Write posts ONLY about the series listed above. Do NOT name, imply, or invent any
  other Fanz series (in particular: do NOT mention AURA, Inno, Vetta, Alpine, Delta,
  Mika, Rina, Hepta, Spinor, V605, or a "Smart Series") — those have no usable product
  photo, so the post would end up illustrated with the wrong fan.
- Rotate: across the month, spread posts over different series AND different sizes.
  No two product-featuring posts should showcase the same series-and-size combination.
- Match the model to the room you describe: 40-42" suits bedrooms, condos and covered
  patios; 48-52" suits living and dining rooms; 56"+ suits large living rooms and
  commercial spaces. Do not put a 66" fan in a small bedroom.
- Only claim a light if you pick an "L" (LED) variant. Never claim WiFi or app control
  for any model — that has not been confirmed for this product line.

PILLAR DEFINITIONS:
- product: Feature-driven, functional selling points, concise, ends with website CTA. MANDATORY: include 10-year warranty + SIRIM + DC motor naturally.
- case: Lifestyle storytelling, "transform your space", real-home feel, soft CTA.
- educational: Practical how-to guides (e.g. "how to choose fan size by room", "DC vs AC motors"), problem-solving, soft CTA.
- story: Brand values, emotional connection, "your comfort is our priority", less product more heart.
- promo: Clear offer, urgency, sense of timing, engagement-driving CTA (DM us, drop your room type).
- festival: Pure greeting, warm respectful tone. Do NOT hard-sell products. Subtle product references only.

REQUIRED PILLAR COUNTS (exactly these — this is critical):
- product: 4 posts
- case: 3 posts
- educational: 2 posts
- story: 2 posts
- promo: 1 post
- festival: 0-2 extra posts (do NOT count toward the 12 regular posts)

Total regular posts: 12. Festival posts are additional.

WEEKLY RHYTHM (spread posts across the month):
- 3-4 posts per week
- Monday to Friday only (no weekends)
- At most 1 post per day (except festival posts which can share a day)
- First post should be early in the month, last post should be late in the month

BRAND VOICE:
- English only (Malaysia/Singapore English context)
- Professional, crisp, and confident — every word earns its place
- Short sentences. Rhythmic pacing. Like: "Simple design. Strong airflow. Lasting comfort."
- Use unexpected hooks: "Bigger fan doesn't always mean better airflow"
- Not salesy, not robotic — think of a knowledgeable friend who happens to write great copy

OUTPUT FORMAT:
You MUST respond with ONLY a valid JSON array. No other text, no markdown code fences, no explanation.

Each item in the array must be an object with these exact keys:
{
  "pillar": "product" | "case" | "educational" | "story" | "promo" | "festival",
  "topic": "Catchy post title in English, 5-12 words",
  "post_angle": "One-sentence explanation of the creative angle and why it works for this date",
  "suggested_date": "YYYY-MM-DD"
}

CONSTRAINTS:
- suggested_date must be within ${targetMonthStr} (valid dates: ${targetYear}-${String(targetMonthIndex + 1).padStart(2, '0')}-01 to ${targetYear}-${String(targetMonthIndex + 1).padStart(2, '0')}-${String(daysInMonth).padStart(2, '0')})
- suggested_date must be a weekday (Monday to Friday)
- No duplicate suggested_dates except for festival posts
- Exactly 4 product, 3 case, 2 educational, 2 story, 1 promo pillars
- Festival posts: 0-2 extra, pillar="festival", can share dates with regular posts
- Product rotation: every series listed under PRODUCT SERIES must appear in at least one post's topic or angle, and no series-and-size combination may repeat across product-featuring posts

VALID JSON ARRAY ONLY. No preamble, no explanation, no code fences.`;
}

// ============================================
// parseTargetMonth
// ============================================

/**
 * Parse a month string like "2026-07" or "July 2026" into { monthName, year, monthIndex }.
 * If input is empty/null, defaults to the next month in Malaysia timezone.
 *
 * @param {string|null} input
 * @returns {{ monthName: string, year: number, monthIndex: number, monthStr: string }}
 */
function parseTargetMonth(input) {
  if (!input || input.trim() === '') {
    const now = getMalaysiaDate();
    // Next month
    let year = now.getFullYear();
    let monthIndex = now.getMonth() + 1;
    if (monthIndex > 11) {
      monthIndex = 0;
      year += 1;
    }
    return {
      monthName: MONTHS[monthIndex],
      year,
      monthIndex,
      monthStr: `${MONTHS[monthIndex]} ${year}`,
    };
  }

  const trimmed = input.trim();

  // Try "YYYY-MM" format
  const dashMatch = trimmed.match(/^(\d{4})-(\d{1,2})$/);
  if (dashMatch) {
    const year = parseInt(dashMatch[1], 10);
    const monthIndex = parseInt(dashMatch[2], 10) - 1;
    if (monthIndex >= 0 && monthIndex <= 11) {
      return {
        monthName: MONTHS[monthIndex],
        year,
        monthIndex,
        monthStr: `${MONTHS[monthIndex]} ${year}`,
      };
    }
  }

  // Try "Month YYYY" format
  const textMatch = trimmed.match(/^([A-Za-z]+)\s+(\d{4})$/);
  if (textMatch) {
    const monthIndex = MONTHS.indexOf(
      textMatch[1].charAt(0).toUpperCase() + textMatch[1].slice(1).toLowerCase()
    );
    const year = parseInt(textMatch[2], 10);
    if (monthIndex >= 0 && monthIndex <= 11) {
      return {
        monthName: MONTHS[monthIndex],
        year,
        monthIndex,
        monthStr: `${MONTHS[monthIndex]} ${year}`,
      };
    }
  }

  // Fallback: next month
  const now = getMalaysiaDate();
  let year = now.getFullYear();
  let monthIndex = now.getMonth() + 1;
  if (monthIndex > 11) {
    monthIndex = 0;
    year += 1;
  }
  return {
    monthName: MONTHS[monthIndex],
    year,
    monthIndex,
    monthStr: `${MONTHS[monthIndex]} ${year}`,
  };
}

module.exports = {
  buildMonthlySystemPrompt,
  plannerProductSeries,
  parseTargetMonth,
  getMalaysiaDate,
  MONTHS,
  REQUIRED_RATIOS,
  ALL_PILLARS,
};
