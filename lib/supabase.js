// ============================================
// Supabase REST client for content_calendar
//
// Uses service_role key (full read/write) via the PostgREST endpoint.
// No SDK — plain fetch only.
// ============================================

const { transition, isValidStatus } = require('./state-machine');

const TABLE = 'content_calendar';
const INITIAL_STATUS = 'draft';
const VALID_PILLARS = ['product', 'case', 'promo', 'story'];

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
// CRUD
// ============================================

async function createContentCalendar(data) {
  if (data && data.status !== undefined && data.status !== INITIAL_STATUS) {
    // Anything other than the default initial state must be a legal first-hop from draft.
    transition(INITIAL_STATUS, data.status);
  }
  const result = await request(
    'POST',
    TABLE,
    data,
    'return=representation'
  );
  return Array.isArray(result) ? result[0] : result;
}

async function getContentCalendar(id) {
  if (!id) throw new Error('getContentCalendar: id is required');
  const result = await request(
    'GET',
    `${TABLE}?id=eq.${encodeURIComponent(id)}&limit=1`
  );
  if (Array.isArray(result) && result.length > 0) return result[0];
  return null;
}

async function listContentCalendar(filter = {}) {
  const params = new URLSearchParams();
  if (filter.status) {
    if (!isValidStatus(filter.status)) {
      throw new Error(`listContentCalendar: invalid status filter "${filter.status}"`);
    }
    params.set('status', `eq.${filter.status}`);
  }
  if (filter.pillar) {
    if (!VALID_PILLARS.includes(filter.pillar)) {
      throw new Error(`listContentCalendar: invalid pillar "${filter.pillar}"`);
    }
    params.set('pillar', `eq.${filter.pillar}`);
  }
  if (filter.chat_id) params.set('chat_id', `eq.${filter.chat_id}`);
  params.set('order', filter.order || 'created_at.desc');
  if (filter.limit) params.set('limit', String(Math.min(filter.limit, 200)));
  const query = params.toString();
  const result = await request('GET', `${TABLE}?${query}`);
  return result || [];
}

async function updateContentCalendar(id, data) {
  if (!id) throw new Error('updateContentCalendar: id is required');
  if (data && data.status !== undefined) {
    const current = await getContentCalendar(id);
    if (!current) {
      throw new Error(`updateContentCalendar: row ${id} not found`);
    }
    // Transition check applies only if status actually changed
    if (current.status === data.status) {
      // Same status — skip transition, still update other fields
    } else {
      transition(current.status, data.status);
    }
    // Append status filter to PATCH for TOCTOU concurrency guard
    const result = await request(
      'PATCH',
      `${TABLE}?id=eq.${encodeURIComponent(id)}&status=eq.${encodeURIComponent(current.status)}`,
      data,
      'return=representation'
    );
    if (!result || (Array.isArray(result) && result.length === 0)) {
      throw new Error(
        `updateContentCalendar: concurrency conflict — row ${id} status changed since read ` +
        `(expected ${current.status}). Retry from latest state.`
      );
    }
    return Array.isArray(result) ? result[0] : result;
  }
  // No status change — regular field update
  const result = await request(
    'PATCH',
    `${TABLE}?id=eq.${encodeURIComponent(id)}`,
    data,
    'return=representation'
  );
  return Array.isArray(result) ? result[0] : result;
}

async function getPendingReview() {
  return listContentCalendar({ status: 'pending_review', order: 'created_at.desc' });
}

module.exports = {
  isConfigured,
  createContentCalendar,
  getContentCalendar,
  listContentCalendar,
  updateContentCalendar,
  getPendingReview,
};
