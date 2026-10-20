#!/usr/bin/env node
/* bench.js -- the two-step solver (beam + fast screen) against the full BGMA
 * pipeline. This is the experiment's measurement harness; the write-up and the
 * recorded run are in README.md and results.txt / bench_results.csv.
 *
 * The radical variant keeps steps 1 and 2 of BGMA and drops the rest:
 *   beam islands -> fast candidate-list screen -> shortest tour wins
 * No elite pool, no ERX, no kick/anneal, no full polish, no final polish.
 *
 * Rows:
 *   greedy / beam only        cheap context, no screen
 *   beam+screen (low budget)  2 islands x K=n/4, screen every final -- BGMA
 *                             low's beam+screen shape (identical for n>=64,
 *                             slightly wider at n=50)
 *   beam+screen (fixed rule)  16 islands x K=n/4, near=n/10, screen every
 *                             final -- the pre-tuning winner
 *   beam+screen (n-scaled)    islands=max(16,n/20), K=n/5, near=n/8, top 16
 *                             finals -- tuned by tune_nscale.js
 *   beam + tunnel (tuned)     the repo's all-n tuned beam+tunnel baseline
 *   BGMA low/mid/high/xhigh   the full pipeline at each effort level
 *
 * The reference is the best tour any method found on the same instance, so the
 * gaps are relative to the winner, not to the optimum. --bound adds the 1-tree
 * lower bound for an absolute quality column.
 *
 * usage:
 *   node experiments/beam-screen-only/bench.js
 *   node experiments/beam-screen-only/bench.js --ns=100,200,300 --seeds=2 --levels=low,mid
 *   node experiments/beam-screen-only/bench.js --ns=50,100,200,300,400 --seeds=3 --csv=experiments/beam-screen-only/bench_results.csv
 *   node experiments/beam-screen-only/bench.js --md=1
 */
'use strict';
const fs = require('fs');
const { B, beamScreen, runEffort } = require('../../src/hybrid/bgma.js');
const { hkBound } = require('../../src/hybrid/hybrid_vis.js');

const CFG = {
  ns: '50,100,150,200,250,300,350,400', seeds: 2, kinds: 'uniform,cluster',
  levels: 'low,mid,high,xhigh,max',
  bound: 1, boundIters: 400, csv: '', md: 0
};
const NUM = { seeds: 1, bound: 1, boundIters: 1, md: 1 };
process.argv.slice(2).forEach(a => {
  const m = /^--([a-zA-Z]+)=(.*)$/.exec(a);
  if (!m || !(m[1] in CFG)) throw new Error('bad flag: ' + a);
  CFG[m[1]] = NUM[m[1]] ? +m[2] : m[2];
});
const NS = CFG.ns.split(',').map(Number).filter(n => n > 3);
const KINDS = CFG.kinds.split(',').filter(Boolean);
const LEVELS = CFG.levels.split(',').filter(Boolean);

const clock = fn => { const t0 = process.hrtime.bigint(); const v = fn(); return [Number(process.hrtime.bigint() - t0) / 1e6, v]; };
const med = a => { const b = a.slice().sort((x, y) => x - y); return b.length % 2 ? b[b.length >> 1] : (b[b.length / 2 - 1] + b[b.length / 2]) / 2; };
const mean = a => a.reduce((s, x) => s + x, 0) / a.length;
const mx = a => Math.max.apply(null, a);
const rnd = (x, lo) => Math.max(lo, Math.round(x));
const fmt = x => x == null ? '—' : x < 1 ? (x * 1000).toFixed(0) + ' us' : x < 1000 ? (x < 10 ? x.toFixed(1) : x.toFixed(0)) + ' ms' : (x / 1000).toFixed(x < 10000 ? 2 : 1) + ' s';
const padR = (s, w) => { s = String(s); while (s.length < w) s += ' '; return s; };
const padL = (s, w) => { s = String(s); while (s.length < w) s = ' ' + s; return s; };
const pcent = x => (x >= 0 ? '+' : '') + x.toFixed(2) + '%';

/* ------------------------------- solvers -------------------------------- */

/* The previous fixed rule: what the ablation shipped with. */
function pureFixed(n) {
  return { islands: 16, K: rnd(n / 4, 16), near: rnd(n / 10, 10), screenF: 0, restarts: 1 };
}

/* N-scaled rule from tune_nscale.js: the island count tracks the knee, the
 * beam narrows to n/5, the screen widens to n/8 and screens the top 16 finals
 * per island. The cap keeps larger n from exploding past the measured range. */
