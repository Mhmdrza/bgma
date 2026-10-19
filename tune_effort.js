#!/usr/bin/env node
/* tune_effort.js -- learn how the BGMA knobs trade runtime for quality.
 *
 * Runs one-factor-at-a-time sweeps plus a few combined profiles over synthetic
 * uniform/cluster instances, and reports:
 *   - gap vs the best tour found by any tested method (relative quality)
 *   - gap vs a 1-tree lower bound (true optimality gap, n <= ~200)
 *   - median wall time
 *
 * usage:
 *   node tune_effort.js --ns=40,80,150 --seeds=2
 *   node tune_effort.js --ns=100,200 --seeds=2 --only=elite|gen
 *   node tune_effort.js --ns=80 --seeds=1 --boundIters=0 --out=effort.csv
 */
'use strict';
const fs = require('fs');
const { B, hybrid, runEffort, effortPreset } = require('./bgma.js');
const { hkBound } = require('./hybrid_vis.js');

const CFG = { ns: '40,80,150', seeds: 2, only: '', boundIters: 600, out: '' };
process.argv.slice(2).forEach(a => {
  const m = /^--([a-zA-Z]+)=(.*)$/.exec(a);
  if (!m || !(m[1] in CFG)) throw new Error('bad flag: ' + a);
  CFG[m[1]] = m[1] === 'ns' || m[1] === 'only' || m[1] === 'out' ? m[2] : +m[2];
});
const NS = CFG.ns.split(',').map(Number).filter(x => x > 3);
const R = x => Math.max(1, Math.round(x));

const base = n => ({
  islands: 4, K: Math.max(16, R(n / 3)), elites: 16, polish: 4,
  gens: 6, children: 8, kickRate: 0.35, anneal: 20000, annealRate: 0.35, inject: 1
});
const W = (n, o) => Object.assign(base(n), o);

