// ============================================
// festival-calendar.js — 马来西亚节日表（单一事实来源）
//
// 为什么存在:对话层曾把还有 22 天的 Merdeka 说成 "already passed" ——
// 因为日期靠模型心算 + 提示词例句被当模板背。从此节日日期只能来自这张表,
// 模型只转述代码算好的结论。
//
// 三个正交的维度,别混:
//   confidence — 决定【话术】能不能说具体日期
//     confirmed  固定日期,永不变(元旦/劳动节/Merdeka/马来西亚日/圣诞)
//     verified   每年变,但多来源一致 → 可以说 "X月X日""还有 N 天"
//     tentative  来源打架或单一来源 → 排期照排,但话术只许说 "大概在X月中下旬",
//                ⛔ 禁止具体日期、禁止 "还有 N 天" —— phraseFor() 从构造上保证
//   tier — 决定【月度规划】要不要自动安排
//     1 当月有就必须排一篇   2 可以排   3 不自动排,但她主动提要认得出来(lookup)
//   scheduling — 排期用 schedulingDateFor(),tentative 也给日期(取区间首日);
//                只有来源冲突大到没法猜的(如 2026 哈芝节差一个月)返回 null,排期卡必须问她
//
// 升级口子:老板娘确认某个 tentative 日期后,把该年条目的 confidence 改成
// 'verified',source 写 "Fanz 老板娘 YYYY-MM-DD 确认" —— 只改数据,不改代码。
//
// 来源缩写:
//   OH  = officeholidays.com/countries/malaysia/{year}
//   WIKI= en.wikipedia.org/wiki/Mid-Autumn_Festival (Dates 节)
//   CH  = chinahighlights.com/festivals/mid-autumn-festival-date.htm
//   MC  = malaysiacalendar.com/public-holiday-2027
//   CS  = cutisekolah.com.my/en/public-holidays-2026
// ============================================

