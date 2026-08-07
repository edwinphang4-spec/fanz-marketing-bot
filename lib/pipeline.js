// ============================================
// pipeline.js — 配图流水线编排 [I-5]（合成版）
//
// 新链路：文案 → 背景 prompt（LLM）→ 纯背景生成（云端存储）→
//         确定性合成（产品 + logo + 文字模板）→ 成品上传 → image_ready
//
// compose_spec (jsonb) 记录合成的全部输入（背景 URL/产品/文字/位置），
// Dashboard 改字/换产品后只需 recomposeOnly 重合成——不再调图像 AI，
// 秒级完成、零生成成本。背景存 Supabase Storage，跨部署可用。
//
// compose_spec 列缺失时降级运行（不落 spec，只警告），部署顺序无关；
// 但 Dashboard 编辑功能依赖该列（migration: alter table content_calendar
// add column if not exists compose_spec jsonb）。
// ============================================

const path = require('path');
const fs = require('fs');
const os = require('os');
const supabase = require('./supabase');
const { generateBackground } = require('./background-gen');
const { composeFinal } = require('./compose');
const { extractTextsFromRow } = require('./text-overlay');
const { storeFinalImage } = require('./store-image');
const { updateImageRow } = require('./image-state');
const { PRODUCTS_DIR, selectProductImage, writeSourceProductImage } = require('./select-product');
const brandKit = require('./brand-kit');
const { pickTemplate } = require('./design-templates');
const brand = require('./brand');
const { buildReferenceImagePrompt } = require('./design-agent');
const sharp = require('sharp');
const qa = require('./qa-image');
const { generateReferenceImage } = require('./reference-image-gen');

/**
 * Normalize compose_spec from the row (PostgREST returns jsonb as object,
 * but tolerate a stringified value).
 */
function readSpec(row) {
  const raw = row.compose_spec;
  if (!raw) return {};
  if (typeof raw === 'object') return raw;
  try { return JSON.parse(raw); } catch (_) { return {}; }
}

/** Best-effort spec persistence — tolerate a missing compose_spec column. */
async function saveSpec(rowId, spec) {
  try {
    await supabase.updateContentCalendar(rowId, { compose_spec: spec });
    return true;
  } catch (err) {
    console.error(`[pipeline] compose_spec not persisted (column missing?): ${err.message}`);
    return false;
  }
}

/**
 * Resolve which product asset to compose. source_product_image 是唯一事实源
 * （Dashboard 换产品 / worker [product-next] 都写这一列）。
 *
 * 解析顺序：brand_assets（Dashboard 上传的真实素材，按 name 匹配，返回
 * Storage URL）→ 本地 assets/products/ 兜底（brand_assets 为空/DB 不可用）
 * → 自动选图。返回 { name, source, slot? }，source 可为 URL 或本地路径。
 */
