// ============================================
// festival-handler.js — Festival post detection
//
// Determines if a content_calendar row is a
// festival post that should skip product scene
// generation and use a festive design instead.
// ============================================

// 只有**具体节日名**才算节庆帖 —— 两轮实测教训:
//   ① 第一轮漏判:"Celebrating Malaysia Day" 没命中,因为表里写的是
//      'celebration' 而文案是 'celebrating',子串对不上;且没有 'malaysia day'。
//      → 节日名一律存词干,并补齐马来西亚真实公假。
//   ② 第二轮过度触发:我把 'celebrat' 当泛化词加进来后,"10 Years of Trust and
//      Innovation"(post_angle 写 "Celebrate Fanz's journey…")被判成节庆帖,
//      出了一张毫无节庆元素、也不该走节庆模板的品牌故事图。
//      → 泛化词('celebrat'/'festive'/'holiday'/'greeting')**不再单独触发**。
//        判错方向要选安全的那边:漏判只是少个节庆版式,误判会让品牌故事变节庆图。
const FESTIVAL_KEYWORDS = [
  // 华人节庆
  'chinese new year', 'cny', 'lunar new year', 'mid-autumn', 'mooncake', 'qingming',
  // 马来/伊斯兰节庆
  'hari raya', 'aidilfitri', 'aidiladha', 'ramadan', 'ramadhan',
  'awal muharram', 'muharram', 'maulidur rasul', 'nuzul al-quran', 'nuzul quran',
  // 印度节庆
  'deepavali', 'diwali', 'thaipusam', 'ponggal', 'pongal',
  // 佛教 / 基督教
  'wesak', 'vesak', 'christmas', 'good friday', 'easter',
  // 国家假日(马来西亚)
  'merdeka', 'independence day', 'national day', 'hari kebangsaan',
  'malaysia day', 'hari malaysia', 'labour day', 'labor day',
  'federal territory day', "agong's birthday",
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
