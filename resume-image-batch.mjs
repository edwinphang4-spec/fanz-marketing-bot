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
console.log('\n════ 自检警告(降级留痕)════');
let any = false;
for (const r of finalRows) {
  const s = specOf(r);
  if (s.warnings && s.warnings.length) { any = true; console.log(`• ${String(r.topic).slice(0, 40)}: ${s.warnings.join(' | ')}`); }
}
if (!any) console.log('(无)');
