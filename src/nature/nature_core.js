/* nature_core.js -- the nature solver, parameterised.
 *
 * This is the same population + annealing + recombination pipeline as
 * docs/nature_tsp.html and src/nature/nature_tsp.js, extracted so that:
 *   - the demos keep their readable copies,
 *   - src/nature/nature_effort.js can map an --effort level onto the knobs,
 *   - tuning/tune_nature.js can sweep one knob at a time.
 *
 * Pipeline
 *   poles -> weighted population wave (flow splits, tubes merge, soft
 *   measurement) -> anneal the distinct survivors -> ordered crossover
 *   children -> anneal children -> best tour wins. Restarts repeat the whole
 *   run from independent poles/streams.
 *
 * All knobs are plain options. Defaults reproduce the page/bench behaviour.
 */
'use strict';
const fs = require('fs');
const path = require('path');

/* --------------------------- load instance code -------------------------- */

const beamCore = fs.readFileSync(path.join(__dirname, '..', 'beam', 'beam_fast.js'), 'utf8')
  .split('/* ================================= harness')[0]
  .replace('process.argv.slice(2)', '[]');
const B = eval(beamCore + ';({buildInstance,rng,tourLenRows,tourLenFlat,checkTour,refineFast,refineBase,greedy,' +
  'beamFast,beamFastTunnel,heldKarp})');

/* ------------------------------- defaults -------------------------------- */

const DEFAULTS = Object.freeze({
  /* population wave */
  M: 48,                 // number of foragers (flow units)
  branchLag: 3,          // trailing cities allowed to nominate (rank = lag+1)
  extraRank: 2,          // extra candidate rank from the current city (0 = off)
  maxBranch: 4,          // children per state after candidate dedupe (0 = unlimited)
  selMode: 'soft',       // soft = flow * exp(-(f-fmin)/T); hard = top-M cut; flow = flow only
  selT: 0.25,            // soft-selection temperature as a fraction of the spread
  poles: 'farthest',     // farthest | random | all
  startCount: 2,         // poles used when poles=random
  startSeed: 0,          // salt for the random stream (0 = page/bench default)

  /* annealing + avulsion */
  iters: 0,              // proposals per tour; 0 -> min(120000, 1500 + 45 n^2)
  T0: 0,                 // initial temperature; 0 -> 0.03 n
  coolRate: 0.99998,
  Tmin: 1e-7,
  pLocal: 0.85,          // fraction of informed (candidate-list) proposals
  stallK: 50,            // avulsion after stallK * n non-improving proposals
  reheat: 0.4,           // temperature is raised to at least reheat * T0 on avulsion
  nearK: 0,              // candidate-list width for proposals; 0 -> min(10, n-1)

  /* portfolio */
  survivors: 8,          // distinct population survivors annealed
  children: 8,           // ordered-crossover children annealed
  parents: 4,            // top parents used for crossover
  restarts: 1,           // independent runs, best tour wins
  /* optional finishing local search, borrowed from the tunnel:
   * 0 = pure nature model; 'fast' = candidate-list 2-opt; 'base' = full restart */
  polish: 0,
  polishTop: 3,
  polishOrOptMaxL: 3
});

const rnd = (x, lo) => Math.max(lo == null ? 0 : lo, Math.round(x));

/* ------------------------------- rng ------------------------------------ */

let rand = B.rng(0x5EED);
function setRand(fn) { rand = fn; }

/* --------------------------- population wave ---------------------------- */

function makeNear(order, n, k) {
  const kn = Math.max(2, Math.min(k, n - 1));
  const near = new Int32Array(n * kn);
  for (let i = 0; i < n; i++) {
    for (let q = 0; q < kn; q++) near[i * kn + q] = order[i][q % (n - 1)];
  }
  return { near, kn };
}

function kth(order, seen, city, rank) {
  if (rank <= 0) return -1;
  let k = 0;
  for (const c of order[city]) if (!seen[c] && ++k === rank) return c;
  return -1;
}

