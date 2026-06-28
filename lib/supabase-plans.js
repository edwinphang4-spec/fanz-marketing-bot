// ============================================
// Supabase REST client for content_plans
//
// Uses service_role key (full read/write) via the PostgREST endpoint.
// No SDK — plain fetch only.
// ============================================

const { transition, isValidStatus } = require('./state-machine');

const TABLE = 'content_plans';
const INITIAL_STATUS = 'drafting';

function getConfig() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) {
    throw new Error(
      'Supabase not configured: SUPABASE_URL and SUPABASE_SERVICE_KEY are required'
    );
  }
  return { url: url.replace(/\/+$/, ''), key };
}

function isConfigured() {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY);
}

function buildHeaders(prefer) {
  const { key } = getConfig();
  const h = {
    apikey: key,
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
  };
  if (prefer) h.Prefer = prefer;
  return h;
}

const REQUEST_TIMEOUT_MS = 15_000;

async function request(method, pathAndQuery, body, prefer) {
  const { url } = getConfig();
  const fullUrl = `${url}/rest/v1/${pathAndQuery}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const opts = {
    method,
    headers: buildHeaders(prefer),
    signal: controller.signal,
  };
  if (body !== undefined) {
    opts.body = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch(fullUrl, opts);
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(
      `Supabase ${method} ${pathAndQuery} failed ${res.status}: ${errText}`
    );
  }
  if (res.status === 204) return null;
  const text = await res.text();
  if (!text) return null;
  return JSON.parse(text);
}

// ============================================
// DDL helpers
// ============================================

async function executeSQL(sql) {
  const { url, key } = getConfig();
  const fullUrl = `${url}/sql`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const opts = {
    method: 'POST',
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    signal: controller.signal,
    body: JSON.stringify({ query: sql }),
  };
  let res;
  try {
    res = await fetch(fullUrl, opts);
  } finally {
    clearTimeout(timer);
  }
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  return { ok: res.ok, status: res.status, data };
}

// ============================================
// CRUD
// ============================================

async function createContentPlan(data) {
  const result = await request(
    'POST',
    TABLE,
    data,
    'return=representation'
  );
  return Array.isArray(result) ? result[0] : result;
}

async function getContentPlan(id) {
  if (!id) throw new Error('getContentPlan: id is required');
  const result = await request(
    'GET',
    `${TABLE}?id=eq.${encodeURIComponent(id)}&limit=1`
  );
  if (Array.isArray(result) && result.length > 0) return result[0];
  return null;
}

async function listContentPlans(filter = {}) {
  const params = new URLSearchParams();
  if (filter.month) {
    params.set('month', `eq.${filter.month}`);
  }
  if (filter.status) {
    params.set('status', `eq.${filter.status}`);
  }
  if (filter.chat_id) {
    params.set('chat_id', `eq.${filter.chat_id}`);
  }
  params.set('order', filter.order || 'created_at.desc');
  if (filter.limit) params.set('limit', String(Math.min(filter.limit, 200)));
  const query = params.toString();
  const result = await request('GET', `${TABLE}?${query}`);
  return result || [];
}

async function updateContentPlan(id, data) {
  if (!id) throw new Error('updateContentPlan: id is required');
  // No status transition check — content_plans has its own lifecycle
  // (drafting → pending_approval → plan_approved → in_production → scheduled → completed)
  // independent of the content_calendar state machine.
  const result = await request(
    'PATCH',
    `${TABLE}?id=eq.${encodeURIComponent(id)}`,
    data,
    'return=representation'
  );
  return Array.isArray(result) ? result[0] : result;
}

async function getPlansByMonth(month) {
  return listContentPlans({ month });
}

// ============================================
// DDL — create content_plans table and extend content_calendar
// ============================================

async function runDDL() {
  const sql = `
-- Create content_plans table
CREATE TABLE IF NOT EXISTS content_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  month text NOT NULL,
  status text NOT NULL DEFAULT 'drafting',
  chat_id text NOT NULL,
  total_posts integer DEFAULT 0,
  notes text
);

-- Drop old status CHECK constraint on content_calendar if it exists
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints tc
    JOIN pg_catalog.pg_constraint c ON tc.constraint_name = c.conname
    WHERE tc.table_name = 'content_calendar'
      AND tc.constraint_type = 'CHECK'
      AND c.conname LIKE '%status%'
  ) THEN
    EXECUTE (
      SELECT 'ALTER TABLE content_calendar DROP CONSTRAINT ' || c.conname::text
      FROM information_schema.table_constraints tc
      JOIN pg_catalog.pg_constraint c ON tc.constraint_name = c.conname
      WHERE tc.table_name = 'content_calendar'
        AND tc.constraint_type = 'CHECK'
        AND c.conname LIKE '%status%'
      LIMIT 1
    );
  END IF;
END $$;

-- Drop old pillar CHECK constraint on content_calendar if it exists
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints tc
    JOIN pg_catalog.pg_constraint c ON tc.constraint_name = c.conname
    WHERE tc.table_name = 'content_calendar'
      AND tc.constraint_type = 'CHECK'
      AND c.conname LIKE '%pillar%'
  ) THEN
    EXECUTE (
      SELECT 'ALTER TABLE content_calendar DROP CONSTRAINT ' || c.conname::text
      FROM information_schema.table_constraints tc
      JOIN pg_catalog.pg_constraint c ON tc.constraint_name = c.conname
      WHERE tc.table_name = 'content_calendar'
        AND tc.constraint_type = 'CHECK'
        AND c.conname LIKE '%pillar%'
      LIMIT 1
    );
  END IF;
END $$;

-- Extend content_calendar with monthly workflow columns
ALTER TABLE content_calendar ADD COLUMN IF NOT EXISTS plan_id uuid;
ALTER TABLE content_calendar ADD COLUMN IF NOT EXISTS post_angle text;
ALTER TABLE content_calendar ADD COLUMN IF NOT EXISTS suggested_date text;
ALTER TABLE content_calendar ADD COLUMN IF NOT EXISTS scheduled_date timestamptz;
ALTER TABLE content_calendar ADD COLUMN IF NOT EXISTS publish_reminder_sent boolean DEFAULT false;
ALTER TABLE content_calendar ADD COLUMN IF NOT EXISTS image_source text DEFAULT 'ai_generated';
  `;
  return executeSQL(sql);
}

module.exports = {
  isConfigured,
  createContentPlan,
  getContentPlan,
  listContentPlans,
  updateContentPlan,
  getPlansByMonth,
  executeSQL,
  runDDL,
};