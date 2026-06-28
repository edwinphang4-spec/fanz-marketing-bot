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

const REQUIRED_RATIOS = {
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
 * Parse and validate the AI-generated monthly plan.
 *
 * @param {string} rawText - AI response text
 * @param {string} targetMonthStr - e.g. "July 2026"
 * @returns {{ valid: boolean, posts: Array, errors: string[], pillarCounts: object }}
 */
function parseAndValidateMonthlyPlan(rawText, targetMonthStr) {
  const errors = [];
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
        return { valid: false, posts: [], errors, pillarCounts: {} };
      }
    } else {
      errors.push(`No valid JSON array found in response`);
      return { valid: false, posts: [], errors, pillarCounts: {} };
    }
  }

  if (!Array.isArray(parsed)) {
    errors.push(`Parsed result is not an array (got ${typeof parsed})`);
    return { valid: false, posts: [], errors, pillarCounts: {} };
  }

  // Step 2: Validate each post
  const monthInfo = parseMonthInfo(targetMonthStr);
  if (!monthInfo) {
    errors.push(`Could not parse target month string: "${targetMonthStr}"`);
    return { valid: false, posts: [], errors, pillarCounts: {} };
  }

  const validatedPosts = [];
  const dateCounts = {}; // track regular post dates for uniqueness
  const festivalDateCounts = {}; // festival posts can share dates but we still track

  for (let i = 0; i < parsed.length; i++) {
    const item = parsed[i];
    const idx = i + 1;

    if (!item || typeof item !== 'object') {
      errors.push(`Post #${idx}: not an object`);
      continue;
    }

    // Check required fields
    if (!item.pillar || typeof item.pillar !== 'string') {
      errors.push(`Post #${idx}: missing or invalid "pillar"`);
      continue;
    }
    if (!item.topic || typeof item.topic !== 'string' || item.topic.trim().length < 2) {
      errors.push(`Post #${idx}: missing or too short "topic"`);
      continue;
    }
    if (!item.post_angle || typeof item.post_angle !== 'string' || item.post_angle.trim().length < 2) {
      errors.push(`Post #${idx}: missing or too short "post_angle"`);
      continue;
    }
    if (!item.suggested_date || typeof item.suggested_date !== 'string') {
      errors.push(`Post #${idx}: missing or invalid "suggested_date"`);
      continue;
    }

    const pillar = item.pillar.toLowerCase();

    if (!VALID_PILLARS.includes(pillar)) {
      errors.push(`Post #${idx}: invalid pillar "${pillar}" (valid: ${VALID_PILLARS.join(', ')})`);
      continue;
    }

    // Validate date format
    const dateMatch = item.suggested_date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!dateMatch) {
      errors.push(`Post #${idx}: suggested_date "${item.suggested_date}" is not in YYYY-MM-DD format`);
      continue;
    }

    const postYear = parseInt(dateMatch[1], 10);
    const postMonth = parseInt(dateMatch[2], 10) - 1; // 0-indexed
    const postDay = parseInt(dateMatch[3], 10);

    // Validate date is within target month
    if (postYear !== monthInfo.year || postMonth !== monthInfo.monthIndex) {
      errors.push(`Post #${idx}: date "${item.suggested_date}" is not in ${targetMonthStr}`);
      continue;
    }

    if (postDay < 1 || postDay > monthInfo.daysInMonth) {
      errors.push(`Post #${idx}: day ${postDay} is out of range for ${targetMonthStr} (1-${monthInfo.daysInMonth})`);
      continue;
    }

    // Validate weekday
    if (!isWeekday(item.suggested_date)) {
      errors.push(`Post #${idx}: "${item.suggested_date}" falls on a weekend`);
      continue;
    }

    // Check for duplicate dates (regular posts only)
    if (pillar !== 'festival') {
      if (dateCounts[item.suggested_date]) {
        errors.push(`Post #${idx}: duplicate date "${item.suggested_date}" for non-festival post`);
        continue;
      }
      dateCounts[item.suggested_date] = true;
    } else {
      // Festival posts can share dates but we track for info
      if (!festivalDateCounts[item.suggested_date]) {
        festivalDateCounts[item.suggested_date] = 0;
      }
      festivalDateCounts[item.suggested_date]++;
    }

    validatedPosts.push({
      pillar,
      topic: item.topic.trim(),
      post_angle: item.post_angle.trim(),
      suggested_date: item.suggested_date,
    });
  }

  // Step 3: Validate pillar ratios
  const pillarCounts = {};
  const regularPosts = validatedPosts.filter(p => p.pillar !== 'festival');
  const festivalPosts = validatedPosts.filter(p => p.pillar === 'festival');

  for (const p of regularPosts) {
    pillarCounts[p.pillar] = (pillarCounts[p.pillar] || 0) + 1;
  }

  // Check total regular posts
  if (regularPosts.length !== 12) {
    errors.push(`Total regular posts: expected 12, got ${regularPosts.length}`);
  }

  // Check each pillar ratio
  for (const [pillar, expected] of Object.entries(REQUIRED_RATIOS)) {
    const actual = pillarCounts[pillar] || 0;
    if (actual !== expected) {
      errors.push(`Pillar "${pillar}": expected ${expected}, got ${actual}`);
    }
  }

  // Check festival posts (0-2)
  if (festivalPosts.length > 2) {
    errors.push(`Festival posts: expected 0-2, got ${festivalPosts.length}`);
  }

  const valid = errors.length === 0 && validatedPosts.length >= 12;

  return {
    valid,
    posts: validatedPosts,
    regularPosts,
    festivalPosts,
    errors,
    pillarCounts,
  };
}

module.exports = {
  parseAndValidateMonthlyPlan,
  parseMonthInfo,
  isWeekday,
  mapPillarForDB,
  VALID_PILLARS,
  REQUIRED_RATIOS,
};