#!/usr/bin/env node
/* stress_max.js -- adversarial stress harness for one or more effort levels.
 *
 * For each (n, family, seed, level) it reports
 *   - wall time, tour length, tour validity and length self-consistency,
 *   - the proven 1-tree lower bound and the certified gap to it,
 *   - the true gap on families whose optimum is known by construction
 *     (convex position -> hull cycle; collinear -> out and back),
 *   - Held-Karp exact comparison at n <= 22.
 *
 * usage:
 *   node tuning/stress_max.js --ns=1000 --families=uniform,cluster --levels=max
 *   node tuning/stress_max.js --ns=100,200,400 --families=convex,line,grid,dup
 *   node tuning/stress_max.js --ns=20 --levels=low,max --exact=1
 *   node tuning/stress_max.js --n=1000 --families=uniform --levels=max --json=out.json
 *
 * flags: --n --ns --families --levels --seeds --seed --boundIters --json --repeat
 */
'use strict';
const fs = require('fs');
const { B, runEffort } = require('../src/hybrid/bgma.js');
const { hkBound, heldKarp } = require('../src/hybrid/hybrid_vis.js');

const CFG = {
  n: 200, ns: '', families: 'uniform', levels: 'max', seeds: 1, seed: 1,
  boundIters: 600, json: '', repeat: 1, exact: 0
};
const NUM = new Set(['n', 'seeds', 'seed', 'boundIters', 'repeat', 'exact']);
process.argv.slice(2).forEach(a => {
  const m = /^--([a-zA-Z]+)=(.*)$/.exec(a);
  if (!m || !(m[1] in CFG)) throw new Error('bad flag: ' + a);
  CFG[m[1]] = NUM.has(m[1]) ? +m[2] : m[2];
});

/* ------------------------------ instances -------------------------------- */
function buildFromPoints(pts) {
  const n = pts.length, D = new Float64Array(n * n), rows = [];
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++)
    D[i * n + j] = i === j ? 0 : Math.hypot(pts[i][0] - pts[j][0], pts[i][1] - pts[j][1]);
  for (let i = 0; i < n; i++) rows.push(D.subarray(i * n, (i + 1) * n));
  const order = [], orderFlat = new Int32Array(n * (n - 1));
  for (let i = 0; i < n; i++) {
    const idx = [];
    for (let j = 0; j < n; j++) if (j !== i) idx.push(j);
    idx.sort((a, b) => rows[i][a] - rows[i][b]);
    order.push(idx);
    for (let j = 0; j < n - 1; j++) orderFlat[i * (n - 1) + j] = idx[j];
  }
  const kn = Math.min(Math.max(10, Math.round(n / 10)), n - 1);
  const near = new Int32Array(n * kn);
  for (let i = 0; i < n; i++) for (let j = 0; j < kn; j++) near[i * kn + j] = order[i][j];
  let best = -1, p = 0, q = 1;
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++)
    if (D[i * n + j] > best) { best = D[i * n + j]; p = i; q = j; }
  return { D, rows, order, orderFlat, near, kn, fp: [p, q], n };
}
const lcg = seed => { let s = seed >>> 0; return () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff); };

function makeFamily(fam, n, seed) {
  if (fam === 'uniform' || fam === 'cluster') {
    const inst = B.buildInstance(n, seed, fam, Math.max(10, Math.round(n / 10)));
    return { inst, known: null };
  }
  let pts;
  if (fam === 'convex') {            // strictly convex -> optimal tour is the hull cycle
    pts = [];
    for (let i = 0; i < n; i++) {
      const t = 2 * Math.PI * i / n;
      pts.push([100 * Math.cos(t), 62 * Math.sin(t)]);
    }
    const inst = buildFromPoints(pts);
    let opt = 0;
    for (let i = 0; i < n; i++) opt += inst.rows[i][(i + 1) % n];
    inst.base = inst;
    return { inst, known: opt, why: 'convex position: hull cycle is optimal' };
  }
  if (fam === 'line') {              // collinear -> optimal tour traverses the span twice
    pts = [];
    const r = lcg(seed * 7919 + 13);
    for (let i = 0; i < n; i++) pts.push([r() * 100, 0]);
    const inst = buildFromPoints(pts);
    let lo = Infinity, hi = -Infinity;
    for (const p of pts) { lo = Math.min(lo, p[0]); hi = Math.max(hi, p[0]); }
    inst.base = inst;
    return { inst, known: 2 * (hi - lo), why: 'collinear: every gap is crossed twice' };
  }
  if (fam === 'grid') {              // integer lattice, many exact ties
    pts = [];
    const k = Math.ceil(Math.sqrt(n));
    for (let i = 0; i < n; i++) pts.push([i % k, Math.floor(i / k)]);
    const inst = buildFromPoints(pts); inst.base = inst;
    return { inst, known: null };
  }
  if (fam === 'same') {             // every city at the same point: all distances 0
    pts = [];
    for (let i = 0; i < n; i++) pts.push([50, 50]);
    const inst = buildFromPoints(pts); inst.base = inst;
    return { inst, known: 0, why: 'coincident cities: every tour has length 0' };
  }
  if (fam === 'fine' || fam === 'coarse') {   // uniform geometry, coordinates scaled
    const k = fam === 'fine' ? 1e-3 : 1e6;
    const r = lcg(seed * 7717 + 3);
    pts = [];
    for (let i = 0; i < n; i++) pts.push([(4 + r() * 92) * k, (4 + r() * 92) * k]);
    const built = buildFromPoints(pts); built.base = built;
    return { inst: built, known: null };
  }
  if (fam === 'dup') {               // half the cities coincide -> zero-length edges
    const r = lcg(seed * 104729 + 7);
    pts = [];
    for (let i = 0; i < n / 2; i++) { const p = [r() * 100, r() * 100]; pts.push(p, [p[0], p[1]]); }
    while (pts.length < n) { const p = [r() * 100, r() * 100]; pts.push(p); }
    const inst = buildFromPoints(pts.slice(0, n)); inst.base = inst;
    return { inst, known: null };
  }
  throw new Error('unknown family: ' + fam);
}