const TABLE = [
  // ── confirmed:固定日期,任何年份都成立 ──
  { id: 'new_year', tier: 2, fixed: { month: 1, day: 1 },
    names: { en: "New Year's Day", zh: '元旦', ms: 'Tahun Baru' },
    aliases: ['元旦', "new year's day", 'new year day', 'tahun baru'],
    source: '固定日期 1/1' },
  { id: 'labour_day', tier: 3, fixed: { month: 5, day: 1 },
    names: { en: 'Labour Day', zh: '劳动节', ms: 'Hari Pekerja' },
    aliases: ['劳动节', 'labour day', 'labor day', 'hari pekerja'],
    source: '固定日期 5/1' },
  { id: 'merdeka', tier: 1, fixed: { month: 8, day: 31 },
    names: { en: 'National Day / Merdeka', zh: '国庆日', ms: 'Hari Merdeka' },
    aliases: ['国庆', '国庆日', 'merdeka', 'national day', 'hari merdeka', 'hari kebangsaan'],
    source: '固定日期 8/31' },
  { id: 'malaysia_day', tier: 1, fixed: { month: 9, day: 16 },
    names: { en: 'Malaysia Day', zh: '马来西亚日', ms: 'Hari Malaysia' },
    aliases: ['马来西亚日', 'malaysia day', 'hari malaysia'],
    source: '固定日期 9/16' },
  { id: 'christmas', tier: 2, fixed: { month: 12, day: 25 },
    names: { en: 'Christmas', zh: '圣诞节', ms: 'Hari Krismas' },
    aliases: ['圣诞', '圣诞节', 'christmas', 'xmas', 'krismas'],
    source: '固定日期 12/25' },

  // ── 每年变的 ──
  { id: 'mid_autumn', tier: 2,
    names: { en: 'Mid-Autumn Festival', zh: '中秋节', ms: 'Pesta Kuih Bulan' },
    aliases: ['中秋', '中秋节', 'mid-autumn', 'mid autumn', 'mooncake festival', 'pesta tanglung', 'kuih bulan'],
    byYear: {
      2026: { from: '2026-09-25', confidence: 'verified', source: 'WIKI + CH 一致' },
      2027: { from: '2027-09-15', confidence: 'verified', source: 'WIKI + Edwin 核对' },
    } },
  { id: 'cny', tier: 1,
    names: { en: 'Chinese New Year', zh: '农历新年', ms: 'Tahun Baru Cina' },
    aliases: ['农历新年', '春节', '过年', 'cny', 'chinese new year', 'tahun baru cina', 'lunar new year'],
    byYear: {
      2026: { from: '2026-02-17', to: '2026-02-18', confidence: 'verified', source: 'Edwin 双源 + OH 一致' },
      2027: { from: '2027-02-06', to: '2027-02-07', confidence: 'verified', source: 'OH + MC 一致' },
    } },
  { id: 'agong_birthday', tier: 3,
    names: { en: "Agong's Birthday", zh: '国王诞辰', ms: 'Hari Keputeraan YDP Agong' },
    aliases: ['国王诞辰', 'agong', "agong's birthday", 'keputeraan agong', 'ydp agong'],
    byYear: {
      2026: { from: '2026-06-01', confidence: 'verified', source: '官方定例(6月首个星期一) + OH' },
      2027: { from: '2027-06-07', confidence: 'verified', source: '官方定例(6月首个星期一) + OH' },
    } },

  // ── tentative:排期照排,话术只许说"大概" ──
  { id: 'raya_aidilfitri', tier: 1,
    names: { en: 'Hari Raya Aidilfitri', zh: '开斋节', ms: 'Hari Raya Aidilfitri' },
    aliases: ['开斋节', 'hari raya', 'raya', 'aidilfitri', 'raya puasa', 'eid', 'eid al-fitr', 'hari raya puasa'],
    byYear: {
      2026: { from: '2026-03-20', to: '2026-03-22', confidence: 'tentative',
        source: '来源打架: OH 说 3/21,CS 说 3/20-22(看月亮定)',
        approx: { zh: '大概在3月中下旬', en: 'around mid-to-late March' } },
      2027: { from: '2027-03-09', to: '2027-03-10', confidence: 'tentative',
        source: 'OH 单源(看月亮定)',
        approx: { zh: '大概在3月上旬', en: 'around early March' } },
    } },
  { id: 'raya_haji', tier: 3,
    names: { en: 'Hari Raya Haji', zh: '哈芝节', ms: 'Hari Raya Aidiladha' },
    aliases: ['哈芝节', 'raya haji', 'aidiladha', 'hari raya haji', 'eid al-adha', '古尔邦'],
    byYear: {
      // ⚠️ 2026 来源冲突整整一个月:OH 说 5/27,CS/Trip 说 6/26-27。
      // 差距大到没法替她猜 → 不给排期日期,排期卡必须问她。待老板娘确认。
      2026: { from: null, to: null, confidence: 'tentative', conflict: true,
        source: '冲突: OH 说 5/27,CS+Trip 说 6/26-27 —— 待老板娘确认',
        approx: { zh: '大概在5月底或6月底(来源冲突,日期待确认)', en: 'around late May or late June (sources conflict)' } },
      2027: { from: '2027-05-16', confidence: 'tentative',
        source: 'OH 单源(看月亮定)',
        approx: { zh: '大概在5月中旬', en: 'around mid-May' } },
    } },
  { id: 'deepavali', tier: 1,
    names: { en: 'Deepavali', zh: '屠妖节', ms: 'Hari Deepavali' },
    aliases: ['屠妖节', 'deepavali', 'diwali', 'hari deepavali'],
    byYear: {
      2026: { from: '2026-11-08', to: '2026-11-09', confidence: 'tentative',
        source: 'OH 说 11/8,Edwin 记 约11/8-9',
        approx: { zh: '大概在11月上旬', en: 'around early November' } },
      2027: { from: '2027-10-28', to: '2027-10-29', confidence: 'tentative',
        source: '来源打架: OH 说 10/29,MC 说 10/28',
        approx: { zh: '大概在10月底', en: 'around late October' } },
    } },
  { id: 'wesak', tier: 3,
    names: { en: 'Wesak Day', zh: '卫塞节', ms: 'Hari Wesak' },
    aliases: ['卫塞节', 'wesak', 'vesak', 'hari wesak'],
    byYear: {
      2026: { from: '2026-05-31', confidence: 'tentative', source: 'OH + Edwin 记 约5/31',
        approx: { zh: '大概在5月底', en: 'around late May' } },
      2027: { from: '2027-05-20', confidence: 'tentative', source: 'OH + MC 一致',
        approx: { zh: '大概在5月下旬', en: 'around late May' } },
    } },
  { id: 'thaipusam', tier: 3,
    names: { en: 'Thaipusam', zh: '大宝森节', ms: 'Hari Thaipusam' },
    aliases: ['大宝森节', 'thaipusam'],
    byYear: {
      2026: { from: '2026-02-01', to: '2026-02-02', confidence: 'tentative', source: 'OH 说 2/1,Edwin 记 约2/1-2',
        approx: { zh: '大概在2月初', en: 'around early February' } },
      2027: { from: '2027-01-22', confidence: 'tentative', source: 'OH + MC 一致',
        approx: { zh: '大概在1月下旬', en: 'around late January' } },
    } },
  { id: 'awal_muharram', tier: 3,
    names: { en: 'Awal Muharram', zh: '回历新年', ms: 'Awal Muharram' },
    aliases: ['回历新年', 'awal muharram', 'maal hijrah', 'muharram'],
    byYear: {
      2026: { from: '2026-06-17', confidence: 'tentative', source: 'OH 单源(看月亮定)',
        approx: { zh: '大概在6月中', en: 'around mid-June' } },
      2027: { from: '2027-06-06', confidence: 'tentative', source: 'OH 单源(看月亮定)',
        approx: { zh: '大概在6月上旬', en: 'around early June' } },
    } },
  { id: 'maulidur_rasul', tier: 3,
    names: { en: 'Maulidur Rasul', zh: '先知诞辰', ms: 'Maulidur Rasul' },
    aliases: ['先知诞辰', 'maulidur rasul', 'maulud', 'mawlid', 'prophet muhammad birthday'],
    byYear: {
      2026: { from: '2026-08-25', confidence: 'tentative', source: 'OH 单源(看月亮定)',
        approx: { zh: '大概在8月下旬', en: 'around late August' } },
      2027: { from: '2027-08-15', confidence: 'tentative', source: 'OH 单源(看月亮定)',
        approx: { zh: '大概在8月中', en: 'around mid-August' } },
    } },
  // 各州苏丹诞辰:没进表。13 个州各一个日期、还会临时改,而帖子是全国投放 ——
  // 不知道哪些州对 Fanz 重要之前,塞 26 条 tentative 只会淹掉有用的。要哪个州问 Edwin。
];

