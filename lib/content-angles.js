// ============================================
// content-angles.js — 内容角度维度（代码层分配 + 代码层校验）
//
// 2026-08-01 Edwin 定调:决定这个产品成败的不是配图技术,是**内容质量**。
// 判断标准只有一句:「老板娘看到这 13 篇,会不会直接说『可以发』?」
//
// 上一轮干测证明:拆掉强制卖点后标题雷同基本消失,但 13 篇读起来仍像
// 「同一篇的 13 个变体」—— 因为每篇的**内容角度**是一样的(都在讲产品好在哪)。
// pillar 只回答「这是什么类型的帖子」,不回答「这篇从哪个角度切入」。
//
// 所以这里加第二个维度:每篇除了 pillar 还有一个 angle(7 类)。
//
// 铁律:分布**必须用代码保证**,不能只写在提示词里。
//   · 提示词说「角度要多样」是概率性的 —— 实测 12 篇里 8 篇撞同一句副标题,
//     就是"祈祷式约束"的结果。
//   · 这里的 planContentAngles() 是确定性算法:同样的 pillar 序列进去,
//     同样的角度分布出来,不掷骰子、不问模型。
// ============================================

/**
 * 7 类内容角度。
 * zh/label 给人看(Telegram 卡片、干测报告),其余字段喂提示词。
 */
const ANGLES = {
  knowledge: {
    zh: '知识',
    brief: 'teach one concrete, checkable thing about choosing or living with a ceiling fan',
    guidance:
      'Teach ONE thing the reader can act on — how to choose, how something works, what the ' +
      'difference between two options actually is. Use only facts that appear in CONFIRMED SPECS, ' +
      'the official Fanz fan-size guide, or this post\'s assigned model. If you have no verified ' +
      'fact to teach, teach a choice we DO have real data for: light (L) versus no light (N), ' +
      'or how blade count and diameter change what a fan suits. Never invent a number to teach with.',
  },
  scenario: {
    zh: '场景',
    brief: 'one specific room at one specific moment of the day',
    guidance:
      'Put the reader inside ONE specific space at ONE specific moment — a bedroom at 2am, a ' +
      'dining table with the whole family around it, a covered balcony on a still evening, a study ' +
      'desk in the afternoon. Write what that moment feels like, not what the fan is made of. ' +
      'The product appears as part of the scene, never as a spec list.',
  },
  aesthetic: {
    zh: '美学',
    brief: 'finish, material and how it sits inside a room\'s style',
    guidance:
      'Talk about how it LOOKS and what it goes with — the finish, the material, the interior ' +
      'style it belongs to (wood tones with Scandinavian and muji-style rooms, matt black with ' +
      'industrial and modern-minimalist rooms, matt white with bright airy rooms). Design language, ' +
      'not performance language. Do not mention warranty, certification or motor type here.',
  },
  timing: {
    zh: '时效',
    brief: 'what is happening in Malaysia right now',
    guidance:
      'Anchor to what is happening in Malaysia at this moment — the monsoon and closed windows, ' +
      'the hot dry stretch, school holidays, the run-up to a festival, a renovation season. ' +
      'The post should read as if it could only have been written this month.',
  },
  emotion: {
    zh: '情感',
    brief: 'brand feeling — a decade of Malaysian homes, service that turns up',
    guidance:
      'Brand-level feeling, not product features. A decade of Malaysian homes. The fan that has ' +
      'been running above a family since the kids were small. Service that actually turns up. ' +
      'Less product, more heart. No spec, no size, no certification.',
  },
  painpoint: {
    zh: '痛点',
    brief: 'the frustration the reader already has, in their words',
    guidance:
      'Open by naming a frustration the reader already has, in the words they would use — the old ' +
      'fan that rattles, the electricity bill, the fan that broke and nobody would come and fix it, ' +
      'the room that never cools evenly. Name it plainly first, resolve it second. The resolution ' +
      'may be one brand fact ONLY if the allotment below gives you one.',
  },
  spec: {
    zh: '产品',
    brief: 'the functional case — concrete features and specifications',
    guidance:
      'The functional case for this model. Concrete, verifiable features from the assigned product ' +
      'and CONFIRMED SPECS. This is the ONE angle where feature talk is the point — but keep it to ' +
      'at most three things, written as prose sentences, never as a bullet list.',
  },
};

const ANGLE_KEYS = Object.keys(ANGLES);

