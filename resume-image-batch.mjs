// 续跑某个 plan 里还没出图的帖子。
//
// 2026-08-03:13 张验收批因为 OpenAI 账户 billing hard limit 全部失败(0/13)。
// 文案已经生成并写进库了 —— 额度恢复后不该重跑文案(白花钱),只补出图这一步。
//
// 用法:  node resume-image-batch.mjs <PLAN_ID>
const REPO = '/Users/mryew/Projects/fanz-marketing-bot';
process.chdir(REPO);
const sb = await import(`${REPO}/lib/supabase.js`);
const pipe = await import(`${REPO}/lib/pipeline.js`);
const ca = await import(`${REPO}/lib/content-angles.js`);
const qc = await import(`${REPO}/lib/qa-content.js`);
const fs = await import('node:fs');

const planId = process.argv[2];
if (!planId) { console.error('用法: node resume-image-batch.mjs <PLAN_ID>'); process.exit(1); }

const rows = await sb.listContentCalendarByPlanId(planId);
const todo = (rows || []).filter((r) => r.fb_content && !r.image_url)
  .sort((a, b) => String(a.suggested_date).localeCompare(String(b.suggested_date)));
console.log(`plan ${planId}: ${rows.length} 篇,其中 ${todo.length} 篇待出图`);
if (!todo.length) process.exit(0);

// ── 出图前先验状态,别烧完钱才发现走不通 ──
//
// 2026-08-03 实测:第一张图整整生成了 182 秒、logo 也贴好了、自检也跑完了,
// 最后一步才被状态机拒掉("copy_done" → "image_ready" 不合法)—— 状态机没错,
// 是我建种子行时把 status 停在 copy_done(生产里那是「文案已生成,等人审」)。
// 出图合法起点是 copy_approved / image_retry。
// 这种检查必须在**花钱之前**做:错的状态提前一秒就能查出来,事后查代价是一次出图。
const IMAGERY_OK = ['copy_approved', 'image_retry'];
const badState = todo.filter((r) => !IMAGERY_OK.includes(r.status));
if (badState.length) {
  console.error(`\n⛔ ${badState.length} 篇的状态不能出图(合法起点:${IMAGERY_OK.join(' / ')}):`);
  for (const r of badState) console.error(`   ${r.suggested_date}  status=${r.status}`);
  console.error('\n生产流程里 copy_done 要先经人工审核才会变 copy_approved。');
  console.error('这是验收批就先推状态,再重跑本脚本。一张图 ~180 秒,别让它跑完才发现。');
  process.exit(1);
}
// 上一轮被中断留下的 generating 声明会让本轮跳过认领,先清掉
for (const r of todo) {
  if (r.image_status === 'generating') {
    try { await sb.updateContentCalendar(r.id, { image_status: 'pending' }); r.image_status = 'pending'; }
    catch (e) { console.error(`重置 ${r.suggested_date} 的 generating 声明失败: ${e.message}`); }
  }
}

const specOf = (r) => { try { return typeof r.compose_spec === 'string' ? JSON.parse(r.compose_spec) : (r.compose_spec || {}); } catch (_) { return {}; } };

const t0 = Date.now(); const results = [];
for (const r of todo) {
  const s = Date.now();
  let res;
  try { res = await pipe.runImageryPipeline(r.id, { fresh: true }); }
  catch (e) { res = { success: false, error: e.message }; }
  const secs = Math.round((Date.now() - s) / 1000);
  results.push({ id: r.id, topic: r.topic, angle: specOf(r).angle, ...res, secs });
  console.log(`${res.success ? '✅' : '❌'} ${r.suggested_date} [${specOf(r).angle || '?'}] ${secs}s ${res.success ? res.imageUrl : res.error}`);
  fs.default.writeFileSync('/Users/mryew/Desktop/fanz-image-batch.json', JSON.stringify({ planId, results }, null, 2));
  // 额度类错误没必要把剩下的全撞一遍 —— 早停,省时间也省日志噪音
  if (!res.success && /billing|quota|hard limit|insufficient/i.test(String(res.error))) {
    console.error('\n⛔ 账户额度问题,剩余 ' + (todo.length - results.length) + ' 篇未尝试。先解决额度再重跑本脚本。');
    break;
  }
}
console.log(`\n总耗时 ${Math.round((Date.now() - t0) / 60000)} 分钟,成功 ${results.filter((r) => r.success).length}/${results.length}`);

