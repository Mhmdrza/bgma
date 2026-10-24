#!/usr/bin/env node
/* bench.js -- does seeding BGMA from the 1-tree lower bound pay?
 *
 * The candidate algorithm is OTSH (One-Tree Seeded Hybrid, src/onetree/onetree_seed.js):
 * the subgradient ascent that produces the 1-tree *bound* also produces the tree
 * itself, and a depth-first walk of that tree -- keeping each city the first time
 * it is reached -- is a Hamiltonian cycle for free. That walk is the degree
 * repair: a city of tree degree d>2 is entered once and skipped d-1 times, so the
 * surplus disappears; a city of degree 1 gets its second edge from the closing
 * edge. The walk is then handed to BGMA as an extra pool seed, and the bound L
 * goes in as `floor`, so the search stops the moment it reaches a proven optimum.
 *
 * Rows:
 *   greedy                        cheap context, no screen
 *   1-tree walk only              bound + DFS walk, nothing else (the analogue of
 *                                 "beam only": no screen, no pipeline)
 *   1-tree walk + screen          the walk's single candidate-list screen
 *   BGMA low/mid                  the unmodified pipeline
 *   OTSH low/mid                  walk seeded into the same pipeline, floor = L
 *
 * Timed with the bound inside the clock for both 1-tree rows (it is part of the
 * algorithm); the `vs bound` column computes its own bound outside the clock.
 *
 * The reference is the best tour any method found on the same instance, so gaps
 * are relative to the winner. Where the family has a known optimum (convex: the
 * hull cycle; line: every gap crossed twice) the true-gap table measures it.
 *
 * usage:
 *   node experiments/one-tree-seed/bench.js
 *   node experiments/one-tree-seed/bench.js --ns=100,200,400 --seeds=2 --levels=low,mid
 *   node experiments/one-tree-seed/bench.js --fams=convex,line --ns=50,100,200 --md=1
 *   node experiments/one-tree-seed/bench.js --csv=experiments/one-tree-seed/bench_results.csv
 */
'use strict';
const fs = require('fs');
const { B, runEffort } = require('../../src/hybrid/bgma.js');
const { hkBound } = require('../../src/hybrid/hybrid_vis.js');
const { oneTreeSeed, treeHybrid, walkTree } = require('../../src/onetree/onetree_seed.js');
const { makeFamily } = require('../../tuning/families.js');

const CFG = {
  ns: '50,100,200,300,400', seeds: 2, fams: 'uniform,cluster,convex,line',
  levels: 'low,mid', bound: 1, boundIters: 400, iters: 400, csv: '', md: 0
};
const NUM = { seeds: 1, bound: 1, boundIters: 1, iters: 1, md: 1 };
process.argv.slice(2).forEach(a => {
  const m = /^--([a-zA-Z]+)=(.*)$/.exec(a);
  if (!m || !(m[1] in CFG)) throw new Error('bad flag: ' + a);
  CFG[m[1]] = NUM[m[1]] ? +m[2] : m[2];
});
const NS = CFG.ns.split(',').map(Number).filter(n => n > 3);
const FAMS = CFG.fams.split(',').filter(Boolean);
const LEVELS = CFG.levels.split(',').filter(Boolean);

const clock = fn => { const t0 = process.hrtime.bigint(); const v = fn(); return [Number(process.hrtime.bigint() - t0) / 1e6, v]; };
const med = a => { const b = a.slice().sort((x, y) => x - y); return b.length % 2 ? b[b.length >> 1] : (b[b.length / 2 - 1] + b[b.length / 2]) / 2; };
const mean = a => a.reduce((s, x) => s + x, 0) / a.length;
const mx = a => Math.max.apply(null, a);
const fmt = x => x == null ? '—' : x < 1 ? (x * 1000).toFixed(0) + ' us' : x < 1000 ? (x < 10 ? x.toFixed(1) : x.toFixed(0)) + ' ms' : (x / 1000).toFixed(x < 10000 ? 2 : 1) + ' s';
const padR = (s, w) => { s = String(s); while (s.length < w) s += ' '; return s; };
const padL = (s, w) => { s = String(s); while (s.length < w) s = ' ' + s; return s; };
const pcent = x => (x >= 0 ? '+' : '') + x.toFixed(2) + '%';

/* ------------------------------ self-check ------------------------------- */
/* The walk must be a permutation over the 1-tree's own edge structure, its
 * length must recompute from the matrix, and it must never beat the bound it
 * came from (L <= every tour). Then a 5001-city path, to prove the walk is
 * iterative and does not blow the stack. */
