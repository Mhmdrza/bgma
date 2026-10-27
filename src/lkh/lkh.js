/* lkh.js -- Lin-Kernighan-Helsgaun style tour search.
 *
 * This is an independent solver for the symmetric TSP, in the shape of
 * Helsgaun's LKH: candidate-list restricted, sequential k-opt moves found by a
 * Lin-Kernighan edge-exchange chain, wrapped in an iterated local search that
 * perturbs the tour with double-bridge kicks.
 *
 * What it implements
 *   - candidate sets from the K nearest neighbours (LKH's NEAREST candidate
 *     set, not its alpha-nearness one -- no 1-tree ascent here)
 *   - sequential Lin-Kernighan moves: two reconnections per candidate, both tour
 *     orientations, positive-gain pruning, and a look-ahead that refuses to
 *     extend a chain whose gain no longer covers the cheapest possible closing
 *     edge. maxDepth = 3 means moves up to 5-opt (2 + maxDepth edges changed)
 *   - don't-look bits: a city is only re-searched once an adjacent edge changed
 *   - iterated LK: double-bridge kick -> LK to a local optimum; the incumbent is
 *     replaced on improvement and the search restarts from the best tour when a
 *     trial is worse (classic ILK acceptance). The kick run stops after 50
 *     kicks with no improvement (`stall`), so tiny n does not churn
 *
 * Not implemented (deliberate): alpha-nearness candidate sets, non-sequential
 * 4/5-opt moves, tour merging, and the 1-tree/Walk construction. Deeper chains
 * are available (--maxDepth=5) but cost far more than they return here: without
 * alpha-values there is little pruning, so 5 measured ~10x slower than 3 for
 * ~0.1% shorter tours.
 *
 * usage:
 *   node src/lkh/lkh.js --n=200 --seeds=3
 *   node src/lkh/lkh.js --ns=100,200,400,1000 --seeds=2 --kinds=uniform,cluster
 *   node src/lkh/lkh.js --n=100 --K=10 --maxDepth=5 --kicks=200
 *   node src/lkh/lkh.js --check=1                 # validate vs Held-Karp, n<=12
 */
'use strict';

const EPS = 1e-9;

const DEFAULTS = Object.freeze({
  K: 8,             // candidate-set size
  maxDepth: 3,      // chain levels; depth d closes at a (d+2)-opt move
  kicks: 0,         // 0 -> max(40, round(30000 / n))
  stall: 50,        // stop after this many kicks with no improvement
  starts: 4,        // nearest-neighbour starts for the initial tour
  seed: 1,
  eps: EPS
});

function rng(seed) {
  let a = seed >>> 0;
  return function () {
    a += 0x6D2B79F5; let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function tourLenFlat(D, t, n) {
  let s = 0;
  for (let i = 0; i < n; i++) s += D[t[i] * n + t[(i + 1) % n]];
  return s;
}

function checkTour(t, n) {
  if (t.length !== n) return false;
  const seen = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const v = t[i];
    if (!(v >= 0 && v < n) || seen[v]) return false;
    seen[v] = 1;
  }
  return true;
}

/* ------------------------------- candidates ------------------------------ */
/* One pass over the rows, sorted, truncated to K. O(n^2 log n) once. */
function buildCandidates(D, n, K) {
  const cand = new Int32Array(n * K);
  for (let i = 0; i < n; i++) {
    const row = D.subarray(i * n, (i + 1) * n), idx = [];
    for (let j = 0; j < n; j++) if (j !== i) idx.push(j);
    idx.sort((a, b) => row[a] - row[b]);
    for (let q = 0; q < K; q++) cand[i * K + q] = idx[q];
  }
  return cand;
}

/* ------------------------------ construction ----------------------------- */

function nnTour(D, n, start) {
  const t = new Int32Array(n), seen = new Uint8Array(n);
  let cur = start;
  seen[cur] = 1;
  t[0] = cur;
  for (let i = 1; i < n; i++) {
    const off = cur * n;
    let best = -1, bd = Infinity;
    for (let j = 0; j < n; j++) {
      if (seen[j]) continue;
      const d = D[off + j];
      if (d < bd) { bd = d; best = j; }
    }
    t[i] = best; seen[best] = 1; cur = best;
  }
  return t;
}

function initialTour(D, n, starts, r) {
  let best = null, bestLen = Infinity;
  const seeds = [];
  /* the two poles make the greedy walk start at opposite ends; the rest is random */
  let p = 0, q = 0, far = -1;
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    const d = D[i * n + j];
    if (d > far) { far = d; p = i; q = j; }
  }
  seeds.push(p, q);
  while (seeds.length < starts) seeds.push(Math.floor(r() * n));
  for (const s of seeds) {
    const t = nnTour(D, n, s), len = tourLenFlat(D, t, n);
    if (len < bestLen) { bestLen = len; best = t; }
  }
  return best;
}

