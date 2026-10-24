#!/usr/bin/env node
/* farthest_pole_cli.js -- run Farthest-Beam Walk from the command line.
 *
 * FBW is a pure construction heuristic: rank every city pair farthest-first, put a
 * cursor on one endpoint of the farthest pair, then step from city to nearest
 * unvisited city one edge at a time, asking each step for its near beam (k nearest)
 * and its far request (the farthest city still open). The last few cities are
 * ordered by brute force and the walk closes back to the start. No local search,
 * no randomness.
 *
 * usage:
 *   node src/farthest/farthest_pole_cli.js --n=200
 *   node src/farthest/farthest_pole_cli.js --ns=50,100,200 --seeds=3 --kind=both
 *   node src/farthest/farthest_pole_cli.js --n=20 --exact=1
 *   node src/farthest/farthest_pole_cli.js --n=200 --bound=1
 *   node src/farthest/farthest_pole_cli.js --n=200 --tour=tour.txt --json=run.json
 *
 * flags:
 *   --n=200              instance size
 *   --ns=50,100,200      benchmark several sizes instead of --n
 *   --seed=1 --seeds=1   instance seed / number of seeds
 *   --kind=uniform       uniform | cluster | both
 *   --exact=0            Held-Karp comparison (n <= 22)
 *   --bound=0            proven 1-tree lower bound
 *   --boundIters=600     subgradient iterations for the bound
 *   --tour=FILE          write the tour of a single run
 *   --json=FILE          write every run as JSON
 */
'use strict';
const fs = require('fs');
const { makeInstance, checkTour, tourLen, heldKarp, hkBound } = require('../hybrid/hybrid_vis.js');
const { solve } = require('./farthest_pole.js');

const CFG = {
  n: 200, ns: '', seed: 1, seeds: 1, kind: 'uniform',
  exact: 0, bound: 0, boundIters: 600, tour: '', json: ''
};
const NUM = { n: 1, seed: 1, seeds: 1, exact: 1, bound: 1, boundIters: 1 };
process.argv.slice(2).forEach(a => {
  const m = /^--([a-zA-Z]+)=(.*)$/.exec(a);
  if (!m || !(m[1] in CFG)) throw new Error('bad flag: ' + a);
  CFG[m[1]] = NUM[m[1]] ? +m[2] : m[2];
});

const NS = CFG.ns ? CFG.ns.split(',').map(Number).filter(x => x > 2) : [CFG.n];
if (!NS.length) throw new Error('n must be >= 3');
const KINDS = CFG.kind === 'both' ? ['uniform', 'cluster'] : [CFG.kind];

const clock = fn => { const t0 = process.hrtime.bigint(); const v = fn(); return [Number(process.hrtime.bigint() - t0) / 1e6, v]; };
const ms = x => x < 1 ? (x * 1000).toFixed(0) + 'us' : x < 1000 ? x.toFixed(0) + 'ms' : (x / 1000).toFixed(2) + 's';
const pct = x => (x >= 0 ? '+' : '') + x.toFixed(2) + '%';
const padR = (s, w) => { s = String(s); while (s.length < w) s += ' '; return s; };
const padL = (s, w) => { s = String(s); while (s.length < w) s = ' ' + s; return s; };

const results = [];
let invalid = 0;

for (const n of NS) {
  for (let s = CFG.seed; s < CFG.seed + CFG.seeds; s++) {
    for (const kind of KINDS) {
      const inst = makeInstance(n, s, kind);
      const [t, r] = clock(() => solve(inst.D));
      const ok = checkTour(r.tour, n) && Math.abs(tourLen(inst.D, r.tour) - r.len) < 1e-8;
      if (!ok) invalid++;
      let exact = null, bound = null;
      if (CFG.exact) {
        if (n > 22) throw new Error('--exact needs n <= 22');
        exact = heldKarp(inst.D).len;
      }
      if (CFG.bound) bound = hkBound(inst.D, r.len, CFG.boundIters);
      const row = { n, seed: s, kind, len: r.len, ms: t, ok, tour: r.tour, stats: r.stats,
                    exact, bound,
                    gapExact: exact != null ? (r.len / exact - 1) * 100 : null,
                    gapBound: bound != null ? (r.len / bound - 1) * 100 : null };
      results.push(row);
      console.log(padR('n=' + n + ' s=' + s + ' ' + kind, 22) +
        padL(r.len.toFixed(2), 10) + padL(ms(t), 8) +
        '  moves=' + r.stats.moves + ' tail=' + r.stats.tailCities + ' span=' + r.stats.startSpan.toFixed(1) +
        (exact != null ? '  exact=' + exact.toFixed(2) + '  gap=' + pct(row.gapExact) +
          (r.len <= exact + 1e-9 ? '  OPTIMAL' : '') : '') +
        (bound != null ? '  bound=' + bound.toFixed(2) + '  gap<=' + pct(row.gapBound) +
          (r.len <= bound + 1e-6 ? '  PROVEN OPTIMAL' : '') : '') +
        (ok ? '' : '  INVALID'));
    }
  }
}

if (NS.length > 1 || KINDS.length > 1 || CFG.seeds > 1) {
  const med = a => { const b = a.slice().sort((x, y) => x - y), h = b.length >> 1; return b.length % 2 ? b[h] : (b[h - 1] + b[h]) / 2; };
  console.log('');
  console.log('SUMMARY  (' + results.length + ' instances)');
  console.log(padR('n', 8) + padL('median len', 12) + padL('median ms', 11) +
              padL('mean gap exact', 16) + padL('mean gap bound', 16));
  for (const n of NS) {
    const rr = results.filter(r => r.n === n);
    const ge = rr.map(r => r.gapExact).filter(x => x != null);
    const gb = rr.map(r => r.gapBound).filter(x => x != null);
    console.log(padR(n, 8) + padL(med(rr.map(r => r.len)).toFixed(2), 12) +
      padL(ms(med(rr.map(r => r.ms))), 11) +
      padL(ge.length ? pct(ge.reduce((a, b) => a + b, 0) / ge.length) : '—', 16) +
      padL(gb.length ? pct(gb.reduce((a, b) => a + b, 0) / gb.length) : '—', 16));
  }
}

if (invalid) console.error('WARNING: ' + invalid + ' invalid tours');

if (CFG.tour) {
  if (results.length !== 1) throw new Error('--tour needs exactly one run (one n, seed and kind)');
  const r = results[0];
  fs.writeFileSync(CFG.tour, '# farthest_pole n=' + r.n + ' seed=' + r.seed + ' kind=' + r.kind +
    ' len=' + r.len.toFixed(6) + '\n' + r.tour.join(',') + '\n');
  console.log('tour      : ' + CFG.tour);
}
if (CFG.json) {
  const clean = results.map(r => ({ n: r.n, seed: r.seed, kind: r.kind, len: r.len, ms: r.ms, ok: r.ok,
    stats: r.stats, exact: r.exact, bound: r.bound, gapExact: r.gapExact, gapBound: r.gapBound }));
  fs.writeFileSync(CFG.json, JSON.stringify(clean, null, 2) + '\n');
  console.log('json      : ' + CFG.json);
}
