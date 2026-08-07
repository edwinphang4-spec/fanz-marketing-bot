// ============================================
// Monthly Plan Parser — validates AI-generated monthly calendar.
//
// Exposes:
//   parseAndValidateMonthlyPlan(rawText, targetMonthStr) → { valid, posts, errors, pillarCounts }
// ============================================

const VALID_PILLARS = ['product', 'case', 'educational', 'story', 'promo', 'festival'];
// 七类内容角度 —— 单一真源在 content-angles.js
const VALID_ANGLES = require('./content-angles').ANGLE_KEYS;

// Map internal pillars to DB-safe values
// Festival posts use 'story' for storage (DB CHECK allows product/case/promo/story/educational)
const PILLAR_DB_MAP = {
  festival: 'story',
};

function mapPillarForDB(pillar) {
  return PILLAR_DB_MAP[pillar] || pillar;
}

// Target ratios — used as soft guidance, NOT hard requirements.
// The pillar breakdown is a strategy suggestion; the M-2 review lets
// the user tweak it. Don't reject a whole month because LLM was off by one.
const TARGET_RATIOS = {
  product: 4,
  case: 3,
  educational: 2,
  story: 2,
  promo: 1,
};

const WEEKDAYS = [1, 2, 3, 4, 5]; // Monday=1, Sunday=0, Monday=1 ... Friday=5

/**
 * Parse a target month string like "July 2026" into { year, monthIndex, daysInMonth }.
 */
function parseMonthInfo(targetMonthStr) {
  const parts = (targetMonthStr || '').split(' ');
  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];
  const monthIndex = monthNames.indexOf(parts[0]);
  const year = parseInt(parts[1], 10);
  if (monthIndex === -1 || isNaN(year)) return null;
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
  return { year, monthIndex, daysInMonth };
}

/**
 * Check if a date string (YYYY-MM-DD) is a weekday (Mon-Fri).
 * Uses UTC to avoid timezone offset issues.
 */
function isWeekday(dateStr) {
  const parts = dateStr.split('-').map(Number);
  const d = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
  const day = d.getUTCDay(); // 0=Sun, 1=Mon, ..., 5=Fri, 6=Sat
  return day >= 1 && day <= 5;
}

/**
 * Get the next weekday after a given date (YYYY-MM-DD) within the same month.
 * Returns null if no weekday remains in the month.
 */
/**
 * 往后找第一个工作日。2026-08-08:第二个参数从 monthInfo 换成 {from,to} 窗口 ——
 * 原本用 daysInMonth 判边界,窗口不再等于整月之后那个判据就不成立了。
 * 越出窗口返回 null(调用方保持原样:找不到就不挪)。
 */
function nextWeekday(dateStr, win) {
  const d0 = new Date(`${dateStr}T00:00:00Z`);
  for (let attempt = 1; attempt <= 10; attempt++) {
    d0.setUTCDate(d0.getUTCDate() + 1);
    const testStr = d0.toISOString().slice(0, 10);
    if (win && (testStr < win.from || testStr > win.to)) return null;
    if (isWeekday(testStr)) return testStr;
  }
  return null;
}

/**
 * Parse and validate the AI-generated monthly plan.
 *
 * Validation philosophy:
 * - HARD errors: JSON must parse, each post needs required fields, valid pillar, valid date
 * - SOFT warnings: pillar ratios are targets, not requirements; duplicate dates auto-fix
 * - The M-2 review lets the user tweak anything, so don't reject over minor issues
 *
 * @param {string} rawText - AI response text
 * @param {string} targetMonthStr - e.g. "July 2026"
 * @returns {{ valid: boolean, posts: Array, regularPosts: Array, festivalPosts: Array, errors: string[], warnings: string[], pillarCounts: object }}
 */
