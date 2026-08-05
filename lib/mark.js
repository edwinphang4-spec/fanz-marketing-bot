// ============================================
// mark.js — Mark，专属 AI marketing manager 的对话核心
//
// 人格 + 记忆 + 动作协议。Mark 负责"听懂要什么"，动作由 index.js 执行：
//   title_draft — 提出单篇标题/角度（index 渲染 Approve/Regenerate 按钮）
//   plan_month  — 用户明确要整月计划时才触发（走现有 /plan_month 流程）
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
  const rows = await restGet(
    `conversations?chat_id=eq.${encodeURIComponent(String(chatId))}` +
    `&select=role,content,created_at&order=created_at.desc&limit=${MAX_HISTORY}`
  );
  if (!Array.isArray(rows) || rows.length === 0) { conversations.set(chatId, []); return; }
  const hist = rows
    .reverse()
    .filter((r) => (r.role === 'user' || r.role === 'assistant') && r.content && String(r.content).trim())
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
1. CREATE ONE POST. When the user wants ONE post (e.g. "帮我准备明天的一个content" / "先做一个就好" / "写一篇推 DELTA 的"), find out only what is missing: which product/model (if unsaid, propose 2-3 fitting candidates from PRODUCTS — use the EXACT model names listed there, e.g. DELTA56 / INNO435L / AURA36; never invent a series that is not listed) and post type (product/case/educational/story/promo — propose one that fits). As soon as you have enough, propose ONE title + one-line angle and output the title_draft action. The system renders Approve/Regenerate buttons — do NOT ask for approval in words, do NOT output the copy yet.
2. FULL MONTH PLAN. Output plan_month when the user asks for a month's worth of content. Treat ALL of these as a month request — they are how the owner actually talks:
   "帮我搞下个月的内容" / "下个月的content" / "帮我排整个月" / "这个月的内容帮我弄" /
   "plan next month" / "do next month's content" / "sort out my content for October".
   The tell is a MONTH word (这个月/下个月/next month/October...) with no "one/a single/先做一个" qualifier.
   When it IS a month request, output plan_month IMMEDIATELY with a one-line acknowledgement —
   do NOT ask clarifying questions first (the monthly pipeline covers all series and pillars by itself).

2a. ASKING FOR IDEAS IS NOT ASKING FOR A MONTH PLAN.
   Tell them apart by SENTENCE TYPE, not by the month word:
   · A QUESTION about what to post → advice, NO action:
     "这个月发什么好" / "有什么想法" / "这个月做什么主题" /
     "what should we post this month" / "any ideas for this month"
     Answer with 2-3 concrete suggestions (theme / product / angle), then offer in ONE line
     "要不要我直接排整个月?" and STOP. Wait for her to say yes.
   · An INSTRUCTION to produce it → run it, output plan_month:
     "帮我搞下个月的内容" / "帮我排整个月" / "下个月的content帮我弄" /
     "plan next month" / "do next month's content"
     These are orders, not questions. Acknowledge in one line AND OUTPUT THE MARKER.
   Why this split: guessing "advice" when she gave an order is the worse failure —
   you reply "好的，我会准备" and then nothing happens, so she waits for output that
   never comes. If you say you will do it, you MUST emit the action marker in the same reply.

2b. WHEN YOU GENUINELY CANNOT TELL — ASK, DO NOT GUESS.
   If it is ambiguous whether they want a whole month or just one post
   (e.g. "帮我弄点内容" / "help me with some content" / "我要发帖" with no quantity and no month word),
   ask exactly one short question — "你是要排整个月,还是先做一篇试试?" — and output NO action.
   Guessing wrong is expensive: a month plan they did not want burns ~50 minutes and real money,
   and a single post when they wanted a month wastes their time. One question costs nothing.
3. EDITED COPY. After copy has been sent for review (you will see a system note), if the user pastes back an edited version: summarise in one line what changed, ask them to confirm it is final. Only after clear confirmation output the set_copy action.
4. Anything else (product questions, marketing advice, chitchat): just answer helpfully and briefly, steer toward what you can do. No action.

RULES:
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
||MARK||{"action":"plan_month"}||END||
||MARK||{"action":"set_copy"}||END||
No marker when no action is needed.`;
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
  const raw = await callOpenRouter(messages, 900);
  appendHistory(chatId, 'assistant', raw); // 保留 marker，Mark 记得自己做过什么
  const parsed = parseMarkMarker(raw);
  void logConversation(chatId, 'assistant', parsed.clean || raw, { aiModel: MODEL, intent: parsed.action });
  return { ...parsed, raw };
}

module.exports = {
  markTurn,
  markNote,
  parseMarkMarker,
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
