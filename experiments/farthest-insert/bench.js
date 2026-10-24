#!/usr/bin/env node
/* bench.js -- does farthest-pole construction (FPI) build a tour worth a hybrid?
 *
 * The candidate algorithm is in src/farthest/farthest_insert.js. It starts from
 * the farthest pair A-Z and grows the tour from there, with the far list of the
 * opposite pole deciding the next move. Two readings of that idea are measured
 * against each other and against the rest of the repository:
 *
 *   zigzag   two fronts, one from each pole, advanced into the middle and closed
 *            on the A-Z edge; a candidate nearer to the opposite pole than to its
 *            own front is eliminated (the literal idea, rules elim/nn2/veto)
 *   fi       the same poles and the same far list read as insertion: take the
 *            city farthest from the cycle so far and splice it in at its cheapest
 *            position. The first insertion lands between A and Z, which deletes
 *            the diameter the zigzag keeps (rules fi/ni) -- this is FPI
 *
 * Rows:
 *   greedy                  cheap context
 *   FBW                     the farthest-pole walk already in the repo
 *   zigzag elim / nn2 / veto   the two-front readings (no screen, no pipeline)
 *   FPI fi / NPI ni         farthest / nearest insertion from the poles
 *   FPI fi + screen         fi, then one candidate-list screen
 *   BGMA low/mid            the unmodified pipeline
 *   FPI fi + BGMA low/mid   the fi tour handed to the same pipeline as a seed
 *
 * The fi seed is timed together with the pipeline, since building it is part of
 * the algorithm. The reference is the best tour any method found on the same
 * instance, so gaps are relative to the winner; where the family has a known
 * optimum (convex: the hull cycle; line: every gap crossed twice) the true-gap
 * table measures it instead.
 *
 * usage:
 *   node experiments/farthest-insert/bench.js
 *   node experiments/farthest-insert/bench.js --ns=100,200,400 --seeds=2 --levels=low
 *   node experiments/farthest-insert/bench.js --fams=convex,line --ns=50,100,200 --md=1
 *   node experiments/farthest-insert/bench.js --csv=experiments/farthest-insert/bench_results.csv
 */
'use strict';
const fs = require('fs');
const { B, runEffort } = require('../../src/hybrid/bgma.js');
const { hkBound } = require('../../src/hybrid/hybrid_vis.js');
const { solve: fpi, insertion } = require('../../src/farthest/farthest_insert.js');
const { solve: fbw } = require('../../src/farthest/farthest_pole.js');
const { makeFamily } = require('../../tuning/families.js');

const CFG = {
  ns: '50,100,200,300,400', seeds: 2, fams: 'uniform,cluster,convex,line',
  levels: 'low,mid', bound: 1, boundIters: 400, csv: '', md: 0
};
const NUM = { seeds: 1, bound: 1, boundIters: 1, md: 1 };
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
/* Every rule must return a permutation and a length that recomputes from the
 * matrix, and fi/ni must never beat their own lower bound. A 5001-city line then
 * proves the constructions are iterative and do not blow the stack. */
let checked = 0;
for (const fam of FAMS.concat(['grid', 'same', 'dup'])) {
  for (const n of [3, 4, 8, 40, 150]) {
    const { inst } = makeFamily(fam, n, 3);
    const D = inst.base.rows;
    for (const rule of ['fi', 'ni', 'elim', 'far', 'nn2', 'alt', 'veto']) {
      const r = fpi(D, { rule });
      if (!B.checkTour(r.tour, n)) throw new Error('not a permutation: ' + rule + ' ' + fam + ' n=' + n);
      if (Math.abs(B.tourLenRows(D, r.tour) - r.len) > 1e-9) throw new Error('length mismatch: ' + rule + ' ' + fam + ' n=' + n);
    }
    checked++;
  }
}
{
  const D = [];
  for (let i = 0; i < 5001; i++) { const row = []; for (let j = 0; j < 5001; j++) row.push(Math.abs(i - j)); D.push(row); }
  for (const rule of ['fi', 'elim']) if (!B.checkTour(fpi(D, { rule }).tour, 5001)) throw new Error('5001-city ' + rule + ' failed');
}

/* -------------------------------- solvers -------------------------------- */

