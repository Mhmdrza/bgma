#!/usr/bin/env node
/* stress_parallel.js -- worker-thread version of stress_max.js.
 *
 * Same instances, same seeds, same effort levels and the same reported numbers,
 * but the independent runs are spread over `--jobs` threads:
 *
 *   - `max` is three independent hybrid runs (xhigh, and two `max` restarts), so
 *     it splits three ways with no change in the result;
 *   - different levels / seeds / families are independent as well;
 *   - the 1-tree bound stays in the parent and is computed once per (instance,
 *     level) against the chosen tour, exactly as the serial harness does.
 *
 * usage:
 *   node tuning/stress_parallel.js --ns=1000 --families=uniform,cluster --levels=max --jobs=6
 *   node tuning/stress_parallel.js --ns=400 --families=convex,line,grid,dup --levels=low,max
 *   node tuning/stress_parallel.js --ns=1000 --levels=low,mid,high,xhigh --jobs=8
 *
 * flags: --n --ns --families --levels --seeds --seed --boundIters --json --repeat --exact --jobs
 */
'use strict';
const fs = require('fs');
const os = require('os');
const { B, unitsFor, combineUnits } = require('../src/hybrid/bgma.js');
const { runPool } = require('../src/hybrid/pool.js');
const { familySpec, makeFamily } = require('./families.js');
const { hkBound, heldKarp } = require('../src/hybrid/hybrid_vis.js');

const CFG = {
  n: 200, ns: '', families: 'uniform', levels: 'max', seeds: 1, seed: 1,
  boundIters: 600, json: '', repeat: 1, exact: 0,
  jobs: Math.min(6, Math.max(1, os.cpus().length - 1))
};
const NUM = new Set(['n', 'seeds', 'seed', 'boundIters', 'repeat', 'exact', 'jobs']);
process.argv.slice(2).forEach(a => {
  const m = /^--([a-zA-Z]+)=(.*)$/.exec(a);
  if (!m || !(m[1] in CFG)) throw new Error('bad flag: ' + a);
  CFG[m[1]] = NUM.has(m[1]) ? +m[2] : m[2];
});

const pct = x => (x >= 0 ? '+' : '') + x.toFixed(3) + '%';
const ms = x => x < 1000 ? x.toFixed(0) + 'ms' : (x / 1000).toFixed(1) + 's';
const padR = (s, w) => { s = String(s); while (s.length < w) s += ' '; return s; };
const padL = (s, w) => { s = String(s); while (s.length < w) s = ' ' + s; return s; };

const NS = CFG.ns ? CFG.ns.split(',').map(Number) : [CFG.n];
const FAMILIES = CFG.families.split(',');
const LEVELS = CFG.levels.split(',');

