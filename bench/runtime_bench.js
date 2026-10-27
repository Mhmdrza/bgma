#!/usr/bin/env node
/* runtime_bench.js -- wall-clock runtime (and quality) of every algorithm in the repo, side by side.
 *
 * Methods: greedy, beam only, beam+tunnel (tuned preset), nature, BGMA at each
 * effort level, plus the two reference computations (1-tree bound, Held-Karp).
 * Solvers are loaded from the project files, not re-implemented. Times are the
 * solve only (instance/distance-matrix setup is excluded, except that BGMA builds
 * its own neighbour lists internally and that cost is included). Each cell is the
 * median over every instance (--seeds x uniform/cluster).
 *
 * usage:
 *   node bench/runtime_bench.js
 *   node bench/runtime_bench.js --ns=50,100,200 --seeds=2 --levels=low,mid,high
 *   node bench/runtime_bench.js --maxN=200            # run `max` only up to n=200 (default 400)
 *   node bench/runtime_bench.js --json=docs/runtime.json --web=docs/runtime_data.js
 *   node bench/runtime_bench.js --md=1                # print markdown tables
 *   node bench/runtime_bench.js --from=docs/runtime.json --md=1   # re-print saved results, no re-run
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { B, NAT, runEffort } = require('../src/hybrid/bgma.js');
const { hkBound } = require('../src/hybrid/hybrid_vis.js');
const { christofides } = require('../src/christofides/christofides.js');
const lkh = require('../src/lkh/lkh.js');

const CFG = {
  ns: '20,50,100,200,400', seeds: 2, kinds: 'uniform,cluster',
  levels: 'low,mid,high,xhigh,max', maxN: 400, exactMax: 20,
  M: 48, boundIters: 400, json: '', web: '', md: 0, from: ''
};
const NUM = { seeds: 1, maxN: 1, exactMax: 1, M: 1, boundIters: 1, md: 1 };
process.argv.slice(2).forEach(a => {
  const m = /^--([a-zA-Z]+)=(.*)$/.exec(a);
  if (!m || !(m[1] in CFG)) throw new Error('bad flag: ' + a);
  CFG[m[1]] = NUM[m[1]] ? +m[2] : m[2];
});
const NS = CFG.ns.split(',').map(Number).filter(n => n > 3);
const KINDS = CFG.kinds.split(',').filter(Boolean);
const LEVELS = CFG.levels.split(',').filter(Boolean);

const clock = fn => { const t0 = process.hrtime.bigint(); const v = fn(); return [Number(process.hrtime.bigint() - t0) / 1e6, v]; };
const med = a => { const b = a.slice().sort((x, y) => x - y), h = b.length >> 1; return b.length % 2 ? b[h] : (b[h - 1] + b[h]) / 2; };
const mean = a => a.reduce((s, x) => s + x, 0) / a.length;
const rnd = (x, lo) => Math.max(lo, Math.round(x));
const fmt = x => x == null ? '—' : x < 1 ? (x * 1000).toFixed(0) + ' us' : x < 1000 ? (x < 10 ? x.toFixed(1) : x.toFixed(0)) + ' ms' : (x / 1000).toFixed(x < 10000 ? 2 : 1) + ' s';

/* ------------------------------- solvers -------------------------------- */

const METHODS = [
  { id: 'greedy', label: 'greedy nearest-neighbour', note: 'O(n^2)' },
  { id: 'beam', label: 'beam only (K=n/3)', note: 'O(n K log K)' },
  { id: 'tuned', label: 'beam + tunnel (tuned)', note: 'beam + 2-opt/Or-opt on n finals x4 restarts' },
  { id: 'nature', label: 'nature (population + anneal)', note: 'M=48 wave, 8+6 anneals' },
  { id: 'christofides', label: 'Christofides (1.5-approx)', note: 'MST + blossom matching on odd vertices + Euler tour' },
  { id: 'lkh', label: 'LK-style (5-opt, iterated)', note: 'K=8 nearest candidates, double-bridge kicks, auto kick count' }
].concat(LEVELS.map(l => ({ id: 'bgma-' + l, label: 'BGMA ' + l, note: 'effort level', level: l })))
 .concat([
  { id: 'bound', label: '1-tree lower bound', note: CFG.boundIters + ' subgradient iterations', ref: true },
  { id: 'exact', label: 'Held-Karp exact', note: 'O(n^2 2^n), n <= ' + CFG.exactMax, ref: true }
 ]);

