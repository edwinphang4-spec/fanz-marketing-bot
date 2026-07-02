# Telegram Bot API Limits — Fanz Marketing Bot Reference

> This file documents all Telegram Bot API limits relevant to the project.
> Reference this checklist whenever building new UI features with inline keyboards,
> sending messages, or constructing callback_data.

---

## 1. callback_data — 64 bytes per button

| Limit | Exact | Behavior When Exceeded |
|-------|-------|------------------------|
| **callback_data** | **64 bytes** (UTF-8) | `error_code: 400, BUTTON_DATA_INVALID` — silent failure in `sendMessage()` / `sendPhoto()` |

### How the project handles it

A centralized `cb()` function is used for ALL callback_data construction:

```js
function cb(prefix, ...parts) {
  const data = parts.length > 0 ? `${prefix}:${parts.join(':')}` : prefix;
  const bytes = Buffer.byteLength(data, 'utf8');
  if (bytes > 60) {
    throw new Error(
      `callback_data overflow: "${data}" = ${bytes} bytes ` +
      `(Telegram limit 64, margin kept to 60). ` +
      `Shorten prefix or use a Map lookup instead.`
    );
  }
  return data;
}
```

**Rules:**
- Assert at **60 bytes** (4 bytes margin under limit)
- Use short prefixes (2-4 chars preferred): `me`, `mr`, `mrp`, `ma`, `ba`, `br`, `bn`, `baa`, `brg`
- For two-UUID patterns (action + two IDs): use a Map lookup (`monthActionMap`, `batchActionMap`) to store the second ID
- Never concatenate two UUIDs directly in callback_data — that's ~90 bytes, always over limit
- All 33 callback_data sites migrated at commit `8b1e10b`

### Byte reference (36-byte UUID)

| Pattern | Bytes | Status |
|---------|-------|--------|
| `cb('me', uuid)` | 39 | Safe |
| `cb('ba', uuid)` | 39 | Safe |
| `cb('brg', uuid)` | 40 | Safe |
| `cb('image_retry_go', uuid, 3)` | 53 | Safe |
| `cb('image_change_scene', uuid, 3)` | 57 | Margin |
| `cb('image_change_product', uuid, 10)` | 60 | At limit |
| `cb('image_change_product', uuid, 100)` | 61 | **cb() throws** |
| `'old_action:' + uuid + ':' + uuid` | ~90 | **cb() throws** |

---

## 2. Message text — 4096 characters

| Limit | Exact | Behavior When Exceeded |
|-------|-------|------------------------|
| **Message text** | **4096 chars** | Message rejected with 400 error |

### Mitigation

Messages over ~3500 chars must be split using `sendWithSplit` pattern:

```js
async function sendWithSplitRaw(chatId, text, options, maxLen = 4000) {
  if (Buffer.byteLength(text, 'utf8') > maxLen) {
    // Split into chunks
    const chunks = splitIntoChunks(text, maxLen);
    for (const chunk of chunks) {
      await bot.sendMessage(chatId, chunk, options);
    }
    return;
  }
  await bot.sendMessage(chatId, text, options);
}
```

---

## 3. Photo caption — 1024 characters

| Limit | Exact | Behavior When Exceeded |
|-------|-------|------------------------|
| **Caption** (sendPhoto) | **1024 chars** | Caption truncated silently |

### Mitigation

Keep captions under 1000 chars. For longer content, send a text message before/after the photo.

---

## 4. Inline keyboard layout

| Limit | Notes |
|-------|-------|
| **Buttons per row** | Up to 8 |
| **Rows per keyboard** | No hard limit, but total JSON size (~10KB) restricts it |
| **Total buttons** | No hard limit; practically ~100 before JSON size limit |
| **Markup JSON size** | ~10KB (estimated; Telegram doesn't publish exact limit) |

### Project patterns

- Monthly review uses up to 13 rows (one per post)
- Batch review uses per-plan rows
- M-5 image review uses 3 rows × 2 buttons = 6 buttons

---

## 5. answerCallbackQuery — 200 byte text limit

| Limit | Exact |
|-------|-------|
| **Toast text** | **200 bytes** |

Flash messages shown when button pressed must be under 200 bytes.
Longer text is truncated.

---

## 6. Rate limits

| Context | Limit |
|---------|-------|
| Messages per second per chat | ~30 |
| Messages per minute per group | ~20 (varies) |
| Callback query responses | Should respond within ~2s; after 30s the loading indicator disappears |

### Mitigation

- No rate-limit throttling currently implemented
- Batch operations (14 posts at once) are safe at ~30 msg/s
- If Telegram starts returning `retry_after`, implement backoff

---

## 7. File/media size limits

| Type | Max Size |
|------|----------|
| Photo | 10 MB |
| Document | 50 MB |
| Video | 50 MB |
| Animation (GIF) | 50 MB |
| Audio | 50 MB |
| Voice | 20 MB |

### Project usage

- Scene images generated via GPT Image 2 are typically <5 MB (within photo limit)
- `bot.sendPhoto()` used for image review cards

---

## 8. Button text length

| Limit | Notes |
|-------|-------|
| **Button label text** | No hard limit documented by Telegram |

### Project conventions

- Keep button text under 30-40 chars for readability
- "Change Product" / "Upload Own" etc. are fine at ~15-20 chars
- Dynamic text like `"✏️ Smart Series Product Showcase..."` is truncated to 30 chars via `shortTopic`

---

## Quick reference for new button creation

When adding a new inline keyboard button:

1. Choose a **2-4 char prefix** for callback_data
2. Use `cb('prefix', id)` — never raw template literals
3. If you need TWO IDs in callback_data, create a Map and store one ID
4. Verify: `Buffer.byteLength(cb('your_prefix', uuid), 'utf8')` ≤ 60
5. Verify message ≤ 4096 chars (split if needed)
