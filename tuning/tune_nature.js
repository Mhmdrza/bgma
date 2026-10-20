#!/usr/bin/env node
/* tune_nature.js -- learn how the nature knobs trade runtime for quality.
 *
 * Runs one-factor-at-a-time sweeps plus candidate effort profiles over
 * synthetic uniform/cluster instances, and reports:
 *   - gap vs the best tour found by any tested method (relative quality)
 *   - gap vs a 1-tree lower bound (true optimality gap, n <= ~200)
 *   - median wall time
 *
 * usage:
 *   node tuning/tune_nature.js --ns=50,100,150 --seeds=2
 *   node tuning/tune_nature.js --ns=100,200 --seeds=2 --only='M=|surviv|children'
 *   node tuning/tune_nature.js --ns=80 --seeds=1 --boundIters=0 --out=nature.csv
 */
'use strict';
const fs = require('fs');
const { B, nature, runEffort } = require('../src/nature/nature_core.js');
const { effortPreset } = require('../src/nature/nature_effort_profiles.js');
const { hkBound } = require('../src/hybrid/hybrid_vis.js');

const CFG = { ns: '50,100,150', seeds: 2, only: '', boundIters: 600, out: '' };
process.argv.slice(2).forEach(a => {
  const m = /^--([a-zA-Z]+)=(.*)$/.exec(a);
  if (!m || !(m[1] in CFG)) throw new Error('bad flag: ' + a);
  CFG[m[1]] = m[1] === 'ns' || m[1] === 'only' || m[1] === 'out' ? m[2] : +m[2];
});
const NS = CFG.ns.split(',').map(Number).filter(x => x > 3);
const R = x => Math.max(1, Math.round(x));
const autoIters = n => Math.min(120000, 1500 + 45 * n * n);

const base = n => ({
  M: 48, survivors: 8, children: 8, parents: 4, restarts: 1,
  iters: 0, selT: 0.25, branchLag: 3, extraRank: 2, maxBranch: 4,
  pLocal: 0.85, stallK: 50, reheat: 0.4, coolRate: 0.99998, T0: 0
});
const W = (n, o) => Object.assign(base(n), o);
const itersX = (n, x) => Math.round(autoIters(n) * x);

