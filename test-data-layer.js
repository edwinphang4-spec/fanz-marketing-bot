#!/usr/bin/env node
// ============================================
// Self-check for the data layer (lib/supabase.js)
// and state machine (lib/state-machine.js).
//
// Does NOT hit Supabase or require any env vars.
// Verifies: module structure, function signatures, state-machine logic.
//
// Exit code 0 on full pass; non-zero on any failure.
// ============================================

const path = require('path');

let passed = 0;
let failed = 0;

function pass(name) {
  passed++;
  console.log(`PASS: ${name}`);
}

function fail(name, err) {
  failed++;
  console.error(`FAIL: ${name}`);
  if (err) console.error(`       ${err.message || err}`);
}

function assert(cond, name) {
  if (cond) pass(name);
  else fail(name);
}

function assertThrows(fn, name, expectedSubstr) {
  try {
    fn();
    fail(name, new Error('expected throw, got none'));
  } catch (err) {
    if (expectedSubstr && !String(err.message).includes(expectedSubstr)) {
      fail(name, new Error(`error message missing "${expectedSubstr}": ${err.message}`));
      return;
    }
    pass(name);
  }
}

function assertDoesNotThrow(fn, name) {
  try {
    fn();
    pass(name);
  } catch (err) {
    fail(name, err);
  }
}

// ============================================
// 1. lib/supabase.js — module + signatures
// ============================================
console.log('--- lib/supabase.js ---');
const supabasePath = path.join(__dirname, 'lib', 'supabase.js');
let supabase;
try {
  supabase = require(supabasePath);
  pass('lib/supabase.js loads');
} catch (err) {
  fail('lib/supabase.js loads', err);
  process.exit(1);
}

const supabaseFns = [
  'createContentCalendar',
  'getContentCalendar',
  'listContentCalendar',
  'updateContentCalendar',
  'getPendingReview',
];
for (const fn of supabaseFns) {
  assert(typeof supabase[fn] === 'function', `supabase.${fn} is a function`);
}

// All CRUD fns should be async (return a promise when called without env).
// We can't safely invoke them (would need fetch + env), but constructor check via .constructor.name.
for (const fn of supabaseFns) {
  if (typeof supabase[fn] === 'function') {
    assert(
      supabase[fn].constructor.name === 'AsyncFunction',
      `supabase.${fn} is async`
    );
  }
}

// ============================================
// 2. lib/state-machine.js — module + signatures
// ============================================
console.log('\n--- lib/state-machine.js ---');
const smPath = path.join(__dirname, 'lib', 'state-machine.js');
let sm;
try {
  sm = require(smPath);
  pass('lib/state-machine.js loads');
} catch (err) {
  fail('lib/state-machine.js loads', err);
  process.exit(1);
}

const smFns = ['transition', 'nextStatus', 'allowedTransitions'];
for (const fn of smFns) {
  assert(typeof sm[fn] === 'function', `state-machine.${fn} is a function`);
}
assert(Array.isArray(sm.STATES) && sm.STATES.length > 0, 'STATES array exported');
assert(sm.TRANSITIONS && typeof sm.TRANSITIONS === 'object', 'TRANSITIONS map exported');