let checked = 0;
for (const fam of FAMS.concat(['grid', 'same', 'dup'])) {
  for (const n of [8, 40, 150]) {
    const { inst } = makeFamily(fam, n, 3);
    const st = oneTreeSeed(inst.base, { iters: 120 });
    if (st.tour) {
      if (!B.checkTour(st.tour, n)) throw new Error('walk is not a permutation: ' + fam + ' n=' + n);
      if (Math.abs(B.tourLenRows(inst.base.rows, st.tour) - st.len) > 1e-9) throw new Error('walk length mismatch: ' + fam + ' n=' + n);
      if (st.len < st.L - 1e-9) throw new Error('walk beats its own bound: ' + fam + ' n=' + n);
    }
    checked++;
  }
}
{
  const path = [];
  for (let i = 0; i < 5000; i++) path.push([i, i + 1]);
  if (!walkTree(5001, path, 0)) throw new Error('walkTree failed on a 5001-city path');
}

/* -------------------------------- solvers -------------------------------- */

const METHODS = [
  { id: 'greedy', label: 'greedy nearest-neighbour', note: 'O(n^2)' },
  { id: 'walk', label: '1-tree walk only', note: 'bound + DFS walk, no screen' },
  { id: 'walk-screen', label: '1-tree walk + screen', note: 'the walk, one candidate-list screen' }
].concat(LEVELS.map(l => ({ id: 'bgma-' + l, label: 'BGMA ' + l, level: l })))
  .concat(LEVELS.map(l => ({ id: 'otsh-' + l, label: 'OTSH ' + l, level: l })));

function greedyRun(inst) {
  const [msv, tour] = clock(() => B.greedy(inst.base, inst.base.fp[0]));
  return { len: B.tourLenRows(inst.base.rows, tour), ms: msv, ok: B.checkTour(tour, inst.n) };
}

function walkRun(inst) {
  const [msv, st] = clock(() => oneTreeSeed(inst.base, { iters: CFG.iters }));
  return { len: st.len, ms: msv, ok: !!st.tour && B.checkTour(st.tour, inst.n),
    bad: st.violations, cert: st.violations === 0 && !!st.tour, distilled: true };
}

function bgmaRun(inst, level) {
  const [msv, res] = clock(() => runEffort(inst, 1, level));
  return { len: res.len, ms: msv, ok: B.checkTour(res.tour, inst.n), cert: !!res.certified };
}

/* level is only used for the preset when the pipeline stages are switched off */
function otshRun(inst, level, preset) {
  const [msv, res] = clock(() => treeHybrid(inst, 1, level, { iters: CFG.iters, preset: preset }));
  return { len: res.len, ms: msv, ok: B.checkTour(res.tour, inst.n), cert: !!res.certified,
    bad: res.violations, distilled: res.source === 'one-tree' };
}

function runMethod(m, inst) {
  if (m.id === 'greedy') return greedyRun(inst);
  if (m.id === 'walk') return walkRun(inst);
  if (m.id === 'walk-screen') return otshRun(inst, 'low', { islands: 0, gens: 0, polish: 0 });
  if (m.level && m.id.slice(0, 5) === 'bgma-') return bgmaRun(inst, m.level);
  if (m.level && m.id.slice(0, 5) === 'otsh-') return otshRun(inst, m.level, null);
  throw new Error('unknown method ' + m.id);
}

/* --------------------------------- run ----------------------------------- */

const rows = [];
let bad = 0;

/* Warm the JIT on a small instance before any measurement; the first timed call
 * at n=50 otherwise pays for compiling every solver and the ascent. */
{
  const w = makeFamily('uniform', 40, 1).inst;
  for (const m of METHODS) runMethod(m, w);
}

console.log('');
console.log('one-tree seed bench   n=' + NS.join('/') + '  seeds=' + CFG.seeds + '  ' + FAMS.join('+') +
  '  levels=' + LEVELS.join('/') + '  iters=' + CFG.iters);
console.log('');

for (const n of NS) {
  const insts = [];
  for (let s = 1; s <= CFG.seeds; s++) for (const fam of FAMS) insts.push(Object.assign(makeFamily(fam, n, s), { s, fam, n }));
  for (const entry of insts) {
    const inst = entry.inst;
    const res = {};
    for (const m of METHODS) res[m.id] = runMethod(m, inst);
    for (const k in res) if (!res[k].ok) bad++;
    const ref = Math.min.apply(null, METHODS.map(m => res[m.id].len));
    const bound = CFG.bound ? hkBound(inst.base.rows, ref, CFG.boundIters) : null;
    rows.push({ n, seed: entry.s, fam: entry.fam, ref, bound, known: entry.known, res });
    console.log(padR('n=' + n + ' s=' + entry.s + ' ' + entry.fam, 24) +
      'ref=' + ref.toFixed(1).padStart(9) +
      (entry.known != null ? '  optimum' : '  best-of-all') +
      (bound != null ? '  bound=' + bound.toFixed(1).padStart(9) + '  gap<=' + pcent((ref / bound - 1) * 100) : ''));
  }
}

/* -------------------------------- summary -------------------------------- */

const gap = (r, id) => (r.res[id].len / r.ref - 1) * 100;
const gapBound = (r, id) => r.bound == null ? null : (r.res[id].len / r.bound - 1) * 100;
const gapKnown = (r, id) => r.known == null ? null : (r.res[id].len / r.known - 1) * 100;

