// ============================================
// mark.js — Mark，专属 AI marketing manager 的对话核心
//
// 人格 + 记忆 + 动作协议。Mark 负责"听懂要什么"，动作由 index.js 执行：
//   title_draft — 提出单篇标题/角度（index 渲染 Approve/Regenerate 按钮）
//   make_content — 任意数量 + 任意日期范围（"整月"只是它的特例）
//   set_copy    — 用户粘贴修改稿并确认终版后，落库
//
// 记忆两层：进程内 Map（供 LLM 上下文）+ conversations 表（持久，
// dashboard 的 image-chat 与此共用一张表 = 记忆连通）。
// ============================================

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const MODEL = process.env.MODEL || 'gpt-4o';
const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

const MAX_HISTORY = 24;
const conversations = new Map(); // chatId -> [{role, content}]
const activeRows = new Map();    // chatId -> calendar row id currently under discussion
const lastPastes = new Map();    // chatId -> last long text the user pasted (edited copy)
const hydrated = new Set();      // chatId 已从 DB 水合过历史（每进程每 chat 一次）

function getHistory(chatId) { return conversations.get(chatId) || []; }

function appendHistory(chatId, role, content) {
  if (!conversations.has(chatId)) conversations.set(chatId, []);
  const h = conversations.get(chatId);
  h.push({ role, content });
  if (h.length > MAX_HISTORY) conversations.set(chatId, h.slice(h.length - MAX_HISTORY));
}

// ── 只读 REST（非阻塞，失败返回 null，绝不抛）──
async function restGet(pathAndQuery) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) return null;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/${pathAndQuery}`, {
        headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`, Accept: 'application/json' },
        signal: controller.signal,
      });
      if (!r.ok) return null;
      return await r.json();
    } finally { clearTimeout(timer); }
  } catch { return null; }
}

/**
 * 冷启动水合：进程重启会清空内存 Map，导致 Mark 失忆。首次遇到某 chatId
 * 时从 conversations 表把最近 MAX_HISTORY 条捞回来铺进内存 → 重启不再失忆。
 * 每进程每 chat 只水合一次（hydrated Set 去重），已有内存历史时跳过。
 */
async function hydrateHistory(chatId) {
  if (hydrated.has(chatId)) return;
  hydrated.add(chatId);
  if (getHistory(chatId).length > 0) return; // 进程内已有活跃历史，不覆盖
  const q = `conversations?chat_id=eq.${encodeURIComponent(String(chatId))}`;
  // intent 用来滤掉埋点行；万一这张表没有 intent 列，降级重试，
  // 否则整次水合返回 null = Mark 重启后彻底失忆（比看见埋点行糟得多）。
  const rows = await restGet(`${q}&select=role,content,intent,created_at&order=created_at.desc&limit=${MAX_HISTORY * 2}`)
    || await restGet(`${q}&select=role,content,created_at&order=created_at.desc&limit=${MAX_HISTORY}`);
  if (!Array.isArray(rows) || rows.length === 0) { conversations.set(chatId, []); return; }
  const hist = rows
    .reverse()
    .filter((r) => (r.role === 'user' || r.role === 'assistant') && r.content && String(r.content).trim())
    // 埋点行不是对话 —— 尤其 promise_blocked 存的就是被拦下来的那句谎话，
    // 水合回记忆等于让 Mark 下一轮理直气壮地说"我刚才说了在准备啊"。
    .filter((r) => !GUARD_INTENTS.has(r.intent))
    .map((r) => ({ role: r.role, content: String(r.content) }));
  conversations.set(chatId, hist.slice(-MAX_HISTORY));
}

// ── 内容日历感知（全局共享，60s 缓存，避免每轮打库）──
let _calCache = null;
let _calAt = 0;
const CAL_TTL_MS = 60_000;

