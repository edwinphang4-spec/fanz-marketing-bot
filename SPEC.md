# [4] 审核节点 Review — Telegram 入口

## 输入
- content_calendar 中 status='copy_done' 的行（含 fb_content, ig_content, hashtags）
- 当前 copywriting pipeline 在 index.js 中的位置（lines 459-486）

## 输出

### 1. 审核卡（Review Card）
copywriting pipeline 写入成功（status='copy_done'）后，紧接着：
- 更新 status 为 'pending_review'（已有 transition: copy_done → pending_review）
- 用 `bot.sendMessage` 发送审核卡消息，含：
  - 标题 + pillar direction emoji
  - FB 内容
  - IG 内容
  - Hashtags
  - 底部 inline keyboard：[✅ Approve] [✏️ Request Changes]

### 2. Approve 处理（callback_query data: `review_approve:{rowId}`）
- db: updateContentCalendar(rowId, { status: 'approved' })
- answerCallbackQuery("Approved ✓")
- editMessageText 追加 "✅ Approved" 标记
- 移除 inline keyboard（设为空数组）

### 3. Reject 处理（callback_query data: `review_reject:{rowId}`）
- answerCallbackQuery("Please send revision notes")
- editMessageText 追加 "✏️ Please send your revision notes below:"
- 移除 inline keyboard
- 存 `awaitingReviewNotes`（Map<chatId, { rowId, reviewMsgId }>）
- 下一次用户文本消息被拦截为该行的 revision note
- db: updateContentCalendar(rowId, { status: 'rejected', review_notes })
- 发确认消息 "Revision notes saved. The content has been moved back for revision."
- 清理 `awaitingReviewNotes`

### 4. 消息拦截优先级
message handler 中：
1. 非文本消息 → return（skip）
2. 数字（1-999）→ 仅当 getPlanSession 活跃时走 plan selection
3. 文本 → 仅当 awaitingReviewNotes 有该 chatId 时走 review notes
4. 以 / 开头 → 跳过（command）
5. 其它 → 走自由文本生成

### 5. 测试
`test-review.js` + `test-review.sh`
断言：
- 审核卡构建不含占位符
- callback_data 正确编码 rowId
- updateContentCalendar 调用时状态过渡正确
- 打回笔记正确存储
- 批准后状态变为 approved
- 消息拦截优先级符合上述顺序
- 集成：真实 DB 写入 pending_review 后 approve/reject

## 不变更
- 不修改 state-machine.js（已有 copy_done→pending_review→approved/rejected）
- 不修改 supabase.js 基础 CRUD
- 不修改 copywriting.js
- 不修改 planning.js
- 不修改原有的 generateContent 输出流程（用户仍收到 AI 原始输出 + 额外审核卡）