console.log('');
console.log('SUMMARY  (' + rows.length + ' instances; gap vs best-of-all per instance)');
console.log('');
console.log(padR('method', 28) + padL('median', 9) + padL('mean', 9) + padL('worst', 9) +
  padL('best', 9) + padL('wins', 7) + padL('vs bound', 10) + padL('med ms', 11) + padL('certified', 14));
for (const m of METHODS) {
  const g = rows.map(r => gap(r, m.id));
  const gb = rows.map(r => gapBound(r, m.id)).filter(x => x != null);
  const wins = rows.filter(r => r.res[m.id].len <= r.ref + 1e-9).length;
  const cert = rows.filter(r => r.res[m.id].cert).length;
  const dis = rows.filter(r => r.res[m.id].distilled && r.res[m.id].cert).length;
  console.log(padR(m.label, 28) + padL(pcent(med(g)), 9) + padL(pcent(mean(g)), 9) +
    padL(pcent(mx(g)), 9) + padL(pcent(Math.min.apply(null, g)), 9) +
    padL(wins + '/' + rows.length, 7) +
    padL(gb.length ? pcent(med(gb)) : '—', 10) +
    padL(fmt(med(rows.map(r => r.res[m.id].ms))), 11) +
    padL(cert ? cert + '/' + rows.length + (dis ? ' (' + dis + ' dist)' : '') : '—', 14));
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

const kn = rows.filter(r => r.known != null);
if (kn.length) {
  console.log('');
  console.log('TRUE GAP vs the published/known optimum  (' + kn.length + ' instances: ' +
    Array.from(new Set(kn.map(r => r.fam))).join(', ') + ')');
  console.log('');
  console.log(padR('method', 28) + padL('median', 9) + padL('mean', 9) + padL('worst', 9) + padL('optimal', 9));
  for (const m of METHODS) {
    const g = kn.map(r => gapKnown(r, m.id));
    const hits = kn.filter(r => Math.abs(gapKnown(r, m.id)) < 1e-9).length;
    console.log(padR(m.label, 28) + padL(pcent(med(g)), 9) + padL(pcent(mean(g)), 9) +
      padL(pcent(mx(g)), 9) + padL(hits + '/' + kn.length, 9));
  }
}

console.log('');
if (rows[0].res['walk'] && rows[0].res['otsh-low']) {
  /* walk = bound + walk; otsh-low = the same bound + walk + the pipeline, so the
   * difference is the pipeline's share of the wall time, and the walk's own cost
   * (which is the bound) is what is left. */
  const boundShare = rows.map(r => (r.res['walk'].ms - 0) / r.res['otsh-low'].ms);
  console.log('cost split    : the ascent is ' + pcent((1 - mean(boundShare)) * 100) +
    ' of OTSH low wall time on average (' + fmt(med(rows.map(r => r.res['walk'].ms))) +
    ' of ' + fmt(med(rows.map(r => r.res['otsh-low'].ms))) + ')');
}
console.log('validation    : ' + (bad === 0 ? 'all tours are valid permutations' : bad + ' INVALID tours') +
  ' (' + checked + ' walk cases + a 5001-city path self-checked)');

if (CFG.md) {
  console.log('');
  console.log('MARKDOWN');
  console.log('');
  console.log('| method | median gap | mean gap | worst gap | median time | certified |');
  console.log('|---|---:|---:|---:|---:|---:|');
  for (const m of METHODS) {
    const g = rows.map(r => gap(r, m.id));
    const cert = rows.filter(r => r.res[m.id].cert).length;
    console.log('| ' + m.label + ' | ' + pcent(med(g)) + ' | ' + pcent(mean(g)) + ' | ' +
      pcent(mx(g)) + ' | ' + fmt(med(rows.map(r => r.res[m.id].ms))) + ' | ' +
      (cert ? cert + '/' + rows.length : '—') + ' |');
  }
}

if (CFG.csv) {
  const head = ['n', 'seed', 'fam', 'reference', 'reference_kind', 'bound']
    .concat(METHODS.reduce((a, m) => a.concat([m.id + '_len', m.id + '_ms', m.id + '_cert']), []));
  const out = [head.join(',')];
  for (const r of rows) {
    const line = [r.n, r.seed, r.fam, r.ref.toFixed(6), r.known != null ? 'optimum' : 'best-of-all',
      r.bound == null ? '' : r.bound.toFixed(6)];
    for (const m of METHODS) line.push(r.res[m.id].len.toFixed(6), r.res[m.id].ms.toFixed(3), r.res[m.id].cert ? 1 : 0);
    out.push(line.join(','));
  }
  fs.writeFileSync(CFG.csv, out.join('\n') + '\n');
  console.log('');
  console.log('wrote         : ' + CFG.csv);
}
console.log('');