function branches(st, order, P) {
  const t = st.t, d = t.length, out = [];
  const lags = Math.min(P.branchLag, d);
  for (let lag = 0; lag < lags; lag++) {
    const c = kth(order, st.seen, t[d - 1 - lag], lag + 1);
    if (c >= 0 && out.indexOf(c) < 0) out.push(c);
  }
  if (P.extraRank > 0) {
    const c2 = kth(order, st.seen, t[d - 1], P.extraRank);
    if (c2 >= 0 && out.indexOf(c2) < 0) out.push(c2);
  }
  if (P.maxBranch > 0 && out.length > P.maxBranch) out.length = P.maxBranch;
  return out;
}

function keyOf(st) {
  return st.seen.map(v => v ? 1 : 0).join('') + '|' + st.t[st.t.length - 1] + '|' + st.start;
}

function pickPoles(inst, P, run) {
  const n = inst.n;
  if (run === 0 && P.poles === 'farthest') return inst.fp.slice(0, 2);
  if (run === 0 && P.poles === 'all') {
    const out = [];
    for (let i = 0; i < n; i++) out.push(i);
    return out;
  }
  const count = Math.max(1, Math.min(run === 0 && P.poles === 'farthest' ? 2 : P.startCount, n));
  const out = [], seen = new Uint8Array(n);
  while (out.length < count) {
    const c = Math.floor(rand() * n);
    if (!seen[c]) { seen[c] = 1; out.push(c); }
  }
  return out;
}

function popWave(D, order, poles, M, P) {
  const n = D.length;
  let states = poles.map(p => {
    const seen = new Array(n).fill(false); seen[p] = true;
    return { t: [p], seen, len: 0, start: p, w: 1 };
  });

  for (let step = 1; step < n; step++) {
    const pool = new Map();
    for (const st of states) {
      const cand = branches(st, order, P);
      if (!cand.length) { pool.set(keyOf(st), { ...st }); continue; }
      const share = st.w / cand.length;                 // flow splits along the tubes
      for (const c of cand) {
        const seen = st.seen.slice(); seen[c] = true;
        const kid = {
          t: st.t.concat(c), seen,
          len: st.len + D[st.t[st.t.length - 1]][c],
          start: st.start, w: share
        };
        const key = keyOf(kid);
        const old = pool.get(key);
        if (old) old.w += share;                        // tubes merge: flows add
        else pool.set(key, kid);
      }
    }
    let arr = [...pool.values()];
    for (const s of arr) s.f = s.len + D[s.t[s.t.length - 1]][s.start];
    arr.sort((a, b) => a.f - b.f);

    /* soft measurement: probability proportional to flow * exp(-(f-fmin)/T) */
    const fmin = arr[0].f;
    const spread = Math.max(1e-9, arr[arr.length - 1].f - fmin);
    if (P.selMode === 'hard') {
      /* quantum-style hard cut: keep the M best, flow decides ties only */
      states = arr.slice(0, Math.min(M, arr.length)).map(s => Object.assign({}, s));
    } else if (P.selMode === 'flow' || P.selT <= 0) {
      /* no quality pressure: flow alone */
      let total = 0;
      for (const s of arr) total += s.w;
      states = resample(arr, M, s => s.w / total);
    } else {
      const T = Math.max(1e-9, P.selT * spread);
      let total = 0;
      for (const s of arr) { s.p = s.w * Math.exp(-(s.f - fmin) / T); total += s.p; }
      states = resample(arr, M, s => s.p / total);
    }
    for (const st of states) st.w = 1;          // flow renormalised: each survivor carries 1 unit
  }
  return states;
}

/* systematic resampling from a discrete distribution */
function resample(arr, M, probOf) {
  const out = [], probs = arr.map(probOf);
  let u = rand() / M, acc = 0, idx = 0;
  for (let k = 0; k < M; k++) {
    const target = u + k / M;
    while (idx < arr.length - 1 && acc + probs[idx] < target) { acc += probs[idx]; idx++; }
    out.push(arr[idx]);
  }
  return out;
}