const METHODS = [
  { id: 'greedy', label: 'greedy nearest-neighbour' },
  { id: 'fbw', label: 'FBW (farthest-pole walk)' }
]
  .concat([['elim', 'zigzag elim'], ['nn2', 'zigzag nn2'], ['veto', 'zigzag veto (one front)']]
    .map(([rule, label]) => ({ id: 'zig-' + rule, label, rule })))
  .concat([{ id: 'fi', label: 'FPI (farthest insertion)' }, { id: 'ni', label: 'NPI (nearest insertion)' }])
  .concat([{ id: 'fi-screen', label: 'FPI + screen' }])
  .concat(LEVELS.map(l => ({ id: 'bgma-' + l, label: 'BGMA ' + l, level: l })))
  .concat(LEVELS.map(l => ({ id: 'fi-' + l, label: 'FPI + BGMA ' + l, level: l })));

const fiTour = inst => insertion(inst.base.rows);

function runMethod(m, inst) {
  const D = inst.base.rows;
  if (m.id === 'greedy') {
    const [t, tour] = clock(() => B.greedy(inst.base, inst.base.fp[0]));
    return { len: B.tourLenRows(D, tour), ms: t, ok: B.checkTour(tour, inst.n) };
  }
  if (m.id === 'fbw') {
    const [t, r] = clock(() => fbw(D));
    return { len: r.len, ms: t, ok: B.checkTour(r.tour, inst.n) };
  }
  if (m.rule) {
    const [t, r] = clock(() => fpi(D, { rule: m.rule }));
    return { len: r.len, ms: t, ok: B.checkTour(r.tour, inst.n) };
  }
  if (m.id === 'fi' || m.id === 'ni') {
    const [t, r] = clock(() => fpi(D, { rule: m.id }));
    return { len: r.len, ms: t, ok: B.checkTour(r.tour, inst.n) };
  }
  if (m.id === 'fi-screen') {
    const [t, r] = clock(() => {
      const tour = fiTour(inst);
      return B.refineFast(inst.base.D, tour, inst.base.near, inst.base.kn, inst.n, false, { oroptMaxL: 3 });
    });
    return { len: r.len, ms: t, ok: B.checkTour(r.tour, inst.n) };
  }
  if (m.level && m.id.slice(0, 5) === 'bgma-') {
    const [t, r] = clock(() => runEffort(inst, 1, m.level));
    return { len: r.len, ms: t, ok: B.checkTour(r.tour, inst.n) };
  }
  if (m.level && m.id.slice(0, 3) === 'fi-') {
    const [t, r] = clock(() => runEffort(inst, 1, m.level, { seedTours: [fiTour(inst)] }));
    return { len: r.len, ms: t, ok: B.checkTour(r.tour, inst.n) };
  }
  throw new Error('unknown method ' + m.id);
}

/* --------------------------------- run ----------------------------------- */

const rows = [];
let bad = 0;

{ /* warm the JIT before any measurement */
  const w = makeFamily('uniform', 40, 1).inst;
  for (const m of METHODS) runMethod(m, w);
}

console.log('');
console.log('farthest-pole insertion bench   n=' + NS.join('/') + '  seeds=' + CFG.seeds + '  ' + FAMS.join('+') +
  '  levels=' + LEVELS.join('/'));
console.log('');