async function resolveProduct(row) {
  const name = row.source_product_image || null;

  // 1) brand_assets（云端真实素材库）
  if (name) {
    try {
      const asset = await brand.getProductAssetByName(name);
      if (asset && asset.public_url) {
        // meta 带着素材库的结构化规格（叶数/有无灯/真实木色）——出图时当硬约束用，
        // 事前禁止模型加灯改叶数，比事后重生成便宜得多。
        return {
          name: asset.name,
          source: asset.public_url,
          slot: asset.default_product_slot || null,
          meta: asset.metadata || null,
        };
      }
    } catch (_) { /* DB 不可用 → 落到本地兜底 */ }
  }

  // 2) 本地 assets/products/ 兜底 —— 仅当 name 像文件名（带图片扩展名）。
  //    source_product_image 也可能是 brand_assets 的显示名（如 "Grande L Fan"），
  //    那种名字 path.join 到本地永远不存在，跳过这层直接落到云端库兜底。
  const looksLikeFilename = name && /\.(png|jpe?g|webp|svg)$/i.test(name);
  const fromRow = looksLikeFilename ? path.join(PRODUCTS_DIR, name) : null;
  if (fromRow && fs.existsSync(fromRow)) {
    return { name, source: fromRow, slot: null };
  }

  // 3) 云端库有产品但名字对不上 → 从"已确认可用"的选品池里挑一个。
  //
  //    2026-07-30 修:原来是 list[0]，两个真问题——
  //    ① 全表 sort_order 都是 0，"第一个"由数据库返回顺序决定，同一条查询
  //       换个 limit 就换一台风扇（实测 grandev2mb / FERRO 各返回过一次）；
  //    ② 整月 13 篇都落到兜底时，13 篇会共用同一台风扇。
  //    现在:只取 metadata.in_pool（系列/尺寸/LED/颜色全部确认、非低清）的行，
  //    再按 row.id 哈希稳定取模——同一篇永远同一台（可复现），不同篇自然分散。
  try {
    const list = await brand.listProductAssets();
    const pool = list.filter((a) => a && a.metadata && a.metadata.in_pool === true && a.public_url);
    const candidates = pool.length > 0 ? pool : list;
    if (candidates.length > 0) {
      let h = 0;
      for (const ch of String(row.id)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
      const pick = candidates[h % candidates.length];
      console.error(
        `[pipeline] product "${name || '(none)'}" not resolved — picked "${pick.name}" ` +
        `from ${pool.length > 0 ? 'verified pool' : 'unverified list (pool empty!)'} of ${candidates.length}`
      );
      try { await writeSourceProductImage(row.id, pick.name); } catch (_) {}
      return {
        name: pick.name,
        source: pick.public_url,
        slot: pick.default_product_slot || null,
        meta: pick.metadata || null,
      };
    }
  } catch (_) {}

  // 4) 本地自动选图（最终兜底）
  if (name) console.error(`[pipeline] product "${name}" unresolved anywhere — auto-selecting from local library`);
  const picked = selectProductImage(row.pillar || 'product', row.topic || '');
  if (picked && fs.existsSync(picked.filepath)) {
    try { await writeSourceProductImage(row.id, picked.filename); } catch (_) {}
    return { name: picked.filename, source: picked.filepath, slot: null };
  }
  throw new Error('No usable product image found');
}

/**
 * 收集同一个月已经印在别的图上的标题/副标题/CTA。
 *
 * 提炼层逐篇跑，没有这份清单它只能凭措辞规避重复 —— 实测不够:Fanz 自己的
 * 真实收尾就是 "DM us today"，13 篇里 3 篇的 CTA 照样撞。给它真实的已用清单
 * 才是代码层的解法。任何一步失败都返回空对象，绝不因为查重挡住出图。
 *
 * @returns {Promise<{avoidTitles:string[], avoidSubheads:string[], avoidCtas:string[]}>}
 */
async function collectUsedImageTexts(row) {
  const empty = { avoidTitles: [], avoidSubheads: [], avoidCtas: [] };
  if (!row || !row.plan_id) return empty;
  try {
    const siblings = await supabase.listContentCalendarByPlanId(row.plan_id);
    const seen = { avoidTitles: new Set(), avoidSubheads: new Set(), avoidCtas: new Set() };
    for (const s of siblings || []) {
      if (!s || s.id === row.id) continue;
      let spec = {};
      try { spec = typeof s.compose_spec === 'string' ? JSON.parse(s.compose_spec) : (s.compose_spec || {}); } catch (_) { continue; }
      const t = spec.image_texts;
      if (!t) continue;
      if (t.title) seen.avoidTitles.add(String(t.title).trim());
      if (t.selling_point) seen.avoidSubheads.add(String(t.selling_point).trim());
      if (t.cta) seen.avoidCtas.add(String(t.cta).trim());
    }
    // 只带最近的一批，避免月底那几篇拖着十几条禁用清单把提示词撑爆
    const cap = (s) => [...s].slice(-10);
    return { avoidTitles: cap(seen.avoidTitles), avoidSubheads: cap(seen.avoidSubheads), avoidCtas: cap(seen.avoidCtas) };
  } catch (err) {
    console.error('[pipeline] 读取整月已用图上文字失败(不阻断):', err.message);
    return empty;
  }
}

/**
 * Run the imagery pipeline for a content_calendar row.
 *
 * @param {string} rowId - content_calendar row UUID
 * @param {object} [opts]
 * @param {string} [opts.topicOverride] - reviewer scene request ("change scene"),
 *   passed to background prompt derivation; forces a new background
 * @param {boolean} [opts.fresh] - clear image_url so store-image's idempotency
 *   guard does not silently keep the old final image (any regenerate/recompose)
 * @param {boolean} [opts.recomposeOnly] - reuse the existing background from
 *   compose_spec and only re-run the deterministic composition (change text /
 *   change product). Falls back to generating a background if none exists.
 * @returns {Promise<{success: boolean, imageUrl?: string, error?: string, isDryRun?: boolean}>}
 */
async function runImageryPipeline(rowId, opts = {}) {
  try {
    // Step 0: Read the row
    const row = await supabase.getContentCalendar(rowId);
    if (!row) {
      return { success: false, error: 'Row not found' };
    }

    // Claim if the caller (worker) hasn't already. Conditional PATCH —
    // a lost race means another process owns this row.
    if (row.image_status !== 'generating') {
      await updateImageRow(rowId, { image_status: 'generating' }, row.image_status || 'pending');
    }

    if (opts.fresh) {
      await supabase.updateContentCalendar(rowId, { image_url: null });
      row.image_url = null;
    }

    // 品牌套件（色板/声音/背景风格/logo/默认版式）——DB 挂了返回内置默认，不崩
    const kit = await brand.getBrandKit();

    // 降级留痕:任何"图还是出了但缺了要素"的情况都往这里记，最后落进
    // compose_spec.warnings 并随返回值上抛（worker 会带进 Telegram 审核卡）。
    // 2026-07-30 事故教训:两张 educational 成品没有风扇却照样标记成功，
    // 因为降级只写在 console 里，没人看得到。
    const warnings = [];

    const spec = readSpec(row);
    // 节庆图整张是模型画的、且明令不许出现产品 —— 给它挑一台风扇没有意义,
    // 只会在 compose_spec 里留下一个"这篇讲 FS 423L"的假记录(2026-08-06 实测)。
    const isFestivalRow = spec.is_festival === true || (() => {
      try { return require('./festival-handler').isFestivalPost(row); } catch (_) { return false; }
    })();
    const product = isFestivalRow
      ? { name: null, source: null, slot: null, meta: null }
      : await resolveProduct(row);
    spec.v = 1;
    spec.product = product.name;

    // 内容角度是规划时算好写进 compose_spec 的（content_calendar 没有专门的列）。
    // 提炼图上文字要按角度抓重点，所以在这里把它挂回 row 上传下去。
    if (!row.angle && spec.angle) row.angle = spec.angle;
    // is_festival 同理:规划时写在 compose_spec 里(pillar 落库会被映射成 story,
    // 写完就分不出节庆帖了)。2026-08-06 查出来它一直没被挂回 row —— design-agent
    // 里那个"节庆图只留祝福语"的判断读的正是 row.is_festival,于是从未生效。
    if (row.is_festival === undefined && spec.is_festival !== undefined) row.is_festival = spec.is_festival;

    // ─── Step 0.5: 设计模板（九 tag 路由）───先选模板，版式精度才排得对
    const template = pickTemplate(row);
    spec.template = template.tag;
    spec.mode = template.mode;

    // 版式优先级：spec（Dashboard 手改过）> 素材自带摆位 > 模板建议
    //           > brand_kit 全局默认。模板知道"这类帖该长什么样"（如
    //           product_intro 的风扇要贴顶大幅摆放），排在品牌全局默认之前。
    spec.product_slot = spec.product_slot || product.slot || template.productSlot ||
      (kit.default_layout && kit.default_layout.product_slot) || brandKit.DEFAULT_PRODUCT_SLOT;
    spec.title_slot = spec.title_slot ||
      (kit.default_layout && kit.default_layout.title_slot) || brandKit.DEFAULT_TITLE_SLOT;
    // 文字：spec（Dashboard 编辑过）优先，否则从 row 提取（默认 title=topic）
    spec.texts = (spec.texts && Object.keys(spec.texts).length > 0)
      ? spec.texts
      : extractTextsFromRow(row);

    // logo 变体按模板挑（深底白/浅底蓝/lockup），查不到回退 brand_kit 单 logo
    let templateLogoUrl = null;
    try {
      const { getLogoAssetBySeries } = require('./brand');
      const la = await getLogoAssetBySeries(template.logoSeries);
      templateLogoUrl = la && la.public_url;
    } catch (_) {}
    const logoUrl = templateLogoUrl || kit.logo_url;

    const outPath = path.join(
      os.tmpdir(),
      `final-${rowId.replace(/-/g, '').slice(0, 12)}-${Date.now()}.png`
    );
    try {
      if (template.mode === 'ai_reference') {
        // ─── AI 原生整图生成（产品图+logo 当参考图，一步到位）───
        // 2026-07-24 架构转向：贴纸式合成被判定"没有设计感"，改为让模型自己
        // 处理光影/阴影/排版/logo/徽章。代价：不再有 recomposeOnly 的免费
        // 秒级重合成——任何改动都是一次新的付费生成（Edwin 已确认接受）。
        //
        // logo/徽章的代码贴层（applyLogoOverlay/applyBadgeOverlay）已退役：
        // 那是给旧模型 gpt-image-1 擦屁股的补丁（logo 张冠李戴、小字拼错）；
        // gpt-image-2 实测两样都直出全对，贴层反而是画面里最丑的部分。
        // 整月已经用过的图上文字 —— 从同一个 plan 的兄弟行读。
        // 提炼层是逐篇跑的，没有这个输入它不可能知道"这句已经印在另外三张图上了"。
        // 读不到就当空（不阻断），qa-content 的整月查重仍然会兜住。
        const usedTexts = await collectUsedImageTexts(row);
        const { prompt, texts: designTexts, sceneMode, logoSeries, explainerPanel } = await buildReferenceImagePrompt(
          row, template, product.name, kit.brand_voice, product.meta, kit.colors,
          {
            ...usedTexts,
            imageFeedback: opts.imageFeedback || null,
            // 重出时把上一版图上文字带上 —— 她没要求改字就不许换(2026-08-06)
            currentTexts: spec.image_texts || null,
          }
        );
        if (opts.imageFeedback) spec.image_feedback = opts.imageFeedback;
        spec.design_prompt = prompt;
        spec.scene_mode = sceneMode;

        // logo 变体按"这张图实际抽到的场景明暗"取，而不是模板写死的那个。
        // 2026-07-30 Edwin 目检修:product_intro 写死白色 logo，抽到明亮卧室
        // 就不可读，模型自己垫了个黑底方框（花朵和 tagline 也丢了，因为挂的是
        // wordmark 不是三件套 lockup）。现在亮场景取 lockup_blue、暗场景取
        // lockup_white，取不到再退回模板配置那个。
        let refLogoUrl = logoUrl;
        try {
          const { getLogoAssetBySeries } = require('./brand');
          const la = await getLogoAssetBySeries(logoSeries);
          if (la && la.public_url) refLogoUrl = la.public_url;
          else console.error(`[pipeline] logo series "${logoSeries}" unavailable — falling back to ${template.logoSeries}`);
        } catch (err) {
          console.error(`[pipeline] logo series lookup failed (${logoSeries}):`, err.message);
        }
        spec.logo_series = logoSeries;
        // 出图时提炼的图上文案存进 spec —— 视频版(video-gen)复用同一份，
        // 保证动图上的标题/CTA/徽章跟静态图一字不差。
        spec.image_texts = designTexts;

        if (!refLogoUrl) {
          await releaseClaim(rowId);
          return { success: false, error: 'ai_reference mode requires a logo asset (none resolved)' };
        }

        // 2026-07-30 Edwin 目检修:logo 不再当参考图喂给模型。
        // 实测放大对比,模型是"重画"logo 而不是复制——花朵中心的双圈圆环丢了、
        // 花瓣从圆润变成带棱角。整张画布重绘的模型做不到像素级复制,靠提示词
        // 也管不住。改成 prompt 要求该角落留空 + 生成后用 sharp 贴真实 PNG,
        // 100% 保真。节庆 full_ai 那条路一直是这么做的,这里只是对齐。
        // 自检重试:硬伤才重画,最多 2 次(Edwin 定的红线)。
        // 审美问题一律不重画 —— 重画一次 ~215 秒 + 一次出图钱,不值得为口味烧。
        const QA_MAX_ATTEMPTS = 2;
        let ref = null, finalBuffer = null, qaResult = null, variantPick = null;
        let logoPosition = template.logoPosition;
        const logoRatio = template.logoWidthRatio || qa.LOGO_INK_RATIO_TARGET;

        for (let attempt = 1; attempt <= QA_MAX_ATTEMPTS; attempt++) {
        ref = await generateReferenceImage({
          prompt,
          productSource: product.source,
        });
        if (!ref.success) {
          await releaseClaim(rowId);
          return { success: false, error: ref.error || 'Reference-image generation failed' };
        }
        // 图片 API 的真实用量落库 —— 整月批量要能报实测花费,不靠估算
        if (ref.usage) spec.image_usage = ref.usage;
        if (ref.dryRun) {
          await updateImageRow(rowId, { image_status: 'generated' }, 'generating');
          await supabase.updateContentCalendar(rowId, { status: 'image_ready' });
          return { success: true, imageUrl: '(dry-run)', isDryRun: true };
        }

        // ── 贴真实 logo:蓝白版按真实 WCAG 对比度选，不再拿灰度阈值猜 ──
        //
        // 2026-07-30:此前用"灰度均值 + 拍脑袋阈值"选版，连错三次。改成算
        // 品牌蓝/白各自与实测背景的对比度：品牌蓝够 3:1(WCAG 图形门槛)就用
        // 品牌蓝，够不着才退白版。logo 是我们自己贴的，所以选错可以零成本重贴。
        finalBuffer = ref.buffer;
        try {
          const { applyLogoOverlay } = require('./compose');
          const { getLogoAssetBySeries } = require('./brand');
          // 位置也按构图选:默认用模板位,只有该角落对比不够或太杂乱才挪。
          // 2026-08-01 去 Fanz 官方账号实地看内容发现他们位置是变的(左上/右下/
          // 下方居中都用),跟着构图走。
          const placement = await qa.pickLogoPlacement(ref.buffer, {
            logoWidthRatio: logoRatio,
            preferredPosition: template.logoPosition,
            // 文字区是我们在提示词里规定的（design-agent.TEXT_ZONE），不是检测出来的 ——
            // 挪位时据此排除会压到标题的角落。2026-08-03:09-30 挪到左上后紧贴标题，
            // 三种探测文字位置的办法全部失败，所以改成由构造得知。
            textZone: require('./design-agent').TEXT_ZONE,
          });
          logoPosition = placement.position;
          spec.logo_position = logoPosition;
          // 摆位判断落库,不只写 console —— 验收时要能回答"这张的 logo 为什么在这儿、
          // 有没有被挪过、当时量到的对比度和杂乱度是多少"。只活在日志里等于查不到。
          spec.logo_placement = {
            position: placement.position,
            variant: placement.variant,
            contrast: placement.contrast,
            busyness: placement.busyness,
            movedFromDefault: Boolean(placement.movedFromDefault),
            defaultPosition: template.logoPosition,
            scrim: Boolean(placement.scrim),
            luminance: placement.luminance,
            cBlue: placement.cBlue,
            cWhite: placement.cWhite,
            reason: placement.reason || 'default position kept',
            candidates: placement.all || null,
          };
          if (placement.movedFromDefault) {
            console.log(`[pipeline] logo moved ${template.logoPosition} -> ${logoPosition} (${placement.reason})`);
          }
          variantPick = { ...placement, contrastBlue: null, contrastWhite: null, reason: placement.reason || 'default position kept' };
          const wantSeries = placement.variant === 'blue' ? 'lockup_blue' : 'lockup_white';
          if (wantSeries !== logoSeries) {
            const la = await getLogoAssetBySeries(wantSeries);
            if (la && la.public_url) {
              console.log(`[pipeline] logo variant by contrast: ${logoSeries} -> ${wantSeries} (${variantPick.reason})`);
              refLogoUrl = la.public_url;
              spec.logo_series = wantSeries;
            }
          }
          finalBuffer = await applyLogoOverlay(ref.buffer, {
            logoUrl: refLogoUrl,
            logoPosition,
            logoWidthRatio: logoRatio,
            withBackdrop: false,
            // 浅色/中间调背景上蓝版对比偏弱时加一层极淡的雾，而不是退白版
            logoScrim: Boolean(placement.scrim),
          });
        } catch (err) {
          // logo 是品牌要素:贴不上要留痕(落 compose_spec + 审核卡),不能只写日志
          warnings.push(`logo overlay failed — image has NO logo: ${err.message}`);
          console.error('[pipeline] logo overlay failed, keeping image without logo:', err.message);
        }

        // ── 自检:代码能算准的先算,算不准的只报警 ──
        // 自检要按**这个版式实际画了什么**来查,不能一律按产品帖的三段文字。
        //
        // 2026-08-06:知识版式故意没有副标题、没有 CTA(教学图不在最后一行卖东西),
        // 自检却照旧找 selling_point/cta,报"文字没渲染出来" —— 检查的东西和实际
        // 版式对不上,是假警报。而真正该查的恰恰是面板里那几个数字:
        // 印错一位就是一条假声明。
        const checkTexts = explainerPanel
          ? {
            title: designTexts.title,
            panel_left: explainerPanel.left[2],
            panel_right: explainerPanel.right[2],
            panel_caption: explainerPanel.caption,
          }
          : designTexts;
        qaResult = await runSelfCheck(finalBuffer, {
          texts: checkTexts,
          productMeta: product.meta,
          logoPosition,
          logoWidthRatio: logoRatio,
          variantPick,
        });
        qaResult.attempt = attempt;
        const mustRedo = qaResult.blocking.length > 0 || qaResult.failures.length > 0;
        if (!mustRedo) break;                       // 通过,交付
        if (attempt < QA_MAX_ATTEMPTS) {
          console.warn(`[pipeline] QA attempt ${attempt} failed, regenerating: ` +
            `${[...qaResult.blocking, ...qaResult.failures].join('; ')}`);
          continue;                                  // 重画一次
        }
        // 最后一次仍不过:硬伤绝不交付;质量问题带警告交付
        if (qaResult.blocking.length) {
          spec.qa = qaResult;
          await saveSpec(rowId, spec);
          await releaseClaim(rowId);
          return {
            success: false,
            error: `QA blocked delivery after ${QA_MAX_ATTEMPTS} attempts: ${qaResult.blocking.join('; ')}`,
            qa: qaResult,
          };
        }
        }  // end QA retry loop

        // 视觉自检:只在最终成品上跑一次(省钱),结果**只报警不拦截**。
        // 叶数/有无灯这类判断视觉模型会错(建库时误判 6 次),不配当闸门。
        try {
          const { visionCheck } = require('./qa-vision');
          const vis = await visionCheck(finalBuffer, product.meta);
          if (vis.error) qaResult.warnings.push(`vision check unavailable: ${vis.error}`);
          else {
            qaResult.vision = vis.observed;
            qaResult.warnings.push(...vis.warnings);
          }
        } catch (err) {
          qaResult && qaResult.warnings.push(`vision check crashed: ${err.message}`);
        }

        spec.qa = qaResult;
        if (qaResult) {
          for (const f of qaResult.failures) warnings.push(`QA: ${f}`);
          for (const w of qaResult.warnings) warnings.push(`QA(warn): ${w}`);
        }
        fs.writeFileSync(outPath, finalBuffer);
      } else {
        // ─── 旧链路：背景生成 → 确定性合成（composite / festival full_ai）───
        const reuseBackground = Boolean(
          opts.recomposeOnly && spec.background_url && !opts.topicOverride
        );

        if (!reuseBackground) {
          // 节庆(full_ai)没有 topicOverride,但可能有 [img] 意见 —— 两者走同一个入口
          const bg = await generateBackground(
            row, opts.topicOverride || opts.imageFeedback || null, kit.background_style, template
          );
          if (!bg.success) {
            await releaseClaim(rowId);
            return { success: false, error: bg.error || 'Background generation failed' };
          }
          if (bg.dryRun) {
            // dry-run 红线：只跳过图像 API 那一下；状态机走完
            await updateImageRow(rowId, { image_status: 'generated' }, 'generating');
            await supabase.updateContentCalendar(rowId, { status: 'image_ready' });
            return { success: true, imageUrl: '(dry-run)', isDryRun: true };
          }
          spec.background_url = bg.backgroundUrl;
          spec.background_prompt = bg.prompt;
          // scene_image_url 同步存背景 URL（Dashboard/排查可见）
          await supabase.updateContentCalendar(rowId, { scene_image_url: bg.backgroundUrl });
        }

        const isFullAi = template.mode === 'full_ai';

        // 节庆(full_ai)这条路原本完全不量背景:logo 变体和位置都写死在模板里
        // (白版 + top_center)。2026-08-03 实测 09-16:米白中心面板配白 logo
        // 几乎看不见,还被标题压住。改成和 ai_reference 同一套判定 —— 量真实背景,
        // 品牌蓝优先,并挑一个不被文字占住的角落。量不到就退回模板配置,不阻断。
        let fullAiLogoUrl = logoUrl;
        let fullAiPosition = template.logoPosition;
        let fullAiScrim = false;
        // 量的和贴的必须是**同一个数**。
        //
        // 2026-08-06:测量用 `template.logoWidthRatio || 0.12`、合成用
        // `template.logoWidthRatio || brandKit.LOGO.widthRatio(0.22)` —— 模板没配
        // 这一项时(festival_lifestyle 就没配),会变成量 12% 宽、贴 22% 宽,
        // 覆盖面积是量过那块的 3.4 倍,干净度读数完全不作数。
        // festival_illustration 配了 0.20,所以它没踩到这个;但这是颗哑雷,一并拆掉。
        // (logo 素材实测 2000x2000 无透明边,墨宽=图宽,两个数是同一量纲。)
        const fullAiLogoRatio = template.logoWidthRatio || qa.LOGO_INK_RATIO_TARGET;
        if (isFullAi) {
          try {
            const { loadAsset } = require('./compose');
            const { buffer: bgBuf } = await loadAsset(spec.background_url);
            const placement = await qa.pickLogoPlacement(bgBuf, {
              logoWidthRatio: fullAiLogoRatio,
              preferredPosition: template.logoPosition,
              // 2026-08-06:节庆图用它自己的文字区。之前套的是参考图那套
              // (文字在下半部),而节庆的排版文字是**居中**的 —— 结果四个角
              // 全被判成压文字,判定无路可走退回默认位,守卫等于没装。
              textZone: require('./design-agent').FESTIVAL_TEXT_ZONE,
            });
            fullAiPosition = placement.position;
            fullAiScrim = Boolean(placement.scrim);
            const wantSeries = placement.variant === 'blue' ? 'lockup_blue' : 'lockup_white';
            const { getLogoAssetBySeries } = require('./brand');
            const la = await getLogoAssetBySeries(wantSeries);
            if (la && la.public_url) fullAiLogoUrl = la.public_url;
            spec.logo_position = fullAiPosition;
            spec.logo_series = wantSeries;
            spec.logo_placement = {
              position: placement.position,
              variant: placement.variant,
              contrast: placement.contrast,
              cBlue: placement.cBlue,
              cWhite: placement.cWhite,
              luminance: placement.luminance,
              busyness: placement.busyness,
              movedFromDefault: Boolean(placement.movedFromDefault),
              defaultPosition: template.logoPosition,
              scrim: fullAiScrim,
              reason: placement.reason,
              candidates: placement.all || null,
            };
          } catch (err) {
            warnings.push(`festival logo placement fell back to template defaults: ${err.message}`);
            console.error('[pipeline] full_ai logo placement failed, using template defaults:', err.message);
          }
        }

        const composed = await composeFinal({
          background: spec.background_url,
          productSource: isFullAi ? null : product.source,
          texts: isFullAi ? {} : spec.texts,
          productSlot: spec.product_slot,
          titleSlot: spec.title_slot,
          colors: { ...kit.colors, title: template.titleColor || (kit.colors && kit.colors.title) },
          logoUrl: fullAiLogoUrl,
          logoPosition: fullAiPosition,
          logoWidthRatio: fullAiLogoRatio,
          logoScrim: fullAiScrim,
          fonts: kit.fonts,
          outPath,
        });
        if (composed && composed.warnings && composed.warnings.length) {
          warnings.push(...composed.warnings);
        }
      }

      // ─── Step 3: 成品上传 ───
      const storeResult = await storeFinalImage(rowId, outPath);
      if (!storeResult.success) {
        await releaseClaim(rowId);
        return { success: false, error: storeResult.error || 'Image storage failed' };
      }

      // ─── Step 4: 落 spec + 状态 ───
      // 成品已入库（image_url 已写），主状态先行；image_status 收尾失败
      // 只记日志不翻盘——recoverStuckRows 会兜住滞留的 generating。
      if (warnings.length) {
        spec.warnings = warnings;
        console.warn(`[pipeline] row ${rowId} produced with ${warnings.length} warning(s): ${warnings.join(' | ')}`);
      }
      await saveSpec(rowId, spec);
      await supabase.updateContentCalendar(rowId, { status: 'image_ready' });
      try {
        await updateImageRow(rowId, { image_status: 'generated' }, 'generating');
      } catch (flipErr) {
        console.error(`[pipeline] image_status flip failed (non-fatal, row stored): ${flipErr.message}`);
      }

      return {
        success: true,
        imageUrl: storeResult.imageUrl,
        isDryRun: false,
        ...(warnings.length ? { warnings } : {}),
      };
    } finally {
      try { fs.unlinkSync(outPath); } catch (_) {}
    }
  } catch (err) {
    await releaseClaim(rowId);
    return { success: false, error: err.message };
  }
}

/**
 * 成品自检 —— 只查能量化的东西,分三档:
 *   blocking : 硬伤,不许交付(目前只有"图文矛盾":图上写的型号/尺寸和实际
 *              用的产品对不上。这条 100% 可用代码判定)
 *   failures : 该修但可零成本修好的(logo 有墨占比不在区间 / 对比度不达标)
 *   warnings : 只提示,不拦不重画(字太小的估算、卖点重复等)
 *
 * 刻意不做的事:不判断"好不好看"。自检只守下限,品味交给人抽查。
 * 叶数/有无灯/颜色/禁止元素属于视觉判断,实测视觉模型会误判(建库时把灰色
 * 机身盖当成灯 6 次),所以放在 qa-vision 里只报警,不在这里当闸门。
 */
async function runSelfCheck(imageBuffer, opts) {
  const out = { blocking: [], failures: [], warnings: [], metrics: {} };
  try {
    const meta = await sharp(imageBuffer).metadata();
    out.metrics.canvas = `${meta.width}x${meta.height}`;

    // ① logo 有墨占比(设定值核对,100% 可靠)
    const ratio = opts.logoWidthRatio || qa.LOGO_INK_RATIO_TARGET;
    out.metrics.logoInkRatio = +ratio.toFixed(4);
    if (ratio < qa.LOGO_INK_RATIO_MIN || ratio > qa.LOGO_INK_RATIO_MAX) {
      out.failures.push(`logo ink ratio ${(ratio * 100).toFixed(1)}% outside ${(qa.LOGO_INK_RATIO_MIN * 100)}-${(qa.LOGO_INK_RATIO_MAX * 100)}%`);
    }

    // ② logo 与背景的真实对比度
    if (opts.variantPick) {
      out.metrics.logoVariant = opts.variantPick.variant;
      out.metrics.logoContrast = opts.variantPick.variant === 'blue'
        ? opts.variantPick.contrastBlue : opts.variantPick.contrastWhite;
      out.metrics.logoBgRgb = opts.variantPick.bgRgb;
      if (out.metrics.logoContrast != null && out.metrics.logoContrast < qa.GRAPHIC_CONTRAST_MIN) {
        out.failures.push(`logo contrast ${out.metrics.logoContrast}:1 below ${qa.GRAPHIC_CONTRAST_MIN}:1 (both variants weak on this background)`);
      }
    }

    // ③ 卖点重复(纯字符串,100% 可靠)
    const dup = qa.checkDuplicateClaims(opts.texts || {});
    if (!dup.ok) {
      out.warnings.push(`duplicate claim across ${dup.duplicates.map((d) => d.fields.join('/')).join(', ')}`);
      out.metrics.duplicates = dup.duplicates;
    }

    // ④ 图文一致 —— 硬伤档
    const cons = qa.checkTextProductConsistency(opts.texts || {}, opts.productMeta);
    if (!cons.ok) out.blocking.push(...cons.issues);

    // ④b 编造的事实数字 —— 同样是硬伤,而且后果更重:图上印着"适合 225 平方尺"
    // 这种没依据的数字发到官方账号,客户照着买错要找 Fanz 投诉。
    const claims = require('./qa-claims').checkFabricatedClaims(
      ['title', 'selling_point', 'cta', 'promo_badge'].map((f) => (opts.texts || {})[f] || '').join(' . '),
      opts.productMeta
    );
    if (!claims.ok) out.blocking.push(...claims.blocking);
    out.warnings.push(...claims.warnings);

    // ⑤ OCR:文字有没有真渲染出来 + 最小行高(估算,只守低线)
    const ocr = await qa.ocrTextLines(imageBuffer, {
      logoPosition: opts.logoPosition, logoWidthRatio: ratio,
    });
    if (ocr.error) {
      out.warnings.push(`OCR unavailable: ${ocr.error}`);
    } else {
      out.metrics.minTextHeightRatio = ocr.minRatio;
      out.metrics.ocrLines = ocr.lines.map((l) => `${(l.heightRatio * 100).toFixed(1)}% "${l.text.slice(0, 30)}"`);
      if (ocr.belowRegenFloor) {
        out.failures.push(`smallest text line ${(ocr.minRatio * 100).toFixed(1)}% of canvas — below ${(qa.TEXT_HEIGHT_REGEN_FLOOR * 100)}% floor`);
      } else if (ocr.minRatio != null && !ocr.meetsTarget) {
        out.warnings.push(`smallest text line ${(ocr.minRatio * 100).toFixed(1)}% — under the ${(qa.MIN_TEXT_HEIGHT_RATIO * 100)}% target (warning only, estimate)`);
      }
      const rendered = qa.checkRenderedText(ocr.renderedText, opts.texts || {});
      if (!rendered.ok) {
        out.warnings.push(`text may not have rendered: ${rendered.missing.map((m) => m.field).join(', ')}`);
      }
    }
  } catch (err) {
    out.warnings.push(`self-check failed to run: ${err.message}`);
  }
  return out;
}

/**
 * Release the claim to 'failed' — from whatever image_status the row is
 * actually in (a post-store failure can leave it at 'generated', where a
 * fixed generating→failed guard would silently no-op and strand the claim).
 */
async function releaseClaim(rowId) {
  try {
    const row = await supabase.getContentCalendar(rowId);
    if (row && row.image_status === 'generating') {
      await updateImageRow(rowId, { image_status: 'failed' }, 'generating');
    }
  } catch (_) {
    // already moved on / transient read failure — recoverStuckRows兜底
  }
}

module.exports = {
  runImageryPipeline,
};