/* ------------------------- annealing + avulsion ------------------------- */

function doubleBridge(t, n) {
  const a = 1 + Math.floor(rand() * (n - 3));
  const b = a + 1 + Math.floor(rand() * (n - a - 2));
  const c = b + 1 + Math.floor(rand() * (n - b - 1));
  const out = [];
  for (let i = 0; i < a; i++) out.push(t[i]);
  for (let i = c; i < n; i++) out.push(t[i]);
  for (let i = b; i < c; i++) out.push(t[i]);
  for (let i = a; i < b; i++) out.push(t[i]);
  return out;
}

function propose(t, pos, n, near, kn, P) {
  const i = Math.floor(rand() * (n - 2));
  let j;
  if (rand() < P.pLocal) {                   // informed: a near neighbour of an edge end
    const c = near[t[i] * kn + Math.floor(rand() * kn)];
    j = pos[c];
    if (j <= i + 1) return null;
  } else {
    j = i + 2 + Math.floor(rand() * (n - i - 2));
  }
  if (i === 0 && j === n - 1) return null;
  return [i, j];
}

function anneal(D, tour, n, iters, T0, near, kn, P) {
  const t = Int32Array.from(tour), pos = new Int32Array(n);
  for (let i = 0; i < n; i++) pos[t[i]] = i;
  let len = B.tourLenRows(D, t);
  let bestT = Array.from(t), bestL = len, T = T0, since = 0;

  for (let it = 0; it < iters; it++) {
    T *= P.coolRate;
    if (T < P.Tmin) T = P.Tmin;
    const pr = propose(t, pos, n, near, kn, P);
    if (!pr) continue;
    const i = pr[0], j = pr[1];
    const a = t[i], b = t[i + 1], c = t[j], d = t[(j + 1) % n];
    const delta = D[a][c] + D[b][d] - D[a][b] - D[c][d];

    if (delta < 0 || rand() < Math.exp(-delta / T)) {
      for (let lo = i + 1, hi = j; lo < hi; lo++, hi--) {
        const x = t[lo]; t[lo] = t[hi]; t[hi] = x;
        pos[t[lo]] = lo; pos[t[hi]] = hi;
      }
      len += delta;
      if (len < bestL - 1e-9) { bestL = len; bestT = Array.from(t); since = 0; }
      else since++;
    } else since++;

    if (P.stallK > 0 && since > P.stallK * n) {   // avulsion: new course, partial reheat
      const k = doubleBridge(t, n);
      for (let q = 0; q < n; q++) t[q] = k[q];
      for (let q = 0; q < n; q++) pos[t[q]] = q;
      len = B.tourLenRows(D, t);
      T = Math.max(T, T0 * P.reheat);
      since = 0;
    }
  }
  return { tour: bestT, len: bestL };
}

/* ---------------------------- recombination ---------------------------- */

function ox(A, B2) {                    // ordered crossover: valid tour by construction
  const n = A.length;
  let a = Math.floor(rand() * n), b = Math.floor(rand() * n);
  if (a > b) { const x = a; a = b; b = x; }
  const child = new Array(n).fill(-1), used = new Uint8Array(n);
  for (let i = a; i <= b; i++) { child[i] = B2[i]; used[B2[i]] = 1; }
  let k = (b + 1) % n;
  for (let q = 0; q < n; q++) {
    const c = A[(b + 1 + q) % n];
    if (!used[c]) { child[k] = c; used[c] = 1; k = (k + 1) % n; }
  }
  return child;
}

/* ------------------------------- one run -------------------------------- */