for (const n of NS) {
  const insts = [];
  for (let s = 1; s <= CFG.seeds; s++) for (const fam of FAMS) insts.push(Object.assign(makeFamily(fam, n, s), { s, fam, n }));
  for (const entry of insts) {
    const inst = entry.inst, res = {};
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
console.log(padR('method', 30) + padL('median', 9) + padL('mean', 9) + padL('worst', 9) +
  padL('best', 9) + padL('wins', 7) + padL('vs bound', 10) + padL('med ms', 11));
for (const m of METHODS) {
  const g = rows.map(r => gap(r, m.id));
  const gb = rows.map(r => gapBound(r, m.id)).filter(x => x != null);
  const wins = rows.filter(r => r.res[m.id].len <= r.ref + 1e-9).length;
  console.log(padR(m.label, 30) + padL(pcent(med(g)), 9) + padL(pcent(mean(g)), 9) +
    padL(pcent(mx(g)), 9) + padL(pcent(Math.min.apply(null, g)), 9) +
    padL(wins + '/' + rows.length, 7) +
    padL(gb.length ? pcent(med(gb)) : '—', 10) +
    padL(fmt(med(rows.map(r => r.res[m.id].ms))), 11));
}

console.log('');
console.log('MEDIAN GAP BY n');
console.log(padR('method', 30) + NS.map(n => padL('n=' + n, 10)).join(''));
for (const m of METHODS) {
  console.log(padR(m.label, 30) + NS.map(n => {
    const rr = rows.filter(x => x.n === n);
    return padL(pcent(med(rr.map(x => gap(x, m.id)))), 10);
  }).join(''));
}

console.log('');
console.log('MEDIAN TIME BY n');
console.log(padR('method', 30) + NS.map(n => padL('n=' + n, 10)).join(''));
for (const m of METHODS) {
  console.log(padR(m.label, 30) + NS.map(n => {
    const rr = rows.filter(x => x.n === n);
    return padL(fmt(med(rr.map(x => x.res[m.id].ms))), 10);
  }).join(''));
}

const kn = rows.filter(r => r.known != null);
if (kn.length) {
  console.log('');
  console.log('TRUE GAP vs the known optimum  (' + kn.length + ' instances: ' +
    Array.from(new Set(kn.map(r => r.fam))).join(', ') + ')');
  console.log('');
  console.log(padR('method', 30) + padL('median', 9) + padL('mean', 9) + padL('worst', 9) + padL('optimal', 9));
  for (const m of METHODS) {
    const g = kn.map(r => gapKnown(r, m.id));
    const hits = kn.filter(r => Math.abs(gapKnown(r, m.id)) < 1e-9).length;
    console.log(padR(m.label, 30) + padL(pcent(med(g)), 9) + padL(pcent(mean(g)), 9) +
      padL(pcent(mx(g)), 9) + padL(hits + '/' + kn.length, 9));
  }
}

if (rows[0].res['zig-elim'] && rows[0].res['fi']) {
  const zig = rows.map(r => (r.res['zig-elim'].len / r.res['fi'].len - 1) * 100);
  const zg = rows.map(r => gap(r, 'zig-elim'));
  console.log('');
  console.log('the two readings of the idea (' + rows.length + ' instances)');
  console.log('  zigzag (elim)   median ' + pcent(med(zg)) + '  mean ' + pcent(mean(zg)) + ' vs best-of-all');
  console.log('  fi (insertion)  median ' + pcent(med(rows.map(r => gap(r, 'fi')))) +
    '  mean ' + pcent(mean(rows.map(r => gap(r, 'fi')))) + ' vs best-of-all');
  console.log('  the zigzag is ' + pcent(med(zig)) + ' longer than fi on the median instance, and fi is the shorter' +
    ' one on ' + rows.filter(r => r.res['fi'].len < r.res['zig-elim'].len - 1e-9).length + '/' + rows.length);
}
if (rows[0].res['ni'] && rows[0].res['fi']) {
  const g = rows.map(r => (r.res['ni'].len / r.res['fi'].len - 1) * 100);
  console.log('  nearest insertion is ' + pcent(med(g)) + ' longer than farthest insertion on the median instance' +
    ' (fi shorter on ' + rows.filter(r => r.res['fi'].len < r.res['ni'].len - 1e-9).length + '/' + rows.length + ')');
}
if (rows[0].res['fi-screen'] && rows[0].res['bgma-low']) {
  const share = rows.map(r => (r.res['fi'].len - r.res['fi-screen'].len) / r.res['fi'].len);
  console.log('');
  console.log('where the quality comes from');
  console.log('  one screen drops the fi tour by ' + pcent(mean(share) * 100) + ' on average (' +
    fmt(med(rows.map(r => r.res['fi'].ms))) + ' -> ' + fmt(med(rows.map(r => r.res['fi-screen'].ms))) + ')');
  const lift = rows.map(r => (r.res['bgma-low'].len - r.res['fi-low'].len) / r.res['bgma-low'].len);
  console.log('  seeding BGMA low with fi changes the tour by ' + pcent(mean(lift) * 100) +
    ' on average (' + (lift.filter(x => x > 1e-9).length) + ' better, ' +
    (lift.filter(x => x < -1e-9).length) + ' worse, ' +
    (lift.filter(x => Math.abs(x) <= 1e-9).length) + ' equal)');
}

console.log('');
console.log('validation    : ' + (bad === 0 ? 'all tours are valid permutations' : bad + ' INVALID tours') +
  ' (' + checked + ' rule/family cases + a 5001-city line self-checked)');

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
  const head = ['n', 'seed', 'fam', 'reference', 'reference_kind', 'bound']
    .concat(METHODS.reduce((a, m) => a.concat([m.id + '_len', m.id + '_ms']), []));
  const out = [head.join(',')];
  for (const r of rows) {
    const line = [r.n, r.seed, r.fam, r.ref.toFixed(6), r.known != null ? 'optimum' : 'best-of-all',
      r.bound == null ? '' : r.bound.toFixed(6)];
    for (const m of METHODS) line.push(r.res[m.id].len.toFixed(6), r.res[m.id].ms.toFixed(3));
    out.push(line.join(','));
  }
  fs.writeFileSync(CFG.csv, out.join('\n') + '\n');
  console.log('');
  console.log('wrote         : ' + CFG.csv);
}
console.log('');
