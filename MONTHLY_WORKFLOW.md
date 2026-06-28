# Fanz Marketing — 月度内容工作流设计规格 (MONTHLY_WORKFLOW.md)

> 升级版工作流：从"单篇生成"升级为"月度批量规划 + 排期"。
> 配合现有的 MARKETING_WORKFLOW.md（单篇底层）和 IMAGERY_WORKFLOW.md（配图）。
> 底层文案/配图/审核全部复用，本文件定义上层的月度规划 + 批量生产 + 排期 + 提醒。

---

## 设计目标

让老板娘一句"帮我 plan 下个月的 content"，系统就：
1. 分析当月节庆/季节/产品轮换
2. 产出整月内容日历（12 篇常规 + 节庆帖）
3. 老板批整月方向
4. 批量生成文案（全部先生成，批量审）
5. 逐篇生成配图（一篇篇生成，逐篇 QC，多出口防卡死）
6. 自动排期（按节庆/最佳时间排日期）
7. cron 每天检查 → 到期提醒老板手动发（Meta 自动发布留阶段二）

---

## 内容策略（Marketing Strategist 定）

### 每月配比（12 篇常规 + 节庆按需）

| Pillar | 数量/月 | 作用 |
|--------|--------|------|
| product | 4 | 主力，轮换不同系列（FS/Grande/Smart/AURA/Inno） |
| case | 3 | 建立信任，生活方式感，转化导向 |
| educational | 2 | 涨粉利器（实用指南，被收藏分享） |
| story | 2 | 品牌温度，情感连接 |
| promo | 1 | 不超过 1，避免像廉价打折店 |
| 节庆 | 按需（0-2） | 节庆祝贺帖，不占常规 12 配额 |

### 发布节奏
每周 3-4 帖：
- 周一/二：product 或 educational
- 周三/四：case 或 story
- 周五/周末：promo 或 educational

### 内容来源分析（规划时考虑）
- 当月马来西亚节庆（开斋节/农历新年/Deepavali/Muharram/圣诞/国庆等）
- 季节（马来西亚常年热，雨季/旱季，学校假期）
- 产品轮换（确保各系列都有曝光，不重复推同一款）
- （阶段二增强：实时流行话题，接搜索）

---

## 阶段划分

### 阶段一（现在做，不等外部）
月度规划 → 批整月 → 批量文案 → 逐篇配图 → 自动排期 → cron 到期提醒老板手动发

### 阶段二（等 Meta 权限）
到期自动发布到 FB/IG（接 Meta Graph API），接口在阶段一预留

---

## 数据层扩展

### 新建表：content_plans（月度计划）
| 字段 | 说明 |
|------|------|
| id | uuid |
| created_at | 创建时间 |
| month | 计划月份（如 '2026-07'） |
| status | 计划状态：drafting / pending_approval / approved / in_production / scheduled / completed |
| chat_id | 老板的 telegram chat_id |
| total_posts | 计划总帖数 |
| notes | 备注 |

### content_calendar 扩展（已有表，加字段）
| 字段 | 说明 |
|------|------|
| plan_id | 关联 content_plans.id（哪个月度计划） |
| post_angle | 内容角度（规划时定的方向） |
| suggested_date | 建议发布日期（规划时定） |
| scheduled_date | 最终排定日期（排期后） |
| publish_reminder_sent | 提醒是否已发（cron 用） |
| image_source | 配图来源：ai_generated / user_uploaded / skipped |

（image_url, scene_image_url, status, image_status 等已有，复用）

### content_calendar status 扩展（月度新增状态）
现有 11 状态保留，月度工作流新增：
- planned（已规划，在月度计划里，待批整月）
- plan_approved（整月批准，待批量生成文案）
（文案生成后进入现有的 copy_done → pending_review → ... 流程）

---

## 工作流节点