function runOnce(inst, seed, P, run) {
  const n = inst.n, D = inst.rows;
  const M = Math.max(2, P.M);
  const nearK = P.nearK ? P.nearK : Math.min(10, n - 1);
  const { near, kn } = makeNear(inst.order, n, nearK);
  const iters = P.iters > 0 ? P.iters : Math.min(120000, 1500 + 45 * n * n);
  const T0 = P.T0 > 0 ? P.T0 : 0.03 * n;

  const poles = pickPoles(inst, P, run);
  const pop = popWave(D, inst.order, poles, M, P);
  const uniq = [], seen = new Set();
  for (const st of pop) {
    const key = st.t.join(',');
    if (!seen.has(key)) { seen.add(key); uniq.push(st); }
  }
  uniq.sort((a, b) => (a.len + D[a.t[n - 1]][a.start]) - (b.len + D[b.t[n - 1]][b.start]));

  const cands = [];
  for (const st of uniq.slice(0, Math.max(1, P.survivors))) {
    cands.push(anneal(D, st.t, n, iters, T0, near, kn, P));
  }
  const m = Math.min(P.parents, uniq.length);
  if (m > 1 && P.children > 0) {
    for (let q = 0; q < P.children; q++) {
      cands.push(anneal(D, ox(uniq[q % m].t, uniq[(q + 1) % m].t), n, iters, T0, near, kn, P));
    }
  }
  cands.sort((a, b) => a.len - b.len);

  if (P.polish) {
    const top = Math.min(P.polishTop || 1, cands.length);
    for (let i = 0; i < top; i++) {
      let t = cands[i].tour, len;
      if (P.polish === 'base') {
        t = B.refineBase(inst.rows, t, { oropt: 1, oroptMaxL: P.polishOrOptMaxL });
        len = B.tourLenRows(inst.rows, t);
      } else {
        const r = B.refineFast(inst.D, t, inst.near, inst.kn, n, false, { oroptMaxL: P.polishOrOptMaxL });
        t = r.tour; len = r.len;
      }
      cands[i] = { tour: Array.from(t), len };
    }
    cands.sort((a, b) => a.len - b.len);
  }
  return cands[0];
}

/* Public entry point. Restarts rerun the pipeline from independent poles and
 * keep the shortest tour. */
function nature(inst, seed, opts) {
  const P = Object.assign({}, DEFAULTS, opts || {});
  const n = inst.n;
  const R = Math.max(1, P.restarts | 0);
  let best = null;
  for (let r = 0; r < R; r++) {
    rand = B.rng((seed * 7919 + n * 104729 + r * 15485863 +
      (inst.kind === 'cluster' ? 17 : 0) + (P.startSeed >>> 0)) >>> 0);
    const res = runOnce(inst, seed, P, r);
    if (!best || res.len < best.len - 1e-9) best = res;
  }
  return { tour: best.tour, len: best.len, restarts: R };
}

/* ------------------------------ effort dial ----------------------------- */

const { effortPreset } = require('./nature_effort_profiles.js');

/* Run one named effort level. `max` is a two-configuration portfolio: the
 * xhigh run and the heavier max run are independent, so max can never be
 * worse than xhigh on the same instance. The cost is the sum of both runs. */
function runEffort(inst, seed, level, overrides) {
  const L = String(level || 'mid').toLowerCase();
  const O = overrides || {};
  const withO = opts => Object.assign({}, opts, O);
  if (L === 'max') {
    const n = inst.n;
    const a = nature(inst, seed, withO(effortPreset('xhigh', n)));
    const b = nature(inst, (seed + 104729) >>> 0, withO(effortPreset('max', n)));
    return b.len <= a.len ? b : a;
  }
  return nature(inst, seed, withO(effortPreset(L, inst.n)));
}

module.exports = {
  B, DEFAULTS, nature, runEffort, effortPreset, popWave, anneal, ox, doubleBridge, makeNear,
  setRand, rng: B.rng, tourLenRows: B.tourLenRows, checkTour: B.checkTour,
  buildInstance: B.buildInstance
};