function pureNScale(n) {
  return {
    islands: Math.min(32, rnd(n / 20, 16)),
    K: rnd(n / 5, 16),
    near: rnd(n / 8, 10),
    screenF: 16,
    restarts: 1
  };
}

const METHODS = [
  { id: 'greedy', label: 'greedy nearest-neighbour', note: 'O(n^2)' },
  { id: 'beam', label: 'beam only (K=n/3)', note: 'one beam, no screen' },
  { id: 'pure-low', label: 'beam+screen (low budget)', note: '2 islands x K=n/4, screen all finals' },
  { id: 'pure-old', label: 'beam+screen (fixed rule)', note: '16 islands x K=n/4, near=n/10, all finals' },
  { id: 'pure-ns', label: 'beam+screen (n-scaled)', note: 'islands=n/20, K=n/5, near=n/8, top 16 finals' },
  { id: 'tuned', label: 'beam + tunnel (tuned)', note: 'beam + base polish on n finals x4 restarts' },
  { id: 'bgma-low', label: 'BGMA low', level: 'low' },
  { id: 'bgma-mid', label: 'BGMA mid', level: 'mid' },
  { id: 'bgma-high', label: 'BGMA high', level: 'high' },
  { id: 'bgma-xhigh', label: 'BGMA xhigh', level: 'xhigh' },
  { id: 'bgma-max', label: 'BGMA max', level: 'max' }
].filter(m => !m.level || LEVELS.indexOf(m.level) >= 0);

function greedyRun(inst) {
  const [msv, tour] = clock(() => B.greedy(inst, inst.fp[0]));
  return { len: B.tourLenRows(inst.rows, tour), ms: msv, ok: B.checkTour(tour, inst.n) };
}

function beamOnlyRun(inst) {
  const n = inst.n, K = rnd(n / 3, 16);
  const [msv, res] = clock(() => B.beamFast(inst, K, { starts: 'farthest', startCount: 2 }));
  return { len: res.lenBeam, ms: msv, ok: B.checkTour(res.finals[0].t, n) };
}

function pureRun(inst, make) {
  const [msv, res] = clock(() => beamScreen(inst, 1, make(inst.n)));
  return { len: res.len, ms: msv, ok: B.checkTour(res.tour, inst.n) };
}

function tunedRun(inst) {
  const n = inst.n;
  const K = rnd(n / 3, 16), near = rnd(n / 10, 10);
  const x = B.buildInstance(n, inst.seed, inst.kind, near);
  const [msv, res] = clock(() => B.beamFastTunnel(x, K, n, {
    K, near, refineF: n, oroptMaxL: 5, restarts: 4, tunnelMode: 'base'
  }));
  return { len: res.len, ms: msv, ok: B.checkTour(res.tour, n) };
}

function bgmaRun(inst, level) {
  const [msv, res] = clock(() => runEffort(inst, 1, level));
  return { len: res.len, ms: msv, ok: B.checkTour(res.tour, inst.n) };
}

function runMethod(m, inst) {
  if (m.id === 'greedy') return greedyRun(inst);
  if (m.id === 'beam') return beamOnlyRun(inst);
  if (m.id === 'pure-low') return pureRun(inst, n => ({ islands: 2, K: rnd(n / 4, 16), screenF: 0, restarts: 1 }));
  if (m.id === 'pure-old') return pureRun(inst, pureFixed);
  if (m.id === 'pure-ns') return pureRun(inst, pureNScale);
  if (m.id === 'tuned') return tunedRun(inst);
  if (m.level) return bgmaRun(inst, m.level);
  throw new Error('unknown method ' + m.id);
}

/* --------------------------------- run ---------------------------------- */

const rows = [];
let bad = 0;

/* Warm the JIT on a small instance before any measurement; the first timed
 * call at n=50 otherwise pays for compiling every solver. */
{
  const w = B.buildInstance(40, 1, 'uniform', 10);
  w.seed = 1;
  w.kind = 'uniform';
  for (const m of METHODS) runMethod(m, w);
}

console.log('');
console.log('beam+screen bench   n=' + NS.join('/') + '  seeds=' + CFG.seeds + '  ' + KINDS.join('+') +
            '  levels=' + LEVELS.join('/'));
console.log(''); 

