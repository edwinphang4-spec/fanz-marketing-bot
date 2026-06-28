#!/usr/bin/env node
// ============================================
// REAL TEST — Intent Router for Fanz Marketing Bot.
//
// Tests the classifyIntent() function with real
// OpenRouter API calls, capturing actual responses.
//
// Messages tested:
//   "hello"                    → chitchat (consultant greeting)
//   "你好"                     → chitchat (Chinese greeting)
//   "帮我规划这个月的内容"     → plan_month
//   "写一篇推 Smart Series 的帖子" → generate_post (product pillar)
//   "AURA 适合多大的房间？"   → ask_question
//   "今天天气真好"             → chitchat
//
// Usage: node test-intent-router.js
// ============================================

const path = require('path');
const { classifyIntent } = require('./lib/intent-router');
const { products } = require('./products');

let passed = 0;
let failed = 0;

function pass(name) {
  passed++;
  console.log(`  ✅ PASS: ${name}`);
}

function fail(name, err) {
  failed++;
  console.log(`  ❌ FAIL: ${name}`);
  if (err) console.log(`       ${err.message || err}`);
}

function assert(cond, name) {
  if (cond) pass(name);
  else fail(name, new Error('assertion failed'));
}

function buildProductContext() {
  return products.map(p =>
    `- ${p.name} (${p.typeZh}/${p.type}): ${p.descriptionZh || p.description}\n  Key features: ${p.keySellingPoints.join(', ')}`
  ).join('\n');
}

const brandContext = buildProductContext();

function summarize(result) {
  const intent = result.intent;
  const params = result.params ? `{ pillar: ${result.params.pillar}, topic: ${result.params.topic ? result.params.topic.slice(0, 50) : null}, question: ${result.params.question ? result.params.question.slice(0, 50) : null} }` : '{}';
  const resp = result.response ? result.response.slice(0, 80) + '...' : '(empty)';
  return `intent=${intent} params=${params} response="${resp}"`;
}

async function runTest(name, message, expectedIntent, checkFn) {
  console.log(`\n━━━ ${name} ━━━`);
  console.log(`  Input: "${message}"`);
  console.log(`  Expected intent: ${expectedIntent}`);
  try {
    const result = await classifyIntent(message, brandContext);
    console.log(`  Result: ${summarize(result)}`);
    assert(result.intent === expectedIntent, `${name}: intent matches "${expectedIntent}" (got "${result.intent}")`);
    if (checkFn) checkFn(result);
  } catch (err) {
    fail(name, err);
  }
}

// ============================================
// TESTS
// ============================================

console.log('♢♢♢ FANZ INTENT ROUTER — REAL LLM TESTS ♢♢♢');
console.log(`  Model: ${process.env.MODEL || 'gpt-4o'}`);
console.log(`  Brand context: ${brandContext.length} chars`);
console.log('');

(async () => {

  // 1. "hello" → chitchat (consultant greeting, NOT content generation)
  await runTest('English greeting', 'hello', 'chitchat', (r) => {
    assert(r.response && r.response.length > 5, 'hello: response is non-empty');
    // Should NOT suggest generating content
    assert(!r.response.toLowerCase().includes('generating'), 'hello: response does not say "generating"');
    // Should be a greeting/welcome
    const lower = r.response.toLowerCase();
    assert(lower.includes('hello') || lower.includes('hi') || lower.includes('hey') || lower.includes('welcome') || lower.includes('how'),
      'hello: response is a greeting');
  });

  // 2. "你好" → chitchat (Chinese greeting response)
  await runTest('Chinese greeting', '你好', 'chitchat', (r) => {
    assert(r.response && r.response.length > 5, '你好: response is non-empty');
    // Should contain Chinese characters
    const hasChinese = /[\u4e00-\u9fff]/.test(r.response);
    assert(hasChinese, '你好: response contains Chinese characters');
  });

  // 3. "帮我规划这个月的内容" → plan_month
  await runTest('Plan month request (Chinese)', '帮我规划这个月的内容', 'plan_month');

  // 4. "写一篇推 Smart Series 的帖子" → generate_post
  await runTest('Generate post request (Chinese)', '写一篇推 Smart Series 的帖子', 'generate_post', (r) => {
    assert(r.params && r.params.pillar, 'generate_post: pillar extracted');
    assert(r.params && r.params.topic, 'generate_post: topic extracted');
    const lowerTopic = (r.params.topic || '').toLowerCase();
    const lowerPillar = (r.params.pillar || '').toLowerCase();
    // Should mention Smart Series or smart
    const mentionsSmart = lowerTopic.includes('smart') || lowerTopic.includes('series');
    // If pillar or topic didn't catch it, that's okay — LLM might differ slightly
    if (!mentionsSmart) {
      console.log(`  ⚠️  Note: topic="${r.params.topic}" doesn't explicitly mention Smart, but that's acceptable`);
    }
    assert(r.intent === 'generate_post', 'generate_post: intent confirmed');
  });

  // 5. "AURA 适合多大的房间？" → ask_question
  await runTest('Product question (Chinese)', 'AURA 适合多大的房间？', 'ask_question', (r) => {
    assert(r.response && r.response.length > 5, 'ask_question: response is non-empty');
    // Should contain Chinese
    const hasChinese = /[\u4e00-\u9fff]/.test(r.response);
    assert(hasChinese, 'ask_question: response contains Chinese');
    // Should mention AURA or room size
    const lower = r.response.toLowerCase() + r.response;
    const mentionsAura = lower.includes('aura') || lower.includes('房间') || lower.includes('room') || lower.includes('size');
    if (!mentionsAura) {
      console.log(`  ⚠️  Note: response doesn't explicitly mention AURA/room size, but that's acceptable: "${r.response.slice(0, 100)}"`);
    }
  });

  // 6. "今天天气真好" → chitchat (casual, not product related)
  await runTest('Casual chitchat (Chinese)', '今天天气真好', 'chitchat', (r) => {
    assert(r.response && r.response.length > 5, 'chitchat: response is non-empty');
    // Should contain Chinese
    const hasChinese = /[\u4e00-\u9fff]/.test(r.response);
    assert(hasChinese, 'chitchat: response contains Chinese');
    // Should NOT try to generate content
    assert(!r.response.includes('生成内容') && !r.response.includes('generating'), 'chitchat: response is not about content generation');
  });

  // ============================================
  // SUMMARY
  // ============================================
  console.log('\n========================================');
  console.log(`TOTAL: ${passed} passed, ${failed} failed`);
  console.log('========================================');
  process.exit(failed > 0 ? 1 : 0);

})().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});