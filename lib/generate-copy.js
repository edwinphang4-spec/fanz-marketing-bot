// ============================================
// generate-copy.js — **所有**文案生成的唯一入口
//
// 2026-08-05 查出来的事故隐患:buildCopywritingPrompt 全仓库有 6 个调用点,
// 但只有「月度批量」那一个传了新参数。其余 5 条路(Mark 单篇、/product 系列命令、
// 旧 /plan 选题流、以及**两处"驳回后重写"**)全部还是旧行为:
//   · 没有选品池 → 用写死的兜底清单,会写出库里没有的型号
//   · 没有内容角度/品牌事实配额 → 退回"每篇都塞保修+SIRIM+DC 马达"
//   · 不按排期日写 → "9/28 说国庆快到了"那个 bug 回来
//   · **没有编造拦截** → 编出来的数字直接发出去
//
// 最要命的是"驳回后重写":那是人工挑毛病之后走的路,恰恰是我们最花力气堵的洞,
// 却在那条路上完全敞开。老板娘一点驳回,拿到的就是没有任何质量保障的文案。
//
// 所以这里不是"再补一处",而是**收口**:把四样东西绑进一个函数,
// 所有路径都必须经过它。以后新增生成路径,漏传参数这件事从结构上不可能发生 ——
// 因为参数不再由调用方逐个传,而是由这里从 row 推出来。
// ============================================

const { buildCopywritingPrompt, parseCopywritingResponse, validateCopywritingResult } = require('./copywriting');
const { checkFabricatedClaims } = require('./qa-claims');
const { copywritingProductContext, pickProductsForPlan } = require('./pick-product');
const { planContentAngles } = require('./content-angles');

const MAX_CLAIM_ATTEMPTS = 2;

/** compose_spec 可能是对象也可能是字符串(PostgREST/历史数据都见过) */
function readSpec(row) {
  const raw = row && row.compose_spec;
  if (!raw) return {};
  if (typeof raw === 'object') return raw;
  try { return JSON.parse(raw); } catch (_) { return {}; }
}

/**
 * 单篇的品牌事实配额。
 *
 * 整月有配额表(保修 3-4 / SIRIM 2-3 / DC 3-4),单篇没有"月"可分配。
 * 默认给 null(一条都不提)—— 这和 Fanz 自己的真实帖子一致(他们 2026 年 7 月的
 * 帖子一条品牌事实都没提),也避免"每篇单独生成都在喊保修"。
 * 只有用户在选题里**明确要讲**某条时才放行那一条。
 */
function brandFactFromTopic(text) {
  const t = String(text || '').toLowerCase();
  if (/warranty|保修|保固|10[\s-]*year/.test(t)) return 'warranty';
  if (/sirim|认证|認證/.test(t)) return 'sirim';
  if (/dc motor|dc\s*马达|直流|静音|whisper|quiet/.test(t)) return 'dc_motor';
  return null;
}

/**
 * 生成一篇文案 —— 唯一入口。
 *
 * @param {object} opts
 * @param {object} [opts.row]        content_calendar 行(有就用它的排期日/产品/角度)
 * @param {string} opts.topic        选题
 * @param {string} opts.pillar       内容支柱
 * @param {string} [opts.reviewNotes] 驳回重写时的修改意见
 * @param {string} [opts.brandVoice]
 * @param {function} opts.callLLM    (messages, maxTokens) => Promise<string>
 * @param {boolean} [opts.assignProduct=true] 没有指定产品时,是否从选品池挑一个
 * @returns {Promise<{parsed, meta}>} meta = {product, angle, brandFact, attempts, claimIssues}
 * @throws 两次都编造 / 解析失败 / 校验失败
 */
