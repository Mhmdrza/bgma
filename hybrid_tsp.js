#!/usr/bin/env node
/* hybrid_tsp.js -- Beam-Guided Memetic Annealing (BGMA).
 *
 * Mixes the three lines of work in this repo:
 *   beam+tunnel  : arena beam constructor, fast candidate-list tunnel (screen)
 *   nature_tsp   : soft-flow population, annealing with double-bridge avulsions
 *   tuning       : n/3 beam width, all finals, independent restarts, base polish
 *
 * The idea is to stop spending the expensive full-restart tunnel on every final.
 * Instead: build a diverse pool with beam islands, screen every tour with the fast
 * tunnel, keep an elite pool, then alternate
 *
 *   edge recombination (ERX) -> double-bridge / short anneal -> fast tunnel
 *   -> full-restart polish of the few children that can actually win
 *
 * so the expensive local search is spent only on elites.
 *
 * For the tuned effort-dial version (low/mid/high/xhigh/max), see hybrid_effort.js.
 *
 * usage:
 *   node hybrid_tsp.js --ns=50,100,200 --seeds=2
 *   node hybrid_tsp.js --n=200 --seeds=4 --gens=8 --polish=6
 *   node hybrid_tsp.js --ns=200 --seeds=4 --anneal=0      # no nature mutation
 */
'use strict';
const fs = require('fs');
const path = require('path');

const CFG = {
  n: 200, ns: '50,100,200', seeds: 2,
  islands: 4, K: 0, near: 0,
  elites: 16, polish: 6, gens: 6, children: 8,
  kicks: 1, kickRate: 0.35, anneal: 20000, annealRate: 0.35, inject: 1,
  M: 48, iters: 0, out: ''
};
process.argv.slice(2).forEach(a => {
  const m = /^--([a-zA-Z]+)=(.*)$/.exec(a);
  if (!m || !(m[1] in CFG)) throw new Error('bad flag: ' + a);
  CFG[m[1]] = m[1] === 'out' || m[1] === 'ns' ? m[2] : +m[2];
});
const HAS_NS = process.argv.slice(2).some(a => /^--ns=/.test(a));
const NS = HAS_NS ? CFG.ns.split(',').map(Number).filter(x => x > 3) : [CFG.n];
const SEEDS = CFG.seeds;

/* --------------------------- load implementations ------------------------ */

const beamCore = fs.readFileSync(path.join(__dirname, 'beam_fast.js'), 'utf8')
  .split('/* ================================= harness')[0]
  .replace('process.argv.slice(2)', '[]');
const B = eval(beamCore + ';({buildInstance,beamFast,beamFastTunnel,refineFast,refineBase,greedy,' +
  'tourLenRows,checkTour,rng})');

function sliceHtml(file, marker) {
  const txt = fs.readFileSync(file, 'utf8');
  const cut = txt.indexOf(marker);
  if (cut < 0) throw new Error('marker not found in ' + file + ': ' + marker);
  const start = txt.indexOf('<script>') >= 0 && txt.indexOf('<script>') < cut
    ? txt.indexOf('<script>') + '<script>'.length : 0;
  return txt.slice(start, cut);
}
const NAT = eval(sliceHtml(path.join(__dirname, 'nature_tsp.html'), '/* ============================== drawing') +
  ';({makeNear,popWave,anneal,ox,tourLength,setRand:fn=>{rand=fn;}})');

/* ------------------------------- helpers -------------------------------- */

const clock = fn => { const t0 = process.hrtime.bigint(); const v = fn(); return [Number(process.hrtime.bigint() - t0) / 1e6, v]; };
const med = a => { const b = a.slice().sort((x, y) => x - y); return b[b.length >> 1]; };
const mean = a => a.reduce((s, x) => s + x, 0) / a.length;
const mx = a => Math.max.apply(null, a);
const padL = (s, w) => { s = String(s); while (s.length < w) s = ' ' + s; return s; };
const padR = (s, w) => { s = String(s); while (s.length < w) s = s + ' '; return s; };
const pcent = x => (x >= 0 ? '+' : '') + x.toFixed(2) + '%';
const ms = x => x < 1 ? (x * 1000).toFixed(1) + 'us' : x.toFixed(1) + 'ms';
const rnd = (x, lo) => Math.max(lo == null ? 0 : lo, Math.round(x));

