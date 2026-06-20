#!/usr/bin/env node
'use strict';

// ============================================
// Cleanup verification tests
// ============================================

const fs = require('fs');
const path = require('path');

// Ensure we can require the main module
process.env.SKIP_BOT_INIT = '1';
process.env.TELEGRAM_TOKEN = 'test:token';
process.env.OPENROUTER_API_KEY = 'test-key';

const DIR = __dirname;
let failures = 0;

function assert(condition, message) {
  if (!condition) {
    console.error(`FAIL: ${message}`);
    failures++;
  } else {
    console.log(`PASS: ${message}`);
  }
}

function assertIncludes(source, needle, message) {
  assert(source.includes(needle), `${message} (expected to include "${needle}")`);
}

function assertNotIncludes(source, needle, message) {
  assert(!source.includes(needle), `${message} (expected NOT to include "${needle}")`);
}

// ============================================
// Test 1: callOpenRouter has AbortController + signal
// ============================================
{
  const indexJs = fs.readFileSync(path.join(DIR, 'index.js'), 'utf8');
  assertIncludes(
    indexJs,
    'signal: controller.signal',
    '1. callOpenRouter uses signal: controller.signal'
  );
  assertIncludes(
    indexJs,
    'new AbortController()',
    '1b. callOpenRouter uses AbortController'
  );
  assertIncludes(
    indexJs,
    '60_000',
    '1c. callOpenRouter has 60s timeout'
  );
}

// ============================================
// Test 2: No user-facing err.message in catch blocks
// ============================================
{
  const indexJs = fs.readFileSync(path.join(DIR, 'index.js'), 'utf8');
  // These patterns should NOT appear in user-facing messages
  const forbiddenPatterns = [
    '❌ Error: ${err.message}',
    '❌ Error generating content: ${err.message}',
    '❌ Could not save revision notes: ${err.message}',
  ];
  for (const pattern of forbiddenPatterns) {
    assertNotIncludes(
      indexJs,
      pattern,
      `2. No bare err.message in user-facing strings (checked: "${pattern}")`
    );
  }
  // Verify userMessage is called in catch blocks
  assertIncludes(
    indexJs,
    'userMessage(err,',
    '2b. catch blocks use userMessage helper'
  );
  // Verify userMessage function exists
  assertIncludes(
    indexJs,
    'function userMessage(err, fallback)',
    '2c. userMessage function is defined'
  );
}

// ============================================
// Test 3: sendWithSplit exports both functions
// ============================================
{
  const indexJs = fs.readFileSync(path.join(DIR, 'index.js'), 'utf8');
  assertIncludes(
    indexJs,
    'async function sendWithSplit(chatId, text, options)',
    '3a. sendWithSplit function defined'
  );
  assertIncludes(
    indexJs,
    'async function sendWithSplitRaw(chatId, text, options)',
    '3b. sendWithSplitRaw function defined'
  );
  assertIncludes(
    indexJs,
    'sendWithSplitRaw,',
    '3c. sendWithSplitRaw exported'
  );
  assertIncludes(
    indexJs,
    'sendWithSplit,',
    '3d. sendWithSplit exported'
  );
  // Verify markdown fallback logic
  assertIncludes(
    indexJs,
    'Markdown send failed, falling back to plain text:',
    '3e. sendWithSplit has markdown fallback'
  );
}

// ============================================
// Test 4: StringRegExp.includes returns false for non-string
// ============================================
{
  const copywriting = require(path.join(DIR, 'lib', 'copywriting.js'));
  const [firstPattern] = copywriting.FORBIDDEN_PLACEHOLDER_PATTERNS;
  assert(
    firstPattern.includes(undefined) === false,
    '4a. StringRegExp.includes(undefined) returns false'
  );
  assert(
    firstPattern.includes(null) === false,
    '4b. StringRegExp.includes(null) returns false'
  );
  assert(
    firstPattern.includes(123) === false,
    '4c. StringRegExp.includes(123) returns false'
  );
  assert(
    firstPattern.includes('{{') === true,
    '4d. StringRegExp.includes("{{") still returns true for valid string'
  );
  // Verify source code has the guard
  const copyJs = fs.readFileSync(path.join(DIR, 'lib', 'copywriting.js'), 'utf8');
  assertIncludes(
    copyJs,
    "typeof needle === 'string'",
    '4e. StringRegExp.includes guards with typeof needle === "string"'
  );
}

// ============================================
// Test 5: supabase lib has VALID_PILLARS + Math.min
// ============================================
{
  const supabaseJs = fs.readFileSync(path.join(DIR, 'lib', 'supabase.js'), 'utf8');
  assertIncludes(
    supabaseJs,
    'VALID_PILLARS',
    '5a. supabase.js has VALID_PILLARS constant'
  );
  assertIncludes(
    supabaseJs,
    "'product', 'case', 'promo', 'story'",
    '5b. VALID_PILLARS contains product, case, promo, story'
  );
  assertIncludes(
    supabaseJs,
    'Math.min(filter.limit, 200)',
    '5c. limit capped at 200 with Math.min'
  );
  assertIncludes(
    supabaseJs,
    'if (!VALID_PILLARS.includes(filter.pillar))',
    '5d. pillar validation uses VALID_PILLARS.includes'
  );
  
  // Verify module exports it
  const supabase = require(path.join(DIR, 'lib', 'supabase.js'));
  assert(
    typeof supabase.listContentCalendar === 'function',
    '5e. listContentCalendar is exported'
  );
}

// ============================================
// Summary
// ============================================
console.log(`\n${failures === 0 ? 'ALL TESTS PASSED' : `${failures} TEST(S) FAILED`}`);
process.exit(failures > 0 ? 1 : 0);