-- ============================================
-- 0003_review_note_history.sql — 审核意见留存(现在是阅后即焚)
--
-- 现状:她驳回时写的意见累积在 content_calendar.review_notes,**批准时清空**
-- (Edwin 定的规矩:在此之前它是这篇的完整修改史)。结果是批准之后
-- 「她驳回过什么、说过什么」永远查不到 —— 这既让她事后无从复盘,
-- 也是「偏好记忆第二层」(同类意见累计 3 次才问要不要长期生效)缺的底层数据。
--
-- 为什么用**数据库触发器**而不是在代码里归档:
-- 清空 review_notes 的地方有四处(bot 单篇批准 / 批量单条批准 / 批量全批 /
-- Dashboard 批准),分散在两个仓库。任何一处漏写归档,那条意见就永远没了 ——
-- 这正是我们反复踩的「一条路一条路地补,永远会漏下一个」。放在数据库里,
-- 归档就成了 UPDATE 的一部分,**代码层不可能忘**。
--
-- 只归档真正的审核意见:条件里要求原文含 "[#N " 这种条目标记。
-- 配图那条路也用 review_notes 放动作标记("[img] …" / "[product-next]"),
-- 用完同样清空 —— 那些不是意见,不归档。
--
-- 跑法:Supabase SQL Editor 里整段执行。可重复执行(幂等)。
-- ============================================

create table if not exists review_note_history (
  id          uuid primary key default gen_random_uuid(),
  calendar_id uuid not null,
  chat_id     text,
  plan_id     uuid,
  topic       text,                 -- 快照:帖子标题(日历行以后被删也还看得懂)
  notes       text not null,        -- 原文,含 [#N 时间] 标记,保持可解析
  note_count  int,                  -- 条数,方便统计"改了几次"
  archived_at timestamptz not null default now()
);

create index if not exists idx_rnh_calendar on review_note_history (calendar_id);
create index if not exists idx_rnh_archived on review_note_history (archived_at desc);

create or replace function archive_review_notes() returns trigger as $$
begin
  if old.review_notes is not null
     and btrim(old.review_notes) <> ''
     and (new.review_notes is null or btrim(new.review_notes) = '')
     and old.review_notes ~ '\[#\d+\s'          -- 只认审核意见,不认 [img] 之类的动作标记
  then
    insert into review_note_history (calendar_id, chat_id, plan_id, topic, notes, note_count)
    values (
      old.id, old.chat_id, old.plan_id, old.topic, old.review_notes,
      (select count(*) from regexp_matches(old.review_notes, '\[#\d+\s', 'g'))
    );
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_archive_review_notes on content_calendar;
create trigger trg_archive_review_notes
  before update on content_calendar
  for each row execute function archive_review_notes();