function tourKey(t) {
  const n = t.length;
  let p = 0;
  while (t[p] !== 0) p++;
  let f = [], r = [];
  for (let i = 0; i < n; i++) {
    f.push(t[(p + i) % n]);
    r.push(t[(p - i + n) % n]);
  }
  const fs = f.join(','), rs = r.join(',');
  return fs < rs ? fs : rs;
}

/* Edge recombination: child inherits edges from both parents, fewest-unused-edge rule. */
function erx(A, B2, D, n, r) {
  const adj = Array.from({ length: n }, () => []);
  const add = (a, b) => { if (a !== b && adj[a].indexOf(b) < 0) adj[a].push(b); };
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    add(A[i], A[j]);
    add(B2[i], B2[j]);
  }
  const visited = new Uint8Array(n), out = [];
  let cur = Math.floor(r() * n);
  out.push(cur); visited[cur] = 1;
  for (let step = 1; step < n; step++) {
    let best = -1, bestRem = Infinity, bestD = Infinity;
    const nb = adj[cur];
    for (let q = 0; q < nb.length; q++) {
      const c = nb[q];
      if (visited[c]) continue;
      let rem = 0;
      for (let z = 0; z < adj[c].length; z++) if (!visited[adj[c][z]]) rem++;
      const d = D[cur][c];
      if (rem < bestRem || (rem === bestRem && d < bestD)) { best = c; bestRem = rem; bestD = d; }
    }
    if (best < 0) {
      /* dead end: nearest unvisited */
      for (let c = 0; c < n; c++) if (!visited[c] && D[cur][c] < bestD) { bestD = D[cur][c]; best = c; }
    }
    out.push(best); visited[best] = 1; cur = best;
  }
  return out;
}

function doubleBridge(t, n, r) {
  const a = 1 + Math.floor(r() * (n - 3));
  const b = a + 1 + Math.floor(r() * (n - a - 2));
  const c = b + 1 + Math.floor(r() * (n - b - 1));
  const out = [];
  for (let i = 0; i < a; i++) out.push(t[i]);
  for (let i = c; i < n; i++) out.push(t[i]);
  for (let i = b; i < c; i++) out.push(t[i]);
  for (let i = a; i < b; i++) out.push(t[i]);
  return out;
}

/* ------------------------------ the hybrid ------------------------------- */

