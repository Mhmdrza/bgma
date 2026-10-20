#!/usr/bin/env node
/* knob_bench.js -- greedy vs nature vs beam+tunnel under n-based knob presets.
 *
 * Both solvers are loaded from the project files (not re-implemented), the same way
 * bench_dataset.js does it. Instances are the synthetic uniform/cluster families.
 *
 * usage:
 *   node bench/knob_bench.js
 *   node bench/knob_bench.js --ns=50,100,200 --seeds=2
 *   node bench/knob_bench.js --ns=200 --seeds=4 --M=96 --iters=200000
 *   node bench/knob_bench.js --out=knob_results.csv
 */
'use strict';
const fs = require('fs');
const path = require('path');

const CFG = { ns: '50,100,200', seeds: 2, M: 48, iters: 0, out: '' };
process.argv.slice(2).forEach(a => {
  const m = /^--([a-zA-Z]+)=(.*)$/.exec(a);
  if (!m || !(m[1] in CFG)) throw new Error('bad flag: ' + a);
  CFG[m[1]] = m[1] === 'out' || m[1] === 'ns' ? m[2] : +m[2];
});
const NS = CFG.ns.split(',').map(Number).filter(n => n > 3);
const SEEDS = CFG.seeds, M = CFG.M, FIXED_ITERS = CFG.iters;

/* ------------------------- load the two solvers ------------------------- */

const beamCore = fs.readFileSync(path.join(__dirname, '..', 'src', 'beam', 'beam_fast.js'), 'utf8')
  .split('/* ================================= harness')[0]
  .replace('process.argv.slice(2)', '[]');       // beam_fast's CLI must not see our flags
const B = eval(beamCore + ';({buildInstance,beamFast,beamFastTunnel,refineFast,greedy,' +
  'tourLenRows,tourLenFlat,checkTour,rng,KN})');

function sliceHtml(file, marker) {
  const txt = fs.readFileSync(file, 'utf8');
  const cut = txt.indexOf(marker);
  if (cut < 0) throw new Error('marker not found in ' + file + ': ' + marker);
  const start = txt.indexOf('<script>') >= 0 && txt.indexOf('<script>') < cut
    ? txt.indexOf('<script>') + '<script>'.length : 0;
  return txt.slice(start, cut);
}
const N = eval(sliceHtml(path.join(__dirname, '..', 'docs', 'nature_tsp.html'), '/* ============================== drawing') +
  ';({makeNear,popWave,anneal,ox,tourLength,setRand:fn=>{rand=fn;}})');

/* ------------------------------- presets -------------------------------- */

const rnd = (x, lo) => Math.max(lo, Math.round(x));

/* all presets tunnel every final; only the beam/tunnel shape changes */
const PRESETS = [
  { name: 'beam base K=16 near=10',          opts: n => ({ K: 16, near: 10, refineF: 16 }) },
  { name: 'beam K=n/3 near=10',              opts: n => ({ K: rnd(n / 3, 1), near: 10, refineF: rnd(n / 3, 1) }) },
  { name: 'beam K=n/2 near=10',              opts: n => ({ K: rnd(n / 2, 1), near: 10, refineF: rnd(n / 2, 1) }) },
  { name: 'beam K=n near=10',                opts: n => ({ K: n, near: 10, refineF: n }) },
  { name: 'beam K=n/3 near=n/10',            opts: n => ({ K: rnd(n / 3, 1), near: rnd(n / 10, 2), refineF: rnd(n / 3, 1) }) },
  { name: 'beam K=n/3 near=n',               opts: n => ({ K: rnd(n / 3, 1), near: n - 1, refineF: rnd(n / 3, 1) }) },
  { name: 'beam K=16 score=all',             opts: n => ({ K: 16, near: 10, refineF: 16, score: 'all' }) },
  { name: 'beam K=n/2 near=n/10',            opts: n => ({ K: rnd(n / 2, 1), near: rnd(n / 10, 2), refineF: rnd(n / 2, 1) }) },
  { name: 'beam K=n/2 near=n/10 score=all',  opts: n => ({ K: rnd(n / 2, 1), near: rnd(n / 10, 2), refineF: rnd(n / 2, 1), score: 'all' }) }
];

/* ------------------------------- helpers -------------------------------- */

const clock = fn => { const t0 = process.hrtime.bigint(); const v = fn(); return [Number(process.hrtime.bigint() - t0) / 1e6, v]; };
const med = a => { const b = a.slice().sort((x, y) => x - y); return b[b.length >> 1]; };
const mean = a => a.reduce((s, x) => s + x, 0) / a.length;
const mx = a => Math.max.apply(null, a);
const padL = (s, w) => { s = String(s); while (s.length < w) s = ' ' + s; return s; };
const padR = (s, w) => { s = String(s); while (s.length < w) s = s + ' '; return s; };
const pcent = x => (x >= 0 ? '+' : '') + x.toFixed(2) + '%';
const ms = x => x < 1 ? (x * 1000).toFixed(1) + 'us' : x.toFixed(1) + 'ms';

/* ------------------------------- solvers -------------------------------- */

function greedyRun(inst) {
  const [t, tour] = clock(() => B.greedy(inst, inst.fp[0]));
  return { len: B.tourLenRows(inst.rows, tour), ms: t, ok: B.checkTour(tour, inst.n) };
}

