// ============================================
// e2e-real-chain.js — REAL end-to-end run of the monthly chain M-1 -> M-7
//
// Everything real: OpenRouter GPT-4o (planning + copy), GPT Image 2
// (scene generation), Supabase DB, Supabase Storage, Telegram delivery
// (raw HTTP sendMessage/sendPhoto — no polling, so it does not conflict
// with the deployed bot's poller).
//
// Human review steps (M-2 approval, M-4 copy review, M-5 image review)
// are driven through the LOCAL dashboard API (next start on :3005) so the
// Dashboard side of the chain is exercised too, except M-2 which has no
// dashboard entry (applied via the same DB writes the ma: handler does).
//
// Target month: next month (August 2026) — keeps E2E data clearly apart
// from the July test plans.
//
// Cost note: one full run = 1 planning call + ~13 copy calls (GPT-4o)
// + ~14 GPT Image 2 generations (13 posts + 1 change-scene demo).
//
// Run: source .env, then: node e2e-real-chain.js <telegram_chat_id>
// ============================================

const supabase = require('./lib/supabase');
const supabasePlans = require('./lib/supabase-plans');
const worker = require('./lib/worker');
const cron = require('./cron-publish-reminder');
const { buildMonthlySystemPrompt, parseTargetMonth } = require('./lib/monthly-planning');
const { parseAndValidateMonthlyPlan, mapPillarForDB } = require('./lib/monthly-plan-parser');
const { buildCopywritingPrompt, parseCopywritingResponse, validateCopywritingResult } = require('./lib/copywriting');

const CHAT_ID = process.argv[2];
const DASH = 'http://localhost:3005/api/marketing';
const TG = `https://api.telegram.org/bot${process.env.TELEGRAM_TOKEN}`;
const MODEL = process.env.MODEL || 'gpt-4o';

if (!CHAT_ID) {
  console.error('Usage: node e2e-real-chain.js <telegram_chat_id>');
  process.exit(1);
}

const log = (stage, msg) => console.log(`[E2E][${stage}] ${msg}`);