/* -------------------------------- harness -------------------------------- */
const clock = fn => { const t0 = process.hrtime.bigint(); const v = fn(); return [Number(process.hrtime.bigint() - t0) / 1e6, v]; };
const pct = x => (x >= 0 ? '+' : '') + x.toFixed(3) + '%';
const ms = x => x < 1000 ? x.toFixed(0) + 'ms' : (x / 1000).toFixed(1) + 's';
const padR = (s, w) => { s = String(s); while (s.length < w) s += ' '; return s; };
const padL = (s, w) => { s = String(s); while (s.length < w) s = ' ' + s; return s; };

const NS = CFG.ns ? CFG.ns.split(',').map(Number) : [CFG.n];
const FAMILIES = CFG.families.split(',');
const LEVELS = CFG.levels.split(',');
const rows = [];
let violations = 0, invalidTours = 0, badLen = 0;

function emit(r) {
  rows.push(r);
  if (CFG.json) fs.writeFileSync(CFG.json, JSON.stringify(rows, null, 1));
}

for (const n of NS) for (const fam of FAMILIES) for (let s = CFG.seed; s < CFG.seed + CFG.seeds; s++) {
  const { inst, known, why } = makeFamily(fam, n, s);
  inst.seed = s; inst.kind = fam;
  let exact = null;
  if (CFG.exact && n <= 22) exact = heldKarp(inst.rows).len;

  for (const level of LEVELS) {
    for (let rep = 0; rep < CFG.repeat; rep++) {
      const [t, res] = clock(() => runEffort(inst, s, level));
      const ok = B.checkTour(res.tour, n);
      let recomputed = 0;
      for (let i = 0; i < n; i++) recomputed += inst.rows[res.tour[i]][res.tour[(i + 1) % n]];
      const lenOk = Math.abs(recomputed - res.len) < 1e-6;
      if (!ok) invalidTours++;
      if (!lenOk) badLen++;

      const [bt, bound] = clock(() => hkBound(inst.rows, res.len, CFG.boundIters));
      const gapBound = bound > 0 ? (res.len / bound - 1) * 100 : (res.len <= 1e-12 ? 0 : Infinity);
      if (gapBound < -1e-6) violations++;              // a tour below a proven bound is a bug
      const gapKnown = known != null ? (known > 0 ? (res.len / known - 1) * 100 : (res.len <= 1e-12 ? 0 : Infinity)) : null;
      const gapExact = exact != null ? (exact > 0 ? (res.len / exact - 1) * 100 : (res.len <= 1e-12 ? 0 : Infinity)) : null;

      const r = {
        n, family: fam, seed: s, level, rep, ms: +t.toFixed(1),
        bound: +bound.toFixed(4), boundMs: +bt.toFixed(1), len: +res.len.toFixed(4),
        gapBound: +gapBound.toFixed(4), gapKnown, gapExact, known, exact,
        ok, lenOk, rssMB: +(process.memoryUsage().rss / 1048576).toFixed(0),
        tourDigest: res.tour.slice(0, 6).join('-')
      };
      emit(r);
      console.log(
        padR('n=' + n, 7) + padR(fam, 9) + padR('s=' + s, 5) + padR(level, 7) + padR(ms(t), 9) +
        padL(res.len.toFixed(2), 11) + padL('bound ' + bound.toFixed(2), 15) +
        padL('gap<=' + pct(gapBound), 14) +
        (gapKnown != null ? padL('true' + pct(gapKnown), 12) : '') +
        (gapExact != null ? padL('exact' + pct(gapExact), 12) : '') +
        (ok ? '' : '  INVALID TOUR') + (lenOk ? '' : '  LEN MISMATCH') +
        (gapBound < -1e-6 ? '  BOUND VIOLATED' : ''));
    }
  }
  if (why) console.log('  ^ ' + why);
  if (known != null) console.log('  known optimum = ' + known.toFixed(4));
}

const byLevel = {};
for (const r of rows) {
  const b = byLevel[r.level] || (byLevel[r.level] = { n: 0, gaps: [], ms: [] });
  b.n++; b.gaps.push(r.gapBound); b.ms.push(r.ms);
}
console.log('\nSUMMARY');
console.log(padR('level', 7) + padL('runs', 6) + padL('median gap<=', 14) + padL('worst gap<=', 13) + padL('median time', 13));
for (const [l, b] of Object.entries(byLevel)) {
  const g = b.gaps.slice().sort((x, y) => x - y), t = b.ms.slice().sort((x, y) => x - y);
  console.log(padR(l, 7) + padL(b.n, 6) + padL(pct(g[g.length >> 1]), 14) + padL(pct(g[g.length - 1]), 13) + padL(ms(t[t.length >> 1]), 13));
}
console.log('\ninvalid tours: ' + invalidTours + '   length mismatches: ' + badLen + '   bound violations: ' + violations);
if (CFG.json) console.log('json -> ' + CFG.json);