async function generateCopy(opts) {
  const {
    row = null, topic, pillar, reviewNotes, brandVoice,
    callLLM, assignProduct = true,
  } = opts;
  if (typeof callLLM !== 'function') throw new Error('generateCopy: callLLM is required');
  if (!topic) throw new Error('generateCopy: topic is required');

  const spec = readSpec(row);

  // ── ① 产品 ──
  // row 上已经定了就用它;没定且允许分配,就从选品池挑一个(单篇也能拿到真实型号,
  // 而不是让文案在兜底清单里自由发挥)。
  let productName = (row && row.source_product_image) || null;
  let assignedByUs = false;
  if (!productName && assignProduct) {
    try {
      const picks = await pickProductsForPlan([{ id: row && row.id, pillar, topic, post_angle: (row && row.post_angle) || null }]);
      if (picks && picks[0]) { productName = picks[0].name; assignedByUs = true; }
    } catch (err) {
      console.error('[generate-copy] 选品失败,文案将只拿到系列清单:', err.message);
    }
  }
  const productCtx = await copywritingProductContext({ source_product_image: productName });

  // ── ② 内容角度 + 品牌事实配额 ──
  // 整月的角度是规划时算好写在 compose_spec 里的;单篇没有,现算一个。
  let angleCtx = null;
  if (spec.angle) {
    angleCtx = { angle: spec.angle, brandFact: spec.brand_fact || null };
  } else {
    try {
      const [a] = planContentAngles([{ pillar, topic, post_angle: (row && row.post_angle) || null }]);
      if (a && a.angle) {
        angleCtx = { angle: a.angle, brandFact: brandFactFromTopic(`${topic} ${(row && row.post_angle) || ''}`) };
      }
    } catch (err) {
      console.error('[generate-copy] 角度分配失败,本篇不带角度约束:', err.message);
    }
  }

  // ── ③ 按**这篇的排期日**写,不是今天 ──
  const postDate = (row && (row.suggested_date || row.scheduled_date)) || null;

  const prompt = buildCopywritingPrompt(
    topic, pillar, reviewNotes, brandVoice, productCtx, angleCtx, postDate
  );

  // ── ④ 编造拦截 + 重写 ──
  // 提示词只能"尽量",这里代码说了算:编了就重写一次,还编就抛错让人介入。
  const assignedMeta = productCtx && productCtx.assigned;
  const baseUser = `Generate social media content for this Fanz topic: "${topic}". Pillar: ${pillar}.`;
  let parsed = null, claimIssues = [], attempts = 0;
  for (let attempt = 1; attempt <= MAX_CLAIM_ATTEMPTS; attempt++) {
    attempts = attempt;
    const raw = await callLLM([
      { role: 'system', content: prompt },
      { role: 'user', content: attempt === 1 ? baseUser
        : `${baseUser}\n\nYour previous attempt was rejected for stating facts we cannot verify:\n${claimIssues.join('\n')}\nRewrite it without any unverifiable number.` },
    ]);
    const candidate = parseCopywritingResponse(raw);
    if (!candidate) throw new Error('Failed to parse copywriting response');
    const claims = checkFabricatedClaims(`${candidate.fb_content}\n${candidate.ig_content}`, assignedMeta);
    if (claims.ok) { parsed = candidate; break; }
    claimIssues = claims.blocking;
    console.warn(`[qa-claims] "${String(topic).slice(0, 40)}" 第 ${attempt} 次被拦: ${claimIssues.join(' | ')}`);
  }
  if (!parsed) throw new Error(`Unverifiable claims after ${MAX_CLAIM_ATTEMPTS} attempts: ${claimIssues.join('; ')}`);

  const validation = validateCopywritingResult(parsed);
  if (!validation.valid) throw new Error(`Validation failed: ${validation.errors.join('; ')}`);

  return {
    parsed,
    meta: {
      product: productName,
      productAssignedHere: assignedByUs,
      angle: angleCtx ? angleCtx.angle : null,
      brandFact: angleCtx ? angleCtx.brandFact : null,
      postDate,
      attempts,
      claimIssues: attempts > 1 ? claimIssues : [],
    },
  };
}

module.exports = { generateCopy, brandFactFromTopic, MAX_CLAIM_ATTEMPTS };