// 流动节日覆盖到哪一年(confirmed 的固定节日不算,它们永远成立)
const MAX_MOVABLE_YEAR = Math.max(...TABLE.filter((f) => f.byYear)
  .flatMap((f) => Object.keys(f.byYear).map(Number)));

const pad = (n) => String(n).padStart(2, '0');

/** 某节日在某年的 occurrence。fixed 类任何年份都能算;byYear 类查表,没有返回 null。 */
function occurrenceFor(entry, year) {
  if (entry.fixed) {
    const d = `${year}-${pad(entry.fixed.month)}-${pad(entry.fixed.day)}`;
    return { from: d, to: d, confidence: 'confirmed', source: entry.source, conflict: false };
  }
  const o = entry.byYear && entry.byYear[year];
  if (!o) return null;
  return { from: o.from, to: o.to || o.from, confidence: o.confidence, source: o.source,
    conflict: !!o.conflict, approx: o.approx || null };
}

/** 按别名认节日(她说"帮我做一篇卫塞节的" → wesak)。大小写不敏感,中英马来通吃。 */
function lookup(text) {
  const t = String(text || '').toLowerCase();
  if (!t.trim()) return null;
  // 长别名优先匹配,避免 "hari raya haji" 被 "hari raya" 抢走
  const hits = [];
  for (const entry of TABLE) {
    for (const a of entry.aliases) {
      if (t.includes(a.toLowerCase())) hits.push({ entry, len: a.length });
    }
  }
  if (!hits.length) return null;
  hits.sort((x, y) => y.len - x.len);
  return hits[0].entry;
}

const daysBetween = (fromIso, toIso) =>
  Math.round((Date.parse(toIso + 'T00:00:00Z') - Date.parse(fromIso + 'T00:00:00Z')) / 86_400_000);