// ============================================
// 3. Legal transitions
// ============================================
console.log('\n--- legal transitions ---');
assertDoesNotThrow(() => sm.transition('draft', 'planning_done'), 'draft → planning_done legal');
assertDoesNotThrow(() => sm.transition('planning_done', 'selected'), 'planning_done → selected legal');
assertDoesNotThrow(() => sm.transition('selected', 'copy_done'), 'selected → copy_done legal');
assertDoesNotThrow(() => sm.transition('copy_done', 'pending_review'), 'copy_done → pending_review legal');
// 2026-08-06 改:原本断言 pending_review → approved 合法。那是**配图阶段插进来之前**
// 的流程。现在文案批准只到 copy_approved,后面还有出图 → image_ready → approved;
// 直接跳到 approved 等于产出一篇没有图的帖子。想只发文案的escape hatch在
// copy_approved → approved 那条边上,不在这里。机器是对的,断言过时了。
assertDoesNotThrow(() => sm.transition('pending_review', 'copy_approved'), 'pending_review → copy_approved legal (文案批准,进配图阶段)');
assertThrows(() => sm.transition('pending_review', 'approved'), 'pending_review → approved illegal (不能跳过配图直接可发布)');
assertDoesNotThrow(() => sm.transition('pending_review', 'rejected'), 'pending_review → rejected legal');
// 2026-08-06 新增:Dashboard 的「Request Changes」就是从 copy_done 驳回的。
// 这条边补上之前,线上跑得通但状态机说它非法(装部署探针时才发现)。
assertDoesNotThrow(() => sm.transition('copy_done', 'rejected'), 'copy_done → rejected legal (Dashboard 驳回)');
assertDoesNotThrow(() => sm.transition('copy_done', 'copy_approved'), 'copy_done → copy_approved legal (Dashboard 直接批准,不经 Telegram 卡片)');
// 配图阶段的边 —— 这份测试写在配图阶段之前,一直没覆盖到
assertDoesNotThrow(() => sm.transition('copy_approved', 'image_ready'), 'copy_approved → image_ready legal');
assertDoesNotThrow(() => sm.transition('copy_approved', 'approved'), 'copy_approved → approved legal (跳过配图,只发文案)');
assertDoesNotThrow(() => sm.transition('image_ready', 'image_retry'), 'image_ready → image_retry legal (重出图)');
assertDoesNotThrow(() => sm.transition('image_retry', 'approved'), 'image_retry → approved legal (重试到上限后的出口)');
assertDoesNotThrow(() => sm.transition('approved', 'published'), 'approved → published legal');
assertDoesNotThrow(() => sm.transition('rejected', 'copy_done'), 'rejected → copy_done legal (re-do path)');

// ============================================
// 4. Illegal transitions — must throw
// ============================================
console.log('\n--- illegal transitions ---');
assertThrows(() => sm.transition('draft', 'published'), 'draft → published illegal');
assertThrows(() => sm.transition('draft', 'approved'), 'draft → approved illegal (no skipping)');
assertDoesNotThrow(() => sm.transition('draft', 'selected'), 'draft → selected legal (direct selection)');
assertThrows(() => sm.transition('planning_done', 'approved'), 'planning_done → approved illegal');
assertThrows(() => sm.transition('selected', 'published'), 'selected → published illegal');
assertThrows(() => sm.transition('copy_done', 'approved'), 'copy_done → approved illegal (review required)');
assertThrows(() => sm.transition('pending_review', 'published'), 'pending_review → published illegal (must approve first)');

// ============================================
// 5. Idempotency — published is terminal
// ============================================
console.log('\n--- published terminal (idempotent) ---');
assertThrows(() => sm.transition('published', 'draft'), 'published → draft illegal', 'terminal');
assertThrows(() => sm.transition('published', 'approved'), 'published → approved illegal', 'terminal');
assertThrows(() => sm.transition('published', 'pending_review'), 'published → pending_review illegal', 'terminal');
assertThrows(() => sm.transition('published', 'published'), 'published → published illegal', 'terminal');

// ============================================
// 6. Invalid status names
// ============================================
console.log('\n--- invalid status names ---');
assertThrows(() => sm.transition('foo', 'draft'), 'unknown current status throws');
assertThrows(() => sm.transition('draft', 'bar'), 'unknown target status throws');
assertThrows(() => sm.transition(null, 'draft'), 'null current status throws');
assertThrows(() => sm.allowedTransitions('nope'), 'allowedTransitions(unknown) throws');

// ============================================
// 7. allowedTransitions returns the correct set per state
// ============================================
console.log('\n--- allowedTransitions sets ---');
function sameSet(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b)) return false;
  if (a.length !== b.length) return false;
  const sa = a.slice().sort();
  const sb = b.slice().sort();
  return sa.every((v, i) => v === sb[i]);
}

// 2026-08-06 全表复核。改的每一条都是**测试落后于架构**，不是为了让它变绿:
//   draft/selected 多出 'planned' —— 月度计划流建行时直接落 planned;
//   copy_done 多出 'copy_approved' —— Dashboard 可以直接批准,不经 Telegram 卡片;
//   copy_done 多出 'rejected'     —— Dashboard 的 Request Changes(50d9cda 加的);
//   pending_review 的 'approved' → 'copy_approved' —— 配图阶段插在中间了。
// 顺带把配图那几个状态补进来:这份表原本到 pending_review 就没了,
// copy_approved/image_ready/image_retry 三个状态一条断言都没有。
const expected = {
  draft: ['planning_done', 'selected', 'planned'],
  planning_done: ['selected'],
  selected: ['planned', 'copy_done'],
  planned: ['plan_approved'],
  plan_approved: ['copy_done'],
  copy_done: ['pending_review', 'copy_approved', 'rejected'],
  pending_review: ['copy_approved', 'rejected'],
  copy_approved: ['image_ready', 'approved'],
  image_ready: ['approved', 'image_retry'],
  image_retry: ['image_ready', 'approved'],
  approved: ['published'],
  rejected: ['copy_done'],
  published: [],
};