function hybrid(inst, seed) {
  const n = inst.n, D = inst.rows;
  const K = CFG.K ? CFG.K : rnd(n / 3, 16);
  const nearK = CFG.near ? CFG.near : rnd(n / 10, 10);
  const base = B.buildInstance(n, inst.seed, inst.kind, nearK);
  const r = B.rng((seed * 1000003 + n * 7919) >>> 0);

  const fastOpts = { oroptMaxL: 3 };
  const polishOpts = { oropt: 1, oroptMaxL: 5 };

  /* dedupe by cycle, keep the shortest copy of each, then trim to the elite size */
  function rebuild(list) {
    const byKey = new Map();
    for (const x of list) {
      const k = tourKey(x.t);
      const old = byKey.get(k);
      if (!old || x.len < old.len) byKey.set(k, x);
    }
    return Array.from(byKey.values()).sort((a, b) => a.len - b.len).slice(0, CFG.elites);
  }
  let pool = [];

  function fastTun(t) {
    return B.refineFast(base.D, t, base.near, base.kn, n, false, fastOpts);
  }
  function polish(t) {
    const pt = B.refineBase(base.rows, t, polishOpts);
    return { t: pt, len: B.tourLenRows(base.rows, pt) };
  }

  /* 1. beam islands -> fast screen -> pool */
  const seeds = [];
  for (let i = 0; i < CFG.islands; i++) {
    const bo = {
      starts: i === 0 ? 'farthest' : 'random',
      startCount: 2,
      startSeed: (seed * 97 + i * 131 + 1) >>> 0
    };
    const b = B.beamFast(base, K, bo);
    for (const f of b.finals) {
      const x = fastTun(f.t);
      seeds.push({ t: x.tour, len: x.len });
    }
  }
  pool = rebuild(seeds);

  /* 2. base-polish the initial elite frontier */
  const startPolish = Math.min(CFG.polish, pool.length), warmed = [];
  for (let i = 0; i < startPolish; i++) warmed.push(polish(pool[i].t));
  pool = rebuild(pool.concat(warmed));

  /* 3. generations: ERX -> kick/anneal -> fast tunnel -> elite polish */
  let best = pool[0], stagnant = 0;
  for (let g = 0; g < CFG.gens; g++) {
    const kids = [];
    for (let c = 0; c < CFG.children; c++) {
      let pa = pool[Math.floor(r() * Math.min(4, pool.length))];
      let pb = pool[Math.floor(r() * pool.length)];
      if (pool.length > 1) {
        for (let tries = 0; tries < 4 && pb === pa; tries++) pb = pool[Math.floor(r() * pool.length)];
      }
      let t = erx(pa.t, pb.t, D, n, r);

      if (r() < CFG.kickRate) {
        const kicks = 1 + Math.floor(r() * Math.max(1, CFG.kicks));
        for (let q = 0; q < kicks; q++) t = doubleBridge(t, n, r);
      }

      if (CFG.anneal > 0 && r() < CFG.annealRate) {
        NAT.setRand(B.rng((seed * 31337 + g * 977 + c * 61 + 7) >>> 0));
        const iters = Math.min(CFG.anneal, Math.max(1000, n * 200));
        t = NAT.anneal(D, t, n, iters, Math.max(1, 0.02 * n), base.near, base.kn).tour;
      }

      const x = fastTun(t);
      kids.push({ t: Array.from(x.tour), len: x.len });
    }

    kids.sort((a, b) => a.len - b.len);
    const pol = Math.min(CFG.polish, kids.length);
    for (let i = 0; i < pol; i++) kids[i] = polish(kids[i].t);

    const before = best.len;
    pool = rebuild(pool.concat(kids));
    best = pool[0];
    if (best.len < before - 1e-9) stagnant = 0; else stagnant++;

    /* 4. stagnation: inject a fresh random-start beam island */
    if (CFG.inject && stagnant >= 2) {
      const b = B.beamFast(base, K, {
        starts: 'random', startCount: 2,
        startSeed: (seed * 71 + g * 997 + 17) >>> 0
      });
      const injected = [];
      for (const f of b.finals) {
        const x = fastTun(f.t);
        injected.push({ t: x.tour, len: x.len });
      }
      pool = rebuild(pool.concat(injected));
      best = pool[0];
      stagnant = 0;
    }
  }

  return { tour: best.t, len: best.len, pool: pool.length };
}

/* ------------------------------ baselines -------------------------------- */

function greedyRun(inst) {
  const [t, tour] = clock(() => B.greedy(inst, inst.fp[0]));
  return { len: B.tourLenRows(inst.rows, tour), ms: t, ok: B.checkTour(tour, inst.n) };
}

function tunedRun(inst) {
  const n = inst.n;
  const K = rnd(n / 3, 16), near = rnd(n / 10, 10);
  const x = B.buildInstance(n, inst.seed, inst.kind, near);
  const [t, res] = clock(() => B.beamFastTunnel(x, K, n, {
    K, near, refineF: n, oroptMaxL: 5, restarts: 4, tunnelMode: 'base'
  }));
  return { len: res.len, ms: t, ok: B.checkTour(res.tour, n) };
}

