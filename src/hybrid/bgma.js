/* bgma.js -- Beam-Guided Memetic Annealing, parameterised.
 *
 * This is the same pipeline as hybrid_tsp.js, extracted so that:
 *   - hybrid_tsp.js can keep its benchmark, and
 *   - hybrid_effort.js can map an --effort level onto the knobs.
 *
 * Pipeline:
 *   beam islands -> fast candidate-list screen -> elite pool
 *   -> ERX -> double-bridge kick / short anneal -> fast screen
 *   -> selective full-restart polish -> optional final polish
 *
 * All knobs are plain options; no globals are mutated after load.
 *
 * `beamScreen()` is steps 1+2 with everything after them removed; the ablation
 * against the full pipeline lives in experiments/beam-screen-only/.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { effortPreset } = require('./effort_profiles.js');
const { instanceFromSpec } = require('./instance.js');

/* --------------------------- load implementations ------------------------ */

const beamCore = fs.readFileSync(path.join(__dirname, '..', 'beam', 'beam_fast.js'), 'utf8')
  .split('/* ================================= harness')[0]
  .replace('process.argv.slice(2)', '[]');
const B = eval(beamCore + ';({buildInstance,beamFast,beamFastTunnel,refineFast,refineBase,greedy,' +
  'tourLenRows,checkTour,rng,heldKarp})');

function sliceHtml(file, marker) {
  const txt = fs.readFileSync(file, 'utf8');
  const cut = txt.indexOf(marker);
  if (cut < 0) throw new Error('marker not found in ' + file + ': ' + marker);
  const start = txt.indexOf('<script>') >= 0 && txt.indexOf('<script>') < cut
    ? txt.indexOf('<script>') + '<script>'.length : 0;
  return txt.slice(start, cut);
}
const NAT = eval(sliceHtml(path.join(__dirname, '..', '..', 'docs', 'nature_tsp.html'), '/* ============================== drawing') +
  ';({makeNear,popWave,anneal,ox,tourLength,setRand:fn=>{rand=fn;}})');

/* ------------------------------- defaults -------------------------------- */

const DEFAULTS = Object.freeze({
  islands: 4,
  K: 0,                 // 0 -> max(16, n/3)
  near: 0,              // 0 -> max(10, n/10)
  elites: 16,
  polish: 6,
  gens: 6,
  children: 8,
  kicks: 1,
  kickRate: 0.35,
  anneal: 20000,        // iteration cap; 0 disables annealing
  annealRate: 0.35,
  inject: 1,
  score: 'visited',     // beam score mode
  fastOrOptMaxL: 3,
  polishOrOptMaxL: 5,
  finalPolish: 0,       // polish top N after the generations
  restarts: 1           // independent hybrid restarts, best wins
});

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

/* -------------------- beam + fast screen, and nothing else ----------------
 * Steps 1 and 2 of the pipeline on their own:
 *   beam islands -> fast candidate-list screen -> shortest tour wins
 * No elite pool, no ERX, no kicks/annealing, no full-restart polish.
 * `screenF` caps how many finals per island get the screen (0 = all of them).
 */
const SCREEN_DEFAULTS = Object.freeze({
  islands: 4,
  K: 0,                 // 0 -> max(16, n/3)
  near: 0,              // 0 -> max(10, n/10)
  startCount: 2,
  score: 'visited',
  fastOrOptMaxL: 3,
  screenF: 0,           // 0 -> screen every beam final
  restarts: 1
});

function beamScreenOnce(inst, base, seed, P) {
  const n = inst.n;
  const K = P.K ? P.K : rnd(n / 3, 16);
  const fastOpts = { oroptMaxL: P.fastOrOptMaxL };
  const islands = Math.max(1, P.islands | 0);
  let best = null;
  for (let i = 0; i < islands; i++) {
    const b = B.beamFast(base, K, {
      starts: i === 0 ? 'farthest' : 'random',
      startCount: P.startCount,
      startSeed: (seed * 97 + i * 131 + 1) >>> 0,
      score: P.score
    });
    const lim = P.screenF > 0 ? Math.min(P.screenF, b.finals.length) : b.finals.length;
    for (let f = 0; f < lim; f++) {
      const x = B.refineFast(base.D, b.finals[f].t, base.near, base.kn, n, false, fastOpts);
      if (!best || x.len < best.len - 1e-9) best = { t: x.tour, len: x.len };
    }
  }
  return best;
}