/* name -> options as a function of n. One knob changes per row (except combos). */
const CONFIGS = [
  ['base', n => W(n, {})],
  ['elites=8', n => W(n, { elites: 8 })],
  ['elites=16', n => W(n, { elites: 16 })],
  ['elites=n/10', n => W(n, { elites: R(n / 10) })],
  ['elites=n/5', n => W(n, { elites: R(n / 5) })],
  ['elites=n/3', n => W(n, { elites: R(n / 3) })],
  ['elites=n/2', n => W(n, { elites: R(n / 2) })],

  ['gens=4', n => W(n, { gens: 4 })],
  ['gens=6', n => W(n, { gens: 6 })],
  ['gens=n/25', n => W(n, { gens: R(n / 25) })],
  ['gens=n/10', n => W(n, { gens: R(n / 10) })],
  ['gens=n/5', n => W(n, { gens: R(n / 5) })],

  ['children=4', n => W(n, { children: 4 })],
  ['children=12', n => W(n, { children: 12 })],
  ['children=16', n => W(n, { children: 16 })],

  ['polish=2', n => W(n, { polish: 2 })],
  ['polish=6', n => W(n, { polish: 6 })],
  ['polish=8', n => W(n, { polish: 8 })],
  ['polish=n/10', n => W(n, { polish: R(n / 10) })],
  ['polish=n/5', n => W(n, { polish: R(n / 5) })],

  ['islands=2', n => W(n, { islands: 2 })],
  ['islands=6', n => W(n, { islands: 6 })],
  ['islands=8', n => W(n, { islands: 8 })],

  ['K=n/2', n => W(n, { K: R(n / 2) })],
  ['K=n/2.5', n => W(n, { K: R(n / 2.5) })],
  ['K=n', n => W(n, { K: n })],

  ['anneal=0', n => W(n, { anneal: 0 })],
  ['anneal=60000', n => W(n, { anneal: 60000 })],
  ['annealRate=.6', n => W(n, { annealRate: 0.6 })],

  ['restarts=2', n => W(n, { restarts: 2 })],
  ['restarts=3', n => W(n, { restarts: 3 })],
  ['restarts=4', n => W(n, { restarts: 4 })],
  ['finalPolish=3', n => W(n, { finalPolish: 3 })],
  ['finalPolish=10', n => W(n, { finalPolish: 10 })],
  ['oroptL=8', n => W(n, { polishOrOptMaxL: 8 })],
  ['oroptL=10', n => W(n, { polishOrOptMaxL: 10 })],
  ['fastOrOptL=5', n => W(n, { fastOrOptMaxL: 5 })],
  ['elites=n', n => W(n, { elites: n })],
  ['gens=n/3', n => W(n, { gens: R(n / 3) })],
  ['children=24', n => W(n, { children: 24 })],
  ['islands=12', n => W(n, { islands: 12 })],

  ['combo user', n => W(n, { elites: R(n / 2), gens: R(n / 10) })],
  ['combo big', n => W(n, {
    islands: 6, K: R(n / 2), elites: R(n / 2), gens: R(n / 10),
    children: 12, polish: R(n / 10), finalPolish: 3
  })],
  ['combo mid+', n => W(n, {
    islands: 5, K: R(n / 2.5), elites: R(n / 4), gens: R(n / 8),
    children: 12, polish: R(n / 12), finalPolish: 5, polishOrOptMaxL: 6
  })],
  ['combo max1', n => W(n, {
    islands: 8, K: R(n / 2), elites: R(n / 2), gens: R(n / 5),
    children: 16, polish: R(n / 10), finalPolish: 5, polishOrOptMaxL: 8
  })],
  ['combo max2', n => W(n, {
    islands: 8, K: R(n / 2), elites: R(n / 2), gens: R(n / 5),
    children: 16, polish: R(n / 5), finalPolish: 10, restarts: 2, polishOrOptMaxL: 8
  })],
  ['combo max3', n => W(n, {
    islands: 10, K: n, elites: n, gens: R(n / 6),
    children: 20, polish: R(n / 5), finalPolish: 10, restarts: 2,
    polishOrOptMaxL: 10, fastOrOptMaxL: 5, anneal: 60000, annealRate: 0.5
  })],

  ['effort low', n => effortPreset('low', n)],
  ['effort mid', n => effortPreset('mid', n)],
  ['effort high', n => effortPreset('high', n)],
  ['effort xhigh', n => effortPreset('xhigh', n)],
  ['effort max', n => effortPreset('max', n)],

  /* candidate ladder: increasing spend, roughly geometric */
  ['L1', n => W(n, {
    islands: 2, K: R(n / 4), elites: Math.max(8, R(n / 20)), gens: Math.max(2, R(n / 50)),
    children: 4, polish: 2, anneal: 8000, annealRate: 0.25, finalPolish: 0
  })],
  ['L2', n => W(n, {
    islands: 3, K: R(n / 3), elites: Math.max(12, R(n / 12)), gens: Math.max(3, R(n / 40)),
    children: 6, polish: 4, anneal: 12000, finalPolish: 1
  })],
  ['L3', n => W(n, {
    islands: 4, K: R(n / 3), elites: Math.max(16, R(n / 10)), gens: Math.max(4, R(n / 25)),
    children: 10, polish: 6, anneal: 20000, finalPolish: 2
  })],
  ['L4', n => W(n, {
    islands: 5, K: R(n / 2.5), elites: Math.max(24, R(n / 6)), gens: Math.max(6, R(n / 15)),
    children: 14, polish: Math.max(6, R(n / 15)), anneal: 30000, finalPolish: 3,
    polishOrOptMaxL: 6
  })],
  ['L5', n => W(n, {
    islands: 6, K: R(n / 2), elites: Math.max(32, R(n / 4)), gens: Math.max(8, R(n / 10)),
    children: 16, polish: Math.max(8, R(n / 12)), anneal: 40000, finalPolish: 5,
    polishOrOptMaxL: 6
  })],
  ['L6', n => W(n, {
    islands: 8, K: R(n / 2), elites: Math.max(48, R(n / 2)), gens: Math.max(10, R(n / 8)),
    children: 18, polish: Math.max(10, R(n / 12)), anneal: 60000, finalPolish: 8,
    restarts: 2, polishOrOptMaxL: 8
  })],
  ['L6r1', n => W(n, {
    islands: 8, K: R(n / 2), elites: Math.max(48, R(n / 2)), gens: Math.max(10, R(n / 8)),
    children: 18, polish: Math.max(10, R(n / 12)), anneal: 60000, finalPolish: 8,
    restarts: 1, polishOrOptMaxL: 8
  })],
  ['L5plus', n => W(n, {
    islands: 6, K: R(n / 2), elites: Math.max(32, R(n / 3)), gens: Math.max(8, R(n / 8)),
    children: 18, polish: Math.max(10, R(n / 10)), anneal: 50000, finalPolish: 6,
    restarts: 1, polishOrOptMaxL: 8
  })],
  ['L6r3', n => W(n, {
    islands: 8, K: R(n / 2), elites: Math.max(48, R(n / 2)), gens: Math.max(10, R(n / 8)),
    children: 18, polish: Math.max(10, R(n / 12)), anneal: 60000, finalPolish: 8,
    restarts: 3, polishOrOptMaxL: 8
  })],
  ['L6plus', n => W(n, {
    islands: 8, K: R(n / 2), elites: Math.max(48, R(n / 2)), gens: Math.max(12, R(n / 6)),
    children: 20, polish: Math.max(12, R(n / 8)), anneal: 60000, finalPolish: 12,
    restarts: 2, polishOrOptMaxL: 8
  })],
  ['L7', n => W(n, {
    islands: 10, K: n, elites: n, gens: Math.max(12, R(n / 6)),
    children: 20, polish: Math.max(12, R(n / 6)), anneal: 60000, finalPolish: 12,
    restarts: 3, polishOrOptMaxL: 10, fastOrOptMaxL: 5
  })]
];