const finalRows = await sb.listContentCalendarByPlanId(planId);
const qaRows = finalRows.map((r) => {
  const s = specOf(r);
  return { topic: r.topic, pillar: s.is_festival ? 'festival' : r.pillar, angle: s.angle || null, fb_content: r.fb_content, imageTexts: s.image_texts || null };
});
console.log('\n════ 成品图上文字 ════');
for (const r of qaRows) {
  const t = r.imageTexts || {};
  console.log(`[${r.angle || '?'}] ${t.title || '(无)'} |副 ${t.selling_point || '-'} |CTA ${t.cta || '-'}`);
}
console.log('\n' + (qc.formatRepetitionReport(qc.checkMonthlyRepetition(qaRows)) || '✅ 成品查重零报警'));
console.log(ca.formatAngleReport(ca.checkAngleDistribution(qaRows)) || '✅ 角度/配额合规');
// ════ 自检结果:哪几张被拦下 / 重生成 / logo 挪过位 ════
// 这几件事以前只写在 console 里，跑完就查不到了 —— 验收要能逐张回答。
console.log('\n════ 自检结果(逐张)════');
const tally = { blocked: [], regen: [], moved: [], variantSwap: [], noLogo: [], warn: [] };
for (const r of finalRows.sort((a, b) => String(a.suggested_date).localeCompare(String(b.suggested_date)))) {
  const s = specOf(r);
  const q = s.qa || {};
  const lp = s.logo_placement || {};
  const label = `${r.suggested_date} [${s.angle || '?'}]`;
  const bits = [];
  if (!r.image_url) { bits.push('❌ 未交付'); tally.blocked.push(label); }
  if (q.attempt > 1) { bits.push(`🔁 重生成 ${q.attempt - 1} 次`); tally.regen.push(label); }
  if (lp.movedFromDefault) { bits.push(`📍 logo ${lp.defaultPosition}→${lp.position}(${lp.reason})`); tally.moved.push(label); }
  else if (lp.position) bits.push(`📍 logo ${lp.position} 默认位(对比 ${lp.contrast}:1 杂乱 ${lp.busyness})`);
  if (lp.variant) bits.push(`logo ${lp.variant === 'blue' ? '蓝版' : '白版'}`);
  if (s.logo_series && lp.variant && !s.logo_series.includes(lp.variant)) tally.variantSwap.push(label);
  if ((s.warnings || []).some((w) => /NO logo/i.test(w))) { bits.push('⚠️ 没贴上 logo'); tally.noLogo.push(label); }
  if ((q.blocking || []).length) bits.push(`拦截: ${q.blocking.join('; ')}`);
  if ((q.failures || []).length) bits.push(`硬指标未过: ${q.failures.join('; ')}`);
  if ((q.warnings || []).length) { tally.warn.push(label); bits.push(`警告: ${q.warnings.slice(0, 3).join('; ')}`); }
  console.log(`${label} ${String(r.topic).slice(0, 34)}\n    ${bits.length ? bits.join('\n    ') : '一次过,零警告'}`);
}
console.log('\n────  汇总  ────');
console.log(`被拦下未交付 : ${tally.blocked.length}${tally.blocked.length ? ' — ' + tally.blocked.join(', ') : ''}`);
console.log(`重生成过     : ${tally.regen.length}${tally.regen.length ? ' — ' + tally.regen.join(', ') : ''}`);
console.log(`logo 挪过位  : ${tally.moved.length}${tally.moved.length ? ' — ' + tally.moved.join(', ') : ''}`);
console.log(`logo 换版本  : ${tally.variantSwap.length}`);
console.log(`没贴上 logo  : ${tally.noLogo.length}`);
console.log(`带警告交付   : ${tally.warn.length}`);

// 实测花费(图片 API 真实用量,不估算)
const usage = finalRows.map((r) => specOf(r).image_usage).filter(Boolean);
if (usage.length) {
  const outTok = usage.reduce((a, u) => a + (u.output_tokens || 0), 0);
  console.log(`\n图片 API 实测: ${usage.length} 次调用, output ${outTok} tokens`);
}

// 把成品图下载到桌面,方便直接看/发给 Edwin
const dir = '/Users/mryew/Desktop/fanz-batch-images';
fs.default.mkdirSync(dir, { recursive: true });
let saved = 0;
for (const r of finalRows.sort((a, b) => String(a.suggested_date).localeCompare(String(b.suggested_date)))) {
  if (!r.image_url) continue;
  try {
    const res = await fetch(r.image_url);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const buf = Buffer.from(await res.arrayBuffer());
    const s = specOf(r);
    fs.default.writeFileSync(`${dir}/${r.suggested_date}-${s.angle || 'x'}.png`, buf);
    saved++;
  } catch (e) { console.error(`下载失败 ${r.suggested_date}: ${e.message}`); }
}
console.log(`\n成品图已存到 ${dir}(${saved} 张)`);