function natureRun(inst, seed) {
  const n = inst.n, D = inst.rows, order = inst.order;
  NAT_RAND(B.rng((seed * 7919 + n * 104729 + (inst.kind === 'cluster' ? 17 : 0)) >>> 0));
  const kn = Math.min(10, n - 1), near = NAT.makeNear(D, order, kn);
  const iters = Math.min(120000, 1500 + 45 * n * n), T0 = Math.max(1, 0.03 * n);
  const [t, best] = clock(() => {
    const pop = NAT.popWave(D, order, inst.fp, CFG.M);
    const uniq = [], seen = new Set();
    for (const st of pop) { const k = st.t.join(','); if (!seen.has(k)) { seen.add(k); uniq.push(st); } }
    uniq.sort((a, b) => (a.len + D[a.t[n - 1]][a.start]) - (b.len + D[b.t[n - 1]][b.start]));
    const annealed = [];
    for (const st of uniq.slice(0, 8)) annealed.push(NAT.anneal(D, st.t, n, iters, T0, near, kn));
    const m = Math.min(4, uniq.length);
    if (m > 1) for (let q = 0; q < 6; q++) annealed.push(NAT.anneal(D, NAT.ox(uniq[q % m].t, uniq[(q + 1) % m].t), n, iters, T0, near, kn));
    annealed.sort((a, b) => a.len - b.len);
    return annealed[0];
  });
  return { ms: t, len: best.len, tour: best.tour };
}
const NAT_RAND = f => NAT.setRand(f);

function run(method, n, seed, kind) {
  if (method.id === 'greedy') {
    const inst = B.buildInstance(n, seed, kind, 10);
    const [t, tour] = clock(() => B.greedy(inst, inst.fp[0]));
    return { ms: t, len: B.tourLenRows(inst.rows, tour), tour };
  }
  if (method.id === 'beam' || method.id === 'tuned') {
    const near = rnd(n / 10, 10);
    const inst = B.buildInstance(n, seed, kind, near);
    const K = rnd(n / 3, 16);
    const o = method.id === 'beam' ? { near }
      : { near, oroptMaxL: 5, restarts: 4, tunnelMode: 'base' };
    const [t, r] = clock(() => B.beamFastTunnel(inst, K, method.id === 'beam' ? 0 : n, o));
    return { ms: t, len: r.len, tour: r.tour };
  }
  if (method.id === 'christofides') {
    const inst = B.buildInstance(n, seed, kind, rnd(n / 10, 10));
    const [t, tour] = clock(() => christofides(inst.rows, n));
    return { ms: t, len: B.tourLenRows(inst.rows, tour), tour: tour };
  }
  if (method.id === 'nature') {
    const inst = B.buildInstance(n, seed, kind, n - 1);
    inst.kind = kind;
    return natureRun(inst, seed);
  }
  if (method.id === 'lkh') {
    const inst = B.buildInstance(n, seed, kind, rnd(n / 10, 10));
    const [t, r] = clock(() => lkh.solve(inst.rows, { seed }));
    return { ms: t, len: r.len, tour: r.tour };
  }
  if (method.level) {
    const inst = B.buildInstance(n, seed, kind, rnd(n / 10, 10));
    inst.seed = seed; inst.kind = kind;
    const [t, r] = clock(() => runEffort(inst, seed, method.level));
    return { ms: t, len: r.len, tour: r.tour };
  }
  throw new Error('unknown method ' + method.id);
}

/* ---------------------------------- run --------------------------------- */

