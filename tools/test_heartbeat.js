#!/usr/bin/env node
// node tools/test_heartbeat.js - checks tools/check_heartbeat.js
'use strict';
const assert = require('assert');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { judge, report } = require('./check_heartbeat');

const now = Date.parse('2026-11-16T12:00:00Z');
const h = (hours) => new Date(now - hours * 3600e3).toISOString();
const hb = (o) => JSON.stringify({ status: 'nothing new', alerts: [], en: { addedCards: 0 }, ja: { addedCards: 0 }, sources: [], ...o });
let n = 0;
const t = (name, fn) => { fn(); n++; console.log('ok ', name); };

t('a run 12 hours ago is fine', () => {
  const r = judge(hb({ at: h(12), lastOk: h(12) }), now);
  assert.deepStrictEqual(r.problems, []);
});
t('47 hours is still fine, 49 is not', () => {
  assert.strictEqual(judge(hb({ at: h(47), lastOk: h(47) }), now).problems.length, 0);
  const r = judge(hb({ at: h(49), lastOk: h(49) }), now);
  assert.strictEqual(r.problems.length, 1);
  assert.match(r.problems[0], /has not run since 2026-11-14 11:00 UTC \(49 hours\)/);
});
t('one failed run is not a problem yet', () => {
  assert.strictEqual(judge(hb({ at: h(1), lastOk: h(13), status: 'failed' }), now).problems.length, 0);
});
t('failing for over two days is', () => {
  const r = judge(hb({ at: h(1), lastOk: h(60), status: 'failed' }), now);
  assert.strictEqual(r.problems.length, 1);
  assert.match(r.problems[0], /failed every time since/);
});
t('never a good run (no lastOk) counts as failing', () => {
  assert.match(judge(hb({ at: h(1), status: 'failed' }), now).problems[0], /failed every time since never/);
});
t('missing, empty or broken file', () => {
  assert.match(judge(null, now).problems[0], /No heartbeat at all/);
  assert.match(judge('{oops', now).problems[0], /not readable JSON/);
  assert.match(judge(hb({}), now).problems[0], /has not run since never/);
});
t('a BOM from PowerShell is fine', () => {
  assert.strictEqual(judge('﻿' + hb({ at: h(2), lastOk: h(2) }), now).problems.length, 0);
});
t('the job\'s alerts are warnings, not problems', () => {
  const r = judge(hb({ at: h(2), lastOk: h(2), alerts: ['New English cards held: 3 differences'] }), now);
  assert.deepStrictEqual(r.problems, []);
  assert.deepStrictEqual(r.warnings, ['New English cards held: 3 differences']);
  assert.match(report(r), /### Alerts from the job\n\n- New English cards held/);
});
t('the report names the sources and the counts', () => {
  const md = report(judge(hb({ at: h(2), lastOk: h(2), en: { addedCards: 141 }, sources: [{ name: 'English', last: h(100), days: 4 }] }), now));
  assert.match(md, /English 141, Japanese 0/);
  assert.match(md, /Source English: last change .* \(4 days ago\)/);
  assert.match(md, /All fine\./);
});
t('command line: exit codes and the report file', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'hb-'));
  const f = path.join(d, 'heartbeat.json'), md = path.join(d, 'r.md');
  const run = (...a) => { try { execFileSync(process.execPath, [path.join(__dirname, 'check_heartbeat.js'), ...a], { env: { ...process.env, GITHUB_STEP_SUMMARY: '' } }); return 0; } catch (e) { return e.status; } };
  fs.writeFileSync(f, hb({ at: h(3), lastOk: h(3) }));
  assert.strictEqual(run(f, '--now', new Date(now).toISOString(), '--report', md), 0);
  assert.match(fs.readFileSync(md, 'utf8'), /All fine/);
  assert.strictEqual(run(path.join(d, 'nope.json'), '--now', new Date(now).toISOString(), '--report', md), 1);
  assert.match(fs.readFileSync(md, 'utf8'), /No heartbeat at all/);
  fs.writeFileSync(f, '');
  assert.strictEqual(run(f, '--now', new Date(now).toISOString()), 1);
  fs.rmSync(d, { recursive: true });
});
console.log(`${n}/${n} passed`);
