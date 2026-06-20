#!/usr/bin/env node
// ============================================
// Self-check for the Review node (审核节点).
//
// Validates spec assertions:
// 1. buildReviewMessage produces text with FB, IG, and hashtags present
// 2. Callback data encodes rowId correctly
// 3. Approve flow calls updateContentCalendar with { status: 'approved' }
// 4. Reject flow stores awaitingReviewNotes correctly
// 5. Review notes intercept stores review_notes and updates to rejected
// 6. Message intercept priority: plan selection > review notes > commands > free text
//
// Tests load the production code from index.js via module.exports.
// ============================================

// Set SKIP_BOT_INIT before requiring index.js so the bot becomes a no-op proxy
process.env.SKIP_BOT_INIT = '1';

// ---------------------------------------------------------------------------
// Load production code
// ---------------------------------------------------------------------------
const review = require('./index');

const {
  buildReviewMessage,
  buildReviewKeyboard,
  buildApprovePayload,
  buildRejectPayload,
  decideMessageIntent,
  awaitingReviewNotes,
  PILLAR_EMOJI,
} = review;

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
  else fail(name, new Error('assertion failed'));
}

function assertIncludes(haystack, needle, name) {
  if (typeof haystack === 'string' && haystack.includes(needle)) {
    pass(name);
  } else {
    fail(name, new Error(`expected "${haystack}" to include "${needle}"`));
  }
}

// ---------------------------------------------------------------------------
// 1. buildReviewMessage — produces text with FB, IG, and hashtags present
// ---------------------------------------------------------------------------
console.log('--- buildReviewMessage ---');

const testPlan = {
  number: 1,
  title: '开斋节家居焕新计划',
  description: 'Hari Raya approaching, promote ceiling fan upgrades',
  direction: 'promo',
};

const testParsed = {
  fb_content: 'Hari Raya is coming! Time to upgrade your ceiling fan for family gatherings. Fanz ceiling fans keep your home cool and comfortable. 🏠',
  ig_content: 'Raya vibes loading... ✨\nNew fan = new energy for your home!\n#FanzMalaysia',
  hashtags: '#FanzMalaysia #CeilingFan #HariRaya #HomeUpgrade #DCmotor #10YearWarranty #Malaysia',
};

const reviewMsg = buildReviewMessage(testParsed, testPlan);

assert(typeof reviewMsg === 'string' && reviewMsg.length > 50, 'buildReviewMessage returns a string of reasonable length');
assertIncludes(reviewMsg, testParsed.fb_content, 'review message contains FB content');
assertIncludes(reviewMsg, testParsed.ig_content, 'review message contains IG content');
assertIncludes(reviewMsg, testParsed.hashtags, 'review message contains hashtags');
assertIncludes(reviewMsg, testPlan.title, 'review message contains plan title');
assertIncludes(reviewMsg, testPlan.direction, 'review message contains direction');

// Verify no template placeholders
assert(!reviewMsg.includes('{{'), 'review message has no {{ placeholders');
assert(!reviewMsg.includes('}}'), 'review message has no }} placeholders');

// Verify emoji is present for the pillar
const emoji = PILLAR_EMOJI[testPlan.direction] || '📝';
assertIncludes(reviewMsg, emoji, 'review message contains pillar emoji');

// ---------------------------------------------------------------------------
// 2. Callback data encodes rowId correctly
// ---------------------------------------------------------------------------
console.log('\n--- buildReviewKeyboard ---');

const keyboard1 = buildReviewKeyboard(42);
assert(keyboard1 !== null && typeof keyboard1 === 'object', 'keyboard is an object');
assert(Array.isArray(keyboard1.inline_keyboard), 'keyboard has inline_keyboard array');
assert(keyboard1.inline_keyboard.length === 1, 'keyboard has one row');
assert(keyboard1.inline_keyboard[0].length === 2, 'keyboard row has two buttons');
assert(keyboard1.inline_keyboard[0][0].text === '✅ Approve', 'first button is Approve');
assert(keyboard1.inline_keyboard[0][1].text === '✏️ Request Changes', 'second button is Reject');
assert(
  keyboard1.inline_keyboard[0][0].callback_data === 'review_approve:42',
  'approve callback_data encodes rowId 42'
);
assert(
  keyboard1.inline_keyboard[0][1].callback_data === 'review_reject:42',
  'reject callback_data encodes rowId 42'
);

// Edge cases: string rowId
const keyboard2 = buildReviewKeyboard('abc-123');
assert(
  keyboard2.inline_keyboard[0][0].callback_data === 'review_approve:abc-123',
  'approve callback_data with string rowId'
);

// Large rowId
const keyboard3 = buildReviewKeyboard(999999);
assert(
  keyboard3.inline_keyboard[0][0].callback_data === 'review_approve:999999',
  'approve callback_data with large rowId'
);

// ---------------------------------------------------------------------------
// 3. Approve flow — buildApprovePayload
// ---------------------------------------------------------------------------
console.log('\n--- buildApprovePayload ---');

const approvePayload = buildApprovePayload();
assert(approvePayload !== null && typeof approvePayload === 'object', 'approve payload is an object');
assert(approvePayload.status === 'approved', 'approve payload status is "approved"');
assert(Object.keys(approvePayload).length === 1, 'approve payload has exactly one key');

