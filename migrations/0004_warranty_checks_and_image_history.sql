-- ============================================
-- 0004 — 保修查询结论落库 + 配图历史版本
--
-- 在 Supabase SQL Editor 里整段执行。可重复执行(幂等)。
-- ============================================

-- ── ① warranty_checks:保修判定的结构化记录 ────────────────────────────
-- 现状:CS bot 每次判完保修,结论只存在于对话文字里。
-- 想知道"这个月查了几次保修、多少台已过保、最常见的是哪个部件",查不出来。
-- 由 CS bot 在两处写入(发票号查库的正式判定 / 发票照片确认日期后的初判)——
-- 这两处都是**代码算出来的**结论,不是模型说的,所以值得当数据存。
create table if not exists warranty_checks (
  id             uuid primary key default gen_random_uuid(),
  chat_id        text,
  model          text,
  brand          text,                      -- fanz | vioz | unknown(代码从型号推,不信模型申报)
  issue_type     text,                      -- motor | receiver | led_plate | led_kit | onsite | unknown
  purchase_date  date,
  verdict        text not null,             -- in_warranty | out_of_warranty | needs_brand | not_found
  warranty_years int,
  charge         text,                      -- 过保收费文案(RM 120 之类),没有就空
  country        text,
  source         text not null,             -- invoice_lookup | preliminary_photo
  created_at     timestamptz not null default now()
);
create index if not exists idx_wc_created on warranty_checks (created_at desc);
create index if not exists idx_wc_chat    on warranty_checks (chat_id);

-- ── ② image_version_history:配图的历史版本 ────────────────────────────
-- 现状:每次重画覆盖 content_calendar.image_url,上一版和"为什么重画"都没了。
-- 同样用触发器(而不是代码)——出图链路里写 image_url 的地方不止一处,
-- 而且以后还会加;放数据库里,换图这件事必然留痕。
--
-- 时序说明:worker 先跑完出图管线(写 image_url),**之后**才清 review_notes,
-- 所以换图那一刻 review_notes 还带着她的意见 —— 正好当作"为什么重画"。
create table if not exists image_version_history (
  id          uuid primary key default gen_random_uuid(),
  calendar_id uuid not null,
  topic       text,
  image_url   text not null,                -- 被替换掉的那一版
  replaced_by text,                         -- 换成了哪一版
  reason      text,                         -- 换图那一刻的 review_notes([img] 意见 / 驳回意见)
  image_source text,
  version_no  int,                          -- 这是该帖的第几版(从 1 开始)
  created_at  timestamptz not null default now()
);
create index if not exists idx_ivh_calendar on image_version_history (calendar_id, version_no);

create or replace function archive_image_version() returns trigger as $$
declare
  n int;
begin
  if old.image_url is not null
     and btrim(old.image_url) <> ''
     and new.image_url is distinct from old.image_url
  then
    select coalesce(max(version_no), 0) + 1 into n
      from image_version_history where calendar_id = old.id;
    insert into image_version_history
      (calendar_id, topic, image_url, replaced_by, reason, image_source, version_no)
    values
      (old.id, old.topic, old.image_url, new.image_url,
       nullif(btrim(coalesce(old.review_notes, '')), ''), old.image_source, n);
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_archive_image_version on content_calendar;
create trigger trg_archive_image_version
  before update on content_calendar
  for each row execute function archive_image_version();