// Real Telegram senders via raw HTTP (no polling)
async function tgSend(method, payload) {
  const res = await fetch(`${TG}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = await res.json();
  if (!body.ok) throw new Error(`Telegram ${method} failed: ${JSON.stringify(body).slice(0, 200)}`);
  return body.result;
}
const senders = {
  sendMessage: (chatId, text, opts) => tgSend('sendMessage', { chat_id: chatId, text, ...(opts || {}) }),
  sendPhoto: (chatId, photo, opts) => tgSend('sendPhoto', { chat_id: chatId, photo, ...(opts || {}) }),
  sendImageReviewCard: async () => {}, // plan rows review on the Dashboard
};

async function callOpenRouter(messages, maxTokens) {
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ model: MODEL, messages, max_tokens: maxTokens || 1500, temperature: 0.8 }),
  });
  if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return (await res.json()).choices[0].message.content;
}

const dashPost = async (path, body) => {
  const res = await fetch(DASH + path, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
};

(async () => {
  const summary = { month: null, planId: null, stages: {} };

  // ─── M-1: monthly planning (real GPT-4o) ───
  const target = parseTargetMonth('next month');
  const monthStr = target.monthStr;
  summary.month = monthStr;
  log('M-1', `planning ${monthStr} via ${MODEL}...`);

  const raw = await callOpenRouter([
    { role: 'system', content: buildMonthlySystemPrompt(monthStr) },
    { role: 'user', content: `Generate a full-month content calendar for ${monthStr} with exactly 12 regular posts (4 product, 3 case, 2 educational, 2 story, 1 promo) plus 0-2 festival posts. Ensure all product series are featured.` },
  ], 4000);
  const parsed = parseAndValidateMonthlyPlan(raw, monthStr);
  if (!parsed.valid || parsed.posts.length < 8) {
    console.error('M-1 failed:', parsed.errors);
    process.exit(1);
  }
  log('M-1', `parsed ${parsed.regularPosts.length} regular + ${parsed.festivalPosts.length} festival posts`);

  const plan = await supabasePlans.createContentPlan({
    month: monthStr, status: 'pending_approval', chat_id: String(CHAT_ID),
    total_posts: parsed.posts.length, notes: 'E2E real chain run',
  });
  summary.planId = plan.id;
  const rowIds = [];
  for (const post of parsed.posts) {
    const row = await supabase.createContentCalendar({
      chat_id: String(CHAT_ID), pillar: mapPillarForDB(post.pillar), topic: post.topic,
      post_angle: post.post_angle, suggested_date: post.suggested_date,
      plan_id: plan.id, status: 'planned',
    });
    rowIds.push(row.id);
  }
  summary.stages['M-1'] = `${rowIds.length} calendar rows created (plan ${plan.id})`;
  log('M-1', summary.stages['M-1']);

  // ─── M-2: month approval (same writes as the ma: callback) ───
  await supabasePlans.updateContentPlan(plan.id, { status: 'plan_approved' });
  for (const id of rowIds) await supabase.updateContentCalendar(id, { status: 'plan_approved' });
  summary.stages['M-2'] = 'plan + all rows -> plan_approved';
  log('M-2', summary.stages['M-2']);

  // ─── M-3: batch copywriting (real GPT-4o, same modules as batchGenerateContent) ───
  let copyOk = 0, copyFail = 0;
  for (const id of rowIds) {
    const row = await supabase.getContentCalendar(id);
    try {
      const copyRaw = await callOpenRouter([
        { role: 'system', content: buildCopywritingPrompt(row.topic, row.pillar) },
        { role: 'user', content: `Generate social media content for this Fanz topic: "${row.topic}". Pillar: ${row.pillar}.` },
      ]);
      const copy = parseCopywritingResponse(copyRaw);
      if (!copy) throw new Error('parse failed');
      const v = validateCopywritingResult(copy);
      if (!v.valid) throw new Error(v.errors.join('; '));
      await supabase.updateContentCalendar(id, {
        fb_content: copy.fb_content, ig_content: copy.ig_content,
        hashtags: copy.hashtags, status: 'copy_done',
      });
      copyOk++;
      log('M-3', `${copyOk + copyFail}/${rowIds.length} "${row.topic}" ok`);
    } catch (err) {
      copyFail++;
      log('M-3', `${copyOk + copyFail}/${rowIds.length} "${row.topic}" FAILED: ${err.message}`);
    }
  }
  summary.stages['M-3'] = `${copyOk} copy generated, ${copyFail} failed`;

  // ─── M-4: copy review via LOCAL dashboard API ───
  let reviewOk = 0;
  for (const id of rowIds) {
    const row = await supabase.getContentCalendar(id);
    if (row.status !== 'copy_done') continue;
    const r = await dashPost('/review', { id, action: 'approve' });
    if (r.status === 200) reviewOk++;
    else log('M-4', `approve ${id} -> ${r.status}: ${JSON.stringify(r.body).slice(0, 120)}`);
  }
  summary.stages['M-4'] = `${reviewOk} approved via dashboard /api/marketing/review`;
  log('M-4', summary.stages['M-4']);

  // ─── M-4 -> M-5: Start Image Generation via dashboard ───
  const si = await dashPost('/start-imagery', { planId: plan.id });
  if (si.status !== 200) {
    console.error('start-imagery failed:', si.body);
    process.exit(1);
  }
  summary.stages['M-4->M-5'] = `start-imagery queued=${si.body.queued}`;
  log('M-5', `start-imagery: ${JSON.stringify(si.body)}`);

  // ─── M-5: worker batch imagery (REAL GPT Image 2) ───
  worker._internal.setSenders(senders);
  worker._internal.setLastReminderDate(cron.getMalaysiaDateStr()); // reminder fires later, explicitly
  const t0 = Date.now();
  log('M-5', 'worker tick — generating images (about 1 min per post)...');
  await worker.tick(); // sequential batch; may take 10-15 min
  const rows5 = await supabase.listContentCalendarByPlanId(plan.id);
  const ready = rows5.filter(r => r.status === 'image_ready');
  summary.stages['M-5'] = `${ready.length}/${rows5.length} images generated in ${Math.round((Date.now() - t0) / 1000)}s`;
  log('M-5', summary.stages['M-5']);
  for (const r of rows5) {
    if (r.status !== 'image_ready') log('M-5', `NOT READY: "${r.topic}" status=${r.status} image_status=${r.image_status}`);
  }

  // ─── M-5 review: change_scene on the first post (real regeneration), approve the rest ───
  const demo = ready[0];
  if (demo) {
    const cs = await dashPost('/image-review', { id: demo.id, action: 'change_scene', scene: 'a modern Malaysian condo living room during golden hour' });
    log('M-5', `change_scene demo on "${demo.topic}" -> ${cs.status}`);
    await worker.tick(); // regenerate the demo row
    const demoAfter = await supabase.getContentCalendar(demo.id);
    summary.stages['M-5-retry'] = `change_scene regenerated -> ${demoAfter.status} (marker cleared: ${!demoAfter.review_notes})`;
    log('M-5', summary.stages['M-5-retry']);
  }

  let imgApproved = 0;
  for (const r of await supabase.listContentCalendarByPlanId(plan.id)) {
    if (r.status !== 'image_ready') continue;
    const a = await dashPost('/image-review', { id: r.id, action: 'approve' });
    if (a.status === 200) imgApproved++;
    else log('M-5', `image approve ${r.id} -> ${a.status}`);
  }
  summary.stages['M-5-review'] = `${imgApproved} images approved via dashboard`;
  log('M-5', summary.stages['M-5-review']);

  // ─── M-6: auto-schedule (worker detects all-approved) ───
  await worker.tick();
  const rows6 = await supabase.listContentCalendarByPlanId(plan.id);
  const scheduled = rows6.filter(r => r.scheduled_date);
  const planAfter = await supabasePlans.getContentPlan(plan.id);
  summary.stages['M-6'] = `${scheduled.length}/${rows6.length} rows scheduled, plan status=${planAfter.status}`;
  log('M-6', summary.stages['M-6']);

  // ─── M-7: pull one post to today and fire the real reminder ───
  const todayMYT = cron.getMalaysiaDateStr();
  const reminderRow = rows6.find(r => r.status === 'approved');
  if (reminderRow) {
    await supabase.updateContentCalendar(reminderRow.id, { scheduled_date: `${todayMYT}T12:00:00+08:00` });
    worker._internal.setLastReminderDate(null);
    await worker._internal.runDailyReminder();
    const after = await supabase.getContentCalendar(reminderRow.id);
    summary.stages['M-7'] = `reminder for "${after.topic}" delivered=${after.publish_reminder_sent} (real Telegram, with Mark-as-Published button)`;
    log('M-7', summary.stages['M-7']);
  } else {
    summary.stages['M-7'] = 'SKIPPED - no approved row';
  }

  worker.stop();
  console.log('\n========== E2E SUMMARY ==========');
  console.log(JSON.stringify(summary, null, 2));
})().catch((err) => {
  console.error('[E2E] FATAL:', err);
  worker.stop();
  process.exit(1);
});