/**
 * 每个 pillar 允许的角度,**按优先顺序**排列。
 *
 * 顺序不是装饰 —— planContentAngles 的贪心算法在票数打平时按这个顺序取,
 * 所以把 spec 排在每个列表的后面,就等于「同类帖子里卖点帖最后才轮到」。
 * 这直接实现 Edwin 那句:「4 篇 product 不该都是卖点帖:一篇讲痛点、
 * 一篇讲美学、一篇讲场景、一篇才讲规格」。
 */
const PILLAR_ANGLES = {
  product: ['painpoint', 'aesthetic', 'scenario', 'spec', 'knowledge'],
  case: ['scenario', 'aesthetic', 'emotion', 'painpoint'],
  educational: ['knowledge', 'painpoint', 'scenario'],
  story: ['emotion', 'knowledge', 'timing', 'aesthetic'],
  promo: ['timing', 'spec', 'painpoint'],
  festival: ['timing'],
};

// ── 整月分布硬指标(Edwin 定的) ──
const MAX_SPEC_POSTS = 3;            // 产品角度整月最多 3 篇
const MIN_DISTINCT_ANGLES = 5;       // 整月至少覆盖 5 类角度
const MAX_SAME_ANGLE_PER_PILLAR = 2; // 同一 pillar 内同一角度最多 2 篇

// ============================================
// 品牌事实配额 —— 雷1 的正解
// ============================================
//
// 旧做法:提示词写「product 帖 MUST include SIRIM + 10 年保修 + DC 马达」。
// 结果整月 12 篇里 12 篇都提保修、8 篇都提 SIRIM —— 读起来像同一份广告词
// 复印了十二遍,而 Fanz 自己 2026 年 7 月的真实帖子**一条都没提**。
//
// 新做法:不是「删掉」而是「整月配额」。保修仍然是 Fanz 区别于杂牌的核心
// 信任信号,该出现时必须出现 —— 只是不必每篇都喊。配额在规划时按角度亲和度
// 分配到具体某几篇,其余篇明确要求**一条都不提**。
const BRAND_FACTS = {
  warranty: {
    zh: '10 年马达保修',
    quota: 3,
    band: [3, 4],
    say: '10-year motor warranty',
    // 哪些角度天然适合承载这条事实(排前面的优先分到)
    affinity: ['painpoint', 'emotion', 'spec'],
    detect: /\b10[\s-]*year[s]?\b[^.]{0,40}\b(warranty|motor)\b|\bwarranty\b/i,
  },
  sirim: {
    zh: 'SIRIM 认证',
    quota: 2,
    band: [2, 3],
    say: 'SIRIM certified',
    affinity: ['spec', 'knowledge', 'emotion'],
    detect: /\bSIRIM\b/i,
  },
  dc_motor: {
    zh: 'DC 马达 / 静音',
    quota: 3,
    band: [3, 4],
    say: 'DC motor technology — energy efficient and quiet (no numbers, ever)',
    affinity: ['painpoint', 'knowledge', 'scenario', 'spec'],
    detect: /\bDC\s*motor\b|whisper[\s-]?quiet|near[\s-]?silent/i,
  },
};

const BRAND_FACT_KEYS = Object.keys(BRAND_FACTS);

// ============================================
// 角度分配
// ============================================

/** 从标题/角度说明里猜一个角度 —— 只用于「计划器没给 angle」时的种子。 */
function inferAngle(post) {
  const t = `${post.topic || ''} ${post.post_angle || ''}`.toLowerCase();
  if (/festive|greeting|raya|deepavali|christmas|merdeka|new year|wesak|muharram|thaipusam/.test(t)) return 'timing';
  if (/how to|guide|choose|which|vs\.?|difference|explained|size/.test(t)) return 'knowledge';
  if (/noisy|noise|rattle|broken|repair|bill|too hot|problem|struggle|tired of/.test(t)) return 'painpoint';
  if (/wood|oak|pine|grey|matt|black|white|finish|style|design|scandi|minimal|interior/.test(t)) return 'aesthetic';
  if (/bedroom|living|dining|balcony|patio|study|kitchen|condo|night|evening|morning/.test(t)) return 'scenario';
  if (/year|journey|trust|family|story|promise|care|home since|decade/.test(t)) return 'emotion';
  if (/sale|offer|deal|promo|limited|monsoon|season|school|holiday/.test(t)) return 'timing';
  return null;
}