// 这张表必须覆盖每一个状态 —— 漏掉的状态等于没人看着它的边。
// (配图那三个状态就是这么漏了大半年的。)
for (const s of sm.STATES) {
  assert(Object.prototype.hasOwnProperty.call(expected, s),
    `状态 "${s}" 在期望表里有一行(新增状态时别忘了补)`);
}

for (const [from, want] of Object.entries(expected)) {
  const got = sm.allowedTransitions(from);
  assert(sameSet(got, want), `allowedTransitions("${from}") = [${want.join(', ')}]`);
}

// allowedTransitions must return a COPY (mutation-safe)
const copy = sm.allowedTransitions('draft');
copy.push('hacked');
const fresh = sm.allowedTransitions('draft');
assert(!fresh.includes('hacked'), 'allowedTransitions returns a fresh copy (mutation-safe)');

// ============================================
// 8. nextStatus — happy-path forward
// ============================================
console.log('\n--- nextStatus ---');
// 2026-08-06 改写这一段的**测法**,不只是改数值。
//
// 原来这里逐个写死 nextStatus(selected) === 'copy_done' 之类。nextStatus 的实现
// 就是"取 allowedTransitions 的第一个",所以这些断言锁的是**数组顺序**——
// 谁为了可读性把 TRANSITIONS 里两条边换个位置,测试就红,而行为一点没变。
// 而且查过:nextStatus 在生产代码里**一个调用点都没有**(只有这份测试用它)。
// 锁一个没人用的函数的顺序细节,正是"长期红→习惯性忽略"的来源。
//
// 改成断言它的**契约**(返回第一条合法边;终态返回 null),这样契约不变就不会红。
for (const s of sm.STATES) {
  const want = sm.allowedTransitions(s)[0] ?? null;
  assert(sm.nextStatus(s) === want, `nextStatus("${s}") = 第一条合法边 (${want})`);
}
assert(sm.nextStatus('planning_done') === 'selected', 'nextStatus(planning_done) = selected');
assert(sm.nextStatus('approved') === 'published', 'nextStatus(approved) = published');
assert(sm.nextStatus('rejected') === 'copy_done', 'nextStatus(rejected) = copy_done');
assert(sm.nextStatus('published') === null, 'nextStatus(published) = null (terminal)');
assertThrows(() => sm.nextStatus('garbage'), 'nextStatus(unknown) throws');

// ============================================
// 9. Supabase REST functions — guard without env
// ============================================
console.log('\n--- supabase REST behaviour without env ---');
// Snapshot + unset env so a stray local config can't influence the test.
const savedUrl = process.env.SUPABASE_URL;
const savedKey = process.env.SUPABASE_SERVICE_KEY;
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_KEY;

assert(supabase.isConfigured() === false, 'isConfigured() === false when env missing');

(async () => {
  // 9a. Calls that need to talk to Supabase must reject when not configured.
  try {
    await supabase.getContentCalendar('00000000-0000-0000-0000-000000000000');
    fail('getContentCalendar rejects when env missing');
  } catch (err) {
    if (String(err.message).includes('not configured')) {
      pass('getContentCalendar rejects when env missing');
    } else {
      fail('getContentCalendar rejects when env missing', err);
    }
  }

  // 9b. State-machine guard runs BEFORE network. Invalid starting status should
  //     throw a transition error regardless of env.
  try {
    await supabase.createContentCalendar({ status: 'published' });
    fail('createContentCalendar rejects invalid initial status');
  } catch (err) {
    if (String(err.message).includes('Invalid transition') || String(err.message).includes('terminal')) {
      pass('createContentCalendar rejects invalid initial status (state-machine guard runs first)');
    } else {
      fail('createContentCalendar rejects invalid initial status', err);
    }
  }

  // Restore env so we don't pollute other processes in the same shell.
  if (savedUrl !== undefined) process.env.SUPABASE_URL = savedUrl;
  if (savedKey !== undefined) process.env.SUPABASE_SERVICE_KEY = savedKey;

  // ============================================
  // SUMMARY
  // ============================================
  console.log('\n========================================');
  console.log(`PASSED: ${passed}`);
  console.log(`FAILED: ${failed}`);
  console.log('========================================');
  process.exit(failed === 0 ? 0 : 1);
})();