function natureRun(inst, seed) {
  const n = inst.n, D = inst.rows, order = inst.order;
  NAT.setRand(B.rng((seed * 7919 + n * 104729 + (inst.kind === 'cluster' ? 17 : 0)) >>> 0));
  const kn = Math.min(10, n - 1), near = NAT.makeNear(D, order, kn);
  const iters = CFG.iters || Math.min(120000, 1500 + 45 * n * n);
  const T0 = Math.max(1, 0.03 * n);
  const [t, best] = clock(() => {
    const pop = NAT.popWave(D, order, inst.fp, CFG.M);
    const uniq = [], seen = new Set();
    for (const st of pop) {
      const k = st.t.join(',');
      if (!seen.has(k)) { seen.add(k); uniq.push(st); }
    }
    uniq.sort((a, b) => (a.len + D[a.t[n - 1]][a.start]) - (b.len + D[b.t[n - 1]][b.start]));
    const an = [];
    for (const st of uniq.slice(0, 8)) an.push(NAT.anneal(D, st.t, n, iters, T0, near, kn));
    const m = Math.min(4, uniq.length);
    if (m > 1) for (let q = 0; q < 6; q++) {
      an.push(NAT.anneal(D, NAT.ox(uniq[q % m].t, uniq[(q + 1) % m].t), n, iters, T0, near, kn));
    }
    an.sort((a, b) => a.len - b.len);
    return an[0];
  });
  return { len: best.len, ms: t, ok: B.checkTour(best.tour, n) };
}

/* --------------------------------- bench --------------------------------- */

const methods = ['greedy', 'nature', 'tuned beam', 'hybrid'];
const rows = [];
let bad = 0;

console.log('');
console.log('hybrid_tsp   n=' + NS.join('/') + '  seeds=' + SEEDS + '/family' +
            '  islands=' + CFG.islands + ' gens=' + CFG.gens + ' children=' + CFG.children +
            ' elites=' + CFG.elites + ' polish=' + CFG.polish);
console.log('');

for (const n of NS) {
  for (let s = 1; s <= SEEDS; s++) {
    for (const kind of ['uniform', 'cluster']) {
      const inst = B.buildInstance(n, s, kind, Math.max(10, Math.round(n / 10)));
      inst.seed = s; inst.kind = kind;
      const res = {};
      res.greedy = greedyRun(inst);
      res.nature = natureRun(inst, s);
      res['tuned beam'] = tunedRun(inst);
      const [ht, hr] = clock(() => hybrid(inst, s));
      res.hybrid = { len: hr.len, ms: ht, ok: B.checkTour(hr.tour, n) };
      for (const k in res) if (!res[k].ok) bad++;
      const ref = Math.min.apply(null, methods.map(k => res[k].len));
      rows.push({ n, seed: s, kind, ref, res });
    }
  }
}

const gap = (r, k) => (r.res[k].len / r.ref - 1) * 100;

console.log('SUMMARY  (' + rows.length + ' instances; gap vs best-of-all per instance)');
console.log('');
console.log(padR('method', 16) + padL('median', 9) + padL('mean', 9) + padL('worst', 9) +
            padL('best', 9) + padL('wins', 7) + padL('med ms', 10));
for (const k of methods) {
  const g = rows.map(r => gap(r, k));
  const wins = rows.filter(r => r.res[k].len <= r.ref + 1e-9).length;
  console.log(padR(k, 16) + padL(pcent(med(g)), 9) + padL(pcent(mean(g)), 9) + padL(pcent(mx(g)), 9) +
              padL(pcent(Math.min.apply(null, g)), 9) + padL(wins + '/' + rows.length, 7) +
              padL(ms(med(rows.map(r => r.res[k].ms))), 10));
}

console.log('');
console.log('MEDIAN GAP BY n');
console.log(padR('method', 16) + NS.map(n => padL('n=' + n, 10)).join(''));
for (const k of methods) {
  console.log(padR(k, 16) + NS.map(n => {
    const rr = rows.filter(x => x.n === n);
    return padL(pcent(med(rr.map(x => gap(x, k)))), 10);
  }).join(''));
}

console.log('');
console.log('MEDIAN TIME BY n');
console.log(padR('method', 16) + NS.map(n => padL('n=' + n, 10)).join(''));
for (const k of methods) {
  console.log(padR(k, 16) + NS.map(n =>
    padL(ms(med(rows.filter(x => x.n === n).map(x => x.res[k].ms))), 10)).join(''));
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
  console.log('wrote      : ' + CFG.out);
}
console.log('');
