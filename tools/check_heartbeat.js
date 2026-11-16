#!/usr/bin/env node
/**
 * Is the new-sets job on xproto still running? (16 Nov 2026)
 *
 * tools\update_sets.ps1 (binder-tcg) runs twice a day on the owner's PC and,
 * at the end of every run, force-pushes heartbeat.json to the `heartbeat`
 * branch of this repository:
 *   { at, lastOk, status, alerts: [..], en: {changed, addedCards},
 *     ja: {changed, addedCards}, sources: [{name, last, days}] }
 * `lastOk` is the end of the last run that did not fail.
 *
 * The Set job heartbeat workflow runs this once a day:
 *   node tools/check_heartbeat.js <heartbeat.json> [--report <file.md>] [--now <ISO>]
 * Exit 1 (and the workflow opens an issue, which GitHub emails) when the
 * file is missing or unreadable, when the job has not run for STALE_HOURS
 * (48 = four missed runs: PC off, task disabled, Windows password changed),
 * or when every run for STALE_HOURS has failed. The job's own alerts (a set
 * held for checking, a quiet source) are listed in the report as warnings.
 */
'use strict';
const fs = require('fs');

const STALE_HOURS = Number(process.env.STALE_HOURS || 48);

function hoursSince(iso, now) {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? (now - t) / 3600e3 : Infinity;
}

function when(iso) {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? new Date(t).toISOString().replace('T', ' ').slice(0, 16) + ' UTC' : 'never';
}

/** -> { problems: [..], warnings: [..], hb } */
function judge(text, now = Date.now()) {
  const problems = [], warnings = [];
  let hb = null;
  if (text == null) problems.push('No heartbeat at all: the `heartbeat` branch or its heartbeat.json is missing. The set job has never reported, or something deleted the branch.');
  else {
    try { hb = JSON.parse(String(text).replace(/^\uFEFF/, '')); } catch (e) { problems.push(`heartbeat.json is not readable JSON (${e.message}).`); }
  }
  if (hb) {
    const ran = hoursSince(hb.at, now), good = hoursSince(hb.lastOk, now);
    if (!(ran <= STALE_HOURS)) {
      problems.push(`The set job has not run since ${when(hb.at)} (${Number.isFinite(ran) ? Math.floor(ran) + ' hours' : 'no date'}). Is xproto on, and is the "In the Binder - new sets" scheduled task still enabled?`);
    } else if (!(good <= STALE_HOURS)) {
      problems.push(`The set job runs but has failed every time since ${when(hb.lastOk)}; last status "${hb.status}". See C:\\Users\\xproto\\itb-sets-logs on xproto.`);
    }
    for (const a of Array.isArray(hb.alerts) ? hb.alerts : []) warnings.push(String(a));
  }
  return { problems, warnings, hb };
}

function report({ problems, warnings, hb }) {
  const lines = ['## Set job heartbeat', ''];
  if (hb) {
    lines.push(`Last run: ${when(hb.at)} - ${hb.status || '?'}. Last good run: ${when(hb.lastOk)}.`);
    const n = (x) => (x && x.addedCards) || 0;
    lines.push(`New cards in that run: English ${n(hb.en)}, Japanese ${n(hb.ja)}.`);
    for (const s of Array.isArray(hb.sources) ? hb.sources : []) lines.push(`- Source ${s.name}: last change ${when(s.last)} (${s.days} days ago)`);
    lines.push('');
  }
  if (problems.length) lines.push('### Needs a look', '', ...problems.map((p) => `- ${p}`), '');
  if (warnings.length) lines.push('### Alerts from the job', '', ...warnings.map((w) => `- ${w}`), '');
  if (!problems.length) lines.push('All fine.');
  return lines.join('\n') + '\n';
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args.splice(i, 2)[1] : undefined; };
  const reportFile = opt('--report');
  const nowArg = opt('--now');
  const file = args[0];
  const text = file && fs.existsSync(file) && fs.statSync(file).size > 0 ? fs.readFileSync(file, 'utf8') : null;
  const r = judge(text, nowArg ? Date.parse(nowArg) : Date.now());
  const md = report(r);
  if (reportFile) fs.writeFileSync(reportFile, md);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
  for (const w of r.warnings) console.log(`::warning::${w}`);
  for (const p of r.problems) console.log(`::error::${p}`);
  console.log(r.problems.length ? `heartbeat: ${r.problems.length} problem(s)` : `heartbeat: fine (last run ${when(r.hb.at)})`);
  process.exit(r.problems.length ? 1 : 0);
}

module.exports = { judge, report, STALE_HOURS };