/**
 * 2026-08-08:第二个参数从"月份字符串"扩成"月份字符串 **或** request 对象"。
 * 批量不再固定 12,日期窗口也不再必须是整月 —— 但两条硬约束的**性质**不变:
 * 日期必须落在窗口内、篇数太少就是没生成成功。只是窗口和地板现在跟着请求走。
 */
function parseAndValidateMonthlyPlan(rawText, targetMonthStr) {
  const errors = [];
  const warnings = [];
  let posts = [];

  // Step 1: Try to parse JSON
  let cleanedText = rawText.trim();

  // Remove markdown code fences if present
  cleanedText = cleanedText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');

  let parsed;
  try {
    parsed = JSON.parse(cleanedText);
  } catch (e) {
    // Try to find a JSON array in the response
    const arrayMatch = cleanedText.match(/\[\s*\{.*\}\s*\]/s);
    if (arrayMatch) {
      try {
        parsed = JSON.parse(arrayMatch[0]);
      } catch (e2) {
        errors.push(`Failed to parse JSON: ${e2.message}`);
        return { valid: false, posts: [], regularPosts: [], festivalPosts: [], errors, warnings, pillarCounts: {} };
      }
    } else {
      errors.push(`No valid JSON array found in response`);
      return { valid: false, posts: [], regularPosts: [], festivalPosts: [], errors, warnings, pillarCounts: {} };
    }
  }

  if (!Array.isArray(parsed)) {
    errors.push(`Parsed result is not an array (got ${typeof parsed})`);
    return { valid: false, posts: [], regularPosts: [], festivalPosts: [], errors, warnings, pillarCounts: {} };
  }

  // Step 2: Validate each post
  const req = (targetMonthStr && typeof targetMonthStr === 'object') ? targetMonthStr : null;
  const monthInfo = req ? null : parseMonthInfo(targetMonthStr);
  if (!req && !monthInfo) {
    errors.push(`Could not parse target month string: "${targetMonthStr}"`);
    return { valid: false, posts: [], regularPosts: [], festivalPosts: [], errors, warnings, pillarCounts: {} };
  }
  // 窗口:整月那条路仍按月算(行为不变);request 那条路按 from/to 算。
  const winFrom = req ? req.from : `${monthInfo.year}-${String(monthInfo.monthIndex + 1).padStart(2, '0')}-01`;
  const winTo = req ? req.to : `${monthInfo.year}-${String(monthInfo.monthIndex + 1).padStart(2, '0')}-${String(monthInfo.daysInMonth).padStart(2, '0')}`;
  const wantCount = req ? Math.max(1, Math.round(req.count || 12)) : 12;
  const windowLabel = req ? `${winFrom}..${winTo}` : targetMonthStr;

  const validatedPosts = [];
  const dateCounts = {}; // track regular post dates for uniqueness
  const festivalDateCounts = {};

  for (let i = 0; i < parsed.length; i++) {
    const item = parsed[i];
    const idx = i + 1;

    if (!item || typeof item !== 'object') {
      errors.push(`Post #${idx}: not an object — skipped`);
      continue;
    }

    // Check required fields
    if (!item.pillar || typeof item.pillar !== 'string') {
      errors.push(`Post #${idx}: missing or invalid "pillar" — skipped`);
      continue;
    }
    if (!item.topic || typeof item.topic !== 'string' || item.topic.trim().length < 2) {
      errors.push(`Post #${idx}: missing or too short "topic" — skipped`);
      continue;
    }
    if (!item.post_angle || typeof item.post_angle !== 'string' || item.post_angle.trim().length < 2) {
      errors.push(`Post #${idx}: missing or too short "post_angle" — skipped`);
      continue;
    }
    if (!item.suggested_date || typeof item.suggested_date !== 'string') {
      errors.push(`Post #${idx}: missing or invalid "suggested_date" — skipped`);
      continue;
    }

    const pillar = item.pillar.toLowerCase();

    if (!VALID_PILLARS.includes(pillar)) {
      errors.push(`Post #${idx}: invalid pillar "${pillar}" (valid: ${VALID_PILLARS.join(', ')}) — skipped`);
      continue;
    }

    // Validate date format
    const dateMatch = item.suggested_date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!dateMatch) {
      errors.push(`Post #${idx}: suggested_date "${item.suggested_date}" is not in YYYY-MM-DD format — skipped`);
      continue;
    }

    const postYear = parseInt(dateMatch[1], 10);
    const postMonth = parseInt(dateMatch[2], 10) - 1; // 0-indexed
    const postDay = parseInt(dateMatch[3], 10);

    // Validate date is within target month
    // 窗口校验(原本写死"必须在目标月内")。窗口跟着请求走,判据不变:
    // 排到窗口外的帖子是错的 —— 她说"下星期三篇",给一篇排到下下周就是没听懂。
    if (item.suggested_date < winFrom || item.suggested_date > winTo) {
      errors.push(`Post #${idx}: date "${item.suggested_date}" is not within ${windowLabel} — skipped`);
      continue;
    }

    // 上面的窗口比较已经覆盖了"日子越界",这里只兜住非法日期(如 2 月 30 日)
    if (Number.isNaN(Date.parse(`${item.suggested_date}T00:00:00Z`))) {
      errors.push(`Post #${idx}: "${item.suggested_date}" is not a real date — skipped`);
      continue;
    }

    let finalDate = item.suggested_date;

    // Validate weekday: if on weekend, auto-fix to next weekday
    if (!isWeekday(finalDate)) {
      const fixed = nextWeekday(finalDate, { from: winFrom, to: winTo });
      if (fixed) {
        warnings.push(`Post #${idx}: date "${finalDate}" falls on weekend — auto-shifted to "${fixed}"`);
        finalDate = fixed;
      } else {
        warnings.push(`Post #${idx}: date "${finalDate}" falls on weekend and no weekday remains in month — skipping`);
        continue;
      }
    }

    // Duplicate date handling: auto-shift non-festival posts instead of rejecting
    if (pillar !== 'festival') {
      let attempts = 0;
      while (dateCounts[finalDate] && attempts < 10) {
        const shifted = nextWeekday(finalDate, { from: winFrom, to: winTo });
        if (!shifted) break;
        warnings.push(`Post #${idx}: date "${finalDate}" already taken — auto-shifted to "${shifted}"`);
        finalDate = shifted;
        attempts++;
      }
      if (dateCounts[finalDate]) {
        warnings.push(`Post #${idx}: cannot find unique date after 10 attempts — skipping`);
        continue;
      }
      dateCounts[finalDate] = true;
    } else {
      if (!festivalDateCounts[finalDate]) {
        festivalDateCounts[finalDate] = 0;
      }
      festivalDateCounts[finalDate]++;
    }

    // 内容角度:计划器给的只是种子。非法值或漏给都不判错 ——
    // planContentAngles() 是确定性算法，它会补齐并把整月分布拉回硬指标内。
    // 这里判错反而会因为模型拼错一个词就废掉整月计划。
    const rawAngle = String(item.angle || '').trim().toLowerCase();
    const angle = VALID_ANGLES.includes(rawAngle) ? rawAngle : null;
    if (item.angle && !angle) {
      warnings.push(`Post #${idx}: unknown angle "${item.angle}" — will be reassigned in code`);
    }

    validatedPosts.push({
      pillar,
      angle,
      topic: item.topic.trim(),
      post_angle: item.post_angle.trim(),
      suggested_date: finalDate,
    });
  }

  // Step 3: Pillar ratio checks — SOFT warnings only
  const pillarCounts = {};
  const regularPosts = validatedPosts.filter(p => p.pillar !== 'festival');
  const festivalPosts = validatedPosts.filter(p => p.pillar === 'festival');

  for (const p of regularPosts) {
    pillarCounts[p.pillar] = (pillarCounts[p.pillar] || 0) + 1;
  }

  // 篇数:围绕她要的数量给出宽容区间(整月 12 篇时仍是 10-14,行为不变)
  const lo = Math.max(1, Math.floor(wantCount * 10 / 12));
  const hi = Math.ceil(wantCount * 14 / 12);
  if (regularPosts.length < lo) {
    warnings.push(`Regular posts: expected ~${wantCount}, got ${regularPosts.length} — consider generating more`);
  } else if (regularPosts.length > hi) {
    warnings.push(`Regular posts: expected ~${wantCount}, got ${regularPosts.length} — consider trimming`);
  }

  // Check pillar ratios — soft warning per pillar
  const scaledTargets = req
    ? require('./monthly-planning').pillarPlan(wantCount)
    : TARGET_RATIOS;
  for (const [pillar, target] of Object.entries(scaledTargets)) {
    const actual = pillarCounts[pillar] || 0;
    if (actual === 0) {
      warnings.push(`Pillar "${pillar}": 0 posts — consider adding at least one`);
    } else if (actual < target - 1 || actual > target + 1) {
      warnings.push(`Pillar "${pillar}": expected ~${target}, got ${actual} — you may want to adjust in review`);
    }
  }

  // Check festival posts (0-2) — soft warning
  if (festivalPosts.length > 2) {
    warnings.push(`Festival posts: expected 0-2, got ${festivalPosts.length} — you may want to trim`);
  }

  // valid = true as long as we have enough posts and NO hard errors
  // (warnings don't make it invalid)
  // 硬地板:整月那条路仍是 >= 8(行为不变);小批量按比例,但至少 1 篇。
  // 这条不是形式主义 —— 要 3 篇给 0 篇就是没生成成功,得让调用方知道。
  const floor = req ? Math.max(1, Math.ceil(wantCount * 8 / 12)) : 8;
  const valid = errors.length === 0 && validatedPosts.length >= floor;

  return {
    valid,
    posts: validatedPosts,
    regularPosts,
    festivalPosts,
    errors,
    warnings,
    pillarCounts,
  };
}

