// ============================================
// festival-handler.js — Festival post detection
//
// Determines if a content_calendar row is a
// festival post that should skip product scene
// generation and use a festive design instead.
// ============================================

// 2026-07-30 整月批量实测漏判:"Celebrating Malaysia Day Together" 没被认成
// 节庆帖，出来一张毫无节庆元素的通用图。两个原因,都修了:
//   ① 词形太死 —— 表里是 'celebration'，而文案写的是 'celebrating'，子串匹配不上。
//      现在一律存词干（'celebrat' 同时覆盖 celebrate/celebrating/celebration）。
//   ② 缺马来西亚的真实公假 —— 马来西亚日(9/16)、卫塞节、大宝森节、开斋/哈芝节的
//      各种叫法、元旦、劳动节等都不在表里。补齐。
const FESTIVAL_KEYWORDS = [
  // 华人节庆
  'chinese new year', 'cny', 'lunar new year', 'mid-autumn', 'mooncake', 'qingming',
  // 马来/伊斯兰节庆
  'hari raya', 'raya', 'aidilfitri', 'aidiladha', 'eid', 'ramadan', 'ramadhan',
  'awal muharram', 'muharram', 'maulidur rasul', 'nuzul al-quran', 'nuzul quran',
  // 印度节庆
  'deepavali', 'diwali', 'thaipusam', 'ponggal', 'pongal',
  // 佛教
  'wesak', 'vesak',
  // 基督教
  'christmas', 'xmas', 'good friday', 'easter',
  // 国家假日
  'merdeka', 'independence day', 'national day', 'hari kebangsaan',
  'malaysia day', 'hari malaysia', 'labour day', 'labor day', 'workers day',
  'new year', 'agong', "king's birthday", 'federal territory day',
  // 通用节庆词（存词干，避免词形不匹配）
  'festival', 'festive', 'celebrat', 'holiday', 'greeting', '公假',
  'mid-year', 'school holidays', 'rainy', 'hot',
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