function doubleBridge(t, n, r) {
  const a = 1 + Math.floor(r() * (n - 3));
  const b = a + 1 + Math.floor(r() * (n - a - 2));
  const c = b + 1 + Math.floor(r() * (n - b - 1));
  const out = new Array(n);
  let w = 0;
  for (let i = 0; i < a; i++) out[w++] = t[i];
  for (let i = c; i < n; i++) out[w++] = t[i];
  for (let i = b; i < c; i++) out[w++] = t[i];
  for (let i = a; i < b; i++) out[w++] = t[i];
  return out;
}

/* ------------------------------ link lists -------------------------------
 * The tour lives as next[]/prev[]. The LK chain works on the Hamiltonian path
 * that starts at the current free end and ends at t1; the edge (t1, free end)
 * is the one being rebuilt, so it always stays linked as the "ghost" edge.
 */

function setTour(next, prev, t, n) {
  for (let i = 0; i < n; i++) {
    const a = t[i], b = t[(i + 1) % n];
    next[a] = b; prev[b] = a;
  }
}

function getTour(next, n) {
  const t = new Int32Array(n);
  let x = 0;
  for (let i = 0; i < n; i++) { t[i] = x; x = next[x]; }
  return t;
}

/* Reverse the path [loose .. chainEnd] and reattach it to tail (= the city that
 * was on the far side of the dropped edge), so chainEnd becomes the new free
 * end and the ghost edge becomes (chainEnd, t1). False if unreachable. */
function flip(S, nx, pv, loose, chainEnd, tail, t1, buf, depth, lens) {
  let len = 0, x = loose;
  while (x !== chainEnd) {
    buf[len++] = x;
    x = nx[x];
    if (x === t1 || len > S.n) return false;
  }
  buf[len++] = chainEnd;
  for (let i = len - 1; i >= 0; i--) {
    const cur = buf[i];
    const nxt = i > 0 ? buf[i - 1] : tail;
    nx[cur] = nxt;
    pv[nxt] = cur;
  }
  pv[chainEnd] = t1;
  nx[t1] = chainEnd;
  lens[depth] = len;
  return true;
}

function unflip(nx, pv, t1, tail, buf, len) {
  for (let i = 0; i < len; i++) {
    const cur = buf[i];
    const nxt = i + 1 < len ? buf[i + 1] : tail;
    nx[cur] = nxt;
    pv[nxt] = cur;
  }
  pv[buf[0]] = t1;
  nx[t1] = buf[0];
}

/* One LK chain: `gain` is (removed - added) so far; closing with (loose, t1)
 * would score gain - d(loose, t1). Returns the improvement found, or 0.
 *
 * Two reconnections are tried per candidate t3, which is what makes the first
 * level cover the whole 2-opt neighbourhood: keep the edge (t3, prev[t3]) and
 * reverse loose..prev[t3] (t4 = prev[t3]), or keep (t3, next[t3]) and reverse
 * loose..t3 (t4 = next[t3]). Missing the second one costs ~1% at n=200.
 *
 * `dmin1` is the look-ahead: a chain is only extended while its gain still
 * covers the shortest edge incident to t1, i.e. while some closing edge can
 * still pay for itself. It is a heuristic cut (a long edge removed later could
 * revive a chain), and it buys ~3x on the depth-3 search. */
