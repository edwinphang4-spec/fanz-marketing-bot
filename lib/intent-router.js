// ============================================
// Intent Router — Classifies user intent via LLM.
//
// Every non-command, non-intercept message passes
// through classifyIntent() before routing.
//
// Intent categories:
//   greeting/chitchat — casual conversation
//   plan_month        — wants monthly content planning
//   generate_post     — wants a single social media post
//   ask_question      — asks about products or marketing
//   unclear           — ambiguous, needs clarification
//
// Exports:
//   classifyIntent(userMessage, brandContext)
//     → { intent, params: { pillar, topic, question }, response }
// ============================================

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const MODEL = process.env.MODEL || 'gpt-4o';

/**
 * System prompt for the intent classification LLM.
 * The agent plays a professional marketing consultant for Fanz Sdn Bhd.
 */
function buildIntentSystemPrompt(brandContext) {
  return `You are a professional marketing consultant for Fanz Sdn Bhd, a Malaysian ceiling fan brand.

Personality: Professional, capable, approachable — like a trusted marketing colleague. You give marketing-savvy advice without fluff.

Language adaptation rules:
- Reply in the SAME LANGUAGE as the user: Chinese if they write in Chinese, English if they write in English.
- If the user writes in Chinese, your response MUST be in Chinese.
- If the user writes in English, your response MUST be in English.
- Generated FB/IG content stays English (but that doesn't apply here — your job is classification, not generation).

Your task: Classify the user's intent into one of these categories:

1. **greeting/chitchat** — ANY casual greeting, hello, hi, how are you, weather talk, "你好", "今天天气真好", "早上好", "在吗", "hey", "what's up". Also includes simple social chat that is NOT about Fanz products or marketing. IMPORTANT: A simple greeting like "hello" or "你好" by itself is ALWAYS greeting/chitchat, NOT unclear.

2. **plan_month** — User wants monthly content planning. E.g. "帮我规划这个月的内容", "帮我做这个月的计划", "plan my month".

3. **generate_post** — User wants a single social media post generated. E.g. "写一篇推 Smart Series", "帮我写一篇关于AURA的帖子", "generate a post about FS Series".

4. **ask_question** — User asks a question about Fanz products, marketing, pricing, features, room size, etc. E.g. "AURA适合多大的房间", "Smart Series有什么功能", "What's the warranty period".

5. **unclear** — ONLY when you genuinely cannot determine the intent. A simple greeting like "hello" is NEVER unclear — it's always greeting/chitchat.

Brand context for Fanz Sdn Bhd:
${brandContext}

Return a JSON object (NO markdown, NO code fences, just raw JSON):
{
  "intent": "greeting|chitchat|plan_month|generate_post|ask_question|unclear",
  "params": {
    "pillar": "product|case|promo|story|educational|null",
    "topic": "extracted topic or null",
    "question": "extracted question for ask_question intent"
  },
  "response": "consultant-style reply for greeting/chitchat/ask_question/unclear intents — be helpful, warm, professional. For unclear, ask a clarifying question."
}

Important rules:
- For "generate_post": extract the pillar (product/case/promo/story/educational) and topic from the user's message. If unclear on pillar, default to "product".
- For "ask_question": extract the specific question into params.question and write a brief, helpful answer in params.response. IMPORTANT: Respond in the SAME LANGUAGE as the user.
- For "greeting/chitchat": write a friendly consultant-style response. Respond in the SAME LANGUAGE as the user.
- For "plan_month": params are informational only; no response needed.
- For "unclear": ALWAYS write a clarifying question — never assume or generate blindly.
- The "response" field for plan_month and generate_post can be empty string.`;
}

/**
 * Call OpenRouter with a simple messages array.
 * Handles abort timeout and parse errors.
 */
async function callOpenRouterRaw(messages) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://fanz-marketing-bot.railway.app',
        'X-Title': 'Fanz Marketing Bot - Intent Router',
      },
      body: JSON.stringify({
        model: MODEL,
        messages: messages,
        max_tokens: 600,
        temperature: 0.2, // Low temp for consistent classification
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`OpenRouter API error ${response.status}: ${err}`);
    }

    const data = await response.json();
    return data.choices[0].message.content;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Classify user intent.
 *
 * @param {string} userMessage - The raw user text
 * @param {string} brandContext - Fanz brand/product context string
 * @returns {Promise<{intent: string, params: object, response: string}>}
 */
async function classifyIntent(userMessage, brandContext) {
  if (!userMessage || typeof userMessage !== 'string' || userMessage.trim().length === 0) {
    return {
      intent: 'unclear',
      params: { pillar: null, topic: null, question: null },
      response: 'Hi there! I\'m your Fanz marketing consultant. How can I help you today? You can ask me to plan your monthly content, write a social media post, or ask about our products.',
    };
  }

  const systemPrompt = buildIntentSystemPrompt(brandContext || 'Fanz Sdn Bhd — Malaysian ceiling fan brand with 10+ years history. Products include FS Series, Grande Series, Smart Series, AURA Series, Inno Series. All DC motor, 10-year warranty, SIRIM certified.');

  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userMessage },
  ];

  let raw;
  try {
    raw = await callOpenRouterRaw(messages);
  } catch (err) {
    console.error('Intent router LLM call failed:', err.message);
    // Graceful fallback — treat as unclear, don't crash the bot
    return {
      intent: 'unclear',
      params: { pillar: null, topic: null, question: null },
      response: 'I didn\'t quite catch that — could you clarify what you\'d like help with? I can plan your monthly content, write a social media post, or answer questions about our ceiling fans.',
    };
  }

  // Parse the JSON response
  try {
    // Strip any markdown code fences or extra whitespace
    let cleaned = raw.trim();
    // Remove ```json or ``` fences if present
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
    // Find the first { and last }
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start === -1 || end === -1) {
      throw new Error('No JSON object found in response');
    }
    cleaned = cleaned.slice(start, end + 1);

    const parsed = JSON.parse(cleaned);

    // Validate intent — handle LLM tendencies (greeting/chitchat returned as combined string)
    const validIntents = ['greeting', 'chitchat', 'greeting/chitchat', 'plan_month', 'generate_post', 'ask_question', 'unclear'];
    const rawIntent = parsed.intent || 'unclear';
    const normalizedIntent = validIntents.includes(rawIntent) ? rawIntent : 'unclear';

    // Normalize greeting/chitchat — treat them identically
    const finalIntent = (normalizedIntent === 'greeting' || normalizedIntent === 'chitchat' || normalizedIntent === 'greeting/chitchat') ? 'chitchat' : normalizedIntent;

    return {
      intent: finalIntent,
      params: {
        pillar: parsed.params && parsed.params.pillar ? parsed.params.pillar : null,
        topic: parsed.params && parsed.params.topic ? parsed.params.topic : null,
        question: parsed.params && parsed.params.question ? parsed.params.question : null,
      },
      response: parsed.response || '',
    };
  } catch (parseErr) {
    console.error('Intent router parse error:', parseErr.message, '| Raw:', raw);
    return {
      intent: 'unclear',
      params: { pillar: null, topic: null, question: null },
      response: 'I\'m not sure I understood that. Could you rephrase? I\'m here to help with content planning, social media posts, and product questions.',
    };
  }
}

module.exports = { classifyIntent };