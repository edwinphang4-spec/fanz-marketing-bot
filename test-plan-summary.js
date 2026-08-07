// ============================================
// 月度计划「整体确认」卡片 —— 离线,不花钱。
//
// 2026-08-07:旧卡片是 12 篇 × 3 个按钮 = 36 个,而按钮上的标题被截到 27 字。
// 更荒谬的是同一份信息出现两次:正文里标题完整,下面又用残缺标题重复列一遍
// 当按钮 —— 她要操作的是残缺那份。结果她只能点"全部批准",
// 而一个让人只能点"全部批准"的审核界面等于没有审核。
//
// 这份测试盯住三件事:
//   ① 标题绝不截断(旧版的病根)
//   ② 摘要和清单必须对得上(配比说 3 篇场景,清单里就该数得出 3 篇)
//   ③ 正文里不许有 Markdown 标记 —— 卡片不传 parse_mode,
//      标题里一个 _ 或 * 就会让整条消息 400,她什么都收不到
// ============================================

const { buildPlanCard, rhythmLine, festivalLine, PILLAR_SHORT } = require('./lib/plan-summary');

let pass = 0, fail = 0;
function assert(cond, name, detail) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? `\n      ${detail}` : ''}`); }
}

const LONG = 'Choosing the Right Ceiling Fan Size for Every Room in Your Malaysian Home';
const POSTS = [
  { suggested_date: '2026-09-01', pillar: 'product', topic: 'Perfect Fan for Cozy Condo Living' },
  { suggested_date: '2026-09-03', pillar: 'case', topic: 'Transform Your Living Room into a Haven' },
  { suggested_date: '2026-09-07', pillar: 'educational', topic: LONG },
  { suggested_date: '2026-09-09', pillar: 'story', topic: 'A Decade of Trusted Comfort' },
  { suggested_date: '2026-09-14', pillar: 'product', topic: 'Elevate Your Dining Experience' },
  { suggested_date: '2026-09-16', pillar: 'festival', topic: 'Celebrating Malaysia Day' },
  { suggested_date: '2026-09-17', pillar: 'case', topic: 'Enhance Your Office Space' },
  { suggested_date: '2026-09-21', pillar: 'promo', topic: 'Exclusive Offer This September' },
];
const PICKS = [{ series: 'FS' }, { series: 'GAZE' }, { series: 'FS' }, null, { series: 'DELTA' }, null, { series: 'INNO' }, { series: 'FS' }];

const card = buildPlanCard({ posts: POSTS, picks: PICKS, monthLabel: '9 月', planId: 'p1' });

console.log('\n--- ① 标题绝不截断(旧版的病根) ---');
assert(card.text.includes(LONG), '72 字的长标题完整出现在正文里');
assert(!/\.\.\.|…/.test(card.text), '整张卡片没有任何省略号');
for (const p of POSTS) {
  if (!card.text.includes(p.topic)) { fail++; console.log(`  ✗ 缺了「${p.topic}」`); }
}
assert(POSTS.every((p) => card.text.includes(p.topic)), `${POSTS.length} 篇标题一篇不少`);

console.log('\n--- ② 摘要和清单必须对得上 ---');
// 她看到"使用场景 2",往下就该数得出 2 行"场景"。对不上她会以为系统算错了。
const counts = {};
for (const p of POSTS) counts[p.pillar] = (counts[p.pillar] || 0) + 1;
for (const [pillar, n] of Object.entries(counts)) {
  const short = PILLAR_SHORT[pillar];
  const listed = card.text.split('\n').filter((l) => /^\d{2}-\d{2}\s/.test(l) && l.includes(`  ${short}  `)).length;
  assert(listed === n, `清单里「${short}」${listed} 行 = 配比里的 ${n} 篇`);
}
assert(/产品介绍 2/.test(card.text), '配比用她看得懂的说法(不是 product/case)');
assert(!/\bproduct\b|\bcase\b|\beducational\b/.test(card.text), '界面上不出现内部 pillar 名');

console.log('\n--- ③ 不许有 Markdown 标记(卡片不传 parse_mode) ---');
assert(!card.text.includes('*'), '正文没有 * ');
assert(!/(^|\s)_|_(\s|$)/m.test(card.text), '正文没有会被当成斜体的 _');
// 标题本身带 _ 或 * 时,必须原样保留且不引发问题
const risky = buildPlanCard({
  posts: [{ suggested_date: '2026-09-01', pillar: 'product', topic: 'Deep_dive: FS 563L *quiet* nights' }],
  picks: [], monthLabel: '9 月', planId: 'p1',
});
assert(risky.text.includes('Deep_dive: FS 563L *quiet* nights'),
  '标题里的 _ 和 * 原样保留(不转义、不丢字)');

console.log('\n--- 按钮只剩两个 ---');
const rows = card.keyboard.inline_keyboard;
assert(rows.length === 2, `按钮 ${rows.length} 行(旧版是 ${POSTS.length * 1 + 1} 行以上)`);
assert(rows.flat().length === 2, '一共 2 颗按钮');
assert(rows[0][0].callback_data === 'ma:p1', '第一颗是"开始写文案"');
assert(rows[1][0].callback_data === 'mt:p1', '第二颗是"我有想法要调整"');
assert(!JSON.stringify(rows).includes('mr:') && !JSON.stringify(rows).includes('mrp:'),
  '逐篇的 Remove/Replace 已经没有了');
assert(rows.flat().every((b) => Buffer.byteLength(b.callback_data) < 64),
  'callback_data 都在 Telegram 的 64 字节限制内');

console.log('\n--- 摘要四项都在,而且说人话 ---');
for (const [label, re] of [['内容配比', /📊 内容配比/], ['覆盖产品', /🌀 覆盖产品/],
  ['发布节奏', /📅 发布节奏/], ['节庆', /🎊 节庆/]]) {
  assert(re.test(card.text), `有「${label}」一段`);
}
assert(/（\d+ 个系列）/.test(card.text), '覆盖产品给出系列数');
assert(!/重复度|相似度|\d+%/.test(card.text),
  '不放需要解读的指标(她看到"重复度 12%"不知道该高兴还是担心)');

console.log('\n--- 发布节奏说的是她能据此判断的事 ---');
assert(/每周 2 篇/.test(rhythmLine([
  { suggested_date: '2026-09-01' }, { suggested_date: '2026-09-03' },
  { suggested_date: '2026-09-08' }, { suggested_date: '2026-09-10' },
])), '每周篇数算对');
assert(/其中 1 篇在周末/.test(rhythmLine([
  { suggested_date: '2026-09-01' }, { suggested_date: '2026-09-05' },
])), '周末篇数如实报出(不硬避,她自己判断)');
assert(/同一天有多篇/.test(rhythmLine([
  { suggested_date: '2026-09-01' }, { suggested_date: '2026-09-01' },
])), '同一天挤了两篇会报出来');

console.log('\n--- 节庆:没有就说没有 ---');
assert(festivalLine([]) === '本月没有排节庆帖', '没有节庆时明说(沉默会让她以为系统忘了)');
assert(/09-16/.test(festivalLine([{ suggested_date: '2026-09-16', topic: 'Malaysia Day' }])),
  '有节庆时给出日期');

console.log('\n--- 长度要留得住(Telegram 4096 上限) ---');
const big = buildPlanCard({
  posts: Array.from({ length: 14 }, (_, i) => ({
    suggested_date: `2026-09-${String(i + 1).padStart(2, '0')}`,
    pillar: 'product', topic: LONG,
  })),
  picks: [], monthLabel: '9 月', planId: 'p1',
});
assert(big.text.length < 4096, `14 篇最长标题也只有 ${big.text.length} 字符,不会被 Telegram 截断`);

console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