/* name -> options as a function of n. One knob changes per row (except combos). */
const CONFIGS = [
  ['base', n => W(n, {})],

  ['M=16', n => W(n, { M: 16 })],
  ['M=32', n => W(n, { M: 32 })],
  ['M=96', n => W(n, { M: 96 })],
  ['M=192', n => W(n, { M: 192 })],

  ['iters=x0.25', n => W(n, { iters: itersX(n, 0.25) })],
  ['iters=x0.5', n => W(n, { iters: itersX(n, 0.5) })],
  ['iters=x2', n => W(n, { iters: itersX(n, 2) })],
  ['iters=x4', n => W(n, { iters: itersX(n, 4) })],

  /* n-scaled budgets: the default auto cap (120k) stops growing above n~51 */
  ['iters=5n2', n => W(n, { iters: Math.round(5 * n * n) })],
  ['iters=10n2', n => W(n, { iters: Math.round(10 * n * n) })],
  ['iters=20n2', n => W(n, { iters: Math.round(20 * n * n) })],
  ['iters=45n2', n => W(n, { iters: Math.round(45 * n * n) })],
  ['iters=90n2', n => W(n, { iters: Math.round(90 * n * n) })],
  ['45n2 r2', n => W(n, { iters: Math.round(45 * n * n), restarts: 2 })],
  ['45n2 polish', n => W(n, { iters: Math.round(45 * n * n), polish: 'fast', polishTop: 3 })],
  ['45n2 selT.5', n => W(n, { iters: Math.round(45 * n * n), selT: 0.5 })],

  ['survivors=2', n => W(n, { survivors: 2 })],
  ['survivors=4', n => W(n, { survivors: 4 })],
  ['survivors=16', n => W(n, { survivors: 16 })],
  ['survivors=24', n => W(n, { survivors: 24 })],

  ['children=0', n => W(n, { children: 0 })],
  ['children=4', n => W(n, { children: 4 })],
  ['children=16', n => W(n, { children: 16 })],
  ['children=24', n => W(n, { children: 24 })],

  ['parents=2', n => W(n, { parents: 2 })],
  ['parents=8', n => W(n, { parents: 8 })],

  ['restarts=2', n => W(n, { restarts: 2 })],
  ['restarts=4', n => W(n, { restarts: 4 })],

  ['selT=0 (flow)', n => W(n, { selT: 0 })],
  ['selT=.05', n => W(n, { selT: 0.05 })],
  ['selT=.1', n => W(n, { selT: 0.1 })],
  ['selT=.5', n => W(n, { selT: 0.5 })],
  ['selT=1', n => W(n, { selT: 1 })],
  ['selMode=hard', n => W(n, { selMode: 'hard' })],
  ['selMode=flow', n => W(n, { selMode: 'flow' })],

  ['branchLag=1', n => W(n, { branchLag: 1 })],
  ['branchLag=2', n => W(n, { branchLag: 2 })],
  ['branchLag=4', n => W(n, { branchLag: 4 })],
  ['extraRank=0', n => W(n, { extraRank: 0 })],
  ['extraRank=3', n => W(n, { extraRank: 3 })],
  ['maxBranch=2', n => W(n, { maxBranch: 2 })],
  ['maxBranch=3', n => W(n, { maxBranch: 3 })],
  ['maxBranch=6', n => W(n, { maxBranch: 6 })],
  ['maxBranch=0 (all)', n => W(n, { maxBranch: 0 })],

  ['pLocal=.5', n => W(n, { pLocal: 0.5 })],
  ['pLocal=.7', n => W(n, { pLocal: 0.7 })],
  ['pLocal=.95', n => W(n, { pLocal: 0.95 })],
  ['pLocal=1', n => W(n, { pLocal: 1 })],

  ['stallK=0 (never)', n => W(n, { stallK: 0 })],
  ['stallK=10', n => W(n, { stallK: 10 })],
  ['stallK=20', n => W(n, { stallK: 20 })],
  ['stallK=100', n => W(n, { stallK: 100 })],
  ['stallK=200', n => W(n, { stallK: 200 })],
  ['reheat=0', n => W(n, { reheat: 0 })],
  ['reheat=.2', n => W(n, { reheat: 0.2 })],
  ['reheat=.7', n => W(n, { reheat: 0.7 })],
  ['reheat=1', n => W(n, { reheat: 1 })],

  ['cool=0.9999', n => W(n, { coolRate: 0.9999 })],
  ['cool=0.999995', n => W(n, { coolRate: 0.999995 })],
  ['T0=.005n', n => W(n, { T0: 0.005 * n })],
  ['T0=.01n', n => W(n, { T0: 0.01 * n })],
  ['T0=.06n', n => W(n, { T0: 0.06 * n })],
  ['T0=.1n', n => W(n, { T0: 0.1 * n })],

  ['nearK=5', n => W(n, { nearK: 5 })],
  ['nearK=15', n => W(n, { nearK: 15 })],
  ['nearK=20', n => W(n, { nearK: 20 })],

  ['polish fast x3', n => W(n, { polish: 'fast', polishTop: 3 })],
  ['polish base x3', n => W(n, { polish: 'base', polishTop: 3 })],

  /* candidate ladder: increasing spend, roughly geometric */
  ['L1', n => W(n, {
    M: 24, survivors: 3, children: 3, restarts: 1,
    iters: itersX(n, 0.35), nearK: 8
  })],
  ['L2', n => W(n, {
    M: 32, survivors: 4, children: 6, restarts: 1,
    iters: itersX(n, 0.6), nearK: 10
  })],
  ['L3', n => W(n, {
    M: 48, survivors: 8, children: 8, restarts: 1,
    iters: itersX(n, 1), nearK: 10
  })],
  ['L4', n => W(n, {
    M: 64, survivors: 10, children: 12, restarts: 1,
    iters: itersX(n, 1.5), nearK: 12
  })],
  ['L5', n => W(n, {
    M: 96, survivors: 12, children: 16, restarts: 1,
    iters: itersX(n, 2), nearK: 14
  })],
  ['L6', n => W(n, {
    M: 128, survivors: 16, children: 20, restarts: 2,
    iters: itersX(n, 3), nearK: 16
  })],

  ['effort low', n => effortPreset('low', n)],
  ['effort mid', n => effortPreset('mid', n)],
  ['effort high', n => effortPreset('high', n)],
  ['effort xhigh', n => effortPreset('xhigh', n)],
  ['effort max', n => effortPreset('max', n)],

  /* restart/budget split at fixed total anneal work */
  ['r1 20n2', n => W(n, { survivors: 8, children: 10, restarts: 1,
    iters: Math.round(20 * n * n), polish: 'fast', polishTop: 3 })],
  ['r2 10n2', n => W(n, { survivors: 8, children: 10, restarts: 2,
    iters: Math.round(10 * n * n), polish: 'fast', polishTop: 3 })],
  ['r4 5n2', n => W(n, { survivors: 8, children: 10, restarts: 4,
    iters: Math.round(5 * n * n), polish: 'fast', polishTop: 3 })],
  ['r1 40n2', n => W(n, { survivors: 10, children: 14, restarts: 1,
    iters: Math.round(40 * n * n), polish: 'fast', polishTop: 5 })],
  ['r2 20n2', n => W(n, { survivors: 10, children: 14, restarts: 2,
    iters: Math.round(20 * n * n), polish: 'fast', polishTop: 5 })],
  ['r3 14n2', n => W(n, { survivors: 10, children: 14, restarts: 3,
    iters: Math.round(14 * n * n), polish: 'fast', polishTop: 5 })],
  ['r4 10n2', n => W(n, { survivors: 10, children: 14, restarts: 4,
    iters: Math.round(10 * n * n), polish: 'fast', polishTop: 5 })],
  ['r2 30n2', n => W(n, { survivors: 14, children: 18, restarts: 2,
    iters: Math.round(30 * n * n), polish: 'base', polishTop: 6 })],
  ['r3 20n2', n => W(n, { survivors: 14, children: 18, restarts: 3,
    iters: Math.round(20 * n * n), polish: 'base', polishTop: 6 })],
  ['r6 7n2', n => W(n, { survivors: 10, children: 14, restarts: 6,
    iters: Math.round(7 * n * n), polish: 'fast', polishTop: 5 })],
  ['r8 5n2', n => W(n, { survivors: 10, children: 14, restarts: 8,
    iters: Math.round(5 * n * n), polish: 'fast', polishTop: 5 })],
  ['r8 4n2', n => W(n, { survivors: 10, children: 14, restarts: 8,
    iters: Math.round(4 * n * n), polish: 'fast', polishTop: 5 })],
  ['r12 3n2', n => W(n, { survivors: 10, children: 14, restarts: 12,
    iters: Math.round(3 * n * n), polish: 'fast', polishTop: 5 })]
];