### 节点 M-1：月度规划 PlanMonth 🧠
**触发**：/plan_month [可选：指定月份]
**AI 职责**：
- 分析目标月份的节庆、季节、产品轮换
- 按配比生成 12 篇常规 + 节庆帖的规划
- 每篇：标题/主题、pillar、post_angle（内容角度）、suggested_date
**输出**：
- 新建 content_plans 行（status=pending_approval）
- 12+ 篇 content_calendar 行（status=planned，关联 plan_id）
- 发给老板：整月日历概览（列表展示每篇：日期、pillar、主题）

**客观验证断言**：
- 生成的帖数符合配比（product 4/case 3/educational 2/story 2/promo 1 + 节庆）
- 每篇有 pillar、主题、suggested_date
- suggested_date 分布合理（不挤在同一天，按每周 3-4 帖节奏）
- 节庆帖正确识别当月节庆
- content_plans 和 content_calendar 行正确关联（plan_id）

### 节点 M-2：整月审核 ApproveMonth 👤
**老板操作**：看整月日历，逐篇可以：
- ✅ 保留
- ✏️ 改主题/角度
- 🔄 换一篇（重新规划这一篇）
- 🗑️ 删掉这篇
- ➕ 加一篇
确认整月 → 批准
**输出**：
- content_plans status → approved
- 保留的帖 status → plan_approved
- 删掉的帖移除
**审核入口**：Telegram（逐篇按钮）+ Dashboard（整月列表视图，更直观）

**客观验证断言**：
- 改/删/加操作正确反映到 content_calendar
- 批准后只有 plan_approved 的帖进入下一步
- Dashboard 整月视图正确展示

### 节点 M-3：批量文案 BatchCopy 🧠（复用 lib/copywriting.js）
**处理**：整月批准后，对所有 plan_approved 的帖【一次性批量生成文案】
- 复用现有 buildCopywritingPrompt()（已验收的 Fanz 风格）
- 每篇按其 pillar + 主题 + angle 生成
- 全部生成完，状态 → copy_done
**输出**：12+ 篇文案全部生成，进入批量审核

**客观验证断言**：
- 所有 plan_approved 帖都生成了文案
- 文案符合 Fanz 风格（复用现有验证：关键词、占位符检测）
- 批量生成有进度反馈（生成中 X/12）
- 单篇生成失败不影响其他篇（隔离）

### 节点 M-4：批量文案审核 BatchCopyReview 👤
**老板操作**：批量看所有文案，逐篇：
- ✅ 批准
- ✏️ 打回重写（带反馈，复用现有 review_notes 机制）
保留的进入配图，打回的重新生成文案
**输出**：批准的帖 → copy_approved，进入逐篇配图

**客观验证断言**：
- 批量展示所有文案
- 单篇打回不影响其他篇
- 打回重写复用 review_notes（已验收）
- 批准的帖正确进入配图阶段

### 节点 M-5：逐篇配图 PerPostImage 🧠（复用 GPT Image 2）
**处理**：对每篇 copy_approved 的帖，逐篇生成配图
- 复用 lib/scene-gen.js（GPT Image 2，已验收）
- 一篇篇来（不批量，因为配图要逐篇 QC）
- 节庆帖特殊：不生成产品场景图，用纯节庆设计（或老板上传）

**配图审核多出口（关键，防卡死，业界最佳实践）**：
每篇配图生成后，老板审核卡：
- ✅ 批准 — 满意，用这张
- 🔄 重新生成 — 同产品图+场景，再来一张
- ✏️ 改场景重生成 — 老板输入新场景描述（如"改成卧室、北欧风"）
- 🖼️ 换产品图重生成 — 换一张产品图
- 📤 我自己上传图 — 老板上传自己的图替换（终极兜底）
- ⏭️ 跳过配图发纯文案 — 不要配图

**软提示**：重生成累计 3 次还不满意 → 提示"要不要改场景/换产品图/自己上传？"

**输出**：每篇定稿配图 → approved，image_source 标记来源（ai/uploaded/skipped）

**客观验证断言**：
- 6 个出口都能正常工作
- "改场景重生成"：老板的文字反馈正确注入场景指令
- "我自己上传图"：上传的图正确替换、存储、写 image_url
- 重生成 3 次出现软提示
- 节庆帖走特殊配图逻辑
- 跳过配图 → 发布时发纯文案