/**
 * 给整月的帖子分配内容角度 —— **确定性算法,不掷骰子、不问模型**。
 *
 * 贪心:每篇在「本 pillar 允许的角度」里挑一个,优先挑整月用得最少的;
 * 打平时优先挑本 pillar 里用得最少的;再打平按 PILLAR_ANGLES 的声明顺序
 * (spec 排在后面 → 卖点帖最后才轮到)。硬上限(spec ≤ 3、同 pillar 同角度 ≤ 2)
 * 直接从候选里剔除,剔空了才放宽 —— 宁可放宽也不能没角度。
 *
 * @param {Array<{pillar:string, topic?:string, post_angle?:string, angle?:string}>} posts
 * @returns {Array<{angle:string, brandFact:string|null}>} 与 posts 等长、下标对齐
 */
function planContentAngles(posts = []) {
  const globalCount = Object.fromEntries(ANGLE_KEYS.map((k) => [k, 0]));
  const pillarCount = new Map(); // `${pillar}:${angle}` → n
  const bump = (pillar, angle) => {
    globalCount[angle]++;
    const k = `${pillar}:${angle}`;
    pillarCount.set(k, (pillarCount.get(k) || 0) + 1);
  };
  const inPillar = (pillar, angle) => pillarCount.get(`${pillar}:${angle}`) || 0;

  const out = posts.map(() => null);

  // ① 先落地"没得选"的:festival 固定 timing;计划器/人工已给且合法的角度尊重原样。
  posts.forEach((p, i) => {
    const pillar = String(p.pillar || 'product').toLowerCase();
    const allowed = PILLAR_ANGLES[pillar] || PILLAR_ANGLES.product;
    if (pillar === 'festival') { out[i] = 'timing'; bump(pillar, 'timing'); return; }
    const given = String(p.angle || '').toLowerCase();
    if (given && allowed.includes(given)) { out[i] = given; bump(pillar, given); }
  });

  // ② 其余按贪心补齐
  posts.forEach((p, i) => {
    if (out[i]) return;
    const pillar = String(p.pillar || 'product').toLowerCase();
    const allowed = PILLAR_ANGLES[pillar] || PILLAR_ANGLES.product;

    // 计划器没给角度时,先从标题猜一个当种子 —— 猜中了就省一次错配
    // (「How to choose fan size」猜成 knowledge 比贪心随便给一个准得多)。
    const seed = inferAngle(p);
    const ordered = seed && allowed.includes(seed)
      ? [seed, ...allowed.filter((a) => a !== seed)]
      : allowed;

    const withinCaps = ordered.filter((a) => {
      if (a === 'spec' && globalCount.spec >= MAX_SPEC_POSTS) return false;
      if (inPillar(pillar, a) >= MAX_SAME_ANGLE_PER_PILLAR) return false;
      return true;
    });
    // 全被上限剔光 → 放宽到 pillar 允许的全集(有角度 > 卡死)
    const pool = withinCaps.length ? withinCaps : ordered;

    let best = pool[0];
    for (const a of pool) {
      const cur = [globalCount[best], inPillar(pillar, best), pool.indexOf(best)];
      const cand = [globalCount[a], inPillar(pillar, a), pool.indexOf(a)];
      if (cand[0] < cur[0] || (cand[0] === cur[0] && cand[1] < cur[1])) best = a;
    }
    out[i] = best;
    bump(pillar, best);
  });

  // ③ 品牌事实配额:按角度亲和度分到具体某几篇,其余篇一条都不提
  const facts = posts.map(() => null);
  for (const key of BRAND_FACT_KEYS) {
    const f = BRAND_FACTS[key];
    const candidates = posts
      .map((p, i) => ({ i, pillar: String(p.pillar || '').toLowerCase(), angle: out[i] }))
      .filter((c) => c.pillar !== 'festival' && !facts[c.i])
      // 亲和度靠前的优先;都不亲和的排最后(仍可用,配额优先于完美匹配)
      .sort((a, b) => {
        const ra = f.affinity.indexOf(a.angle), rb = f.affinity.indexOf(b.angle);
        return (ra < 0 ? 99 : ra) - (rb < 0 ? 99 : rb) || a.i - b.i;
      });
    for (const c of candidates.slice(0, f.quota)) facts[c.i] = key;
  }

  return posts.map((_, i) => ({ angle: out[i], brandFact: facts[i] }));
}

