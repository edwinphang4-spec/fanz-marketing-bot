// ============================================
// review-notes.js — 客户驳回意见的累积账本
//
// 2026-08-06 查出来的缺口:她点驳回、写了意见,这条意见的下场取决于走哪条路 ——
//   · Telegram 单篇:用完不清,下次沿用**同一条**(她说的新意见把旧的覆盖掉)
//   · Telegram 批量:用完清成 null,第二次驳回时第一条已经不见了
// 两条路行为不一致,而且都不累积。结果是她连驳三次,模型每次只看到最后一句,
// 永远不知道"她一直不满意的是同一个点"。
//
// Edwin 定的规矩:
//   · 累积,**批准时才清** —— 第三次重写要能看到全部三条
//   · 加序号 + 时间,并明确告诉模型「后面的优先于前面的」——
//     她改口时(「算了还是长一点」)有确定的解法,和人的沟通逻辑一致
//   · 累积到 5 条就不再改了,提示人:改了 5 次还不满意,方向大概就是错的
//
// 注意:review_notes 这一列同时被配图那条路用来放动作标记
// ("[scene] …" / "[product-next]" / "[recompose]")。这里只认 "[#N 时间]" 这种
// 格式的条目,别的一律不当成意见 —— 两套东西共用一列,互相不许踩。
// ============================================

const MAX_NOTES = 5;

/** 一条意见的行首标记:[#2 2026-08-06 14:45] */
const NOTE_HEAD = /\[#(\d+)\s+(\d{4}-\d{2}-\d{2} \d{2}:\d{2})\]/g;

/** 马来西亚时间 YYYY-MM-DD HH:mm */
function stampNow(now) {
  const d = now || new Date();
  const myt = new Date(d.getTime() + (8 * 60 + d.getTimezoneOffset()) * 60_000);
  const p = (n) => String(n).padStart(2, '0');
  return `${myt.getFullYear()}-${p(myt.getMonth() + 1)}-${p(myt.getDate())} ${p(myt.getHours())}:${p(myt.getMinutes())}`;
}

/**
 * 从 review_notes 原文里解析出意见条目。
 * 认不出格式的内容一律忽略(可能是配图的动作标记,或人手改的旧数据)。
 * @returns {Array<{n:number, ts:string, text:string}>}
 */
function parseNotes(raw) {
  const s = String(raw || '');
  const heads = [...s.matchAll(NOTE_HEAD)];
  if (heads.length === 0) return [];
  const out = [];
  for (let i = 0; i < heads.length; i++) {
    const h = heads[i];
    const start = h.index + h[0].length;
    const end = i + 1 < heads.length ? heads[i + 1].index : s.length;
    const text = s.slice(start, end).trim();
    if (text) out.push({ n: Number(h[1]), ts: h[2], text });
  }
  return out;
}

/**
 * 追加一条意见(不是覆盖)。
 * 空白意见不入账 —— 她点了驳回但没写字,那就是"再来一版",不是一条要遵守的要求。
 */
function appendNote(raw, text, now) {
  const clean = String(text || '').trim();
  if (!clean) return String(raw || '');
  const existing = parseNotes(raw);
  const n = existing.length + 1;
  const entry = `[#${n} ${stampNow(now)}] ${clean}`;
  // 保留原文里非意见的部分(配图标记等),把新意见接在后面
  const base = String(raw || '').trim();
  return base ? `${base}\n${entry}` : entry;
}

function noteCount(raw) {
  return parseNotes(raw).length;
}

/** 到上限了 → 不该再改,该整篇重来或换方向 */
function atLimit(raw) {
  return noteCount(raw) >= MAX_NOTES;
}

/**
 * 拼给文案模型看的意见段。
 *
 * 「后面的优先于前面的」这句必须写出来:她第二次说"算了还是长一点"时,
 * 模型要知道该听哪一条,而不是同时满足两个相反的要求。
 */
function formatForPrompt(raw) {
  const notes = parseNotes(raw);
  if (notes.length === 0) {
    const legacy = String(raw || '').trim();
    // 老数据/手写的没有序号 —— 当成单独一条,别丢
    return legacy && !/^\[(scene|product-next|recompose)\b/.test(legacy) ? legacy : '';
  }
  const lines = notes.map((x) => `  ${x.n}. (${x.ts}) ${x.text}`).join('\n');
  return notes.length === 1
    ? `The reviewer asked for this change:\n${lines}`
    : `The reviewer has now asked for ${notes.length} changes on this post, oldest first:\n${lines}\n` +
      `Where two of them conflict, the LATER note wins — it is what she thinks now. ` +
      `Where they do not conflict, satisfy all of them. If the same point keeps coming back, ` +
      `it is the thing she actually cares about — fix that one properly.`;
}

module.exports = {
  MAX_NOTES, parseNotes, appendNote, noteCount, atLimit, formatForPrompt, stampNow,
};