for (const n of NS) {
  const insts = [];
  for (let s = 1; s <= CFG.seeds; s++) for (const kind of KINDS) {
    const inst = B.buildInstance(n, s, kind, Math.max(10, Math.round(n / 10)));
    inst.seed = s;
    inst.kind = kind;
    insts.push(inst);
  }
  for (const inst of insts) {
    const res = {};
    for (const m of METHODS) res[m.id] = runMethod(m, inst);
    for (const k in res) if (!res[k].ok) bad++;
    const ref = Math.min.apply(null, METHODS.map(m => res[m.id].len));
    let bound = null;
    if (CFG.bound) {
      bound = hkBound(inst.rows, ref, CFG.boundIters);
    }
    rows.push({ n, seed: inst.seed, kind: inst.kind, ref, bound, res });
    console.log(padR('n=' + n + ' s=' + inst.seed + ' ' + inst.kind, 22) +
      'ref=' + ref.toFixed(1).padStart(9) +
      (bound != null ? '  bound=' + bound.toFixed(1).padStart(9) +
        '  gap<=' + pcent((ref / bound - 1) * 100) : ''));
  }
}

/* ------------------------------- summary -------------------------------- */

const gap = (r, id) => (r.res[id].len / r.ref - 1) * 100;
const gapBound = (r, id) => r.bound == null ? null : (r.res[id].len / r.bound - 1) * 100;

console.log('');
console.log('SUMMARY  (' + rows.length + ' instances; gap vs best-of-all per instance)');
console.log('');
console.log(padR('method', 28) + padL('median', 9) + padL('mean', 9) + padL('worst', 9) +
            padL('best', 9) + padL('wins', 7) + padL('vs bound', 10) + padL('med ms', 10));
for (const m of METHODS) {
  const g = rows.map(r => gap(r, m.id));
  const gb = rows.map(r => gapBound(r, m.id)).filter(x => x != null);
  const wins = rows.filter(r => r.res[m.id].len <= r.ref + 1e-9).length;
  console.log(padR(m.label, 28) + padL(pcent(med(g)), 9) + padL(pcent(mean(g)), 9) +
    padL(pcent(mx(g)), 9) + padL(pcent(Math.min.apply(null, g)), 9) +
    padL(wins + '/' + rows.length, 7) +
    padL(gb.length ? pcent(med(gb)) : '—', 10) +
    padL(fmt(med(rows.map(r => r.res[m.id].ms))), 10));
}

console.log('');
console.log('MEDIAN GAP BY n');
console.log(padR('method', 28) + NS.map(n => padL('n=' + n, 10)).join(''));
for (const m of METHODS) {
  console.log(padR(m.label, 28) + NS.map(n => {
    const rr = rows.filter(x => x.n === n);
    return padL(pcent(med(rr.map(x => gap(x, m.id)))), 10);
  }).join(''));
}

console.log('');
console.log('MEDIAN TIME BY n');
console.log(padR('method', 28) + NS.map(n => padL('n=' + n, 10)).join(''));
for (const m of METHODS) {
  console.log(padR(m.label, 28) + NS.map(n => {
    const rr = rows.filter(x => x.n === n);
    return padL(fmt(med(rr.map(x => x.res[m.id].ms))), 10);
  }).join(''));
}

console.log('');
console.log('validation : ' + (bad === 0 ? 'all tours are valid permutations' : bad + ' INVALID tours'));

if (CFG.md) {
  console.log('');
  console.log('MARKDOWN');
  console.log('');
  console.log('| method | median gap | mean gap | worst gap | median time |');
  console.log('|---|---:|---:|---:|---:|');
  for (const m of METHODS) {
    const g = rows.map(r => gap(r, m.id));
    console.log('| ' + m.label + ' | ' + pcent(med(g)) + ' | ' + pcent(mean(g)) + ' | ' +
      pcent(mx(g)) + ' | ' + fmt(med(rows.map(r => r.res[m.id].ms))) + ' |');
  }
}

if (CFG.csv) {
  const head = ['n', 'seed', 'kind', 'reference', 'bound']
    .concat(METHODS.reduce((a, m) => a.concat([m.id + '_len', m.id + '_ms']), []));
  const out = [head.join(',')];
  for (const r of rows) {
    const line = [r.n, r.seed, r.kind, r.ref.toFixed(6), r.bound == null ? '' : r.bound.toFixed(6)];
    for (const m of METHODS) line.push(r.res[m.id].len.toFixed(6), r.res[m.id].ms.toFixed(3));
    out.push(line.join(','));
  }
  fs.writeFileSync(CFG.csv, out.join('\n') + '\n');
  console.log('');
  console.log('wrote      : ' + CFG.csv);
}
console.log('');
