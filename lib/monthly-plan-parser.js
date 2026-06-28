// ============================================
// Monthly Plan Parser — validates AI-generated monthly calendar.
//
// Exposes:
//   parseAndValidateMonthlyPlan(rawText, targetMonthStr) → { valid, posts, errors, pillarCounts }
// ============================================

const VALID_PILLARS = ['product', 'case', 'educational', 'story', 'promo', 'festival'];

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
function nextWeekday(dateStr, monthInfo) {
  const parts = dateStr.split('-').map(Number);
  let y = parts[0], m = parts[1], d = parts[2];
  for (let attempt = 1; attempt <= 10; attempt++) {
    d++;
    if (d > monthInfo.daysInMonth) return null;
    const testStr = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
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
  const monthInfo = parseMonthInfo(targetMonthStr);
  if (!monthInfo) {
    errors.push(`Could not parse target month string: "${targetMonthStr}"`);
    return { valid: false, posts: [], regularPosts: [], festivalPosts: [], errors, warnings, pillarCounts: {} };
  }

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
    if (postYear !== monthInfo.year || postMonth !== monthInfo.monthIndex) {
      errors.push(`Post #${idx}: date "${item.suggested_date}" is not in ${targetMonthStr} — skipped`);
      continue;
    }

    if (postDay < 1 || postDay > monthInfo.daysInMonth) {
      errors.push(`Post #${idx}: day ${postDay} is out of range for ${targetMonthStr} (1-${monthInfo.daysInMonth}) — skipped`);
      continue;
    }

    let finalDate = item.suggested_date;

    // Validate weekday: if on weekend, auto-fix to next weekday
    if (!isWeekday(finalDate)) {
      const fixed = nextWeekday(finalDate, monthInfo);
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
        const shifted = nextWeekday(finalDate, monthInfo);
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

    validatedPosts.push({
      pillar,
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

  // Check total regular posts — accept 10-14, warn if outside
  if (regularPosts.length < 10) {
    warnings.push(`Regular posts: expected 10-14, got ${regularPosts.length} — consider generating more`);
  } else if (regularPosts.length > 14) {
    warnings.push(`Regular posts: expected 10-14, got ${regularPosts.length} — consider trimming`);
  }

  // Check pillar ratios — soft warning per pillar
  for (const [pillar, target] of Object.entries(TARGET_RATIOS)) {
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
  const valid = errors.length === 0 && validatedPosts.length >= 8;

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

module.exports = {
  parseAndValidateMonthlyPlan,
  parseMonthInfo,
  isWeekday,
  mapPillarForDB,
  VALID_PILLARS,
  TARGET_RATIOS,
};