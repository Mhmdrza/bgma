#!/usr/bin/env node
/* nature_tsp.js -- the same problem, rebuilt from the natural mechanisms.
 *
 * Quantum version          Natural version
 * -----------------------  ----------------------------------------------------
 * superposition (K tours)  a POPULATION of M foragers, each carrying a share of
 *                          the colony's "flow" (weight)
 * branching                each forager extends along the short edges of its
 *                          last three cities, splitting its flow among children
 * interference             two foragers in the same configuration (visited set +
 *                          last city) are one tube: merge them, add their flow
 * measurement              SOFT selection: resample M survivors with probability
 *                          proportional to flow * exp(-(f - fmin)/T).  No hard
 *                          top-K cut; temperature T sets how harsh the pruning is
 * tunnelling               simulated annealing (thermal kicks) + double-bridge
 *                          "avulsion" moves that jump the tour to a new course
 * recombination            AB-style crossover: splice a segment of tour B into
 *                          tour A, repair, re-anneal
 *
 * usage: node nature_tsp.js --n=200 --seeds=4 --M=48 --iters=4000 [--exact=1]
 *
 * Baseline ("beam + tunnel") is loaded from beam_fast.js in the same directory.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const CFG = { n: 200, seeds: 4, M: 48, iters: 150000, exact: 0 };
process.argv.slice(2).forEach(a => {
  const m = /^--([a-zA-Z]+)=(.*)$/.exec(a);
  if (!m || !(m[1] in CFG)) throw new Error('bad flag: ' + a);
  CFG[m[1]] = +m[2];
});
const N = CFG.n, SEEDS = CFG.seeds, M = CFG.M, ITERS = CFG.iters, EXACT = !!CFG.exact;

/* ------------------------------ baseline ------------------------------ */
const core = fs.readFileSync(path.join(__dirname, 'beam_fast.js'), 'utf8')
  .split('/* ================================= harness')[0]
  .replace('process.argv.slice(2)', '[]');       // beam_fast's CLI must not see our flags
eval(core + ';globalThis.TSP={buildInstance,beamFast,refineFast,heldKarp,greedy,KN};');
const TSP = globalThis.TSP;