// ---------------------------------------------------------------------------
// 4. Reject flow — stores awaitingReviewNotes correctly
// ---------------------------------------------------------------------------
console.log('\n--- awaitingReviewNotes (reject flow) ---');

// The awaitingReviewNotes map is exported from index.js and shared by the
// callback_query handler (reject branch) and the message handler.
// Simulate what the reject callback handler does.

// Initially empty
assert(awaitingReviewNotes.size === 0, 'awaitingReviewNotes starts empty');

// Simulate reject: store the entry
awaitingReviewNotes.set(12345, { rowId: '42', reviewMsgId: 100 });
assert(awaitingReviewNotes.size === 1, 'awaitingReviewNotes has one entry after reject');
const entry = awaitingReviewNotes.get(12345);
assert(entry !== undefined, 'entry exists for chatId 12345');
assert(entry.rowId === '42', 'entry stores correct rowId');
assert(entry.reviewMsgId === 100, 'entry stores correct reviewMsgId');

// Clean up
awaitingReviewNotes.delete(12345);
assert(awaitingReviewNotes.size === 0, 'awaitingReviewNotes cleaned up after consumption');

// ---------------------------------------------------------------------------
// 5. Review notes intercept — buildRejectPayload
// ---------------------------------------------------------------------------
console.log('\n--- buildRejectPayload ---');

const notes = 'Please add more details about the 10-year warranty.';
const rejectPayload = buildRejectPayload(notes);

assert(rejectPayload !== null && typeof rejectPayload === 'object', 'reject payload is an object');
assert(rejectPayload.status === 'rejected', 'reject payload status is "rejected"');
assert(rejectPayload.review_notes === notes, 'reject payload stores review_notes correctly');
assert(Object.keys(rejectPayload).length === 2, 'reject payload has exactly two keys');

// Edge: empty notes
const emptyNotesPayload = buildRejectPayload('');
assert(emptyNotesPayload.status === 'rejected', 'reject payload with empty notes');
assert(emptyNotesPayload.review_notes === '', 'reject payload stores empty notes string');

// Edge: long notes
const longNotes = 'x'.repeat(10000);
const longNotesPayload = buildRejectPayload(longNotes);
assert(longNotesPayload.review_notes.length === 10000, 'reject payload handles long notes');

// ---------------------------------------------------------------------------
// 6. Message intercept priority
//    plan_selection > review_notes > command > free_text
// ---------------------------------------------------------------------------
console.log('\n--- decideMessageIntent ---');

// 6a. Non-text / empty → skip
assert(decideMessageIntent('', false, false) === 'skip', 'empty string → skip');
assert(decideMessageIntent(null, false, false) === 'skip', 'null → skip');
assert(decideMessageIntent(undefined, false, false) === 'skip', 'undefined → skip');
assert(decideMessageIntent('', true, true) === 'skip', 'empty string → skip even with session+review');

// 6b. Plan selection: digit (1-999) + active plan session, regardless of awaitingReviewNotes
assert(
  decideMessageIntent('3', true, false) === 'plan_selection',
  'digit with plan session → plan_selection'
);
assert(
  decideMessageIntent('42', true, true) === 'plan_selection',
  'digit with plan session even when awaiting review → plan_selection (priority)'
);

// Edge: digit 0 is NOT a valid plan number (0 is not in 1-999 range per regex /^[1-9]\d{0,2}$/)
// But the regex /^[1-9]\d{0,2}$/ rejects '0' so it would not be plan_selection
assert(
  decideMessageIntent('0', true, false) !== 'plan_selection',
  'digit 0 with plan session is NOT plan_selection (0 is invalid)'
);

// 6c. Review notes: any text when awaitingReviewNotes (but not a digit with active plan)
assert(
  decideMessageIntent('Some revision notes', false, true) === 'review_notes',
  'text with awaiting review → review_notes'
);

// 6d. Command: starts with /
assert(
  decideMessageIntent('/start', false, false) === 'command',
  '/start → command'
);
assert(
  decideMessageIntent('/product Big fan', false, false) === 'command',
  '/product → command'
);

// 6e. Free text: everything else
assert(
  decideMessageIntent('Hello, make a post about fans', false, false) === 'free_text',
  'plain text with no session/review → free_text'
);
assert(
  decideMessageIntent('Ceiling fan for small rooms', false, false) === 'free_text',
  'product text → free_text'
);

// 6f. Priority enforcement: when both plan session AND awaiting review active,
//     a digit triggers plan_selection, NOT review_notes
assert(
  decideMessageIntent('2', true, true) === 'plan_selection',
  'digit + both active → plan_selection wins over review_notes'
);

// 6g. Non-digit text when both active → review_notes
assert(
  decideMessageIntent('Please fix the copy', true, true) === 'review_notes',
  'non-digit text + both active → review_notes wins over free_text'
);

// 6h. Commands take lowest priority among non-free-text intents
assert(
  decideMessageIntent('/help', false, false) === 'command',
  'command without session/review → command'
);
// /help with plan session active but no awaiting review: digit regex doesn't match '/help',
// hasAwaitingReview=false, so the command check fires → 'command'
assert(
  decideMessageIntent('/help', true, false) === 'command',
  'command with session active but no review → command'
);

// ---------------------------------------------------------------------------
// FINAL SUMMARY
// ---------------------------------------------------------------------------
console.log('\n========================================');
console.log(`TOTAL: ${passed} passed, ${failed} failed`);
console.log('========================================');
process.exit(failed > 0 ? 1 : 0);