/**
 * 单个节日的安全话术。⛔ tentative 从构造上不可能带具体日期:
 * 这个分支只使用 approx 文案,from/to 根本不进字符串。
 */
function phraseFor(entry, year, todayIso) {
  const occ = occurrenceFor(entry, year);
  if (!occ) return `${entry.names.zh}(${entry.names.en}):${year} 年的日期不在表里`;
  if (occ.confidence === 'tentative') {
    const approx = (occ.approx && occ.approx.zh) || '日期未确认';
    return `${entry.names.zh}(${entry.names.en}):${approx}。日期未最终确认,不要向用户报具体日期或倒数天数。`;
  }
  const diff = daysBetween(todayIso, occ.from);
  const when = diff > 0 ? `还有 ${diff} 天` : diff === 0 ? '就是今天' : `已经过了 ${-diff} 天`;
  const range = occ.to && occ.to !== occ.from ? `${occ.from} ~ ${occ.to}` : occ.from;
  return `${entry.names.zh}(${entry.names.en}):${range},${when}。`;
}

/**
 * 给对话层注入的事实块(会话一的 fact injection 消费这个)。
 * 只列窗口内的节日:未来 lookaheadDays 天内将至,或过去 lookbackDays 天内刚过。
 */
function factsForConversation(todayIso, { lookaheadDays = 60, lookbackDays = 14 } = {}) {
  const year = Number(todayIso.slice(0, 4));
  const lines = [];
  for (const entry of TABLE) {
    for (const y of [year, year + 1]) {
      const occ = occurrenceFor(entry, y);
      if (!occ || !occ.from) continue; // 冲突未定的(哈芝节 2026)没有日期,不进倒数窗口
      const diff = daysBetween(todayIso, occ.from);
      if (diff > lookaheadDays || diff < -lookbackDays) continue;
      lines.push('- ' + phraseFor(entry, y, todayIso));
      break;
    }
    // 冲突未定但节日名可能被提起 → 单独一行,让模型知道它存在但日期未定
    for (const y of [year, year + 1]) {
      const o = entry.byYear && entry.byYear[y];
      if (o && o.conflict) lines.push(`- ${entry.names.zh}(${entry.names.en}):${o.approx.zh}。`);
    }
  }
  if (!lines.length) return '';
  return `FESTIVAL FACTS — computed by code from a verified table. TRUST THESE, do not compute dates yourself:\n${lines.join('\n')}`;
}

/** 排期用:tentative 也给日期(取区间首日)。只有冲突未定的返回 null → 排期卡必须问她。 */
function schedulingDateFor(entry, year) {
  const occ = occurrenceFor(entry, year);
  return occ && occ.from ? occ.from : null;
}

/** 月度规划:该月该自动安排哪些节日。must = tier 1,may = tier 2。tier 3 永不自动。 */
function autoPlanFestivals(year, monthIndex1) {
  const must = [], may = [];
  for (const entry of TABLE) {
    if (entry.tier >= 3) continue;
    const occ = occurrenceFor(entry, year);
    if (!occ || !occ.from) continue;
    if (Number(occ.from.slice(5, 7)) !== monthIndex1) continue;
    (entry.tier === 1 ? must : may).push({ entry, occ });
  }
  return { must, may };
}

/** 表快用完提醒:进入最后覆盖年的下半年就开始提示(每次调用都返回,节流由调用方管)。 */
function coverageWarning(todayIso) {
  const y = Number(todayIso.slice(0, 4));
  const m = Number(todayIso.slice(5, 7));
  if (y > MAX_MOVABLE_YEAR || (y === MAX_MOVABLE_YEAR && m >= 7)) {
    return `⚠️ 节日表的流动节日只覆盖到 ${MAX_MOVABLE_YEAR} 年。请让 Claude Code 补下一年的日期(双来源交叉核对),否则明年的规划会缺节庆。`;
  }
  return null;
}

module.exports = {
  TABLE, lookup, occurrenceFor, phraseFor, factsForConversation,
  schedulingDateFor, autoPlanFestivals, coverageWarning, MAX_MOVABLE_YEAR,
};
