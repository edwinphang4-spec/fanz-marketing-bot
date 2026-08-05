// ============================================
// product-facts.js — 有来源的产品事实（按系列，逐条标注出处）
//
// 2026-08-01:去 Fanz 官方 Facebook / Instagram 实地看内容时发现，我们之前
// 判定"系统里没有"的数据，Fanz 自己早就公开发布过。把这些搬进来，文案就能
// 讲真数据而不是编。
//
// 铁律（Edwin 定的）:
//   · 每条事实必须标 **适用范围** 和 **来源**；
//   · Grande 的规格只属于 Grande，不许外溢到别的系列；
//   · 没有来源的一律不进这个文件 —— 宁可少讲，也不要制造新的编造。
// ============================================

// 来源标记
const SRC_IG_SPEC = 'Fanz 官方 IG 规格图（Grande Series 规格帖，2026-08-01 实地查看）';
const SRC_IG_GUIDE = 'Fanz 官方 IG 教育帖「HOW TO CHOOSE THE RIGHT FAN SIZE」（2026-08-01 实地查看）';

/**
 * 按系列的已确认规格。
 * 只有列在这里的系列才有这些规格 —— 其余系列一律视为"待确认"，不许套用。
 */
const SERIES_SPECS = {
  GRANDE: {
    sizes_inch: [45, 52],
    blade_count: 3,
    blade_material: 'ABS',
    speed_settings: 6,
    forward_reverse: true,
    sleep_mode: true,
    led: 'optional — L series has the light',
    wifi: true,                       // "WiFi / Smart Control"
    colours: ['Matt Black', 'Matt White', 'Greywood', 'Pinewood', 'Oakwood'],
    source: SRC_IG_SPEC,
  },
  // FS / GAZE / FERRO:Fanz 尚未公开对应规格图 → 一律待确认，不要照抄 Grande 的。
  FS: { unconfirmed: true, note: '尚无官方规格图；只能讲素材库已确认的尺寸/颜色/有无灯/叶数' },
  GAZE: { unconfirmed: true, note: '同上' },
  FERRO: { unconfirmed: true, note: '同上' },
};

/**
 * 选尺寸对照表 —— Fanz 官方口径。
 * 注意:他们用「房间类型 → 英寸区间」，**不用平方尺**。
 * 我们此前编出来的 "rooms up to 225 sq ft" 不只是数字没依据，
 * 连表达方式都不是 Fanz 的语言。
 */
// ⚠️ 2026-08-05 存证失败 → 全表停用（Edwin 拍板:"看起来有出处但验不了"风险最大）
//
// 我 8/1 说这是从 Fanz 官方 IG 教育帖抄的，Edwin 要我把帖子找出来让他能点开验。
// 花 15 分钟查证的结果:
//   查到了 —— Fanz 官方 IG(@fanz_ceiling_fan,签名 "The Air Mover")确实公开可读，
//            账号里确实有一条讲怎么选风扇尺寸的教育帖。这一点两次独立抓取一致。
//   没查到 —— 拿不到那条帖子的可点开链接(抓到的 permalink 打开是登录墙，
//            也就无法确认它不是被凑出来的)，也拿不到逐字的表格原文。
//   而且对不上 —— 抓回来的房间标签是 "Small Room / Medium / Large Space"，
//            **不是**我写在这里的 "Bedroom"。也就是说这张表至少标签是错的:
//            Fanz 的表里可能根本没有「卧室」这一行。
//
// 所以整表标记 unverified 并停用:roomSizeGuideBlock() 返回空(不再进提示词)，
// qa-claims 的区间比对读到空表 → 任何房间-尺寸建议一律拦。
// 代价只是少一类知识型内容;收益是不再拿一张验不了的表去教真实客户买扇子。
//
// 解除条件:Edwin 直接问 Fanz 要官方的尺寸建议表(那是他们自己发的帖，他们最清楚)。
// 拿到后把逐字内容 + 可点开的出处填回来，并把 verified 改成 true。
const ROOM_SIZE_GUIDE = {
  verified: false,
  unverifiedNote:
    '来源是 Fanz 官方 IG 的选尺寸教育帖(账号 @fanz_ceiling_fan 确实存在且有这类帖子)，' +
    '但拿不到可点开的帖子链接，且抓回来的房间标签是 Small Room / Medium / Large Space，' +
    '与下面记的 Bedroom 对不上。等 Fanz 给官方口径再启用。',
  // 下面这三行是 2026-08-01 的记录，**当前不生效**，留着是为了跟 Fanz 的答复做对照。
  rows: [
    { room: 'Small room', inches: '36 - 42 inch' },
    { room: 'Bedroom', inches: '45 - 56 inch' },
    { room: 'Living room', inches: '52 - 72 inch (depends on the space)' },
  ],
  principle: 'Small rooms need smaller fans, while larger spaces need bigger fans for more even air circulation.',
  source: SRC_IG_GUIDE,
};