/* Public entry point. Restarts repeat the same two steps with fresh beam seeds. */
function beamScreen(inst, seed, opts) {
  const P = Object.assign({}, SCREEN_DEFAULTS, opts || {});
  const n = inst.n;
  const nearK = P.near ? P.near : rnd(n / 10, 10);
  const base = inst.base || B.buildInstance(n, inst.seed, inst.kind, nearK);
  const R = Math.max(1, P.restarts | 0);
  let best = null;
  for (let r = 0; r < R; r++) {
    const res = beamScreenOnce(inst, base, (seed + r * 104729) >>> 0, P);
    if (!best || res.len < best.len - 1e-9) best = res;
  }
  return { tour: best.t, len: best.len, restarts: R, knobs: P };
}

/* ------------------------------ the hybrid ------------------------------- */

function hybridOnce(inst, base, seed, P) {
  const n = inst.n, D = inst.rows;
  const K = P.K ? P.K : rnd(n / 3, 16);
  const r = B.rng((seed * 1000003 + n * 7919) >>> 0);

  const fastOpts = { oroptMaxL: P.fastOrOptMaxL };
  const polishOpts = { oropt: 1, oroptMaxL: P.polishOrOptMaxL };

  function rebuild(list) {
    const byKey = new Map();
    for (const x of list) {
      const k = tourKey(x.t);
      const old = byKey.get(k);
      if (!old || x.len < old.len) byKey.set(k, x);
    }
    return Array.from(byKey.values()).sort((a, b) => a.len - b.len).slice(0, P.elites);
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
  for (let i = 0; i < P.islands; i++) {
    const bo = {
      starts: i === 0 ? 'farthest' : 'random',
      startCount: 2,
      startSeed: (seed * 97 + i * 131 + 1) >>> 0,
      score: P.score
    };
    const b = B.beamFast(base, K, bo);
    for (const f of b.finals) {
      const x = fastTun(f.t);
      seeds.push({ t: x.tour, len: x.len });
    }
  }
  pool = rebuild(seeds);

  /* 2. base-polish the initial elite frontier */
  const startPolish = Math.min(P.polish, pool.length), warmed = [];
  for (let i = 0; i < startPolish; i++) warmed.push(polish(pool[i].t));
  pool = rebuild(pool.concat(warmed));

  /* 3. generations: ERX -> kick/anneal -> fast tunnel -> elite polish */
  let best = pool[0], stagnant = 0;
  for (let g = 0; g < P.gens; g++) {
    const kids = [];
    for (let c = 0; c < P.children; c++) {
      let pa = pool[Math.floor(r() * Math.min(4, pool.length))];
      let pb = pool[Math.floor(r() * pool.length)];
      if (pool.length > 1) {
        for (let tries = 0; tries < 4 && pb === pa; tries++) pb = pool[Math.floor(r() * pool.length)];
      }
      let t = erx(pa.t, pb.t, D, n, r);

      if (r() < P.kickRate) {
        const kicks = 1 + Math.floor(r() * Math.max(1, P.kicks));
        for (let q = 0; q < kicks; q++) t = doubleBridge(t, n, r);
      }

      if (P.anneal > 0 && r() < P.annealRate) {
        NAT.setRand(B.rng((seed * 31337 + g * 977 + c * 61 + 7) >>> 0));
        const iters = Math.min(P.anneal, Math.max(1000, n * 200));
        t = NAT.anneal(D, t, n, iters, Math.max(1, 0.02 * n), base.near, base.kn).tour;
      }

      const x = fastTun(t);
      kids.push({ t: Array.from(x.tour), len: x.len });
    }

    kids.sort((a, b) => a.len - b.len);
    const pol = Math.min(P.polish, kids.length);
    for (let i = 0; i < pol; i++) kids[i] = polish(kids[i].t);

    const before = best.len;
    pool = rebuild(pool.concat(kids));
    best = pool[0];
    if (best.len < before - 1e-9) stagnant = 0; else stagnant++;

    /* 4. stagnation: inject a fresh random-start beam island */
    if (P.inject && stagnant >= 2) {
      const b = B.beamFast(base, K, {
        starts: 'random', startCount: 2,
        startSeed: (seed * 71 + g * 997 + 17) >>> 0,
        score: P.score
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

  /* 5. optional final polish of the surviving frontier */
  if (P.finalPolish > 0) {
    const fin = [];
    for (let i = 0; i < Math.min(P.finalPolish, pool.length); i++) fin.push(polish(pool[i].t));
    pool = rebuild(pool.concat(fin));
    best = pool[0];
  }

  return { tour: best.t, len: best.len, pool: pool.length };
}

/* Public entry point. opts is merged over DEFAULTS; restarts rerun the whole
 * hybrid from independent beam/anneal seeds and keep the shortest tour. */
function hybrid(inst, seed, opts) {
  const P = Object.assign({}, DEFAULTS, opts || {});
  const n = inst.n;
  const nearK = P.near ? P.near : rnd(n / 10, 10);
  /* a caller may supply a prepared instance (custom geometry); otherwise rebuild
   * it from n/seed/kind exactly as before. */
  const base = inst.base || B.buildInstance(n, inst.seed, inst.kind, nearK);
  let best = null, pool = 0;
  const R = Math.max(1, P.restarts | 0);
  for (let r = 0; r < R; r++) {
    const res = hybridOnce(inst, base, (seed + r * 104729) >>> 0, P);
    pool = Math.max(pool, res.pool);
    if (!best || res.len < best.len - 1e-9) best = res;
  }
  return { tour: best.tour, len: best.len, pool: pool, restarts: R };
}

/* Run one named effort level. `max` is a two-configuration portfolio: the
 * xhigh run and the max run are independent, so max can never be worse than
 * xhigh on the same instance. The cost is the sum of both runs. */
function runEffort(inst, seed, level, overrides) {
  const L = String(level || 'mid').toLowerCase();
  const O = overrides || {};
  const withO = opts => Object.assign({}, opts, O);
  if (L === 'max') {
    const n = inst.n;
    const a = hybrid(inst, seed, withO(effortPreset('xhigh', n)));
    const b = hybrid(inst, (seed + 104729) >>> 0, withO(effortPreset('max', n)));
    return b.len <= a.len ? b : a;
  }
  return hybrid(inst, seed, withO(effortPreset(L, inst.n)));
}

/* ------------------------- parallel work units ---------------------------
 * `max` is a portfolio of three independent, deterministic hybrid runs:
 *   arm 0: xhigh at `seed`
 *   arm 1: max restart 0 at seed+104729
 *   arm 1: max restart 1 at seed+2*104729
 * Splitting them across threads is result-identical to runEffort(), because
 * each unit is the exact call hybridOnce() would have made, in any order.
 */
function unitsFor(level, n, seed) {
  const L = String(level || 'mid').toLowerCase();
  if (L === 'max') {
    const s2 = (seed + 104729) >>> 0;
    return [
      { level: 'xhigh', seed, restart: 0, arm: 0, preset: effortPreset('xhigh', n) },
      { level: 'max', seed: s2, restart: 0, arm: 1, preset: effortPreset('max', n) },
      { level: 'max', seed: s2, restart: 1, arm: 1, preset: effortPreset('max', n) }
    ];
  }
  return [{ level: L, seed, restart: 0, arm: 0, preset: effortPreset(L, n) }];
}

/* Run one unit in this thread. Used by the worker pool; also callable directly. */
function hybridUnit(instSpec, seed, preset, restart) {
  const inst = instanceFromSpec(B, instSpec);
  const P = Object.assign({}, DEFAULTS, preset || {});
  const nearK = P.near ? P.near : rnd(inst.n / 10, 10);
  const base = inst.base || B.buildInstance(inst.n, inst.seed, inst.kind, nearK);
  const t0 = process.hrtime.bigint();
  const res = hybridOnce(inst, base, (seed + ((restart | 0) * 104729)) >>> 0, P);
  return { len: res.len, tour: res.tour, ms: Number(process.hrtime.bigint() - t0) / 1e6 };
}

/* Fold unit results back into exactly what runEffort(level) would have returned. */
function combineUnits(level, results) {
  if (String(level || 'mid').toLowerCase() !== 'max') return results[0];
  let a = null, b = null;
  for (const r of results) {
    if (r.arm === 0) a = r;
    else if (!b || r.len < b.len - 1e-9) b = r;
  }
  return b.len <= a.len ? b : a;
}

module.exports = { B, NAT, DEFAULTS, hybrid, hybridOnce, runEffort, erx, doubleBridge,
  effortPreset, tourKey, unitsFor, hybridUnit, combineUnits,
  SCREEN_DEFAULTS, beamScreen, beamScreenOnce };