const only = CFG.only ? new RegExp(CFG.only, 'i') : null;
const configs = only ? CONFIGS.filter(([name]) => only.test(name)) : CONFIGS;

const med = a => { const b = a.slice().sort((x, y) => x - y); return b.length ? b[b.length >> 1] : 0; };
const mean = a => a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0;
const pct = x => (x >= 0 ? '+' : '') + x.toFixed(2) + '%';
const ms = x => x < 1 ? (x * 1000).toFixed(0) + 'us' : x.toFixed(0) + 'ms';
const padR = (s, w) => { s = String(s); while (s.length < w) s += ' '; return s; };
const padL = (s, w) => { s = String(s); while (s.length < w) s = ' ' + s; return s; };
const clock = fn => { const t0 = process.hrtime.bigint(); const v = fn(); return [Number(process.hrtime.bigint() - t0) / 1e6, v]; };

/* ------------------------------- instances ------------------------------- */

const rows = [];
console.log('');
console.log('tune_effort   n=' + NS.join('/') + '  seeds=' + CFG.seeds + '/family  configs=' + configs.length +
            '  boundIters=' + CFG.boundIters);
console.log('');

for (const n of NS) {
  for (let s = 1; s <= CFG.seeds; s++) {
    for (const kind of ['uniform', 'cluster']) {
      const nearK = Math.max(10, Math.round(n / 10));
      const inst = B.buildInstance(n, s, kind, nearK);
      inst.seed = s; inst.kind = kind;

      /* strong anchor: the tuned beam preset */
      let ref = Infinity;
      const [tunedMs, tuned] = clock(() => B.beamFastTunnel(
        B.buildInstance(n, s, kind, nearK), Math.max(16, Math.round(n / 3)), n,
        { K: Math.max(16, Math.round(n / 3)), near: nearK, refineF: n, oroptMaxL: 5,
          restarts: 4, tunnelMode: 'base' }));
      ref = Math.min(ref, tuned.len);
      const res = { 'tuned beam': { len: tuned.len, ms: tunedMs } };

      /* rotate config order per instance to spread JIT/order effects */
      const order = configs.map((c, i) => (i + s + (kind === 'cluster' ? 1 : 0)) % configs.length);
      const used = [];
      for (let q = 0; q < configs.length; q++) {
        const idx = order[q];
        const [name, mk] = configs[idx];
        if (used.indexOf(idx) >= 0) continue;
        used.push(idx);
        /* named effort configs use the same portfolio entry point as the CLI */
        const isEffort = /^effort /.test(name);
        const [t, out] = clock(() => isEffort
          ? runEffort(inst, s, name.slice('effort '.length))
          : hybrid(inst, s, mk(n)));
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