/**
 * "Smart" 的正确说法（Edwin 确认后的口径）。
 * 它是**功能线不是产品线** —— Fanz 自己会在具体型号上标 "Smart Series / WiFi Mode"，
 * 也会在 Grande 规格里写 "WiFi / Smart Control"。所以可以讲，但必须挂在具体型号上，
 * 不能当成一个独立系列去写帖子。
 */
const SMART_POSITIONING = {
  isSeparateSeries: false,
  usage: 'Describe WiFi / smart control as a FEATURE of a specific model (e.g. "the Grande with WiFi control"). Never write about a standalone "Smart Series" product line.',
  confirmedOn: ['GRANDE'],   // 只有 Grande 的规格图明确写了 WiFi
};

/** 取某系列的已确认规格；返回 null 表示该系列没有可用规格 */
function specsForSeries(series) {
  const s = SERIES_SPECS[String(series || '').toUpperCase()];
  if (!s || s.unconfirmed) return null;
  return s;
}

/**
 * 生成给文案 agent 的「这个系列可以讲的规格」文字块。
 * 没有已确认规格的系列返回空字符串 —— 不给就是不许讲。
 */
function seriesFactsBlock(series) {
  const s = specsForSeries(series);
  if (!s) return '';
  const lines = [];
  if (s.sizes_inch) lines.push(`Available sizes: ${s.sizes_inch.map((n) => `${n}"`).join(' / ')}`);
  if (s.blade_count) lines.push(`${s.blade_count} ${s.blade_material || ''} blades`.replace(/\s+/g, ' '));
  if (s.speed_settings) lines.push(`${s.speed_settings} speed settings`);
  if (s.forward_reverse) lines.push('Forward & reverse function');
  if (s.sleep_mode) lines.push('Sleep mode');
  if (s.led) lines.push(`LED light ${s.led}`);
  if (s.wifi) lines.push('WiFi / smart control');
  if (s.colours) lines.push(`Colours: ${s.colours.join(' / ')}`);
  return `\n\nCONFIRMED SPECS for the ${series} series (published by Fanz — safe to state).\n` +
    `These apply to ${series} ONLY. Never attach them to another series:\n` +
    lines.map((l) => `- ${l}`).join('\n');
}

/**
 * 选尺寸对照表文字块（教育类帖子用）。
 * 表没核实过就返回空字符串 —— 不给就是不许讲，宁可少讲一类内容。
 */
function roomSizeGuideBlock() {
  if (!ROOM_SIZE_GUIDE.verified) return '';
  return `\n\nFANZ OFFICIAL FAN-SIZE GUIDE (published by Fanz — safe to state, use these words):\n` +
    ROOM_SIZE_GUIDE.rows.map((r) => `- ${r.room}: ${r.inches}`).join('\n') +
    `\n- Principle: ${ROOM_SIZE_GUIDE.principle}` +
    `\n- Express fan sizing by ROOM TYPE and INCHES, exactly like above. Never express it in square feet.`;
}

module.exports = {
  SERIES_SPECS,
  ROOM_SIZE_GUIDE,
  SMART_POSITIONING,
  specsForSeries,
  seriesFactsBlock,
  roomSizeGuideBlock,
};