const only = CFG.only ? new RegExp(CFG.only, 'i') : null;
const configs = only ? CONFIGS.filter(([name]) => only.test(name)) : CONFIGS;

const med = a => { const b = a.slice().sort((x, y) => x - y); return b.length ? b[b.length >> 1] : 0; };
const mean = a => a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0;
const pct = x => (x >= 0 ? '+' : '') + x.toFixed(2) + '%';
const ms = x => x < 1 ? (x * 1000).toFixed(0) + 'us' : x < 1000 ? x.toFixed(0) + 'ms' : (x / 1000).toFixed(2) + 's';
const padR = (s, w) => { s = String(s); while (s.length < w) s += ' '; return s; };
const padL = (s, w) => { s = String(s); while (s.length < w) s = ' ' + s; return s; };
const clock = fn => { const t0 = process.hrtime.bigint(); const v = fn(); return [Number(process.hrtime.bigint() - t0) / 1e6, v]; };

/* ------------------------------- instances ------------------------------- */

const rows = [];
console.log('');
console.log('tune_nature   n=' + NS.join('/') + '  seeds=' + CFG.seeds + '/family  configs=' + configs.length +
            '  boundIters=' + CFG.boundIters);
console.log('');

for (const n of NS) {
  for (let s = 1; s <= CFG.seeds; s++) {
    for (const kind of ['uniform', 'cluster']) {
      const nearK = Math.max(10, Math.round(n / 10));
      const inst = B.buildInstance(n, s, kind, nearK);
      inst.seed = s; inst.kind = kind;

      /* strong anchor: the tuned beam preset */
      const [tunedMs, tuned] = clock(() => B.beamFastTunnel(
        B.buildInstance(n, s, kind, nearK), Math.max(16, Math.round(n / 3)), n,
        { K: Math.max(16, Math.round(n / 3)), near: nearK, refineF: n, oroptMaxL: 5,
          restarts: 4, tunnelMode: 'base' }));
      let ref = tuned.len;
      const res = { 'tuned beam': { len: tuned.len, ms: tunedMs } };

      /* rotate config order per instance to spread JIT/order effects */
      const order = configs.map((c, i) => (i + s + (kind === 'cluster' ? 1 : 0)) % configs.length);
      const used = [];
      for (let q = 0; q < configs.length; q++) {
        const idx = order[q];
        if (used.indexOf(idx) >= 0) continue;
        used.push(idx);
        const [name, mk] = configs[idx];
        const isEffort = /^effort /.test(name);
        const [t, out] = clock(() => isEffort
          ? runEffort(inst, s, name.slice('effort '.length))
          : nature(inst, s, mk(n)));
        if (!B.checkTour(out.tour, n)) throw new Error('invalid tour: ' + name + ' n=' + n);
        res[name] = { len: out.len, ms: t };
        ref = Math.min(ref, out.len);
      }

      /* true-gap anchor: 1-tree lower bound, using the best tour as the ub */
      let bound = null;
      if (CFG.boundIters > 0) {
        const [bt, bv] = clock(() => hkBound(inst.rows, ref, CFG.boundIters));
        bound = bv;
        res['__bound'] = { len: bv, ms: bt };
      }
      rows.push({ n, seed: s, kind, ref, bound, res });

      const bestName = Object.keys(res).filter(k => k[0] !== '_')
        .sort((a, b) => res[a].len - res[b].len)[0];
      console.log(padR('n=' + n + ' s=' + s + ' ' + kind, 20) +
                  'best=' + res[bestName].len.toFixed(2) + ' (' + bestName + ')' +
                  (bound != null ? '  bound=' + bound.toFixed(2) + '  gap=' + pct((res[bestName].len / bound - 1) * 100) : ''));
    }
  }
}