function lkStep(S, t1, nx, pv, loose, gain, depth, bufs, lens, touched) {
  const D = S.D, cand = S.cand, K = S.K, n = S.n, eps = S.eps;
  const dL = loose * n, coff = loose * K, dmin1 = S.dmin[t1];
  const buf = bufs[depth];
  let aOpen = true;
  for (let q = 0; q < K; q++) {
    const t3 = cand[coff + q];
    if (t3 === t1 || t3 === loose) continue;

    /* A: add (loose, t3), drop (t3, prev[t3]) */
    if (aOpen) {
      const g = gain - D[dL + t3];
      if (g <= eps) aOpen = false;
      else {
        const t4 = pv[t3];
        if (t4 !== loose && t4 !== t1) {
          const g2 = g + D[t3 * n + t4];
          if (g2 - D[t4 * n + t1] > eps) {
            if (flip(S, nx, pv, loose, t4, t3, t1, buf, depth, lens)) {
              touched.push(t1, loose, t3, t4);
              return g2 - D[t4 * n + t1];
            }
          } else if (depth < S.maxDepth && g2 - dmin1 > eps) {
            if (flip(S, nx, pv, loose, t4, t3, t1, buf, depth, lens)) {
              const r = lkStep(S, t1, nx, pv, t4, g2, depth + 1, bufs, lens, touched);
              if (r > 0) { touched.push(loose, t3, t4); return r; }
              unflip(nx, pv, t1, t3, buf, lens[depth]);
            }
          }
        }
      }
    }

    /* B: add (loose, next[t3]), drop (t3, next[t3]) */
    const t4b = nx[t3];
    if (t4b === loose || t4b === t1 || t4b === pv[t3]) continue;
    const gb = gain + D[t3 * n + t4b] - D[dL + t4b];
    if (gb - D[t3 * n + t1] > eps) {
      if (flip(S, nx, pv, loose, t3, t4b, t1, buf, depth, lens)) {
        touched.push(t1, loose, t3, t4b);
        return gb - D[t3 * n + t1];
      }
    } else if (depth < S.maxDepth && gb - dmin1 > eps) {
      if (flip(S, nx, pv, loose, t3, t4b, t1, buf, depth, lens)) {
        const r = lkStep(S, t1, nx, pv, t3, gb, depth + 1, bufs, lens, touched);
        if (r > 0) { touched.push(loose, t3, t4b); return r; }
        unflip(nx, pv, t1, t4b, buf, lens[depth]);
      }
    }
  }
  return 0;
}

/* LK to a local optimum. Cities re-enter the queue when an edge next to them
 * changes, which is the don't-look-bit rule. Returns the tour length. */
function localSearch(S) {
  const n = S.n, next = S.next, prev = S.prev;
  const queue = [], inq = new Uint8Array(n);
  for (let i = 0; i < n; i++) { queue.push(i); inq[i] = 1; }
  const bufs = [];
  for (let d = 0; d <= S.maxDepth; d++) bufs.push(new Int32Array(n));
  const lens = new Int32Array(S.maxDepth + 1);
  const touched = [];
  let guard = 0, limit = 200 * n + 2000;

  const push = c => { const c2 = c | 0; if (c2 >= 0 && c2 < n && !inq[c2]) { inq[c2] = 1; queue.push(c2); } };

  while (queue.length && guard++ < limit) {
    const t1 = queue.pop();
    inq[t1] = 0;
    let moved = 0;
    for (let dir = 0; dir < 2 && !moved; dir++) {
      const nx = dir ? prev : next, pv = dir ? next : prev;
      const t2 = nx[t1];
      touched.length = 0;
      moved = lkStep(S, t1, nx, pv, t2, S.D[t1 * n + t2], 0, bufs, lens, touched);
    }
    if (moved > 0) for (let i = 0; i < touched.length; i++) push(touched[i]);
  }
  const tour = Array.from(getTour(next, n));
  return { tour: tour, len: tourLenFlat(S.D, tour, n) };
}

/* --------------------------------- solve --------------------------------- */

/* M is an n x n distance matrix (array of rows). Returns { tour, len, kicks }. */
function solve(M, opts) {
  const O = Object.assign({}, DEFAULTS, opts || {});
  const n = M.length;
  const D = new Float64Array(n * n);
  for (let i = 0; i < n; i++) {
    const row = M[i];
    for (let j = 0; j < n; j++) D[i * n + j] = row[j];
  }
  if (n < 4) return { tour: Array.from({ length: n }, (_, i) => i), len: tourLenFlat(D, Array.from({ length: n }, (_, i) => i), n), kicks: 0 };

  const r = rng((O.seed * 7919 + n * 104729) >>> 0);
  const K = Math.min(O.K, n - 1);
  const cand = buildCandidates(D, n, K);
  const dmin = new Float64Array(n);
  for (let i = 0; i < n; i++) dmin[i] = D[i * n + cand[i * K]];
  const S = {
    n: n, D: D, K: K, eps: O.eps, dmin: dmin,
    cand: cand,
    maxDepth: Math.max(1, Math.min(O.maxDepth, n - 2)),
    next: new Int32Array(n), prev: new Int32Array(n)
  };

  const kicks = O.kicks > 0 ? (O.kicks | 0) : Math.max(40, Math.round(30000 / n));
  /* small n converges in a kick or two; a long stall run only burns time */
  const stall = O.stall > 0 ? (O.stall | 0) : 50;
  const first = initialTour(D, n, Math.max(1, O.starts | 0), r);
  setTour(S.next, S.prev, first, n);
  let res = localSearch(S);
  let best = res.tour, bestLen = res.len;
  let cur = best, curLen = bestLen;
  let since = 0;
  let k = 0;

  for (; k < kicks; k++) {
    const t = doubleBridge(cur, n, r);
    setTour(S.next, S.prev, t, n);
    res = localSearch(S);
    if (res.len < bestLen - 1e-9) { best = res.tour; bestLen = res.len; since = 0; }
    else if (++since >= stall) break;
    /* chained acceptance: keep walking from the trial unless it is worse, in
     * which case fall back to the best tour found so far */
    if (res.len <= curLen + 1e-9) { cur = res.tour; curLen = res.len; }
    else { cur = best; curLen = bestLen; }
  }
  return { tour: best, len: bestLen, kicks: k };
}