function measure() {
const results = {};        // method -> n -> { ms:[], gap:[] }
METHODS.forEach(m => { results[m.id] = {}; NS.forEach(n => { results[m.id][n] = { ms: [], gap: [] }; }); });
let invalid = 0;

/* JIT warm-up so the first cell is not penalised */
for (const m of METHODS) if (!m.ref) run(m, 30, 99, 'uniform');

process.stderr.write('runtime_bench  ns=' + NS.join('/') + '  seeds=' + CFG.seeds + '  kinds=' + KINDS.join('/') + '\n');
for (const n of NS) {
  for (let seed = 1; seed <= CFG.seeds; seed++) {
    for (const kind of KINDS) {
      const lens = {}, times = {};
      for (const m of METHODS) {
        if (m.ref) continue;
        if (m.level === 'max' && n > CFG.maxN) continue;
        const r = run(m, n, seed, kind);
        if (!B.checkTour(r.tour, n)) invalid++;
        lens[m.id] = r.len; times[m.id] = r.ms;
      }
      const ref = Math.min.apply(null, Object.values(lens));
      for (const id in lens) {
        results[id][n].ms.push(times[id]);
        results[id][n].gap.push((lens[id] / ref - 1) * 100);
      }
      const inst = B.buildInstance(n, seed, kind, rnd(n / 10, 10));
      const [bt] = clock(() => hkBound(inst.rows, ref, CFG.boundIters));
      results.bound[n].ms.push(bt);
      if (n <= CFG.exactMax) {
        const [et] = clock(() => B.heldKarp(inst));
        results.exact[n].ms.push(et);
      }
      process.stderr.write('  n=' + n + ' s=' + seed + ' ' + kind + ' done\n');
    }
  }
}

/* -------------------------------- summary -------------------------------- */

const table = {};
for (const m of METHODS) {
  table[m.id] = {};
  for (const n of NS) {
    const c = results[m.id][n];
    if (!c.ms.length) continue;
    table[m.id][n] = { ms: med(c.ms), gapPct: c.gap.length ? mean(c.gap) : null, instances: c.ms.length };
  }
}
/* empirical scaling exponent: slope of log(ms) vs log(n) between the first and last measured n */
function slope(id) {
  const ns = NS.filter(n => table[id][n] && table[id][n].ms > 0);
  if (ns.length < 2) return null;
  const a = ns[0], b = ns[ns.length - 1];
  return Math.log(table[id][b].ms / table[id][a].ms) / Math.log(b / a);
}
const out = {
  meta: {
    date: new Date().toISOString().slice(0, 10),
    node: process.version, cpu: os.cpus()[0].model.trim(), platform: process.platform + '/' + process.arch,
    seeds: CFG.seeds, kinds: KINDS, instancesPerCell: CFG.seeds * KINDS.length,
    note: 'median wall time of the solve; gapPct is the mean excess over the best tour any method found on the same instance'
  },
  ns: NS,
  methods: METHODS.map(m => ({
    id: m.id, label: m.label, note: m.note, ref: !!m.ref,
    exponent: slope(m.id), cells: table[m.id]
  }))
};
if (invalid) console.error('WARNING: ' + invalid + ' invalid tours');
return out;
}

const out = CFG.from ? JSON.parse(fs.readFileSync(CFG.from, 'utf8')) : measure();
const NSO = out.ns;

const padR = (s, w) => { s = String(s); while (s.length < w) s += ' '; return s; };
const padL = (s, w) => { s = String(s); while (s.length < w) s = ' ' + s; return s; };
const gapFmt = x => x == null ? '—' : (x >= 0 ? '+' : '') + x.toFixed(2) + '%';

if (CFG.md) {
  console.log('| method | ' + NSO.map(n => 'n=' + n).join(' | ') + ' | scaling ~ n^k |');
  console.log('|---|' + NSO.map(() => '---:').join('|') + '|---:|');
  for (const m of out.methods) {
    const cells = NSO.map(n => { const c = m.cells[n]; return c ? fmt(c.ms) : '—'; });
    console.log('| ' + m.label + ' | ' + cells.join(' | ') + ' | ' + (m.exponent == null ? '—' : m.exponent.toFixed(2)) + ' |');
  }
  console.log('');
  console.log('| method | ' + NSO.map(n => 'n=' + n).join(' | ') + ' |');
  console.log('|---|' + NSO.map(() => '---:').join('|') + '|');
  for (const m of out.methods) {
    if (m.ref) continue;
    console.log('| ' + m.label + ' | ' + NSO.map(n => { const c = m.cells[n]; return c ? gapFmt(c.gapPct) : '—'; }).join(' | ') + ' |');
  }
} else {
  console.log('');
  console.log('median wall time per instance   (' + out.meta.cpu + ', node ' + out.meta.node + ', ' + out.meta.instancesPerCell + ' instances/cell)');
  console.log(padR('method', 32) + NSO.map(n => padL('n=' + n, 10)).join('') + padL('~n^k', 8));
  for (const m of out.methods) {
    console.log(padR(m.label, 32) + NSO.map(n => padL(m.cells[n] ? fmt(m.cells[n].ms) : '—', 10)).join('') +
      padL(m.exponent == null ? '—' : m.exponent.toFixed(2), 8));
  }
  console.log('');
  console.log('mean excess over best-of-all tour');
  console.log(padR('method', 32) + NSO.map(n => padL('n=' + n, 10)).join(''));
  for (const m of out.methods) {
    if (m.ref) continue;
    console.log(padR(m.label, 32) + NSO.map(n => padL(m.cells[n] ? gapFmt(m.cells[n].gapPct) : '—', 10)).join(''));
  }
}

if (CFG.json) { fs.mkdirSync(path.dirname(CFG.json), { recursive: true }); fs.writeFileSync(CFG.json, JSON.stringify(out, null, 2) + '\n'); }
if (CFG.web) {
  fs.mkdirSync(path.dirname(CFG.web), { recursive: true });
  fs.writeFileSync(CFG.web, '/* generated by bench/runtime_bench.js -- do not edit */\nwindow.TSP_RUNTIME = ' + JSON.stringify(out) + ';\n');
}
