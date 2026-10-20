#!/usr/bin/env node
/* tune_nscale.js -- search n-based parameter rules for the two-step solver.
 *
 * Every knob is a rule of n rather than a fixed number:
 *   islands = clamp(round(n / A), floor, cap)
 *   K       = max(16, round(n / B))
 *   near    = max(10, round(n / C))   candidate-list width for the screen
 *   screenF = F                       0 screens every beam final
 *
 * BGMA low and mid are measured once per instance as fixed references, so a
 * config is scored on the tour it returns and on the wall time it took.
 *
 * usage:
 *   node experiments/beam-screen-only/tune_nscale.js --A=8,12,16,20,25,32 --B=4,5 --C=8 --F=16
 *   node experiments/beam-screen-only/tune_nscale.js --ns=100,200,300,400 --seeds=3,4 --A=16 --B=5 --C=8 --F=16
 *   node experiments/beam-screen-only/tune_nscale.js --json=experiments/beam-screen-only/nscale.json
 */
'use strict';
const fs = require('fs');
const { B, beamScreen, runEffort } = require('../../src/hybrid/bgma.js');

const CFG = {
  ns: '100,200,300,400', seeds: '1,2', kinds: 'uniform,cluster',
  A: '8,12,16,20,25,32', B: '4,5', C: '8', F: '16',
  cap: 64, floor: 2, budget: 2, json: ''
};
const NUM = { cap: 1, floor: 1, budget: 1 };
process.argv.slice(2).forEach(a => {
  const m = /^--([a-zA-Z]+)=(.*)$/.exec(a);
  if (!m || !(m[1] in CFG)) throw new Error('bad flag: ' + a);
  CFG[m[1]] = NUM[m[1]] ? +m[2] : m[2];
});
const list = s => String(s).split(',').filter(Boolean);
const NS = list(CFG.ns).map(Number).filter(n => n > 3);
const SEEDS = list(CFG.seeds).map(Number);
const KINDS = list(CFG.kinds);

const clock = fn => { const t0 = process.hrtime.bigint(); const v = fn(); return [Number(process.hrtime.bigint() - t0) / 1e6, v]; };
const med = a => { const b = a.slice().sort((x, y) => x - y); return b.length % 2 ? b[b.length >> 1] : (b[b.length / 2 - 1] + b[b.length / 2]) / 2; };
const rnd = (x, lo) => Math.max(lo, Math.round(x));
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const pc = x => (x >= 0 ? '+' : '') + x.toFixed(2) + '%';
const padR = (s, w) => { s = String(s); while (s.length < w) s += ' '; return s; };
const padL = (s, w) => { s = String(s); while (s.length < w) s = ' ' + s; return s; };

const RULES = [];
for (const A of list(CFG.A).map(Number))
  for (const B of list(CFG.B).map(Number))
    for (const C of list(CFG.C).map(Number))
      for (const F of list(CFG.F).map(Number)) RULES.push({ A, B, C, F });

function shape(n, r) {
  return {
    islands: clamp(Math.round(n / r.A), CFG.floor, CFG.cap),
    K: rnd(n / r.B, 16),
    near: rnd(n / r.C, 10),
    screenF: r.F,
    restarts: 1
  };
}

/* ------------------------------- measure -------------------------------- */

const insts = [];
for (const n of NS) for (const seed of SEEDS) for (const kind of KINDS) {
  const inst = B.buildInstance(n, seed, kind, Math.max(10, Math.round(n / 10)));
  inst.seed = seed;
  inst.kind = kind;
  insts.push(inst);
}

/* Warm up on a tiny instance so the timings below do not include JIT. */
{
  const w = B.buildInstance(40, 1, 'uniform', 10);
  w.seed = 1; w.kind = 'uniform';
  beamScreen(w, 1, shape(40, RULES[0]));
  runEffort(w, 1, 'low');
}

const refs = insts.map(inst => {
  const low = clock(() => runEffort(inst, 1, 'low'));
  const mid = clock(() => runEffort(inst, 1, 'mid'));
  return { n: inst.n, kind: inst.kind, low: { len: low[1].len, ms: low[0] }, mid: { len: mid[1].len, ms: mid[0] } };
});

