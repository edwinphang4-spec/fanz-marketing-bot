# 待办集中清理 — 规格

## A. 数据一致性/并发

### A1. M1 双击并发 → 立即清 session
**文件**: `index.js` line 497-508
**问题**: 用户快速两次发送同一数字，第一次还在生成内容，第二次进来时 session 还在，走两次完整流程。
**修复**: `validateSelection` 成功后立即清 session（`clearPlanSession(chatId)`），不要等到内容生成完成后再清。这样第二次数字进来 session 已空，不会触发 plan selection。

具体位置：在 `const { number: num, plan } = validation;` 之后添加：
```javascript
// Prevent double-click: clear session immediately after extracting plan
clearPlanSession(chatId);
```

## B. 健壮性/超时

### B1. generateContent / callOpenRouter 加超时
**文件**: `index.js` line 227-251
**问题**: `callOpenRouter` 用裸 `fetch()`，无超时。OpenRouter 或上游模型可能 hang 住。
**修复**: 添加 60s AbortController 超时：
```javascript
async function callOpenRouter(messages) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);
  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      ...,
      signal: controller.signal,
    });
    // ... rest unchanged
  } finally {
    clearTimeout(timeout);
  }
}
```

## C. 错误处理

### C1. err.message 暴露给用户 → generic 包装
**文件**: `index.js`
**问题**: 多处 `❌ Error: ${err.message}` 直接暴露给用户，可能泄露内部信息。

**修复**: 添加一个 helper，在所有用户可见的 catch 块中使用：
```javascript
function userMessage(err, fallback) {
  console.error('Operation failed:', err);
  return `❌ ${fallback || 'An unexpected error occurred. Please try again.'}`;
}
```

替换的 catch 块（需要搜索这些模式，逐一替换）：
```
Line 417: err.message → 'Error generating plan. Please try /plan again.'
Line 431: err.message → 'Error generating content. Please try again.'
Line 445: err.message → 'Error generating case study. Please try again.'
Line 459: err.message → 'Error generating promotion content. Please try again.'
Line 474: err.message → 'Error generating brand story. Please try again.'
Line 506: err.message → 'Failed to generate content. Please try again.'
Line 649: err.message → 'Failed to save revision notes. Please try again.'
```

### C2. Markdown parse_mode 非法格式炸 → fallback 到纯文本
**文件**: `index.js` line ~788
**问题**: `sendWithSplit(chatId, content, { parse_mode: 'Markdown' })` — 当 LLM 输出的文本包含 Telegram 不支持的 Markdown 格式时（如未闭合的 `*`、嵌套错误等），bot.sendMessage 抛异常，消息无法发送。

**修复**: 修改 `sendWithSplit`（或加新 helper `sendSafe`），先用 Markdown 发送，失败后用纯文本重发：
```javascript
async function sendWithSplit(chatId, text, options) {
  const hasParseMode = options && options.parse_mode;
  // First try with parse_mode
  if (hasParseMode) {
    try {
      return await sendWithSplitRaw(chatId, text, options);
    } catch (err) {
      console.warn('Markdown send failed, falling back to plain text:', err.message);
      // Fall back to plain text
      return await sendWithSplitRaw(chatId, text);
    }
  }
  return await sendWithSplitRaw(chatId, text, options);
}

async function sendWithSplitRaw(chatId, text, options) {
  if (text.length <= 4096) {
    await bot.sendMessage(chatId, text, options);
  } else {
    const chunks = splitMessage(text);
    for (const chunk of chunks) {
      await bot.sendMessage(chatId, chunk, options);
    }
  }
}
```

This way the message always goes through — if Markdown fails, the user still gets the raw content.

## D. 输入校验

### D1. listContentCalendar pillar 白名单
**文件**: `lib/supabase.js` line 108
**问题**: `filter.pillar` 直接拼进查询，未校验。
**修复**: 添加白名单校验（与 state-machine 的 pillar list 保持一致）：
```javascript
const VALID_PILLARS = ['product', 'case', 'promo', 'story'];
if (filter.pillar) {
  if (!VALID_PILLARS.includes(filter.pillar)) {
    throw new Error(`listContentCalendar: invalid pillar "${filter.pillar}"`);
  }
  params.set('pillar', `eq.${filter.pillar}`);
}
```

### D2. listContentCalendar limit 硬上限
**文件**: `lib/supabase.js` line 111
**问题**: `filter.limit` 无上限，可能请求数万行。
**修复**: 
```javascript
if (filter.limit) params.set('limit', String(Math.min(filter.limit, 200)));
```

Also add to listContentCalendar doc that limit defaults to no-limit (all rows) but is capped at 200.

### D3. StringRegExp.includes 非 string 防碎
**文件**: `lib/copywriting.js` line 17-19
**问题**: `includes(needle)` 直接调用 `this.source.includes(needle)`，needle 非 string 时行为未定义。
**修复**: 
```javascript
includes(needle) {
  return typeof needle === 'string' && this.source.includes(needle);
}
```

## E. 小优化

### E1. Pending API 泄露 Supabase error 文本
**文件**: `/root/fanz-bots/fanz-dashboard/app/api/marketing/pending/route.js` line 15
**修复**: 将原始 error 记日志，返回通用消息：
```javascript
if (error) {
  console.error('Failed to fetch pending reviews:', error.message);
  return NextResponse.json({ error: 'Failed to fetch pending reviews.' }, { status: 500 });
}
```

## 测试

创建 `test-cleanup.js` + `test-cleanup.sh` 验证：
1. callOpenRouter 超时被配置（通过检查函数源码中是否包含 `signal:` 或 `AbortController`）
2. userMessage 不泄露原始错误文本（检查 index.js 中是否还有 `err.message` 出现在 catch 的消息字符串中）
3. sendWithSplit 回退到纯文本（检查 index.js 中 sendWithSplit 实现是否正确）
4. StringRegExp.includes 非 string 防护（检查 copywriting.js）
5. listContentCalendar pillar 白名单 + limit 硬上限（检查 supabase.js）

## 文件清单
修改的文件：
- `/root/fanz-bots/marketing-bot/index.js`
- `/root/fanz-bots/marketing-bot/lib/supabase.js`
- `/root/fanz-bots/marketing-bot/lib/copywriting.js`
- `/root/fanz-bots/fanz-dashboard/app/api/marketing/pending/route.js`
- 新文件: `/root/fanz-bots/marketing-bot/test-cleanup.js`
- 新文件: `/root/fanz-bots/marketing-bot/test-cleanup.sh`