/**
 * 把解析器的 errors/warnings 汇总成一句可存可发的说明。
 *
 * 2026-07-30 教训:整月批量实测只出了 11 篇(要的是 13),而解析器**当时就知道**
 * 是哪几篇被判掉、为什么——但调用方只在 parsed.valid===false 时才看 errors，
 * "有效但掉了几篇"这种情况警告被直接丢掉,事后完全查不出原因。
 *
 * @param {object} parsed - parseAndValidateMonthlyPlan 的返回
 * @param {number} [requested] - 本次要求的篇数（用于对比少了几篇）
 * @returns {{shortfall: number, summary: string|null}} summary 为 null 表示无异常
 */
function summarizePlanIssues(parsed, requested) {
  if (!parsed) return { shortfall: 0, summary: null };
  const got = (parsed.posts || []).length;
  const shortfall = requested && requested > got ? requested - got : 0;
  const errs = parsed.errors || [];
  const warns = parsed.warnings || [];
  if (!shortfall && errs.length === 0 && warns.length === 0) return { shortfall: 0, summary: null };

  const lines = [];
  if (shortfall) lines.push(`只产出 ${got} 篇（要求 ${requested} 篇，少 ${shortfall} 篇）`);
  if (errs.length) lines.push(`被判掉 ${errs.length} 条：${errs.slice(0, 10).join(' / ')}`);
  if (warns.length) lines.push(`调整 ${warns.length} 条：${warns.slice(0, 10).join(' / ')}`);
  return { shortfall, summary: lines.join('\n') };
}

module.exports = {
  parseAndValidateMonthlyPlan,
  summarizePlanIssues,
  parseMonthInfo,
  isWeekday,
  mapPillarForDB,
  VALID_PILLARS,
  TARGET_RATIOS,
};