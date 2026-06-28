// ============================================
// festival-handler.js — Festival post detection
//
// Determines if a content_calendar row is a
// festival post that should skip product scene
// generation and use a festive design instead.
// ============================================

const FESTIVAL_KEYWORDS = [
  'chinese new year', 'cny', 'hari raya', 'raya', 'deepavali',
  'christmas', 'merdeka', 'festival', 'celebration', 'holiday',
  'mid-year', 'festive', 'school holidays', 'rainy', 'hot',
  'open house', 'housewarming', 'spring',
];

/**
 * Check if a content_calendar row should use festive handling.
 *
 * Rules:
 * 1. pillar must be 'story'
 * 2. post_angle or topic must contain a festival-related keyword
 *
 * @param {object} row - content_calendar row
 * @returns {boolean} true if this is a festival post
 */
function isFestivalPost(row) {
  if (!row) return false;
  const pillar = (row.pillar || '').toLowerCase();
  if (pillar !== 'story') return false;

  const postAngle = (row.post_angle || '').toLowerCase();
  const topic = (row.topic || '').toLowerCase();
  const combinedText = `${postAngle} ${topic}`;

  for (const kw of FESTIVAL_KEYWORDS) {
    if (combinedText.includes(kw)) return true;
  }

  return false;
}

/**
 * Get the festive scene description to inject into the prompt.
 *
 * @param {object} row - content_calendar row
 * @returns {string|null} festive scene description, or null if not a festival post
 */
function getFestiveSceneDescription(row) {
  if (!isFestivalPost(row)) return null;

  const postAngle = (row.post_angle || '').toLowerCase();
  const topic = (row.topic || '').toLowerCase();
  const combinedText = `${postAngle} ${topic}`;

  if (combinedText.includes('chinese new year') || combinedText.includes('cny')) {
    return 'Chinese New Year festive scene with red lanterns and gold decorations, warm interior lighting, celebration atmosphere';
  }
  if (combinedText.includes('hari raya') || combinedText.includes('raya')) {
    return 'Hari Raya Aidilfitri festive scene with pelita lights, ketupat decorations, warm family gathering setting';
  }
  if (combinedText.includes('deepavali')) {
    return 'Deepavali festive scene with kolam decorations, diya lamps, warm golden lighting, celebration mood';
  }
  if (combinedText.includes('christmas')) {
    return 'Christmas festive scene with decorated tree, warm fairy lights, festive ornaments, cozy holiday atmosphere';
  }
  if (combinedText.includes('merdeka')) {
    return 'Merdeka celebration scene with Jalur Gemilang decorations, modern Malaysian home, patriotic atmosphere';
  }

  // Generic festival
  return 'Festive celebration scene with warm lighting, decorative elements, joyful atmosphere, Malaysian home interior';
}

module.exports = {
  isFestivalPost,
  getFestiveSceneDescription,
  FESTIVAL_KEYWORDS,
};
