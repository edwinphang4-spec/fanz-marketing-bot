// ============================================
// brand.js — 品牌套件 + 资产库读取（Canva Brand Kit 的运行时侧）
//
// brand_kit（单行）与 brand_assets 由 Dashboard 维护；管线在这里读。
// 全部带内存缓存（默认 60s）+ 代码默认值兜底：DB 挂了 / 表还没建 /
// 字段为空，合成照跑，只是退回内置品牌默认，绝不崩。
//
// 产品资产的图像字节由 compose 侧按 public_url 现取（与背景同路子）。
// ============================================

const brandKitLib = require('./brand-kit'); // 静态版式默认（slots / presets / logo 路径）

const CACHE_TTL_MS = Number(process.env.BRAND_CACHE_TTL_MS || 60_000);

// ── 内置默认（DB 无值时的兜底，也是"从未配置过"时的合理起点）──
const DEFAULT_KIT = {
  colors: {
    title: '#FFFFFF',
    stroke: '#1A1A1A',
    cta_fill: '#FFD700',
    cta_stroke: '#1A1A1A',
  },
  fonts: { family: 'sans-serif' },
  // 背景 prompt 的品牌风格锚点：让每张图风格统一（可被 Dashboard 覆盖）
  background_style:
    'bright, airy, modern Malaysian home interior; natural daylight; warm, ' +
    'clean, aspirational lifestyle aesthetic; uncluttered composition',
  // 文案声音（可被 Dashboard 覆盖）
  brand_voice:
    'Warm, knowledgeable and down-to-earth — like a helpful friend who knows fans. ' +
    'Confident but never pushy or salesy. Malaysia/Singapore English.',
  default_layout: {
    title_slot: brandKitLib.DEFAULT_TITLE_SLOT,
    product_slot: brandKitLib.DEFAULT_PRODUCT_SLOT,
  },
  logo_url: null, // null → compose 用本地占位 logo 文件
};

function getConfig() {
  return {
    url: (process.env.SUPABASE_URL || '').replace(/\/+$/, ''),
    key: process.env.SUPABASE_SERVICE_KEY || '',
  };
}