const rows = [];
for (const r of RULES) {
  const per = [];
  for (let i = 0; i < insts.length; i++) {
    const inst = insts[i], ref = refs[i];
    const [ms, res] = clock(() => beamScreen(inst, inst.seed, shape(inst.n, r)));
    per.push({
      n: inst.n, kind: inst.kind,
      len: res.len, ms,
      gLow: (res.len / ref.low.len - 1) * 100,
      gMid: (res.len / ref.mid.len - 1) * 100,
      xLow: ms / ref.low.ms
    });
  }
  rows.push({ rule: r, per });
}

/* -------------------------------- report -------------------------------- */

const tag = r => 'A' + r.A + ' B' + r.B + ' C' + r.C + ' F' + r.F;
const gapMid = row => med(row.per.map(x => x.gMid));
const gapLow = row => med(row.per.map(x => x.gLow));
const ms = row => med(row.per.map(x => x.ms));
const xLow = row => med(row.per.map(x => x.xLow));

console.log('');
console.log('n-scaled tuning   n=' + NS.join('/') + '  seeds=' + SEEDS.join(',') + '  ' + KINDS.join('+') +
            '  instances=' + insts.length + '  rules=' + RULES.length);
console.log('');
console.log(padR('rule', 18) + padR('islands', 22) + padL('vs mid', 8) + padL('vs low', 8) +
            padL('med ms', 9) + padL('x low', 7));
for (const row of rows.slice().sort((a, b) => gapMid(a) - gapMid(b))) {
  const isl = NS.map(n => shape(n, row.rule).islands).join('/');
  console.log(padR(tag(row.rule), 18) + padR(isl, 22) + padL(pc(gapMid(row)), 8) +
              padL(pc(gapLow(row)), 8) + padL(ms(row).toFixed(0), 9) + padL(xLow(row).toFixed(2), 7));
}

const sorted = rows.slice().sort((a, b) => gapMid(a) - gapMid(b));
const best = sorted[0];
const budgeted = sorted.filter(r => xLow(r) <= CFG.budget)[0];
console.log('');
console.log('best quality : ' + tag(best.rule) + '  ' + pc(gapMid(best)) + ' vs mid, ' + pc(gapLow(best)) +
            ' vs low, ' + ms(best).toFixed(0) + ' ms (' + xLow(best).toFixed(2) + 'x low)');
console.log('under ' + CFG.budget + 'x low  : ' + (budgeted ? tag(budgeted.rule) + '  ' + pc(gapMid(budgeted)) +
            ' vs mid, ' + pc(gapLow(budgeted)) + ' vs low, ' + ms(budgeted).toFixed(0) + ' ms' : 'none'));

/* Pareto front over (quality vs mid, time). */
const front = [];
for (const r of rows.slice().sort((a, b) => ms(a) - ms(b))) {
  if (!front.length || gapMid(r) < gapMid(front[front.length - 1])) front.push(r);
}
console.log('');
console.log('Pareto front (median time, gap vs mid):');
for (const r of front) console.log('  ' + padR(tag(r.rule), 18) + padL(ms(r).toFixed(0), 8) + ' ms' +
  padL(pc(gapMid(r)), 9) + padL(pc(gapLow(r)), 9) + padL(xLow(r).toFixed(2) + 'x', 7));

const show = [];
for (const r of [best, budgeted]) if (r && show.indexOf(r) < 0) show.push(r);
for (const r of show) {
  console.log('');
  console.log(tag(r.rule) + ' by n:');
  console.log('  ' + padR('n', 7) + padL('islands', 9) + padL('K', 6) + padL('near', 6) +
              padL('vs mid', 9) + padL('vs low', 9) + padL('ms', 8) + padL('x low', 7));
  for (const n of NS) {
    const q = r.per.filter(x => x.n === n);
    const s = shape(n, r.rule);
    console.log('  ' + padR(n, 7) + padL(s.islands, 9) + padL(s.K, 6) + padL(s.near, 6) +
                padL(pc(med(q.map(x => x.gMid))), 9) + padL(pc(med(q.map(x => x.gLow))), 9) +
                padL(med(q.map(x => x.ms)).toFixed(0), 8) + padL(med(q.map(x => x.xLow)).toFixed(2), 7));
  }
}

if (CFG.json) {
  const out = rows.map(r => ({ rule: r.rule, per: r.per, gapMid: gapMid(r), gapLow: gapLow(r), ms: ms(r), xLow: xLow(r) }));
  fs.writeFileSync(CFG.json, JSON.stringify({ ns: NS, seeds: SEEDS, kinds: KINDS, rows: out }, null, 1) + '\n');
  console.log('\nwrote ' + CFG.json);
}