function formatCalendarSummary(rows) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return 'No posts on the content calendar yet — this is a clean slate.';
  }
  const done = [], scheduled = [], inProgress = [];
  const label = (r) => {
    const prod = r.source_product_image ? String(r.source_product_image).replace(/\.(png|jpe?g|webp)$/i, '') : '';
    const bits = [r.pillar || '?', prod, `"${(r.topic || '').slice(0, 60)}"`].filter(Boolean);
    return bits.join(' · ');
  };
  for (const r of rows) {
    if (r.published_at || r.status === 'published') done.push(`  - ${label(r)} (published ${String(r.published_at || '').slice(0, 10)})`);
    else if (r.scheduled_date || r.status === 'scheduled' || r.status === 'approved') scheduled.push(`  - ${label(r)}${r.scheduled_date ? ` (scheduled ${String(r.scheduled_date).slice(0, 10)})` : ''}`);
    else inProgress.push(`  - ${label(r)} [${r.status || 'draft'}]`);
  }
  const cap = (arr) => arr.slice(0, 12);
  const sections = [];
  if (done.length) sections.push(`Already published/live:\n${cap(done).join('\n')}`);
  if (scheduled.length) sections.push(`Scheduled/approved (upcoming):\n${cap(scheduled).join('\n')}`);
  if (inProgress.length) sections.push(`In progress / awaiting review:\n${cap(inProgress).join('\n')}`);
  return sections.join('\n\n');
}

async function getContentSummary() {
  const now = Date.now();
  if (_calCache && now - _calAt < CAL_TTL_MS) return _calCache;
  const rows = await restGet(
    'content_calendar?select=topic,pillar,status,scheduled_date,source_product_image,published_at,created_at' +
    '&order=created_at.desc&limit=40'
  );
  const summary = formatCalendarSummary(rows);
  _calCache = summary;
  _calAt = now;
  return summary;
}

/** State note Mark can see in history but never reads aloud. */
function markNote(chatId, note) { appendHistory(chatId, 'assistant', note); }

function setActiveRow(chatId, rowId) { activeRows.set(chatId, rowId); }
function getActiveRow(chatId) { return activeRows.get(chatId) || null; }
function setLastPaste(chatId, text) { lastPastes.set(chatId, text); }
function getLastPaste(chatId) { return lastPastes.get(chatId) || null; }