### 节点 M-6：自动排期 AutoSchedule ⚙️
**处理**：所有帖图文定稿后，Agent 自动排发布日期
- 按 suggested_date 为基础
- 节庆帖排在节庆当天或前一两天
- 常规帖按每周 3-4 帖节奏均匀分布
- 避免同一天多帖（除非节庆）
- 最佳发布时间（如晚上 6-9 点，马来西亚活跃时段）
**输出**：每篇 scheduled_date 排定，content_plans status → scheduled

**客观验证断言**：
- 每篇都有 scheduled_date
- 节庆帖排在正确日期
- 常规帖分布符合节奏（不挤）
- 时间在合理发布时段
- 老板可在 Dashboard 看整月排期表，可手动微调

### 节点 M-7：到期提醒 PublishReminder ⚙️（cron）
**处理**：cron 每天定时跑（如每天早上 9 点）
- 检查今天有没有 scheduled_date = 今天 的帖
- 有 → 发 Telegram 提醒老板："今天要发这篇，图文如下，请手动发到 FB/IG"
  附上文案 + 配图 + hashtags（方便老板复制粘贴去发）
- 标记 publish_reminder_sent = true（避免重复提醒）
**阶段二**：这里改成自动调 Meta API 发布

**客观验证断言**：
- cron 正确按日触发
- 只提醒今天该发的帖
- 提醒内容完整（文案+图+hashtags，方便老板直接发）
- 不重复提醒（publish_reminder_sent 守卫）
- 阶段二接口预留（发布动作可切换 提醒/自动发）

---

## cron 实现（Railway）
- Railway 支持 cron job（或用 node-cron 在常驻进程里）
- 每天定时检查 content_calendar 的 scheduled_date
- 触发 M-7 提醒

---

## 完整状态流转（月度）

```
content_plans:
  drafting → pending_approval → approved → in_production → scheduled → completed

content_calendar（单篇，在月度计划内）:
  planned →(批整月)→ plan_approved →(批量文案)→ copy_done 
  →(批量审)→ copy_approved →(逐篇配图)→ image_ready 
  →(逐篇QC)→ approved →(排期)→ scheduled →(到期提醒/发布)→ published
  
  配图打回 → image_retry（重生成/改场景/换图）
  配图跳过 → approved（image_source=skipped）
  配图上传 → approved（image_source=user_uploaded）
```

---

## 复用 vs 新建

**复用（已验收，不重做）**：
- lib/copywriting.js（文案，Fanz 风格）
- lib/scene-gen.js（GPT Image 2 配图）
- lib/text-overlay.js（文字叠加）
- 审核闸 + review_notes（打回重做）
- content_calendar 表

**新建**：
- content_plans 表（月度计划）
- M-1 月度规划逻辑
- M-2 整月审核（Telegram + Dashboard）
- M-3/M-4 批量文案 + 批量审
- M-5 配图多出口（扩展现有审核：加改场景/换图/上传）
- M-6 自动排期
- M-7 cron 到期提醒

---

## 开发顺序（按流水线，逐节点）

1. 数据层：content_plans 表 + content_calendar 扩展字段 + 新状态
2. M-1 月度规划（生成整月日历）
3. M-2 整月审核（Telegram + Dashboard 整月视图）
4. M-3 批量文案（复用 copywriting）
5. M-4 批量文案审核
6. M-5 逐篇配图 + 多出口（扩展配图审核：改场景/换图/上传）
7. M-6 自动排期
8. M-7 cron 到期提醒
9. 月度端到端

每节点走完整流水线（写→独立审→SHA验证→人工验收）。

---

## 本期边界
- 阶段一：到期提醒老板手动发（不接 Meta 自动发布）
- Meta 自动发布、实时流行话题分析：阶段二
- 配图局部编辑（Magic Edit 选区域改）：暂不做，用整张重生成+上传覆盖