module.exports = { solve, rng, tourLen: tourLenFlat, checkTour, doubleBridge, DEFAULTS };

/* -------------------------------- harness -------------------------------- */
if (require.main === module) {
  const path = require('path');
  const CFG = { n: 200, ns: '', seeds: 2, kinds: 'uniform,cluster', K: 8, maxDepth: 3, kicks: 0, check: 0 };
  const NUM = new Set(['n', 'seeds', 'K', 'maxDepth', 'kicks', 'check']);
  process.argv.slice(2).forEach(a => {
    const m = /^--([a-zA-Z]+)=(.*)$/.exec(a);
    if (!m || !(m[1] in CFG)) throw new Error('bad flag: ' + a);
    CFG[m[1]] = NUM.has(m[1]) ? +m[2] : m[2];
  });
  const { B } = require(path.join(__dirname, '..', 'hybrid', 'bgma.js'));
  const med = a => { const b = a.slice().sort((x, y) => x - y); return b[b.length >> 1]; };
  const padL = (s, w) => { s = String(s); while (s.length < w) s = ' ' + s; return s; };
  const padR = (s, w) => { s = String(s); while (s.length < w) s = s + ' '; return s; };

  const tourLenFlatOf = (rows, t) => {
    let s = 0;
    for (let i = 0; i < t.length; i++) s += rows[t[i]][t[(i + 1) % t.length]];
    return s;
  };

  if (CFG.check) {
    let ok = 0, opt = 0;
    for (let seed = 1; seed <= 6; seed++) {
      const inst = B.buildInstance(11, seed, 'uniform', 10);
      const exact = B.heldKarp(inst).len;
      const res = solve(inst.rows, { seed: seed, kicks: 30 });
      if (!checkTour(res.tour, 11)) throw new Error('invalid tour at seed ' + seed);
      if (Math.abs(tourLenFlatOf(inst.rows, res.tour) - res.len) > 1e-6) throw new Error('length mismatch at seed ' + seed);
      ok++; if (res.len <= exact + 1e-6) opt++;
    }
    console.log('check: ' + ok + '/6 valid tours, ' + opt + '/6 optimal at n=11 (Held-Karp)');
    process.exit(0);
  }

  const NS = (CFG.ns ? CFG.ns.split(',') : [String(CFG.n)]).map(Number);
  const KINDS = CFG.kinds.split(',');
  console.log('');
  console.log('lkh   K=' + CFG.K + '  maxDepth=' + CFG.maxDepth + '  kicks=' + (CFG.kicks || 'auto'));
  console.log(padR('n', 6) + padR('seed', 6) + padR('kind', 9) + padL('length', 12) + padL('ms', 10));
  const rows = [];
  for (const n of NS) {
    for (let seed = 1; seed <= CFG.seeds; seed++) {
      for (const kind of KINDS) {
        const inst = B.buildInstance(n, seed, kind, Math.max(10, Math.round(n / 10)));
        const t0 = process.hrtime.bigint();
        const res = solve(inst.rows, { seed: seed, K: CFG.K, maxDepth: CFG.maxDepth, kicks: CFG.kicks });
        const ms = Number(process.hrtime.bigint() - t0) / 1e6;
        if (!checkTour(res.tour, n)) throw new Error('invalid tour');
        const len = tourLenFlatOf(inst.rows, res.tour);
        rows.push({ n, seed, kind, len, ms });
        console.log(padR(n, 6) + padR(seed, 6) + padR(kind, 9) + padL(len.toFixed(3), 12) + padL(ms.toFixed(0), 10));
      }
    }
  }
  console.log('');
  for (const n of NS) {
    const rs = rows.filter(x => x.n === n);
    console.log(padR('n=' + n, 32) + 'median ms ' + padL(med(rs.map(x => x.ms)).toFixed(0), 8));
  }
  console.log('');
}