/**
 * planContentAngles 的日期版 —— 按 suggested_date 排序后分配，再还原成入参顺序。
 *
 * 为什么必须按日期:贪心是顺序敏感的,而「整月读起来是否多样」是按发布顺序
 * 感受的。按 LLM 吐出来的随机顺序分配,可能把三篇痛点排进同一周。
 *
 * @param {Array} posts
 * @returns {Array<{angle:string, brandFact:string|null}>} 与入参下标对齐
 */
function planContentAnglesByDate(posts = []) {
  const order = posts
    .map((p, i) => ({ p, i }))
    .sort((a, b) => String(a.p.suggested_date || '').localeCompare(String(b.p.suggested_date || '')) || a.i - b.i);
  const assigned = planContentAngles(order.map((o) => o.p));
  const out = new Array(posts.length);
  order.forEach((o, k) => { out[o.i] = assigned[k]; });
  return out;
}

// ============================================
// 提示词块
// ============================================

/**
 * 给文案 agent 的「这篇走什么角度」块。
 * @param {string} angle
 * @param {string|null} brandFact - BRAND_FACTS 的 key,或 null = 一条都不许提
 */
function angleBlock(angle, brandFact) {
  const a = ANGLES[angle];
  if (!a) return '';
  const others = ANGLE_KEYS.filter((k) => k !== angle).map((k) => ANGLES[k].brief);

  const factLine = brandFact && BRAND_FACTS[brandFact]
    ? `- This post has been allotted exactly ONE brand fact: ${BRAND_FACTS[brandFact].say}.\n` +
      `  Work it in where it genuinely belongs — one mention, in prose, never as a headline claim\n` +
      `  and never stacked with another brand fact. Do NOT mention any of the others.`
    : `- This post has been allotted NO brand fact. Do NOT mention the warranty, SIRIM, the DC motor,\n` +
      `  the liability insurance, on-site service, or "10+ years". Not once, not in passing, not at\n` +
      `  the end. This post's job is its angle. Across the month those facts are covered by other\n` +
      `  posts — repeating them here is exactly what makes a month of posts read like one advert.`;

  return `
THIS POST'S CONTENT ANGLE: ${angle} (${a.zh}) — ${a.brief}
${a.guidance}

- Stay inside this angle. The other six angles (${others.slice(0, 3).join('; ')}; …) belong to
  OTHER posts this month. If this post drifts into them, the month stops feeling varied.
${factLine}`;
}

/**
 * 给图上文字提炼(design-agent.deriveImageText)的「这篇该抓什么」指令。
 * 雷3:图上文字抓的是**这篇的角度重点**,不是那三条卖点。
 */
const EXTRACTION_FOCUS = {
  knowledge: 'Pull out the TIP ITSELF — the rule, the number-free guideline, the choice being ' +
    'explained. The headline should read like something the reader learns, e.g. a room-to-size rule ' +
    'or a light-vs-no-light choice. Never a slogan.',
  scenario: 'Pull out the FEELING OF THE SPACE and the moment — the room, the time of day, the ' +
    'comfort. The headline should place the reader somewhere, not sell them something.',
  aesthetic: 'Pull out the LOOK — the finish, the material, the interior style it belongs with. ' +
    'The headline should be about how it looks in a room, not about how it performs.',
  timing: 'Pull out the OCCASION or SEASON this post is anchored to — the weather, the holiday, ' +
    'the moment in the year. The headline should feel dated to right now.',
  emotion: 'Pull out the BRAND MESSAGE — the years, the homes, the promise, the human bit. ' +
    'No specification, no size, no certification on the image.',
  painpoint: 'Pull out the PROBLEM in the reader\'s own words. A short question is a strong ' +
    'headline here. Put the resolution in the subheading, not the headline.',
  spec: 'Pull out the CONCRETE FEATURE or specification that this post is actually built on. ' +
    'This is the one angle where a spec belongs on the image.',
};

/** promo 帖子无论角度是什么,图上要抓的都是优惠本身。 */
const PROMO_EXTRACTION_FOCUS =
  'This is a promotion. Pull out the OFFER and its DEADLINE — but only terms that literally ' +
  'appear in the post. If the post states no discount figure and no end date (we have no real ' +
  'promotional terms on file), do NOT invent one: use the offer\'s plain description instead.';

function extractionFocus(angle, pillar) {
  if (String(pillar || '').toLowerCase() === 'promo') return PROMO_EXTRACTION_FOCUS;
  return EXTRACTION_FOCUS[angle] || EXTRACTION_FOCUS.spec;
}