// ── 持久对话日志（与 CS bot / dashboard 同一张 conversations 表）──
// fire-and-forget：绝不阻塞回复；缺列/约束拒绝时降级重试。
async function logConversation(chatId, role, content, meta = {}) {
  if (!SUPABASE_SERVICE_KEY || !content || !String(content).trim()) return;
  const base = { chat_id: String(chatId), role, content: String(content), intent: meta.intent || null };
  const extended = {
    ...base,
    platform: 'telegram',
    sender_name: meta.senderName || (role === 'assistant' ? 'Mark' : null),
    message_type: 'text',
    ai_model_used: meta.aiModel || null,
  };
  const post = (payload) => fetch(`${SUPABASE_URL}/rest/v1/conversations`, {
    method: 'POST',
    headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  try {
    let r = await post(extended);
    if (!r.ok) {
      const t = await r.text();
      if (/column|PGRST204|42703/i.test(t)) r = await post(base);
      else if (/23514/.test(t) && extended.intent) r = await post({ ...extended, intent: null });
      if (!r.ok) console.warn(`[mark] logConversation failed: ${r.status}`);
    }
  } catch (e) { console.warn('[mark] logConversation error:', e.message); }
}

// ── 空头承诺拦截 ───────────────────────────────
// 病根：回复文字和动作标记是两条独立通道。index.js 只在有标记时才动作，
// 文字里承诺了什么代码一个字都不看 —— 于是"我会准备好"发出去了，数据库里空空如也。
// 提示词禁令试过两次（018986 那条铁律），模型总能走到没被枚举的场景，所以改在代码层收口。
//
// 设计上最关键的一刀：**只在没有动作标记时才检测**。有标记 = 承诺是真的，不碰。
// 第二条原则：宁可漏检，不可误伤。漏检退回今天的行为（不变坏），误伤是把对的话改坏。
// 所以下面的正则宁可窄一点，问句一律放过（问句是提示词规定的合法结尾）。
// outbound_money_blocked 来自 CS bot —— conversations 表是共用的,同一个 chat_id
// (比如 Edwin 自己)可能和两个 bot 都聊过,水合时别把对方的埋点捞进来。
const GUARD_INTENTS = new Set(['promise_blocked', 'promise_fallback', 'title_draft_missed', 'outbound_money_blocked']);
const GUARD_TAG = '[guard]';

// 合法的"将来时"—— 建议语气、等待、反问，都不是承诺。
const PROMISE_EXCLUDE = /我会(建议|推荐|说|觉得|认为|等|需要)|我(要|想|先|再)?问|我(会|要)?等(你|您|一下|着)|I'?d (suggest|recommend)|I would (suggest|recommend)|I'?ll (be honest|need|wait|say)/i;

const PROMISE_PATTERNS = [
  // 中文：第一人称 + 将来/立刻 + 动手做事
  /我(会|将|要|来|去|先|这就|马上|立刻|立即|等下|等一下|待会|稍后|晚点|随后|接下来|再)[^。！？!?\n]{0,12}(准备|安排|做|弄|写|排|整理|生成|搞|跟进|处理|规划|计划|去问|问一下)/,
  /(接下来|稍后|待会|等一下|晚点|随后|之后|明天|等会|回头)[^。！？!?\n]{0,6}我(会|来|去|再|就)/,
  /(让我来|交给我|包在我身上)/,
  /(准备|弄|做|写|排|整理)好(了)?(之后|以后)?(再|就)?(发|给|告诉|通知)(给)?(你|您)/,
  // English
  /\bI'?ll\b/i,
  /\bI will\b/i,
  /\bI'?m (going to|gonna)\b/i,
  /\blet me (get|prepare|put|draft|work|sort|check|pull|set|line)/i,
  /\bleave it (with|to) me\b/i,
  /\bget back to you\b/i,
  /\bkeep you posted\b/i,
  // Bahasa Melayu
  /\bsaya akan\b/i,
  /\bnanti saya\b/i,
  /\bbiar saya\b/i,
  /\bsaya (siapkan|sediakan)\b/i,
];

/** 按句切开，保留句末标点（用来判断是不是问句）。 */
function splitSentences(text) {
  return String(text || '')
    .split(/(?<=[。！？!?\n])/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function isPromiseSentence(s) {
  if (/[？?]\s*$/.test(s)) return false;      // 问句 = "要不要我现在就…?" 提示词规定的合法结尾
  if (PROMISE_EXCLUDE.test(s)) return false;
  return PROMISE_PATTERNS.some((re) => re.test(s));
}

/** 检出第一句空头承诺，没有返回 null。只吃已剥掉 marker 的正文。 */
function detectPromise(text) {
  for (const s of splitSentences(text)) {
    if (isPromiseSentence(s)) return s.slice(0, 160);
  }
  return null;
}

/** 兜底用：删掉承诺句，其余（主题建议之类的有用内容）留着。 */
function stripPromises(text) {
  return splitSentences(text).filter((s) => !isPromiseSentence(s)).join(' ').replace(/\s+/g, ' ').trim();
}

// Edwin 定的兜底话术：明说做不到，而不是只问"要不要现在开始" ——
// 后者她会疑惑"你刚说要准备,怎么又问我"。明说顺带让她知道:这个 bot 必须她说了才动。
const FALLBACK_CN = '我没法在后台帮你准备 —— 两条消息之间我什么都做不了。要不要现在就开始？';
const FALLBACK_EN = "I can't work on this in the background — nothing happens between messages. Want me to start now?";
function fallbackLine(original) {
  return /[一-鿿]/.test(String(original || '')) ? FALLBACK_CN : FALLBACK_EN;
}

/** 重生成时贴着具体错误给的纠正（比提示词里的通用禁令命中率高）。 */
function buildCorrectionNote(hit) {
  return `[system note: your previous reply was NOT sent to the user. It promised future work — "${hit}" — but carried no ACTION marker, so nothing was executed and that promise was a lie. You have no background tasks: nothing happens between messages unless a marker in THIS reply makes it happen. Rewrite that reply now, same language, and end it one of exactly two ways: (a) DO IT NOW — emit the ACTION marker in this reply; if you already know the product and the angle, emit title_draft so she gets the Approve button; or (b) DROP the promise entirely and end with a direct offer as a question ("要不要我现在就…?"). Do not mention this note or apologise for it.]`;
}

// 只提议了标题却没发 title_draft = 她收不到 Approve 按钮。埋点用，不拦。
// 粗口径:建议类回复（列三个主题）也会被算进来,看频率够用,要精确就读 content。
const TITLE_PROPOSAL = /(标题|題目)\s*[:：]|\bTitle\s*:/i;
const QUOTED_TITLE = /[「『“"]([^」』”"]{4,60})[」』”"]/;
function detectTitleProposal(text) {
  const t = String(text || '');
  return TITLE_PROPOSAL.test(t) || QUOTED_TITLE.test(t);
}

function guardEnabled() {
  return String(process.env.MARK_PROMISE_GUARD || '').toLowerCase() !== 'off';
}

// ── 人格与协议 ─────────────────────────────────
function buildMarkSystemPrompt({ productContext, brandVoiceText, todayIso, contentSummary }) {
  return `You are Mark, the dedicated AI marketing manager for Fanz Sdn Bhd (Malaysian ceiling fan brand). The person you chat with is your client/boss.

PERSONALITY: a sharp, reliable Malaysian agency account manager with a real memory of the account. Warm and personable but brief and concrete — like a trusted colleague, not a chatbot. Always arrive WITH a proposal, never just open-ended questions. Match the user's language (English / Chinese / Bahasa Melayu). No emoji. Never send the exact same sentence twice in one conversation — rephrase naturally. One question at a time.

TODAY: ${todayIso}

PRODUCTS:
${productContext}

CONTENT CALENDAR — what already exists on this account. This is your MEMORY of what has and hasn't been done. Use it to: (a) answer questions like "what have we posted?" / "have we done Grande V2 yet?" / "what's scheduled?"; (b) NEVER propose a post that duplicates something already published or scheduled — vary the product, angle or pillar instead; (c) proactively notice gaps (a product or pillar not covered recently) and suggest filling them.
${contentSummary || '(calendar unavailable right now — proceed, but say you could not check the calendar if the user asks what has been done.)'}

BRAND VOICE (drives post copy): ${brandVoiceText || 'warm, practical Malaysian home comfort; quality without hype'}

WHAT YOU CAN DO — via ACTION markers the system executes:
1. CREATE ONE POST. When the user wants ONE post (e.g. "帮我准备明天的一个content" / "先做一个就好" / "写一篇推 DELTA 的"), find out only what is missing: which product/model (if unsaid, propose 2-3 fitting candidates from PRODUCTS — use the EXACT model names listed there, e.g. DELTA56 / INNO435L / AURA36; never invent a series that is not listed.
   ⛔ A SERIES NAME IS NOT A MODEL. If she says "推 DELTA" / "做个 AURA 的", ask which model —
   DELTA56 and DELTA66 are 56" and 66", they suit different rooms, and picking for her sends the
   whole post in the wrong direction. Name the options and ask: "DELTA 有 DELTA56 和 DELTA66，你想推哪个？") and post type (product/case/educational/story/promo — propose one that fits). As soon as you have enough, propose ONE title + one-line angle and output the title_draft action. The system renders Approve/Regenerate buttons — do NOT ask for approval in words, do NOT output the copy yet.
2. A BATCH OF POSTS — any quantity, any date range. Output make_content.
   This is ONE action, not a list of commands. Do not ask yourself "which command is this";
   ask "how many, and covering what dates". Everything below is the same action:
     "帮我搞下个月的内容"        → count 12, when next_month
     "帮我排整个月"              → count 12, when this_month
     "下个星期的三个 content"    → count 3,  when next_week
     "这星期来两篇"              → count 2,  when this_week
     "这个月重点推 DELTA"        → count 12, when this_month, products ["DELTA56"]
   A month word with no number means the usual full month (12). Any other quantity she states
   is the quantity — do not round it to a month.
   When you have BOTH the count and a mappable date token, output the marker IMMEDIATELY with a
   one-line acknowledgement. Do NOT ask clarifying questions first — the pipeline covers series,
   pillars and angles by itself, and the system will show her the exact dates and count it worked
   out, so she can correct it there.

2a. ASKING FOR IDEAS IS NOT ASKING FOR POSTS.
   Tell them apart by SENTENCE TYPE, not by the month word:
   · A QUESTION about what to post → advice, NO action:
     "这个月发什么好" / "有什么想法" / "这个月做什么主题" /
     "what should we post this month" / "any ideas for this month"
     Answer with 2-3 concrete suggestions (theme / product / angle), then offer in ONE line
     "要不要我直接排整个月?" and STOP. Wait for her to say yes.
   · An INSTRUCTION to produce it → run it, output make_content.
     These are orders, not questions. Acknowledge in one line AND OUTPUT THE MARKER.
   Why this split: guessing "advice" when she gave an order is the worse failure —
   you reply "好的，我会准备" and then nothing happens, so she waits for output that
   never comes. If you say you will do it, you MUST emit the action marker in the same reply.

2b. MISSING A NUMBER OR MISSING DATES — ASK, DO NOT GUESS.
   · No quantity and no month word ("帮我弄点内容" / "帮我搞几篇" / "help me with some content"):
     ask ONE short question — "要几篇?什么时候发?" — and output NO action.
   · Dates you cannot map to a token ("国庆前准备几篇" / "过两天" / "有空的时候"):
     ask which dates she means, and offer a concrete guess as a question
     ("是指这个星期吗?" ) — but output NO action until she confirms.
   Guessing wrong is expensive: a month she did not want burns ~50 minutes and real money,
   and three posts when she wanted twelve wastes her time. One question costs nothing.
   ⛔ Never invent a count. "几篇" is not a number — it is her asking YOU to pick, so ask back.

2c. ONE POST is still its own action — use title_draft (rule 1), not make_content,
   because a single post goes through the title-approval card first.

3. EDITED COPY. After copy has been sent for review (you will see a system note), if the user pastes back an edited version: summarise in one line what changed, ask them to confirm it is final. Only after clear confirmation output the set_copy action.
4. Anything else (product questions, marketing advice, chitchat): just answer helpfully and briefly, steer toward what you can do. No action.

RULES:
- ⛔ NEVER PROMISE ANYTHING YOU ARE NOT DOING RIGHT NOW. You have no background tasks, no
  follow-up, no reminders, no scheduler of your own. Nothing happens between messages unless an
  ACTION marker in THIS reply made it happen. So these sentences are forbidden — every one of
  them is a lie to a person who is trusting you:
    "我会继续跟进" / "我会准备好" / "接下来我会…" / "稍后我会…" / "我来安排" /
    "I'll keep you posted" / "I'll get these ready" / "I'll follow up" / "leave it with me"
  There are exactly two honest endings to any request you cannot complete in this reply:
    (a) DO IT NOW — emit the action marker in this same reply; or
    (b) OFFER — "要不要我现在就…?" and stop, waiting for her answer.
  If you can only do part of it, say which part you did and what is still not done —
  do not paper over the gap with a promise. An unmet promise costs more than a plain
  "this I cannot do yet": she stops checking, assumes it is handled, and finds out days later.
- Post copy (FB/IG) is written in ENGLISH by the system unless the user asks otherwise; your chat replies always match the user's language.
- Never invent prices, promotions, discounts or warranty terms. If asked, say the sales team confirms pricing.
- System notes in history look like "[...]" — they are state for you (title approved / copy sent / image generating). Use them; never read them aloud.
- suggested_date: if the user says "明天/tomorrow" compute from TODAY; if unspecified leave empty.
- FESTIVAL TIMING — mention it, never block it. When she asks for festive content, work out from
  TODAY whether that festival has passed, is close, or is far off, and say so in ONE short clause
  before you propose — e.g. "Merdeka 是 8 月 31 号,已经过了哦,你是想做回顾类的,还是提前准备下一个节庆?"
  Fixed dates you can rely on: Labour Day 1 May, Merdeka 31 Aug, Malaysia Day 16 Sep, Christmas 25 Dec.
  Dates that MOVE every year (Chinese New Year, Hari Raya, Deepavali, Wesak, Thaipusam, Muharram):
  you do NOT know this year's date — say it is "around <season>", never state a specific day.
  She may genuinely want a retrospective, or to prepare next year's early. So: flag the timing,
  still propose, never refuse.

ACTION MARKER — output on the LAST LINE alone, exactly one of:
||MARK||{"action":"title_draft","title":"...","pillar":"product|case|educational|story|promo","product":"<model name or empty>","angle":"one-line post angle","suggested_date":"YYYY-MM-DD or empty"}||END||
||MARK||{"action":"make_content","count":<number>,"when":"<see below>","products":["MODEL"],"pillars":["product"],"theme":"<short phrase or empty>"}||END||
||MARK||{"action":"set_copy"}||END||
No marker when no action is needed.

HOW TO FILL make_content:
- count: how many posts she asked for, as a NUMBER. If she gave no number and it is not a
  whole month, ASK — do not pick one for her. "几篇" is not a number.
- when: ONE of these exact tokens — "this_week" | "next_week" | "this_month" | "next_month"
  | "YYYY-MM-DD" | "YYYY-MM-DD..YYYY-MM-DD".
  ⛔ Do NOT compute dates yourself. You are bad at it — a post dated 28 September once went out
  saying "National Day is near" when it had passed four weeks earlier. Emit the token; the system
  turns it into real dates and shows her the exact range so she can correct it.
  If she said something you cannot map to one of those tokens ("国庆前", "过两天", "有空的时候"),
  ASK her which dates she means. Guessing a window is worse than one short question.
- products: exact model names she named (INNO525L, DELTA56...). Empty array if she named none.
- pillars: only if she asked for particular types. Empty array otherwise.
- theme: her own words for what this batch is about, if she gave any.`;
}

/** 从回复里剥出 marker。返回 { clean, action, data }。 */
function parseMarkMarker(raw) {
  const m = (raw || '').match(/\|\|MARK\|\|([\s\S]*?)\|\|END\|\|/);
  if (!m) return { clean: (raw || '').trim(), action: null, data: null };
  let data = null;
  try { data = JSON.parse(m[1]); } catch { /* malformed → treat as no action */ }
  const clean = raw.replace(/\|\|MARK\|\|[\s\S]*?\|\|END\|\|/g, '').trim();
  return { clean, action: data && data.action ? data.action : null, data };
}

/**
 * 跑一轮 Mark 对话。副作用：记内存历史 + 落 conversations 表。
 * @param {object} deps - { callOpenRouter, productContext, brandVoiceText, senderName }
 * @returns {{ clean, action, data, raw }}
 */
async function markTurn(chatId, userText, deps) {
  const { callOpenRouter, productContext, brandVoiceText, senderName } = deps;

  // 冷启动先水合历史（重启不失忆）+ 拉内容日历摘要（知道做过什么）——
  // 两者都非阻塞安全，失败降级为"无历史/无日历"，绝不挡住回复。
  await hydrateHistory(chatId);
  const contentSummary = await getContentSummary();

  appendHistory(chatId, 'user', userText);
  void logConversation(chatId, 'user', userText, { senderName: senderName || null });

  const system = buildMarkSystemPrompt({
    productContext,
    brandVoiceText,
    todayIso: new Date().toISOString().slice(0, 10),
    contentSummary,
  });
  const messages = [{ role: 'system', content: system }, ...getHistory(chatId)];
  let raw = await callOpenRouter(messages, 900);
  let parsed = parseMarkMarker(raw);
  let guard = null;

  // ── 空头承诺拦截：只在没有动作标记时跑 ──
  if (!parsed.action && guardEnabled()) {
    const hit = detectPromise(parsed.clean);
    if (hit) {
      const blockedClean = parsed.clean;
      // 埋点先落库（存的是被拦下来的原话，她以后要查就靠这个）
      void logConversation(chatId, 'assistant', `${GUARD_TAG} ${blockedClean}`, { intent: 'promise_blocked', aiModel: MODEL });

      const retryMessages = [...messages, { role: 'assistant', content: raw }, { role: 'user', content: buildCorrectionNote(hit) }];
      let raw2 = '';
      try { raw2 = await callOpenRouter(retryMessages, 900); } catch (e) { console.warn('[mark] guard retry failed:', e.message); }
      const parsed2 = raw2 ? parseMarkMarker(raw2) : null;

      if (parsed2 && (parsed2.action || !detectPromise(parsed2.clean))) {
        raw = raw2; parsed = parsed2;
        guard = { fired: true, hit, resolved: 'retry' };
      } else {
        // 重生成还在承诺 —— 不静默替换成漂亮话：删掉承诺句，剩下的有用内容留着，
        // 末尾明说做不到。同时埋 promise_fallback，这是"提示词彻底管不住"的信号。
        const kept = stripPromises((parsed2 && parsed2.clean) || blockedClean);
        const line = fallbackLine(blockedClean);
        const finalText = kept ? `${kept} ${line}` : line;
        void logConversation(chatId, 'assistant', `${GUARD_TAG} retry still promised: ${(parsed2 && parsed2.clean) || '(retry call failed)'}`, { intent: 'promise_fallback', aiModel: MODEL });
        raw = finalText;
        parsed = { clean: finalText, action: null, data: null };
        guard = { fired: true, hit, resolved: 'fallback' };
      }
    }
  }

  // 提议了标题却没发 title_draft → 她收不到 Approve 按钮。只埋点，不拦。
  if (!parsed.action && detectTitleProposal(parsed.clean)) {
    void logConversation(chatId, 'assistant', `${GUARD_TAG} ${parsed.clean.slice(0, 400)}`, { intent: 'title_draft_missed', aiModel: MODEL });
  }

  // ⚠️ 只把**最终版**写进记忆。留着被拦下来的原话，Mark 下一轮会说"我刚才说了在准备啊"。
  appendHistory(chatId, 'assistant', raw); // 保留 marker，Mark 记得自己做过什么
  void logConversation(chatId, 'assistant', parsed.clean || raw, { aiModel: MODEL, intent: parsed.action });
  return { ...parsed, raw, guard };
}

module.exports = {
  markTurn,
  markNote,
  parseMarkMarker,
  detectPromise,
  stripPromises,
  detectTitleProposal,
  GUARD_INTENTS,
  GUARD_TAG,
  buildMarkSystemPrompt,
  logConversation,
  setActiveRow,
  getActiveRow,
  setLastPaste,
  getLastPaste,
  getHistory,
  hydrateHistory,
  getContentSummary,
  __clear: (chatId) => { conversations.delete(chatId); activeRows.delete(chatId); lastPastes.delete(chatId); hydrated.delete(chatId); },
};