(async function main() {
  /* 1. build every instance once in the parent (needed for the bound + validity) */
  const insts = [];
  for (const n of NS) for (const fam of FAMILIES) for (let s = CFG.seed; s < CFG.seed + CFG.seeds; s++) {
    const { inst, known, why, spec } = makeFamily(fam, n, s);
    inst.seed = s; inst.kind = fam;
    insts.push({ n, fam, s, inst, known, why, spec, exact: CFG.exact && n <= 22 ? heldKarp(inst.rows).len : null });
  }

  /* 2. expand to independent units and dispatch them */
  const tasks = [], meta = [];
  for (const I of insts) for (const level of LEVELS) for (let rep = 0; rep < CFG.repeat; rep++) {
    for (const u of unitsFor(level, I.n, I.s)) {
      tasks.push({ instSpec: I.spec, seed: u.seed, preset: u.preset, restart: u.restart });
      meta.push({ I, level, rep, arm: u.arm });
    }
  }
  const t0 = Date.now();
  const out = await runPool(tasks, CFG.jobs);
  const wallMs = Date.now() - t0;
  const serialMs = out.reduce((a, r) => a + r.ms, 0);

  /* 3. fold units back into one result per (instance, level, rep) and score it */
  const groups = new Map();
  out.forEach((r, i) => {
    const m = meta[i];
    const key = m.I.n + '|' + m.I.fam + '|' + m.I.s + '|' + m.level + '|' + m.rep;
    let g = groups.get(key);
    if (!g) groups.set(key, g = { I: m.I, level: m.level, rep: m.rep, units: [] });
    g.units.push({ len: r.len, tour: r.tour, ms: r.ms, arm: m.arm });
  });

  const rows = [];
  let violations = 0, invalidTours = 0, badLen = 0;

  /* One certificate per instance, not per level. The subgradient step size uses
   * an upper bound, and passing each level's own tour made the same instance
   * report slightly different bounds (up to ~0.02 pp). Use the shortest tour
   * found across all levels as that upper bound, so every gap on an instance is
   * measured against the same, deterministic number. */
  const instKey = I => I.n + '|' + I.fam + '|' + I.s;
  const chosen = new Map(), bestLen = new Map(), instByKey = new Map();
  for (const g of groups.values()) {
    const res = combineUnits(g.level, g.units);
    chosen.set(g, res);
    const k = instKey(g.I);
    instByKey.set(k, g.I);
    const b = bestLen.get(k);
    if (b == null || res.len < b - 1e-9) bestLen.set(k, res.len);
  }
  const boundCache = new Map();
  for (const [k, ub] of bestLen) {
    const bt0 = process.hrtime.bigint();
    const b = hkBound(instByKey.get(k).inst.rows, ub, CFG.boundIters);
    boundCache.set(k, { bound: b, ms: Number(process.hrtime.bigint() - bt0) / 1e6 });
  }

  for (const g of groups.values()) {
    const { I, level } = g;
    const res = chosen.get(g);
    const n = I.n;
    const ok = B.checkTour(res.tour, n);
    let recomputed = 0;
    for (let i = 0; i < n; i++) recomputed += I.inst.rows[res.tour[i]][res.tour[(i + 1) % n]];
    const lenOk = Math.abs(recomputed - res.len) < 1e-6;
    if (!ok) invalidTours++;
    if (!lenOk) badLen++;

    const { bound, ms: bt } = boundCache.get(instKey(I));
    const gapBound = bound > 0 ? (res.len / bound - 1) * 100 : (res.len <= 1e-12 ? 0 : Infinity);
    if (gapBound < -1e-6) violations++;
    const gapKnown = I.known != null ? (I.known > 0 ? (res.len / I.known - 1) * 100 : (res.len <= 1e-12 ? 0 : Infinity)) : null;
    const gapExact = I.exact != null ? (I.exact > 0 ? (res.len / I.exact - 1) * 100 : (res.len <= 1e-12 ? 0 : Infinity)) : null;
    const wall = Math.max(...g.units.map(u => u.ms));

    rows.push({
      n, family: I.fam, seed: I.s, level, rep: g.rep,
      ms: +wall.toFixed(1), serialMs: +g.units.reduce((a, u) => a + u.ms, 0).toFixed(1),
      units: g.units.length, bound: +bound.toFixed(4), boundMs: +bt.toFixed(1),
      len: +res.len.toFixed(4), gapBound: +gapBound.toFixed(4), gapKnown, gapExact,
      known: I.known, exact: I.exact, ok, lenOk,
      rssMB: +(process.memoryUsage().rss / 1048576).toFixed(0),
      tourDigest: res.tour.slice(0, 6).join('-')
    });

    console.log(
      padR('n=' + n, 7) + padR(I.fam, 9) + padR('s=' + I.s, 5) + padR(level, 7) + padR(ms(wall), 9) +
      padL(res.len.toFixed(2), 11) + padL('bound ' + bound.toFixed(2), 15) +
      padL('gap<=' + pct(gapBound), 14) +
      (gapKnown != null ? padL('true' + pct(gapKnown), 12) : '') +
      (gapExact != null ? padL('exact' + pct(gapExact), 12) : '') +
      (ok ? '' : '  INVALID TOUR') + (lenOk ? '' : '  LEN MISMATCH') +
      (gapBound < -1e-6 ? '  BOUND VIOLATED' : ''));
  }

  /* 4. summary */
  const byLevel = {};
  for (const r of rows) {
    const b = byLevel[r.level] || (byLevel[r.level] = { n: 0, gaps: [], ms: [] });
    b.n++; b.gaps.push(r.gapBound); b.ms.push(r.ms);
  }
  console.log('\nSUMMARY  (jobs=' + CFG.jobs + ', units=' + tasks.length +
    ', serial=' + ms(serialMs) + ', wall=' + ms(wallMs) +
    ', speedup=' + (serialMs / wallMs).toFixed(2) + 'x)');
  console.log(padR('level', 7) + padL('runs', 6) + padL('median gap<=', 14) + padL('worst gap<=', 13) + padL('median wall', 13));
  for (const [l, b] of Object.entries(byLevel)) {
    const gp = b.gaps.slice().sort((x, y) => x - y), t = b.ms.slice().sort((x, y) => x - y);
    console.log(padR(l, 7) + padL(b.n, 6) + padL(pct(gp[gp.length >> 1]), 14) + padL(pct(gp[gp.length - 1]), 13) + padL(ms(t[t.length >> 1]), 13));
  }
  console.log('\ninvalid tours: ' + invalidTours + '   length mismatches: ' + badLen + '   bound violations: ' + violations);
  if (CFG.json) { fs.writeFileSync(CFG.json, JSON.stringify(rows, null, 1)); console.log('json -> ' + CFG.json); }
})().catch(e => { console.error(e); process.exit(1); });
