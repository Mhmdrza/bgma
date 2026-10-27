#!/usr/bin/env node
/* lkh_bench.js -- LKH vs BGMA, head to head, on the same synthetic instances.
 *
 * Both solvers get the same point set (the repo's uniform/cluster generator, so
 * every seed is reproducible) and the same budget-free setting: LKH --kicks,
 * BGMA --levels. Quality is scored two ways:
 *   vs bound  -- 1-tree lower bound (hkBound), so the number is a ceiling on the
 *                true gap and never flatters either solver
 *   vs best   -- excess over the shortest tour any method found on that instance
 *
 * usage:
 *   node bench/lkh_bench.js
 *   node bench/lkh_bench.js --ns=100,200,400,1000 --seeds=2
 *   node bench/lkh_bench.js --levels=low,mid,high,xhigh --kicks=150
 *   node bench/lkh_bench.js --json=bench/lkh_results.json
 *
 * flags: --ns --seeds --kinds --levels --K --maxDepth --kicks --boundIters --json
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { B, runEffort } = require('../src/hybrid/bgma.js');
const { hkBound } = require('../src/hybrid/hybrid_vis.js');
const lkh = require('../src/lkh/lkh.js');

const CFG = {
  ns: '100,200,400', seeds: 2, kinds: 'uniform,cluster',
  levels: 'low,mid,high,xhigh', K: 8, maxDepth: 3, kicks: 0, boundIters: 400, json: ''
};
const NUM = new Set(['seeds', 'K', 'maxDepth', 'kicks', 'boundIters']);
process.argv.slice(2).forEach(a => {
  const m = /^--([a-zA-Z]+)=(.*)$/.exec(a);
  if (!m || !(m[1] in CFG)) throw new Error('bad flag: ' + a);
  CFG[m[1]] = NUM.has(m[1]) ? +m[2] : m[2];
});
const NS = CFG.ns.split(',').map(Number);
const KINDS = CFG.kinds.split(',');
const LEVELS = CFG.levels.split(',').filter(Boolean);

const clock = fn => { const t0 = process.hrtime.bigint(); const v = fn(); return [Number(process.hrtime.bigint() - t0) / 1e6, v]; };
const med = a => { const b = a.slice().sort((x, y) => x - y), h = b.length >> 1; return b.length % 2 ? b[h] : (b[h - 1] + b[h]) / 2; };
const pct = x => (x >= 0 ? '+' : '') + x.toFixed(2) + '%';
const padL = (s, w) => { s = String(s); while (s.length < w) s = ' ' + s; return s; };
const padR = (s, w) => { s = String(s); while (s.length < w) s = s + ' '; return s; };
const rnd = (x, lo) => Math.max(lo, Math.round(x));

const METHODS = [{ id: 'lkh', label: 'LKH' }]
  .concat(LEVELS.map(l => ({ id: 'bgma-' + l, label: 'BGMA ' + l, level: l })));

function run(method, inst, seed) {
  if (method.id === 'lkh') {
    const [ms, r] = clock(() => lkh.solve(inst.rows, {
      seed: seed, K: CFG.K, maxDepth: CFG.maxDepth, kicks: CFG.kicks
    }));
    return { ms: ms, len: r.len, tour: r.tour };
  }
  const [ms, r] = clock(() => runEffort(inst, seed, method.level));
  return { ms: ms, len: r.len, tour: r.tour };
}

const rows = [];
let bad = 0;

console.log('');
console.log('lkh_bench   n=' + NS.join('/') + '   seeds=' + CFG.seeds + '   kinds=' + KINDS.join('/'));
console.log('  LKH: K=' + CFG.K + ' maxDepth=' + CFG.maxDepth + ' kicks=' + (CFG.kicks || 'auto') +
  '   BGMA: ' + LEVELS.join('/'));
console.log('');
console.log(padR('n', 6) + padR('s', 4) + padR('kind', 9) +
  METHODS.map(m => padL(m.label, 14) + padL('ms', 9)).join(''));

for (const n of NS) {
  for (let seed = 1; seed <= CFG.seeds; seed++) {
    for (const kind of KINDS) {
      const inst = B.buildInstance(n, seed, kind, rnd(n / 10, 10));
      inst.seed = seed; inst.kind = kind;    // BGMA rebuilds its base from these
      const out = [];
      let best = Infinity;
      for (const m of METHODS) {
        const r = run(m, inst, seed);
        if (!B.checkTour(r.tour, n)) bad++;
        best = Math.min(best, r.len);
        out.push(r);
      }
      /* score with the same ub for every method, so the bound column is comparable */
      const lb = hkBound(inst.rows, best, CFG.boundIters);
      rows.push({ n, seed, kind, lb, best, r: out });

      let line = padR(n, 6) + padR(seed, 4) + padR(kind, 9);
      for (let i = 0; i < METHODS.length; i++) {
        line += padL(out[i].len.toFixed(1), 14) + padL(out[i].ms.toFixed(0), 9);
      }
      console.log(line);
    }
  }
}