/* ------------------------------- rng ---------------------------------- */
function rng(seed) {
  let a = seed >>> 0;
  return function () {
    a += 0x6D2B79F5; let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
let rand = rng(0x5EED);

/* ----------------------------- geometry ------------------------------- */
function gauss(r) { return Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(2 * Math.PI * r()); }
function clampv(v) { return Math.min(96, Math.max(4, v)); }
function makePoints(n, seed, kind) {
  const r = rng(seed * 7919 + n * 104729 + (kind === 'cluster' ? 17 : 0));
  const pts = [];
  if (kind === 'cluster') {
    const k = 3 + Math.floor(r() * 2), centers = [];
    for (let c = 0; c < k; c++) centers.push([18 + r() * 64, 18 + r() * 64]);
    for (let i = 0; i < n; i++) {
      const ce = centers[Math.floor(r() * k)];
      pts.push([clampv(ce[0] + gauss(r) * 8), clampv(ce[1] + gauss(r) * 8)]);
    }
  } else {
    for (let i = 0; i < n; i++) pts.push([4 + r() * 92, 4 + r() * 92]);
  }
  return pts;
}
function distRows(pts) {
  const n = pts.length, D = [];
  for (let i = 0; i < n; i++) {
    D.push(new Float64Array(n));
    for (let j = 0; j < n; j++) D[i][j] = Math.hypot(pts[i][0] - pts[j][0], pts[i][1] - pts[j][1]);
  }
  return D;
}
function nearestOrder(D) {
  const n = D.length, out = [];
  for (let i = 0; i < n; i++) {
    const rest = [];
    for (let j = 0; j < n; j++) if (j !== i) rest.push(j);
    rest.sort((a, b) => D[i][a] - D[i][b]);
    out.push(rest);
  }
  return out;
}
function farthestPair(D) {
  const n = D.length; let best = -1, p = 0, q = 1;
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    if (D[i][j] > best) { best = D[i][j]; p = i; q = j; }
  }
  return [p, q];
}
function tourLength(D, t) {
  let s = 0;
  for (let i = 0; i < t.length; i++) s += D[t[i]][t[(i + 1) % t.length]];
  return s;
}

/* --------------------------- the population --------------------------- */

function branches(st, order) {
  const t = st.t, d = t.length, out = [];
  for (let lag = 0; lag < Math.min(3, d); lag++) {
    const c = kth(order, st.seen, t[d - 1 - lag], lag + 1);
    if (c >= 0 && out.indexOf(c) < 0) out.push(c);
  }
  const c2 = kth(order, st.seen, t[d - 1], 2);
  if (c2 >= 0 && out.indexOf(c2) < 0) out.push(c2);
  return out;
}
function kth(order, seen, city, rank) {
  let k = 0;
  for (const c of order[city]) if (!seen[c] && ++k === rank) return c;
  return -1;
}
function keyOf(st) {
  return st.seen.map(v => v ? 1 : 0).join('') + '|' + st.t[st.t.length - 1] + '|' + st.start;
}

/* weighted wave: flows split, identical configurations merge, soft resampling */
function popWave(D, order, poles, M, T0, cool) {
  const n = D.length;
  let states = poles.map(p => {
    const seen = new Array(n).fill(false); seen[p] = true;
    return { t: [p], seen, len: 0, start: p, w: M / poles.length };
  });
  for (let step = 1; step < n; step++) {
    const pool = new Map();
    for (const st of states) {
      const cand = branches(st, order);
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

    /* soft measurement: probability ∝ flow * exp(-(f - fmin)/T) */
    const fmin = arr[0].f;
    const spread = Math.max(1e-9, arr[arr.length - 1].f - fmin);
    const T = 0.25 * spread;                 // selection strength follows the colony spread
    let total = 0;
    for (const s of arr) { s.p = s.w * Math.exp(-(s.f - fmin) / T); total += s.p; }
    states = [];
    let u = rand() / M;
    let acc = 0, idx = 0;
    for (let k = 0; k < M; k++) {
      const target = (u + k / M) * total;
      while (acc + arr[idx].p < target && idx < arr.length - 1) { acc += arr[idx].p; idx++; }
      states.push(arr[idx]);
    }
    for (const st of states) st.w = 1;          // flow renormalised: each survivor carries 1 unit
    states.sort((a, b) => a.len - b.len);
    T0 *= cool;
  }
  return states;
}

/* ------------------------- annealing + avulsion ------------------------ */

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

function propose(t, pos, n, near, kn) {
  const i = Math.floor(rand() * (n - 2));
  let j;
  if (rand() < 0.85) {                     // most proposals are local: a near neighbour of edge end
    const c = near[t[i] * kn + Math.floor(rand() * kn)];
    j = pos[c];
    if (j <= i + 1) return null;
  } else {
    j = i + 2 + Math.floor(rand() * (n - i - 2));
  }
  if (i === 0 && j === n - 1) return null;
  return [i, j];
}

function anneal(D, tour, n, iters, T0, near, kn) {
  const t = Int32Array.from(tour), pos = new Int32Array(n);
  for (let i = 0; i < n; i++) pos[t[i]] = i;
  let len = tourLength(D, t);
  let bestT = Array.from(t), bestL = len, T = T0, since = 0;

  for (let it = 0; it < iters; it++) {
    T *= 0.99998;
    if (T < 1e-7) T = 1e-7;
    const pr = propose(t, pos, n, near, kn);
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

    if (since > 50 * n) {                  // avulsion: jump to a new course, reheat a little
      const k = doubleBridge(t, n);
      for (let q = 0; q < n; q++) t[q] = k[q];
      for (let q = 0; q < n; q++) pos[t[q]] = q;
      len = tourLength(D, t);
      T = Math.max(T, T0 * 0.4);
      since = 0;
    }
  }
  return { tour: bestT, len: bestL };
}

/* ---------------------------- recombination ---------------------------- */

function ox(A, B) {                    // ordered crossover: valid tour by construction
  const n = A.length;
  let a = Math.floor(rand() * n), b = Math.floor(rand() * n);
  if (a > b) { const x = a; a = b; b = x; }
  const child = new Array(n).fill(-1), used = new Uint8Array(n);
  for (let i = a; i <= b; i++) { child[i] = B[i]; used[B[i]] = 1; }
  let k = (b + 1) % n;
  for (let q = 0; q < n; q++) {
    const c = A[(b + 1 + q) % n];
    if (!used[c]) { child[k] = c; used[c] = 1; k = (k + 1) % n; }
  }
  return child;
}

/* -------------------------------- bench -------------------------------- */

function clock(fn) {
  const t0 = process.hrtime.bigint();
  const v = fn();
  return [Number(process.hrtime.bigint() - t0) / 1e6, v];
}
const med = a => a.slice().sort((x, y) => x - y)[a.length >> 1];
const padL = (s, w) => { s = String(s); while (s.length < w) s = ' ' + s; return s; };
const padR = (s, w) => { s = String(s); while (s.length < w) s = s + ' '; return s; };
const pcent = x => (x >= 0 ? '+' : '') + x.toFixed(2) + '%';

const rows = [];
console.log('');
console.log('nature_tsp   n=' + N + '  seeds=' + SEEDS + '/family  M=' + M + '  anneal iters=' + ITERS +
            '  reference=' + (EXACT && N <= 22 ? 'heldKarp' : 'best of all'));
console.log('');
console.log(padL('#', 3) + padR('kind', 9) + padL('beam+tun', 10) + padL('pop', 9) + padL('pop+anneal', 10) +
            padL('pop+anneal+x', 13) + padL('random+tun', 11) + padL('ref', 9) + padL('tPop', 9) + padL('tAnn', 9));

for (let s = 1; s <= SEEDS; s++) {
  for (const kind of ['uniform', 'cluster']) {
    const inst = TSP.buildInstance(N, s, kind);
    const n = inst.n, D = inst.rows, order = nearestOrder(D), poles = farthestPair(D);

    /* baseline: the fast beam + fast tunnel */
    const base = clock(() => TSP.beamFast(inst, 16));
    const finals = base[1].finals;
    const bt = clock(() => {
      let best = Infinity;
      for (const f of finals) best = Math.min(best, TSP.refineFast(inst.D, f.t, inst.near, TSP.KN, n, false).len);
      return best;
    });

    /* population wave, no local search */
    const T0 = 0.02 * n * 2.0, cool = Math.pow(0.002 / 0.02, 1 / n);
    const pw = clock(() => popWave(D, order, poles, M, T0, cool));
    const popStates = pw[1].sort((a, b) => a.len - b.len);
    const popLen = popStates[0].len + D[popStates[0].t[n - 1]][popStates[0].start];

    /* anneal the best distinct survivors */
    const annRes = clock(() => {
      let best = Infinity;
      const seen = new Set();
      for (const st of popStates) {
        const key = st.t.join(',');
        if (seen.has(key)) continue;
        seen.add(key);
        const r = anneal(D, st.t, n, ITERS, 0.01 * 2 * n, inst.near, TSP.KN);
        if (r.len < best) best = r.len;
        if (seen.size >= 8) break;
      }
      return best;
    });

    /* recombination: splice the two best survivors, anneal the child */
    const oxRes = clock(() => {
      let best = annRes[1];
      for (let q = 0; q < 8; q++) {
        const A = popStates[q % Math.min(4, popStates.length)].t;
        const B = popStates[(q + 1) % Math.min(4, popStates.length)].t;
        const child = ox(A, B);
        const r = anneal(D, child, n, ITERS, 0.01 * 2 * n, inst.near, TSP.KN);
        if (r.len < best) best = r.len;
      }
      return best;
    });

    /* reference: 16 random starts + the fast tunnel */
    const rndRes = clock(() => {
      let best = Infinity;
      for (let q = 0; q < 16; q++) {
        const start = (q * 2654435761 >>> 0) % n;
        const t = TSP.greedy(inst, start);
        best = Math.min(best, TSP.refineFast(inst.D, t, inst.near, TSP.KN, n, false).len);
      }
      return best;
    });

    const opt = (EXACT && N <= 22) ? TSP.heldKarp(inst).len
      : Math.min(bt[1], annRes[1], oxRes[1], rndRes[1]);

    rows.push({ kind, beamTun: bt[1], pop: popLen, ann: annRes[1], ox: oxRes[1], rnd: rndRes[1], opt,
                tPop: pw[0], tAnn: annRes[0] });

    console.log(padL(rows.length, 3) + padR(kind, 9) +
      padL(bt[1].toFixed(1), 10) + padL(popLen.toFixed(1), 9) + padL(annRes[1].toFixed(1), 10) +
      padL(oxRes[1].toFixed(1), 13) + padL(rndRes[1].toFixed(1), 11) + padL(opt.toFixed(1), 9) +
      padL(pw[0].toFixed(1) + 'ms', 9) + padL(annRes[0].toFixed(1) + 'ms', 9));
  }
}

const m = k => med(rows.map(r => r[k]));
const ref = med(rows.map(r => r.opt));
const names = [['beamTun', 'beam + tunnel'], ['pop', 'population only'], ['ann', 'population + anneal'],
               ['ox', 'pop + anneal + recombination'], ['rnd', '16 random + tunnel']];

console.log('');
console.log('------------------------------------------------------------------------------------------');
console.log('SUMMARY   n=' + N + '  instances=' + rows.length);
console.log('');
for (const [k, label] of names) {
  console.log(padR(label, 32) + padL(m(k).toFixed(1), 10) +
    padL(pcent((m(k) / ref - 1) * 100), 9) +
    padL(rows.filter(r => r[k] === Math.min(r.beamTun, r.pop, r.ann, r.ox, r.rnd)).length + '/' + rows.length, 8));
}
console.log('');
console.log('population wave   ' + m('tPop').toFixed(1) + ' ms   (M=' + M + ', soft resampling)');
console.log('annealing         ' + m('tAnn').toFixed(1) + ' ms   (8 survivors x ' + ITERS + ' proposals with kicks)');