// ============================================
// 代码层校验(整月)
// ============================================

/**
 * 校验整月的角度分布 + 品牌事实用量。
 *
 * 分成两件事:
 *   · 角度分布 —— 查的是**分配结果**(planContentAngles 的输出),
 *     这是代码算的,理论上永远合规;真报警说明分配逻辑或 pillar 组合有问题。
 *   · 品牌事实 —— 查的是**模型实际写出来的正文**,这是概率性的,
 *     报警说明模型没听话(超配额=旧毛病复发,欠配额=信任信号丢了)。
 *
 * @param {Array<{pillar?:string, angle?:string, fb_content?:string}>} rows
 * @returns {{ok:boolean, alerts:string[], detail:object}}
 */
function checkAngleDistribution(rows = []) {
  const alerts = [];
  const regular = rows.filter((r) => String(r.pillar || '').toLowerCase() !== 'festival');

  // ① 角度分布
  const counts = {};
  for (const r of rows) {
    const a = r.angle;
    if (!a) continue;
    counts[a] = (counts[a] || 0) + 1;
  }
  const missingAngle = rows.filter((r) => !r.angle).length;
  if (missingAngle) alerts.push(`有 ${missingAngle} 篇没有分配内容角度`);

  const distinct = Object.keys(counts).length;
  if (distinct < MIN_DISTINCT_ANGLES) {
    alerts.push(`整月只覆盖 ${distinct} 类角度(下限 ${MIN_DISTINCT_ANGLES})——13 篇会读起来像同一篇的变体`);
  }
  const specCount = counts.spec || 0;
  if (specCount > MAX_SPEC_POSTS) {
    alerts.push(`产品角度 ${specCount} 篇(上限 ${MAX_SPEC_POSTS})——卖点帖太多`);
  }

  // 同一 pillar 内的角度差异
  const byPillar = new Map();
  for (const r of rows) {
    const p = String(r.pillar || 'product').toLowerCase();
    if (p === 'festival' || !r.angle) continue;
    if (!byPillar.has(p)) byPillar.set(p, []);
    byPillar.get(p).push(r.angle);
  }
  for (const [p, list] of byPillar) {
    const t = {};
    for (const a of list) t[a] = (t[a] || 0) + 1;
    for (const [a, n] of Object.entries(t)) {
      if (n > MAX_SAME_ANGLE_PER_PILLAR) {
        alerts.push(`pillar「${p}」里有 ${n} 篇都走 ${ANGLES[a] ? ANGLES[a].zh : a} 角度(上限 ${MAX_SAME_ANGLE_PER_PILLAR})`);
      }
    }
  }

  // ② 品牌事实实际用量 vs 配额区间
  const factCounts = {};
  for (const key of BRAND_FACT_KEYS) {
    const f = BRAND_FACTS[key];
    const hits = regular.filter((r) => f.detect.test(String(r.fb_content || '')));
    factCounts[key] = hits.length;
    const [lo, hi] = f.band;
    if (hits.length > hi) {
      alerts.push(`「${f.zh}」出现在 ${hits.length}/${regular.length} 篇(整月上限 ${hi})——强制卖点的老毛病`);
    } else if (regular.length >= 8 && hits.length < lo) {
      alerts.push(`「${f.zh}」只出现 ${hits.length} 篇(整月下限 ${lo})——Fanz 最重要的信任信号被漏掉了`);
    }
  }

  return {
    ok: alerts.length === 0,
    alerts,
    detail: { angleCounts: counts, distinct, specCount, brandFactCounts: factCounts, regularPosts: regular.length },
  };
}

/** 压成一段可直接发 Telegram / 存 plan notes 的文字 */
function formatAngleReport(result) {
  if (!result || result.ok) return null;
  return `⚠️ 内容角度/品牌事实分布有 ${result.alerts.length} 处问题:\n` +
    result.alerts.map((a) => `• ${a}`).join('\n');
}

module.exports = {
  ANGLES,
  ANGLE_KEYS,
  PILLAR_ANGLES,
  BRAND_FACTS,
  BRAND_FACT_KEYS,
  MAX_SPEC_POSTS,
  MIN_DISTINCT_ANGLES,
  MAX_SAME_ANGLE_PER_PILLAR,
  planContentAngles,
  planContentAnglesByDate,
  inferAngle,
  angleBlock,
  extractionFocus,
  checkAngleDistribution,
  formatAngleReport,
};
