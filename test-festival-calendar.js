// test-festival-calendar.js — 节日表:数据 + 话术强制 的确定性测试(不打网络不花钱)
//
// 跑法: node test-festival-calendar.js
// 反向验证: 见文件末尾 —— 把 phraseFor 的 tentative 分支破坏掉,话术测试必须变红。
const fc = require(process.env.FC_LIB || './lib/festival-calendar');

let pass = 0; const failures = [];
const t = (c, m) => { c ? pass++ : failures.push(m); };

// ⛔ tentative 话术里绝不允许出现的东西:ISO 日期 / "X月X日" / 倒数天数
const EXACT_DATE_RE = /\d{4}-\d{2}-\d{2}|月\s*\d{1,2}\s*[日号]|还有\s*\d+\s*天|已经过了\s*\d+\s*天/;

// ── 数据层 ──
t(fc.occurrenceFor(fc.lookup('merdeka'), 2031).from === '2031-08-31', 'confirmed 固定日期任何年份都能算(Merdeka 2031)');
t(fc.occurrenceFor(fc.lookup('中秋'), 2026).from === '2026-09-25', '中秋 2026 = 9/25');
t(fc.occurrenceFor(fc.lookup('中秋'), 2027).from === '2027-09-15', '中秋 2027 = 9/15');
t(fc.occurrenceFor(fc.lookup('农历新年'), 2026).from === '2026-02-17', 'CNY 2026 = 2/17');
t(fc.occurrenceFor(fc.lookup('中秋'), 2030) === null, '表外年份返回 null,不瞎编');

// ── lookup:tier 3 也要认得出来(她提了要接得住) ──
t(fc.lookup('帮我做一篇卫塞节的内容')?.id === 'wesak', '中文认出卫塞节');
t(fc.lookup('wesak day post please')?.id === 'wesak', '英文认出 Wesak');
t(fc.lookup('hari raya haji promo')?.id === 'raya_haji', '长别名优先:raya haji 不被 hari raya 抢走');
t(fc.lookup('hari raya 快到了吧')?.id === 'raya_aidilfitri', 'hari raya 单独说 = 开斋节');
t(fc.lookup('thaipusam')?.id === 'thaipusam', '认出大宝森节');
t(fc.lookup('随便聊聊天气') === null, '无关文本不乱认');

// ── 话术强制:confidence 决定能不能说具体日期 ──
{
  const s = fc.phraseFor(fc.lookup('merdeka'), 2026, '2026-08-09');
  t(/2026-08-31/.test(s) && /还有 22 天/.test(s), `confirmed 给具体日期+倒数(${s})`);
}
{
  const s = fc.phraseFor(fc.lookup('中秋'), 2026, '2026-08-09');
  t(/2026-09-25/.test(s), 'verified 给具体日期');
}
for (const [name, year] of [['开斋节', 2026], ['deepavali', 2026], ['wesak', 2026], ['哈芝节', 2026], ['awal muharram', 2026], ['maulidur rasul', 2027]]) {
  const s = fc.phraseFor(fc.lookup(name), year, '2026-08-09');
  t(!EXACT_DATE_RE.test(s), `tentative 话术无具体日期/倒数:${name} ${year} → "${s.slice(0, 60)}"`);
  t(/大概|待确认/.test(s), `tentative 话术带"大概":${name}`);
}

// ── 事实块:窗口过滤 + 同样的话术强制 ──
{
  const block = fc.factsForConversation('2026-08-09');
  t(/Merdeka.*还有 22 天/.test(block.replace(/\n/g, ' ')), '事实块含 Merdeka 倒数(8/9 视角)');
  t(/中秋.*2026-09-25/.test(block.replace(/\n/g, ' ')), '事实块含中秋具体日期(47 天内)');
  t(!/屠妖节|Deepavali/.test(block) || !EXACT_DATE_RE.test(block.split('\n').find((l) => /Deepavali/.test(l)) || ''), '窗外/tentative 不泄露日期');
  // tentative 行逐行检查
  for (const line of block.split('\n').filter((l) => /大概/.test(l))) {
    t(!EXACT_DATE_RE.test(line), `事实块 tentative 行无日期:"${line.slice(0, 50)}"`);
  }
}

// ── 排期 vs 话术分离:tentative 排期照排,只有冲突未定给 null ──
t(fc.schedulingDateFor(fc.lookup('开斋节'), 2026) === '2026-03-20', 'tentative 排期给区间首日');
t(fc.schedulingDateFor(fc.lookup('哈芝节'), 2026) === null, '哈芝节 2026 来源冲突一个月 → 排期 null,必须问她');
t(fc.schedulingDateFor(fc.lookup('哈芝节'), 2027) === '2027-05-16', '哈芝节 2027 有日期');

// ── tier 决定月度自动安排 ──
{
  const aug = fc.autoPlanFestivals(2026, 8);
  t(aug.must.some((x) => x.entry.id === 'merdeka'), '8月:Merdeka(tier1)必须排');
  const sep = fc.autoPlanFestivals(2026, 9);
  t(sep.must.some((x) => x.entry.id === 'malaysia_day'), '9月:马来西亚日(tier1)必须排');
  t(sep.may.some((x) => x.entry.id === 'mid_autumn'), '9月:中秋(tier2)可以排');
  const jun = fc.autoPlanFestivals(2026, 6);
  t(!jun.must.length && !jun.may.length, '6月:国王诞辰/Awal Muharram 都是 tier3 → 不自动排');
}

// ── 过期提醒 ──
t(fc.coverageWarning('2026-08-09') === null, '2026 年中不提醒');
t(/2027/.test(fc.coverageWarning('2027-07-01') || ''), '进入 2027 下半年开始提醒');
t(/2027/.test(fc.coverageWarning('2028-01-05') || ''), '超过覆盖年一定提醒');

console.log(failures.length ? `❌ ${pass} passed, ${failures.length} failed` : `✅ ${pass} passed`);
if (failures.length) { failures.forEach((f) => console.error('  FAIL:', f)); process.exit(1); }

// 反向验证(确认话术测试能红):
//   sed "s/if (occ.confidence === 'tentative')/if (false)/" lib/festival-calendar.js > $SCRATCH/fc-mutated.js
//   FC_LIB=$SCRATCH/fc-mutated.js node test-festival-calendar.js   → tentative 话术测试应全红