/* -------------------------------- summary -------------------------------- */

const names = ['tuned beam'].concat(configs.map(c => c[0]));
const gapRef = (r, k) => (r.res[k].len / r.ref - 1) * 100;
const gapBound = (r, k) => r.bound != null ? (r.res[k].len / r.bound - 1) * 100 : null;

console.log('');
console.log('SUMMARY  (' + rows.length + ' instances; gap vs best-of-all, and vs 1-tree bound)');
console.log('');
console.log(padR('config', 22) + padL('med-ref', 9) + padL('mean-ref', 9) + padL('worst', 9) +
            padL('med-bnd', 9) + padL('mean-bnd', 9) + padL('wins', 7) + padL('med ms', 9));
for (const k of names) {
  const g = rows.map(r => gapRef(r, k));
  const gb = rows.map(r => gapBound(r, k)).filter(x => x != null);
  const wins = rows.filter(r => r.res[k].len <= r.ref + 1e-9).length;
  console.log(padR(k, 22) + padL(pct(med(g)), 9) + padL(pct(mean(g)), 9) + padL(pct(Math.max.apply(null, g)), 9) +
              padL(gb.length ? pct(med(gb)) : '—', 9) + padL(gb.length ? pct(mean(gb)) : '—', 9) +
              padL(wins + '/' + rows.length, 7) + padL(ms(med(rows.map(r => r.res[k].ms))), 9));
}

console.log('');
console.log('MEDIAN GAP VS BOUND BY n');
console.log(padR('config', 22) + NS.map(n => padL('n=' + n, 9)).join(''));
for (const k of names) {
  console.log(padR(k, 22) + NS.map(n => {
    const rr = rows.filter(x => x.n === n && x.bound != null);
    if (!rr.length) return padL('—', 9);
    return padL(pct(med(rr.map(x => gapBound(x, k)))), 9);
  }).join(''));
}

console.log('');
console.log('MEDIAN TIME BY n');
console.log(padR('config', 22) + NS.map(n => padL('n=' + n, 9)).join(''));
for (const k of names) {
  console.log(padR(k, 22) + NS.map(n =>
    padL(ms(med(rows.filter(x => x.n === n).map(x => x.res[k].ms))), 9)).join(''));
}

if (CFG.out) {
  const head = ['n', 'seed', 'kind', 'reference', 'bound'].concat(names.reduce((a, k) => a.concat([k + '_len', k + '_ms']), []));
  const out = [head.join(',')];
  for (const r of rows) {
    const line = [r.n, r.seed, r.kind, r.ref.toFixed(6), r.bound == null ? '' : r.bound.toFixed(6)];
    for (const k of names) line.push(r.res[k].len.toFixed(6), r.res[k].ms.toFixed(3));
    out.push(line.join(','));
  }
  fs.writeFileSync(CFG.out, out.join('\n') + '\n');
  console.log('');
  console.log('wrote      : ' + CFG.out);
}
console.log('');