async function restGet(pathAndQuery) {
  const { url, key } = getConfig();
  if (!url || !key) throw new Error('Supabase not configured');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(`${url}/rest/v1/${pathAndQuery}`, {
      headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`brand REST ${res.status}: ${(await res.text()).slice(0, 120)}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

// ── brand_kit ──
let _kitCache = null;
let _kitAt = 0;

/**
 * Read the brand kit (merged over DEFAULT_KIT so callers always get every key).
 * Resolves logo_asset_id to logo_url. Cached; never throws (falls back to defaults).
 */
async function getBrandKit() {
  const now = Date.now();
  if (_kitCache && now - _kitAt < CACHE_TTL_MS) return _kitCache;
  try {
    const rows = await restGet('brand_kit?id=eq.1&select=*&limit=1');
    const row = Array.isArray(rows) && rows[0] ? rows[0] : {};
    let logoUrl = null;
    if (row.logo_asset_id) {
      try {
        const la = await restGet(`brand_assets?id=eq.${row.logo_asset_id}&select=public_url&limit=1`);
        logoUrl = (Array.isArray(la) && la[0] && la[0].public_url) || null;
      } catch (_) {}
    }
    const kit = {
      colors: { ...DEFAULT_KIT.colors, ...(row.colors || {}) },
      fonts: { ...DEFAULT_KIT.fonts, ...(row.fonts || {}) },
      background_style: row.background_style || DEFAULT_KIT.background_style,
      brand_voice: row.brand_voice || DEFAULT_KIT.brand_voice,
      default_layout: { ...DEFAULT_KIT.default_layout, ...(row.default_layout || {}) },
      logo_url: logoUrl,
    };
    _kitCache = kit;
    _kitAt = now;
    return kit;
  } catch (err) {
    console.error('[brand] getBrandKit fell back to defaults:', err.message);
    // 短缓存这个兜底，避免每次合成都打一次失败请求
    _kitCache = { ...DEFAULT_KIT };
    _kitAt = now;
    return _kitCache;
  }
}

// ── brand_assets（产品）──
let _productsCache = null;
let _productsAt = 0;

/**
 * List active product assets (sorted). Returns [] on any failure — callers
 * must fall back to the filesystem library when this is empty.
 */
async function listProductAssets() {
  const now = Date.now();
  if (_productsCache && now - _productsAt < CACHE_TTL_MS) return _productsCache;
  try {
    const rows = await restGet(
      'brand_assets?kind=eq.product&is_active=eq.true&select=*&order=sort_order,created_at'
    );
    _productsCache = Array.isArray(rows) ? rows : [];
    _productsAt = now;
    return _productsCache;
  } catch (err) {
    console.error('[brand] listProductAssets failed, caller falls back to fs:', err.message);
    return [];
  }
}

/** Find one product asset by name (exact) — for Dashboard-selected products. */
async function getProductAssetByName(name) {
  if (!name) return null;
  const list = await listProductAssets();
  return list.find((a) => a.name === name) || null;
}

/** Test seam / manual refresh. */
function clearCache() {
  _kitCache = null; _kitAt = 0;
  _productsCache = null; _productsAt = 0;
  _refCacheByTag.clear();
  _logoCache = null; _logoAt = 0;
}

// ── brand_assets（参考设计，kind='reference'）──
// 按 series（模板 tag）分桶缓存：不同模板不能互相污染彼此的风格摘要。
const _refCacheByTag = new Map(); // key: series tag or '__all__' → { data, at }

/**
 * List active reference-design assets (sorted, max 4).
 * Used to derive a visual style summary for background prompt injection.
 *
 * @param {string} [seriesTag] - filter to a single template tag (series column).
 *   Omit to get the unfiltered top-4 (legacy behaviour).
 * @returns {Promise<Array>} [] on any failure or no match — callers must degrade gracefully.
 */
async function listReferenceAssets(seriesTag) {
  const now = Date.now();
  const cacheKey = seriesTag || '__all__';
  const cached = _refCacheByTag.get(cacheKey);
  if (cached && now - cached.at < CACHE_TTL_MS) return cached.data;
  try {
    const filter = seriesTag ? `&series=eq.${encodeURIComponent(seriesTag)}` : '';
    const rows = await restGet(
      `brand_assets?kind=eq.reference&is_active=eq.true${filter}&select=*&order=sort_order,created_at&limit=4`
    );
    const data = Array.isArray(rows) ? rows : [];
    _refCacheByTag.set(cacheKey, { data, at: now });
    return data;
  } catch (err) {
    console.error('[brand] listReferenceAssets failed:', err.message);
    return [];
  }
}

// ── brand_assets（logo 变体，kind='logo'）──
let _logoCache = null;
let _logoAt = 0;

/**
 * List active logo-variant assets (series = lockup_blue / lockup_white /
 * wordmark_blue / wordmark_white). Some rows have public_url = null (uploaded
 * directly via storage_path) — derive the public URL from storage_path using
 * the same convention as store-image.js's uploadFile().
 * Returns [] on any failure — callers must fall back to brand_kit's single logo_url.
 */
async function listLogoAssets() {
  const now = Date.now();
  if (_logoCache && now - _logoAt < CACHE_TTL_MS) return _logoCache;
  try {
    const rows = await restGet(
      'brand_assets?kind=eq.logo&is_active=eq.true&series=not.is.null&select=*&order=sort_order,created_at'
    );
    const { url } = getConfig();
    const { BUCKET } = require('./store-image');
    _logoCache = (Array.isArray(rows) ? rows : []).map((row) => ({
      ...row,
      public_url: row.public_url || (row.storage_path
        ? `${url}/storage/v1/object/public/${BUCKET}/${row.storage_path}`
        : null),
    }));
    _logoAt = now;
    return _logoCache;
  } catch (err) {
    console.error('[brand] listLogoAssets failed:', err.message);
    return [];
  }
}

/** Find one active logo asset by series (e.g. 'wordmark_white'). null if not found. */
async function getLogoAssetBySeries(series) {
  if (!series) return null;
  const list = await listLogoAssets();
  return list.find((a) => a.series === series) || null;
}

module.exports = {
  getBrandKit,
  listProductAssets,
  getProductAssetByName,
  listReferenceAssets,
  listLogoAssets,
  getLogoAssetBySeries,
  clearCache,
  DEFAULT_KIT,
};
