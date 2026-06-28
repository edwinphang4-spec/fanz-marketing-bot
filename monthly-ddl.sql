-- ============================================
-- Fanz Content Calendar — Monthly Workflow DDL
-- Phase 1: Data Layer
-- ============================================
-- Created: 2026-06-28
-- 
-- Run this in Supabase Dashboard → SQL Editor
-- For project: ipozfadochzlljkxetcs
-- 
-- SAFETY:
-- - All DDL uses IF NOT EXISTS / IF EXISTS to be idempotent
-- - Old CHECK constraints are replaced with new ones covering ALL states
-- - Existing data is preserved (no DROP TABLE, no DELETE)
-- ============================================

-- ============================================
-- 1. CREATE content_plans table
--    Fields match MONTHLY_WORKFLOW.md spec exactly:
--    id, created_at, month, status, chat_id, total_posts, notes
-- ============================================
CREATE TABLE IF NOT EXISTS content_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  month text NOT NULL,
  status text NOT NULL DEFAULT 'drafting',
  chat_id text NOT NULL,
  total_posts integer DEFAULT 0,
  notes text
);

-- ============================================
-- 2. REPLACE old CHECK constraints on content_calendar
--    Old constraint: status IN ('draft','pending_review','approved','published')
--    New constraint: ALL 13 states from state-machine.js
--    (draft, planning_done, selected, planned, plan_approved, copy_done,
--     pending_review, copy_approved, image_ready, image_retry,
--     approved, rejected, published)
--
--    Old constraint: pillar IN ('product','case','promo','story')
--    New constraint: pillars + educational
-- ============================================

-- 2a. Drop old constraints (IF EXISTS = safe for re-run)
ALTER TABLE content_calendar DROP CONSTRAINT IF EXISTS content_calendar_status_check;
ALTER TABLE content_calendar DROP CONSTRAINT IF EXISTS content_calendar_pillar_check;

-- 2b. Add NEW comprehensive constraints
ALTER TABLE content_calendar ADD CONSTRAINT content_calendar_status_check
  CHECK (status IN (
    'draft',
    'planning_done',
    'selected',
    'planned',
    'plan_approved',
    'copy_done',
    'pending_review',
    'copy_approved',
    'image_ready',
    'image_retry',
    'approved',
    'rejected',
    'published'
  ));

ALTER TABLE content_calendar ADD CONSTRAINT content_calendar_pillar_check
  CHECK (pillar IN ('product', 'case', 'promo', 'story', 'educational'));

-- ============================================
-- 3. Add monthly workflow columns to content_calendar
--    Fields match MONTHLY_WORKFLOW.md spec exactly:
--    plan_id, post_angle, suggested_date, scheduled_date,
--    publish_reminder_sent, image_source
-- ============================================
ALTER TABLE content_calendar ADD COLUMN IF NOT EXISTS plan_id uuid;
ALTER TABLE content_calendar ADD COLUMN IF NOT EXISTS post_angle text;
ALTER TABLE content_calendar ADD COLUMN IF NOT EXISTS suggested_date text;
ALTER TABLE content_calendar ADD COLUMN IF NOT EXISTS scheduled_date timestamptz;
ALTER TABLE content_calendar ADD COLUMN IF NOT EXISTS publish_reminder_sent boolean DEFAULT false;
ALTER TABLE content_calendar ADD COLUMN IF NOT EXISTS image_source text DEFAULT 'ai_generated';

-- ============================================
-- Verification queries (run after to confirm)
-- ============================================

-- V1: content_plans exists
SELECT EXISTS (
  SELECT FROM information_schema.tables 
  WHERE table_schema = 'public' AND table_name = 'content_plans'
) AS content_plans_exists;

-- V2: New columns on content_calendar
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'content_calendar'
ORDER BY ordinal_position;

-- V3: Verify new constraints are in place
SELECT conname, pg_get_constraintdef(oid) AS constraint_def
FROM pg_catalog.pg_constraint
WHERE conrelid = 'content_calendar'::regclass
ORDER BY conname;

-- V4: Verify existing rows are not affected
SELECT status, COUNT(*) AS count
FROM content_calendar
GROUP BY status
ORDER BY status;