function natureRun(inst, seed) {
  const n = inst.n, D = inst.rows, order = inst.order;
  /* deterministic stream, independent of solve order */
  N.setRand(B.rng((seed * 7919 + n * 104729 + (inst.kind === 'cluster' ? 17 : 0)) >>> 0));
  const kn = Math.min(10, n - 1), near = N.makeNear(D, order, kn);
  const iters = FIXED_ITERS || Math.min(120000, 1500 + 45 * n * n);
  const T0 = Math.max(1, 0.03 * n);

  const [t, best] = clock(() => {
    const pop = N.popWave(D, order, inst.fp, M);
    const uniq = [], seen = new Set();
    for (const st of pop) {
      const k = st.t.join(',');
      if (!seen.has(k)) { seen.add(k); uniq.push(st); }
    }
    uniq.sort((a, b) => (a.len + D[a.t[n - 1]][a.start]) - (b.len + D[b.t[n - 1]][b.start]));

    const annealed = [];
    for (const st of uniq.slice(0, 8)) annealed.push(N.anneal(D, st.t, n, iters, T0, near, kn));
    const m = Math.min(4, uniq.length);
    if (m > 1) {
      for (let q = 0; q < 6; q++) {
        annealed.push(N.anneal(D, N.ox(uniq[q % m].t, uniq[(q + 1) % m].t), n, iters, T0, near, kn));
      }
    }
    annealed.sort((a, b) => a.len - b.len);
    return annealed[0];
  });
  return { len: best.len, ms: t, ok: B.checkTour(best.tour, n) };
}

function beamRun(n, seed, kind, o) {
  /* near lists must be built with the same width the tunnel will read */
  const inst = B.buildInstance(n, seed, kind, o.near == null ? 10 : o.near);
  const [t, r] = clock(() => B.beamFastTunnel(inst, o.K, o.refineF, o));
  return { len: r.len, ms: t, ok: B.checkTour(r.tour, n) };
}

/* --------------------------------- run ---------------------------------- */

const KINDS = ['uniform', 'cluster'];
const methods = ['greedy', 'nature'].concat(PRESETS.map(p => p.name));
const rows = [];
let bad = 0;

console.log('');
console.log('knob_bench   n=' + NS.join('/') + '  seeds=' + SEEDS + '/family  nature M=' + M +
            '  iters=' + (FIXED_ITERS || 'auto'));
console.log('');

for (const n of NS) {
  for (let s = 1; s <= SEEDS; s++) {
    for (const kind of KINDS) {
      const base = B.buildInstance(n, s, kind, n - 1);
      base.kind = kind;
      const res = {};
      res.greedy = greedyRun(base);
      res.nature = natureRun(base, s);
      for (const p of PRESETS) res[p.name] = beamRun(n, s, kind, p.opts(n));

      for (const k in res) if (!res[k].ok) bad++;
      const ref = Math.min.apply(null, methods.map(k => res[k].len));
      rows.push({ n, seed: s, kind, ref, res });
    }
  }
}

/* ------------------------------- report --------------------------------- */

const gap = (r, k) => (r.res[k].len / r.ref - 1) * 100;

console.log('SUMMARY  (' + rows.length + ' instances; gap vs best-of-all-methods on each instance)');
console.log('');
console.log(padR('method', 38) + padL('median', 9) + padL('mean', 9) + padL('worst', 9) +
            padL('best', 9) + padL('wins', 6) + padL('med ms', 10));
for (const k of methods) {
  const g = rows.map(r => gap(r, k));
  const wins = rows.filter(r => r.res[k].len <= r.ref + 1e-9).length;
  console.log(padR(k, 38) + padL(pcent(med(g)), 9) + padL(pcent(mean(g)), 9) + padL(pcent(mx(g)), 9) +
              padL(pcent(Math.min.apply(null, g)), 9) + padL(wins + '/' + rows.length, 6) +
              padL(ms(med(rows.map(r => r.res[k].ms))), 10));
}

console.log('');
console.log('MEDIAN GAP BY n');
console.log(padR('method', 38) + NS.map(n => padL('n=' + n, 10)).join(''));
for (const k of methods) {
  const cells = NS.map(n => {
    const rr = rows.filter(r => r.n === n);
    return padL(pcent(med(rr.map(r => gap(r, k)))), 10);
  });
  console.log(padR(k, 38) + cells.join(''));
}

console.log('');
console.log('MEDIAN TIME BY n');
console.log(padR('method', 38) + NS.map(n => padL('n=' + n, 10)).join(''));
for (const k of methods) {
  const cells = NS.map(n => padL(ms(med(rows.filter(r => r.n === n).map(r => r.res[k].ms))), 10));
  console.log(padR(k, 38) + cells.join(''));
}

console.log('');
console.log('BEST BEAM PRESET PER n (median gap)');
for (const n of NS) {
  const rr = rows.filter(r => r.n === n);
  let best = null;
  for (const p of PRESETS) {
    const g = med(rr.map(r => gap(r, p.name)));
    if (!best || g < best.g) best = { name: p.name, g, t: med(rr.map(r => r.res[p.name].ms)) };
  }
  console.log('  n=' + padR(n, 5) + padR(best.name, 38) + pcent(best.g) + '   ' + ms(best.t));
}

console.log('');
console.log('validation : ' + (bad === 0 ? 'all tours are valid permutations' : bad + ' INVALID tours'));

if (CFG.out) {
  const head = ['n', 'seed', 'kind', 'reference'].concat(methods.reduce((a, k) => a.concat([k + '_len', k + '_ms']), []));
  const out = [head.join(',')];
  for (const r of rows) {
    const line = [r.n, r.seed, r.kind, r.ref.toFixed(6)];
    for (const k of methods) line.push(r.res[k].len.toFixed(6), r.res[k].ms.toFixed(3));
    out.push(line.join(','));
  }
  fs.writeFileSync(CFG.out, out.join('\n') + '\n');
  console.log('wrote      : ' + CFG.out + ' (' + rows.length + ' rows)');
}
console.log('');