/* -------------------------------- summary -------------------------------- */
console.log('');
console.log('one row per method: len and time are medians over all instances, gaps are medians.');
console.log(padR('method', 14) + padL('median len', 12) + padL('vs bound', 10) + padL('vs best', 10) +
  padL('worst vs bound', 16) + padL('median ms', 11) + padL('wins', 8));
for (let i = 0; i < METHODS.length; i++) {
  const lens = rows.map(x => x.r[i].len);
  const vb = rows.map(x => (x.r[i].len / x.lb - 1) * 100);
  const vbest = rows.map(x => (x.r[i].len / x.best - 1) * 100);
  const ms = rows.map(x => x.r[i].ms);
  const wins = rows.filter(x => Math.abs(x.r[i].len - x.best) < 1e-6).length;
  console.log(padR(METHODS[i].label, 14) + padL(med(lens).toFixed(1), 12) + padL(pct(med(vb)), 10) +
    padL(pct(med(vbest)), 10) + padL(pct(Math.max(...vb)), 16) + padL(med(ms).toFixed(0), 11) +
    padL(wins + '/' + rows.length, 8));
}

console.log('');
console.log('per n (median excess over the 1-tree bound):');
console.log(padR('n', 6) + METHODS.map(m => padL(m.label, 14)).join(''));
for (const n of NS) {
  const rs = rows.filter(x => x.n === n);
  if (!rs.length) continue;
  console.log(padR(n, 6) + METHODS.map((m, i) =>
    padL(pct(med(rs.map(x => (x.r[i].len / x.lb - 1) * 100))), 14)).join(''));
}

console.log('');
console.log('lkh / bgma-<level> tour ratio (median; below 1.00 means LKH is shorter):');
for (let i = 1; i < METHODS.length; i++) {
  const rel = rows.map(x => (x.r[0].len / x.r[i].len - 1) * 100);
  console.log('  ' + padR(METHODS[i].label, 14) + padL(pct(med(rel)), 9) +
    '   range: min ' + pct(Math.min(...rel)) + '  max ' + pct(Math.max(...rel)));
}

if (bad) console.error('WARNING: ' + bad + ' invalid tours');
if (CFG.json) {
  const out = {
    meta: {
      date: new Date().toISOString().slice(0, 10), node: process.version,
      ns: NS, seeds: CFG.seeds, kinds: KINDS,
      lkh: { K: CFG.K, maxDepth: CFG.maxDepth, kicks: CFG.kicks || 'auto' },
      levels: LEVELS, boundIters: CFG.boundIters
    },
    rows: rows.map(x => ({
      n: x.n, seed: x.seed, kind: x.kind, bound: x.lb, best: x.best,
      methods: METHODS.map((m, i) => ({ id: m.id, len: x.r[i].len, ms: x.r[i].ms }))
    }))
  };
  fs.mkdirSync(path.dirname(CFG.json), { recursive: true });
  fs.writeFileSync(CFG.json, JSON.stringify(out, null, 2) + '\n');
  console.log('\n  wrote ' + rows.length + ' instances to ' + CFG.json);
}
console.log('');
