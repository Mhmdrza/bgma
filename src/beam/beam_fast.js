#!/usr/bin/env node
/* beam_fast.js -- beam + tunnelling, rewritten for speed, benchmarked against the original.
 *
 * BASELINE  (what "Voting Greedy TSP (1).html" does, ported past n=31)
 *   beamBase   partial tours copied per candidate, Map dedupe, full sort per step
 *   refineBase verbatim page refine(): first-improvement 2-opt + Or-opt, full scan
 *              restarted after every accepted move, tour rebuilt by slice/concat
 *
 * FAST
 *   beamFast   persistent arena + parent pointers (no tour copying), integer
 *              bitsets for visited, Zobrist hash for dedupe, Zobrist key
 *   refineFast neighbour-list 2-opt with don't-look bits, in-place reversals,
 *              delta evaluation, pos[] index; optional single-city Or-opt pass
 *
 * usage:
 *   node src/beam/beam_fast.js --n=200 --seeds=6 --K=16 --refineB=16 --refineF=5
 *   node src/beam/beam_fast.js --n=22 --seeds=4 --exact=1        # verify against Held-Karp
 *   node src/beam/beam_fast.js --n=200 --score=all                # score unvisited cities too
 *   node src/beam/beam_fast.js --n=200 --starts=random --startCount=8
 *
 * flags (defaults in brackets). Every constant that changes the answer is exposed.
 * Numeric flags also accept n-based expressions: --K=n/2, --K=n/3, --K=n,
 * --near=n/10, --refineF=n/4, --startCount=n/10, --twoOptGuard=n, --epsilon=1/n,
 * plus max(a,b)/min(a,b): --K=max(16,n/4) --near=max(10,n/10) ...
 * (evaluated after --n is known; integer knobs are rounded to nearest, K/startCount min 1):
 *   instance : --n=200 --seeds=6 --exact=0
 *   beam     : --K=16 --starts=farthest|random|all|first --startCount=2 --startSeed=1
 *              --score=visited|all --lag=3 --extraRank=2 --maxBranch=4
 *              --dedupe=full|last|off
 *              (score=all runs an O(n^2) MST bound per surviving candidate: much slower)
 *   tunnel   : --refineF=16 --refineB=16 --near=10 --oropt=1 --oroptMaxL=3
 *              --passes=2 --twoOptGuard=200 --oroptGuard=20 --sweepGuard=80
 *              --epsilon=1e-9 --parity=0 --tunnelMode=fast|base
 *   portfolio: --restarts=1   (r>0 reruns the beam from random poles)
 *
 * tuned all-n rule (see tune_knobs.js):
 *   --K='max(16,n/3)' --near='max(10,n/10)' --refineF=n --oroptMaxL=5
 *   --restarts=4 --tunnelMode=base
 *   shorthand: --preset=tuned   (any explicit flag still overrides the preset)
 */
'use strict';

var CFG = {
  /* instance / bench */
  n: 200, seeds: 6, exact: 0,
  /* beam */
  K: 16, starts: 'farthest', startCount: 2, startSeed: 1,
  score: 'visited', lag: 3, extraRank: 2, maxBranch: 4, dedupe: 'full',
  /* tunnel */
  refineB: 16, refineF: 16, near: 10, oropt: 1, oroptMaxL: 3, passes: 2,
  twoOptGuard: 200, oroptGuard: 20, sweepGuard: 80, epsilon: 1e-9, parity: 0,
  /* portfolio */
  restarts: 1, tunnelMode: 'fast',
  /* convenience preset ('' | tuned) */
  preset: ''
};
var STRING_FLAGS = { starts: 1, score: 1, dedupe: 1, tunnelMode: 1, preset: 1 };

/* ---------------------------------------------------------------------------
 * n-based flag values: "n", "n/2", "n/3", "2n", "(n+1)/2", "1/n", "n*0.1".
 * Tiny hand-written recursive-descent parser -- no eval, no arbitrary code.
 * ------------------------------------------------------------------------- */
function evalN(expr, n) {
  var s = String(expr).replace(/\s+/g, '')
    .replace(/(\d)n/g, '$1*n')
    .replace(/(\d)\(/g, '$1*(')
    .replace(/\)(?=[\dn(])/g, ')*');
  if (!/^[0-9a-zA-Z+\-*/().,]+$/.test(s)) throw new Error('bad n-expression: ' + expr);
  var i = 0;
  function primary() {
    var c = s[i];
    if (c === '+') { i++; return primary(); }
    if (c === '-') { i++; return -primary(); }
    if (s.startsWith('max(', i) || s.startsWith('min(', i)) {
      var fn = s.slice(i, i + 3);
      i += 4;
      var a1 = sum();
      if (s[i] !== ',') throw new Error('bad n-expression: ' + expr);
      i++;
      var a2 = sum();
      if (s[i] !== ')') throw new Error('bad n-expression: ' + expr);
      i++;
      return fn === 'max' ? Math.max(a1, a2) : Math.min(a1, a2);
    }
    if (c === '(') {
      i++; var v = sum();
      if (s[i] !== ')') throw new Error('bad n-expression: ' + expr);
      i++; return v;
    }
    if (c === 'n') { i++; return n; }
    var m = /^(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?/.exec(s.slice(i));
    if (!m) throw new Error('bad n-expression: ' + expr);
    i += m[0].length;
    return +m[0];
  }
  function product() {
    var v = primary(), c;
    while ((c = s[i]) === '*' || c === '/') {
      i++;
      v = c === '*' ? v * primary() : v / primary();
    }
    return v;
  }
  function sum() {
    var v = product(), c;
    while ((c = s[i]) === '+' || c === '-') {
      i++;
      v = c === '+' ? v + product() : v - product();
    }
    return v;
  }
  var out = sum();
  if (i !== s.length || !isFinite(out)) throw new Error('bad n-expression: ' + expr);
  return out;
}

/* two passes: collect raw strings, resolve --n first, then every other value */
var RAW = {};
process.argv.slice(2).forEach(function (a) {
  var m = /^--([a-zA-Z]+)=(.*)$/.exec(a);
  if (!m) throw new Error('bad flag: ' + a);
  if (!(m[1] in CFG)) throw new Error('unknown flag: ' + m[1]);
  RAW[m[1]] = m[2];
});
if (RAW.n != null) {
  var nv = Number(RAW.n);
  if (!isFinite(nv) || nv < 1 || Math.floor(nv) !== nv) throw new Error('--n must be a positive integer');
  CFG.n = nv;
}
for (var strKey in RAW) if (STRING_FLAGS[strKey]) CFG[strKey] = RAW[strKey];
for (var rawKey in RAW) {
  if (rawKey === 'n' || STRING_FLAGS[rawKey]) continue;
  var rawVal = RAW[rawKey], resolved;
  if (/^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/.test(rawVal)) {
    resolved = +rawVal;
  } else if (rawVal.indexOf('n') >= 0) {
    resolved = evalN(rawVal, CFG.n);
  } else {
    throw new Error('--' + rawKey + ' needs a number or an n-expression: ' + rawVal);
  }
  /* epsilon is the only genuinely fractional knob; everything else is a count */
  CFG[rawKey] = rawKey === 'epsilon' ? resolved : Math.max(rawKey === 'K' || rawKey === 'startCount' ? 1 : 0, Math.round(resolved));
}

/* --preset=tuned: the all-n rule found by tune_knobs.js; explicit flags still win */
if (CFG.preset === 'tuned') {
  var TUNED = {
    K: 'max(16,n/3)', near: 'max(10,n/10)', refineF: 'n',
    oroptMaxL: '5', restarts: '4', tunnelMode: 'base'
  };
  for (var pk in TUNED) {
    if (RAW[pk] != null) continue;
    if (pk === 'tunnelMode') { CFG[pk] = TUNED[pk]; continue; }
    var pv = evalN(TUNED[pk], CFG.n);
    CFG[pk] = Math.max(pk === 'K' ? 1 : 0, Math.round(pv));
  }
}

/* aliases + validation: fail loudly instead of producing a silently different solver */
if (CFG.preset !== '' && CFG.preset !== 'tuned') throw new Error('--preset must be empty|tuned');
if (CFG.dedupe === 'none') CFG.dedupe = 'off';
if (CFG.score !== 'visited' && CFG.score !== 'all') throw new Error('--score must be visited|all');
if (['farthest', 'random', 'all', 'first'].indexOf(CFG.starts) < 0) throw new Error('--starts must be farthest|random|all|first');
if (['full', 'last', 'off'].indexOf(CFG.dedupe) < 0) throw new Error('--dedupe must be full|last|off');
if (CFG.K < 1) throw new Error('--K must be >= 1');
if (CFG.lag < 0 || CFG.extraRank < 0) throw new Error('--lag/--extraRank must be >= 0');
if (CFG.lag === 0 && CFG.extraRank === 0) throw new Error('no branch source: --lag and --extraRank are both 0');
if (CFG.refineF < 0 || CFG.refineB < 0) throw new Error('--refineF/--refineB must be >= 0');
if (CFG.restarts < 1) throw new Error('--restarts must be >= 1');
if (CFG.tunnelMode !== 'fast' && CFG.tunnelMode !== 'base') throw new Error('--tunnelMode must be fast|base');

var N = CFG.n, SEEDS = CFG.seeds, K = CFG.K;
var RB = CFG.refineB, RF = CFG.refineF, KN = Math.min(CFG.near, N - 1), PARITY = !!CFG.parity;

/* every solver entry point takes an optional override object; CFG stays the default */
function cfgWith(o) {
  if (!o) return CFG;
  var r = {}, k;
  for (k in CFG) r[k] = CFG[k];
  for (k in o) r[k] = o[k];
  return r;
}
function branchCount(O) {
  return O.maxBranch > 0 ? O.maxBranch : O.lag + (O.extraRank > 0 ? 1 : 0);
}

/* ============================== instance data ============================== */

function rng(seed) {
  var a = seed >>> 0;
  return function () {
    a += 0x6D2B79F5; var t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function gauss(r) { return Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(2 * Math.PI * r()); }
function clamp(v) { return Math.min(96, Math.max(4, v)); }
function makePoints(n, seed, kind) {
  var r = rng(seed * 7919 + n * 104729 + (kind === 'cluster' ? 17 : 0));
  var pts = [], i;
  if (kind === 'cluster') {
    var k = 3 + Math.floor(r() * 2), centers = [];
    for (i = 0; i < k; i++) centers.push([18 + r() * 64, 18 + r() * 64]);
    for (i = 0; i < n; i++) {
      var c = centers[Math.floor(r() * k)];
      pts.push([clamp(c[0] + gauss(r) * 8), clamp(c[1] + gauss(r) * 8)]);
    }
  } else {
    for (i = 0; i < n; i++) pts.push([4 + r() * 92, 4 + r() * 92]);
  }
  return pts;
}
function buildInstance(n, seed, kind, nearK) {
  var pts = makePoints(n, seed, kind), i, j;
  var kn = Math.min(nearK == null ? KN : nearK, n - 1);
  var D = new Float64Array(n * n), rows = [];
  for (i = 0; i < n; i++) {
    var x = pts[i][0], y = pts[i][1];
    for (j = 0; j < n; j++) {
      if (i !== j) D[i * n + j] = Math.hypot(x - pts[j][0], y - pts[j][1]);
    }
  }
  for (i = 0; i < n; i++) rows.push(D.subarray(i * n, (i + 1) * n));
  // neighbour order: full lists (baseline) + truncated list (fast paths)
  var order = [], orderFlat = new Int32Array(n * (n - 1));
  for (i = 0; i < n; i++) {
    var idx = [];
    for (j = 0; j < n; j++) if (j !== i) idx.push(j);
    idx.sort(function (a, b) { return rows[i][a] - rows[i][b]; });
    order.push(idx);
    for (j = 0; j < n - 1; j++) orderFlat[i * (n - 1) + j] = idx[j];
  }
  var near = new Int32Array(n * kn);
  for (i = 0; i < n; i++) for (j = 0; j < kn; j++) near[i * kn + j] = order[i][j];
  var fp = farthestPair(D, n);
  return { D: D, rows: rows, order: order, orderFlat: orderFlat, near: near, kn: kn, fp: fp, n: n };
}
function farthestPair(D, n) {
  var best = -1, p = 0, q = 1;
  for (var i = 0; i < n; i++) for (var j = i + 1; j < n; j++) if (D[i * n + j] > best) { best = D[i * n + j]; p = i; q = j; }
  return [p, q];
}

/* the poles / starting partial tours, chosen by --starts */
function pickStarts(inst, O) {
  var n = inst.n, i, out = [];
  if (O.starts === 'farthest') return inst.fp.slice(0, 2);
  if (O.starts === 'first') return [0];
  if (O.starts === 'all') {
    for (i = 0; i < n; i++) out.push(i);
    return out;
  }
  /* random: deterministic given --startSeed */
  var count = Math.max(1, Math.min(O.startCount | 0, n));
  var r = rng((O.startSeed >>> 0) ^ 0x9E3779B9 ^ n), seen = new Uint8Array(n);
  while (out.length < count) {
    var c = Math.floor(r() * n);
    if (!seen[c]) { seen[c] = 1; out.push(c); }
  }
  return out;
}

/* MST lower bound over unvisited ∪ {last, start}: O(V^2) Prim.
 * Scratch arrays are passed in so scoring does not allocate per candidate. */
function mstScratch(n) {
  return { L: new Int32Array(n + 2), B: new Float64Array(n + 2), I: new Uint8Array(n + 2) };
}
function mstArray(D, n, vis, last, start, S) {
  var L = S.L, B = S.B, I = S.I, m = 0, c, q;
  for (c = 0; c < n; c++) if (!vis[c]) { L[m] = c; B[m] = Infinity; I[m] = 0; m++; }
  var li = m; L[m] = last; B[m] = Infinity; I[m] = 0; m++;
  if (start !== last) { L[m] = start; B[m] = Infinity; I[m] = 0; m++; }
  if (m <= 1) return 0;
  I[li] = 1;
  var total = 0, added = 1;
  for (q = 0; q < m; q++) if (!I[q]) B[q] = D[last][L[q]];
  while (added < m) {
    var bi = -1, bd = Infinity;
    for (q = 0; q < m; q++) if (!I[q] && B[q] < bd) { bd = B[q]; bi = q; }
    if (bi < 0) break;
    I[bi] = 1; added++; total += bd;
    var row = D[L[bi]];
    for (q = 0; q < m; q++) if (!I[q]) { var dd = row[L[q]]; if (dd < B[q]) B[q] = dd; }
  }
  return total;
}

function tourLenRows(D, t) { var s = 0; for (var i = 0; i < t.length; i++) s += D[t[i]][t[(i + 1) % t.length]]; return s; }
function tourLenFlat(D, t, n) { var s = 0; for (var i = 0; i < n; i++) s += D[t[i] * n + t[(i + 1) % n]]; return s; }
function checkTour(t, n) {
  if (t.length !== n) return false;
  var seen = new Uint8Array(n);
  for (var i = 0; i < n; i++) { if (t[i] < 0 || t[i] >= n || seen[t[i]]) return false; seen[t[i]] = 1; }
  return true;
}

/* ================================ greedy ================================== */

function greedy(inst, start) {
  var n = inst.n, D = inst.rows, order = inst.order;
  var visited = new Uint8Array(n), tour = [start];
  visited[start] = 1;
  while (tour.length < n) {
    var o = order[tour[tour.length - 1]], c = -1;
    for (var i = 0; i < o.length; i++) if (!visited[o[i]]) { c = o[i]; break; }
    tour.push(c); visited[c] = 1;
  }
  return tour;
}

/* ============================ baseline tunnel =============================
 * the page's refine(); D access unchanged (array of rows).
 * Defaults reproduce the page exactly; --oropt / --oroptMaxL / --epsilon alter it.
 */
function refineBase(D, tour, o) {
  var O = cfgWith(o), n = tour.length, t = tour.slice(), improved = true, i, j, k, len;
  var eps = O.epsilon, maxL = Math.min(O.oroptMaxL, n - 1);
  while (improved) {
    improved = false;
    for (i = 0; i < n - 1 && !improved; i++) {
      for (j = i + 2; j < n; j++) {
        if (i === 0 && j === n - 1) continue;
        var a = t[i], b = t[i + 1], c = t[j], d = t[(j + 1) % n];
        if (D[a][c] + D[b][d] - D[a][b] - D[c][d] < -eps) {
          var seg = t.slice(i + 1, j + 1).reverse();
          t = t.slice(0, i + 1).concat(seg, t.slice(j + 1));
          improved = true; break;
        }
      }
    }
    if (improved) continue;
    for (len = 1; O.oropt && len <= maxL && !improved; len++) {
      for (i = 0; i < n && !improved; i++) {
        var tt = t.slice(i).concat(t.slice(0, i));
        var sg = tt.slice(0, len), rest = tt.slice(len);
        var prev = rest[rest.length - 1], next = rest[0];
        var s0 = sg[0], s1 = sg[len - 1];
        var gain = D[prev][s0] + D[s1][next] - D[prev][next];
        for (k = 0; k < rest.length - 1; k++) {
          var u = rest[k], v = rest[k + 1], base = D[u][v];
          var fwd = D[u][s0] + D[s1][v] - base, rev = D[u][s1] + D[s0][v] - base;
          if (fwd < gain - eps) { t = rest.slice(0, k + 1).concat(sg, rest.slice(k + 1)); improved = true; break; }
          if (rev < gain - eps) { t = rest.slice(0, k + 1).concat(sg.slice().reverse(), rest.slice(k + 1)); improved = true; break; }
        }
      }
    }
  }
  return t;
}

/* ============================ baseline beam ==============================
 * the page's quantum(), ported past the 32-bit bitmask (visited array + hashed key).
 * Honors the same knobs as beamFast so --score / --starts / --lag change both paths.
 */
function beamBase(inst, K, doRefine, o) {
  var O = cfgWith(o);
  K = K == null ? O.K : K;
  var D = inst.rows, order = inst.order, n = inst.n, poles = pickStarts(inst, O), step;
  var MS = mstScratch(n);
  var states = poles.map(function (s) {
    var v = new Uint8Array(n); v[s] = 1;
    return { t: [s], vis: v, len: 0, s: s, f: 0 };
  });
  var maxBranch = branchCount(O);
  for (step = 1; step < n; step++) {
    var seen = new Map(), plain = [];
    for (var si = 0; si < states.length; si++) {
      var st = states[si], m = st.t.length, cur = st.t[m - 1], cand = [];
      for (var lag = 0; lag < Math.min(O.lag, m); lag++) {
        var v = st.t[m - 1 - lag], rank = lag + 1, k = 0, c = -1, o2 = order[v];
        for (var q = 0; q < o2.length; q++) if (!st.vis[o2[q]]) { k++; if (k === rank) { c = o2[q]; break; } }
        if (c >= 0 && cand.indexOf(c) < 0) cand.push(c);
      }
      if (O.extraRank > 0) {
        var k2 = 0, c2 = -1, o3 = order[cur];
        for (var q2 = 0; q2 < o3.length; q2++) if (!st.vis[o3[q2]]) { k2++; if (k2 === O.extraRank) { c2 = o3[q2]; break; } }
        if (c2 >= 0 && cand.indexOf(c2) < 0) cand.push(c2);
      }
      if (O.maxBranch > 0) cand = cand.slice(0, maxBranch);
      for (var ci = 0; ci < cand.length; ci++) {
        var cc = cand[ci], len = st.len + D[cur][cc];
        var nv = new Uint8Array(st.vis); nv[cc] = 1;
        var f = len + (O.score === 'all' ? mstArray(D, n, nv, cc, st.s, MS) : D[cc][st.s]);
        var state = { t: st.t.concat(cc), vis: nv, len: len, s: st.s, f: f };
        if (O.dedupe === 'off') { plain.push(state); continue; }
        var key;
        if (O.dedupe === 'last') {
          key = (Math.imul(cc + 1, 2654435761) ^ Math.imul(st.s + 1, 40503)) >>> 0;
        } else {
          var h = 2166136261;
          for (var w = 0; w < n; w++) h = Math.imul(h ^ nv[w], 16777619);
          key = (h ^ Math.imul(cc + 1, 2654435761) ^ Math.imul(st.s + 1, 40503)) >>> 0;
        }
        var old = seen.get(key);
        if (old === undefined || len < old.len) seen.set(key, state);
      }
    }
    var allStates = O.dedupe === 'off' ? plain : Array.from(seen.values());
    states = allStates.sort(function (a, b) { return a.f - b.f; }).slice(0, K);
  }
  var finals = states.map(function (st) { return { t: st.t, len: st.len + D[st.t[n - 1]][st.s] }; })
    .sort(function (a, b) { return a.len - b.len; });
  var best = finals[0], eps = O.epsilon;
  for (var i = 0; i < Math.min(finals.length, doRefine ? O.refineB : 0); i++) {
    var rt = refineBase(D, finals[i].t, O);
    var post = tourLenRows(D, rt);
    if (post < best.len - eps) best = { t: rt, len: post };
  }
  return { tour: best.t, len: best.len, lenBeam: finals[0].len, finals: finals };
}

/* ============================== fast tunnel ============================== */

/* candidate 2-opt: both endpoints' neighbour lists, don't-look bits, in-place reversal */
function twoOptFast(D, t, pos, near, kn, n, guardMul, eps) {
  var dlb = new Uint8Array(n), queue = [], i;
  for (i = 0; i < n; i++) queue.push(t[i]);
  var guard = 0, limit = guardMul * n;

  function apply(a, b, c, d) {
    var ia = pos[a], ic = pos[c];
    if (ia === ic || (ia + 1) % n === ic || (ic + 1) % n === ia) return false;
    var ii = ia, jj = ic;
    if (jj < ii) { var sw = ii; ii = jj; jj = sw; }
    if (jj === ii + 1 || (ii === 0 && jj === n - 1)) return false;
    if (!(D[a * n + c] + D[b * n + d] - D[a * n + b] - D[c * n + d] < -eps)) return false;
    for (var lo = ii + 1, hi = jj; lo < hi; lo++, hi--) {
      var x = t[lo]; t[lo] = t[hi]; t[hi] = x;
      pos[t[lo]] = lo; pos[t[hi]] = hi;
    }
    return true;
  }

  while (queue.length && guard++ < limit) {
    var a = queue.pop();
    if (dlb[a]) continue;
    var b = t[(pos[a] + 1) % n], moved = false, q, c, d;

    var off = a * kn;                                   // c drawn near a
    for (q = 0; q < kn && !moved; q++) {
      c = near[off + q];
      if (c === a || c === b) continue;
      d = t[(pos[c] + 1) % n];
      if (d === a || d === b) continue;
      if (!apply(a, b, c, d)) continue;
      dlb[a] = dlb[b] = dlb[c] = dlb[d] = 0;
      queue.push(a, b, c, d);
      moved = true;
    }
    if (moved) continue;

    off = b * kn;                                       // d drawn near b
    for (q = 0; q < kn && !moved; q++) {
      d = near[off + q];
      if (d === a || d === b) continue;
      c = t[(pos[d] - 1 + n) % n];
      if (c === a || c === b) continue;
      if (!apply(a, b, c, d)) continue;
      dlb[a] = dlb[b] = dlb[c] = dlb[d] = 0;
      queue.push(a, b, c, d);
      moved = true;
    }
    if (!moved) dlb[a] = 1;
  }
}

/* full O(n^2) 2-opt sweep, in place, no restart -- parity mode */
function sweep2opt(D, t, pos, n, guardMax, eps) {
  var improved = true, guard = 0;
  while (improved && guard++ < guardMax) {
    improved = false;
    for (var i = 0; i < n - 1; i++) {
      var a = t[i], b = t[i + 1];
      for (var j = i + 2; j < n; j++) {
        if (i === 0 && j === n - 1) continue;
        var c = t[j], d = t[(j + 1) % n];
        if (D[a * n + c] + D[b * n + d] - D[a * n + b] - D[c * n + d] < -eps) {
          for (var lo = i + 1, hi = j; lo < hi; lo++, hi--) {
            var x = t[lo]; t[lo] = t[hi]; t[hi] = x;
            pos[t[lo]] = lo; pos[t[hi]] = hi;
          }
          b = t[i + 1];
          improved = true;
        }
      }
    }
  }
}

/* Or-opt: move a segment of 1..maxL cities, best move per position, apply by rebuild */
function orOptFast(D, t, pos, near, kn, n, maxL, guardMax, eps) {
  maxL = Math.min(maxL, n - 1);
  var improved = true, guard = 0;
  while (improved && guard++ < guardMax) {
    improved = false;
    for (var L = 1; L <= maxL && !improved; L++) {
      for (var i = 0; i < n && !improved; i++) {
        var seg = [], z;
        for (z = 0; z < L; z++) seg.push(t[(i + z) % n]);
        var s0 = seg[0], s1 = seg[L - 1];
        var prev = t[(i - 1 + n) % n], next = t[(i + L) % n];
        var save = D[prev * n + s0] + D[s1 * n + next] - D[prev * n + next];
        var inSeg = new Uint8Array(n);
        for (z = 0; z < L; z++) inSeg[seg[z]] = 1;
        var best = -eps, bestU = -1, bestRev = false;

        for (var side = 0; side < 2; side++) {
          var base = (side ? s1 : s0) * kn;
          for (var q = 0; q < kn; q++) {
            var u = near[base + q];
            if (inSeg[u]) continue;
            var v = t[(pos[u] + 1) % n];
            if (inSeg[v]) continue;
            var dF = D[u * n + s0] + D[s1 * n + v] - D[u * n + v] - save;
            if (dF < best) { best = dF; bestU = u; bestRev = false; }
            var dR = D[u * n + s1] + D[s0 * n + v] - D[u * n + v] - save;
            if (dR < best) { best = dR; bestU = u; bestRev = true; }
          }
        }
        if (bestU < 0) continue;

        var arr = [], q2;
        for (q2 = 0; q2 < n; q2++) if (!inSeg[t[q2]]) arr.push(t[q2]);
        arr.splice(arr.indexOf(bestU) + 1, 0, ...(bestRev ? seg.slice().reverse() : seg));
        for (q2 = 0; q2 < n; q2++) { t[q2] = arr[q2]; pos[t[q2]] = q2; }
        improved = true;
      }
    }
  }
}

function refineFast(D, tour, near, kn, n, parity, o) {
  var O = cfgWith(o), t = Int32Array.from(tour), pos = new Int32Array(n), i, p;
  for (i = 0; i < n; i++) pos[t[i]] = i;
  /* --passes: 2-opt rounds, with one Or-opt pass squeezed in after the first.
     passes=2 reproduces 2opt -> oropt -> 2opt. passes=0 skips 2-opt. */
  if (O.passes > 0) {
    twoOptFast(D, t, pos, near, kn, n, O.twoOptGuard, O.epsilon);
    if (O.oropt && O.oroptMaxL > 0) orOptFast(D, t, pos, near, kn, n, O.oroptMaxL, O.oroptGuard, O.epsilon);
    for (p = 1; p < O.passes; p++) twoOptFast(D, t, pos, near, kn, n, O.twoOptGuard, O.epsilon);
  }
  if (parity) {                       // full O(n^2) sweeps: baseline-equivalent local optimum
    sweep2opt(D, t, pos, n, O.sweepGuard, O.epsilon);
    if (O.oropt && O.oroptMaxL > 0) orOptFast(D, t, pos, near, kn, n, O.oroptMaxL, O.oroptGuard, O.epsilon);
    sweep2opt(D, t, pos, n, O.sweepGuard, O.epsilon);
  }
  var out = new Array(n);
  for (i = 0; i < n; i++) out[i] = t[i];
  return { tour: out, len: tourLenFlat(D, t, n) };
}

/* =============================== fast beam ===============================
 * Arena of persistent nodes: parent index, city, length, f, start, visited bits.
 * No per-candidate tour copy: O(W) bitset copy + O(1) bookkeeping.
 */
function beamFast(inst, K, o) {
  var O = cfgWith(o);
  K = K == null ? O.K : K;
  var n = inst.n, D = inst.D, orderFlat = inst.orderFlat, no = n - 1;
  var poles = pickStarts(inst, O);
  var W = (n + 31) >> 5;
  /* worst case: S seeds + (n-2) steps, each expanding <= K states into <= B children.
     x2 leaves room for the "shorter duplicate rebuilt as a new node" path. */
  var B = branchCount(O);
  var cap = 2 * (poles.length + B * (poles.length + (n + 2) * K)) + 16;

  var AP = new Int32Array(cap), AC = new Int32Array(cap), AS = new Int32Array(cap);
  var AL = new Float64Array(cap), AF = new Float64Array(cap), AH = new Uint32Array(cap);
  var AB = new Uint32Array(cap * W);
  var nn = 0;

  var Z = new Uint32Array(n), zr = rng(0x9E3779B9 ^ n);
  for (var i = 0; i < n; i++) Z[i] = (zr() * 4294967296) >>> 0;

  var MS = mstScratch(n);
  /* MST over unvisited ∪ {last, start} using the node's bitset (score=all) */
  function mstBits(base, last, start) {
    var L = MS.L, Bd = MS.B, I = MS.I, m = 0, c, q;
    for (c = 0; c < n; c++) {
      if (!((AB[base + (c >> 5)] >>> (c & 31)) & 1)) { L[m] = c; Bd[m] = Infinity; I[m] = 0; m++; }
    }
    var li = m; L[m] = last; Bd[m] = Infinity; I[m] = 0; m++;
    if (start !== last) { L[m] = start; Bd[m] = Infinity; I[m] = 0; m++; }
    if (m <= 1) return 0;
    I[li] = 1;
    var total = 0, added = 1;
    for (q = 0; q < m; q++) if (!I[q]) Bd[q] = D[last * n + L[q]];
    while (added < m) {
      var bi = -1, bd = Infinity;
      for (q = 0; q < m; q++) if (!I[q] && Bd[q] < bd) { bd = Bd[q]; bi = q; }
      if (bi < 0) break;
      I[bi] = 1; added++; total += bd;
      var row = L[bi] * n;
      for (q = 0; q < m; q++) if (!I[q]) { var dd = D[row + L[q]]; if (dd < Bd[q]) Bd[q] = dd; }
    }
    return total;
  }

  function mkNode(parent, city, len, start) {
    var id = nn++;
    AP[id] = parent; AC[id] = city; AL[id] = len; AS[id] = start;
    var b = id * W;
    if (parent >= 0) {
      var pb = parent * W;
      for (var w = 0; w < W; w++) AB[b + w] = AB[pb + w];
      AH[id] = AH[parent] ^ Z[city];
    } else {
      AH[id] = Z[city];
    }
    AB[b + (city >> 5)] |= (1 << (city & 31));
    /* the score is what survives the top-K cut, so it must be known per node */
    if (parent < 0) AF[id] = 0;
    else AF[id] = len + (O.score === 'all'
      ? mstBits(b, city, start)
      : D[city * n + start]);
    return id;
  }
  function nthU(v, rank, base) {
    var off = v * no;
    for (var q = 0; q < no; q++) {
      var c = orderFlat[off + q];
      if (!((AB[base + (c >> 5)] >>> (c & 31)) & 1)) {
        if (--rank === 0) return c;
      }
    }
    return -1;
  }
  function tourOf(id) {
    var out = new Array(n), k = n - 1;
    for (; id >= 0; id = AP[id]) out[k--] = AC[id];
    return out;
  }

  var states = poles.map(function (s) { return mkNode(-1, s, 0, s); });
  var maxBranch = branchCount(O);

  for (var step = 1; step < n; step++) {
    var slotOf = new Map(), created = [];
    for (var si = 0; si < states.length; si++) {
      var sid = states[si], cur = AC[sid], base = sid * W, cand = [];
      var depth = step;
      for (var lag = 0; lag < Math.min(O.lag, depth); lag++) {
        var v = sid;
        for (var up = 0; up < lag; up++) v = AP[v];
        var c = nthU(AC[v], lag + 1, base);
        if (c >= 0 && cand.indexOf(c) < 0) cand.push(c);
      }
      if (O.extraRank > 0) {
        var c2 = nthU(cur, O.extraRank, base);
        if (c2 >= 0 && cand.indexOf(c2) < 0) cand.push(c2);
      }
      if (O.maxBranch > 0) cand = cand.slice(0, maxBranch);

      for (var ci = 0; ci < cand.length; ci++) {
        var cc = cand[ci], len = AL[sid] + D[cur * n + cc];
        if (O.dedupe === 'off') { created.push(mkNode(sid, cc, len, AS[sid])); continue; }
        var key = O.dedupe === 'full'
          ? (AH[sid] ^ Z[cc] ^ Math.imul(cc + 1, 0x9E3779B1) ^ Math.imul(AS[sid] + 1, 0x85EBCA77)) >>> 0
          /* last-city-only key: histories with the same end merge, visited sets need not match */
          : (Math.imul(cc + 1, 0x9E3779B1) ^ Math.imul(AS[sid] + 1, 0x85EBCA77)) >>> 0;
        var slot = slotOf.get(key);
        if (slot === undefined) {
          slotOf.set(key, created.length);
          created.push(mkNode(sid, cc, len, AS[sid]));
        } else if (len < AL[created[slot]]) {
          /* the shorter path must be rebuilt, not just re-priced: its parent chain
             is what the tour is reconstructed from */
          created[slot] = mkNode(sid, cc, len, AS[sid]);
        }
      }
    }
    created.sort(function (a, b) { return AF[a] - AF[b]; });
    states = created.slice(0, K);
  }

  var finals = states.map(function (id) {
    return { id: id, t: tourOf(id), len: AL[id] + D[AC[id] * n + AS[id]] };
  }).sort(function (a, b) { return a.len - b.len; });
  return { finals: finals, lenBeam: finals[0].len };
}

function refineOne(inst, tour, kn, O) {
  if (O.tunnelMode === 'base') {
    if (!inst.rows) throw new Error('tunnelMode=base needs inst.rows');
    var t = refineBase(inst.rows, tour, O);
    return { tour: t, len: tourLenRows(inst.rows, t) };
  }
  return refineFast(inst.D, tour, inst.near, kn, inst.n, !!O.parity, O);
}

function beamFastTunnelOnce(inst, K, RF, O) {
  var b = beamFast(inst, K, O);
  /* refineF=0 means "beam only": return the best wave without tunnelling */
  if (RF <= 0) return { tour: b.finals[0].t, len: b.lenBeam, lenBeam: b.lenBeam };
  var knMax = inst.kn != null ? inst.kn : inst.n - 1;
  var kn = Math.min(O.near, knMax);
  var best = null;
  var lim = Math.min(b.finals.length, RF);
  for (var i = 0; i < lim; i++) {
    var r = refineOne(inst, b.finals[i].t, kn, O);
    if (!best || r.len < best.len - O.epsilon) best = r;
  }
  return { tour: best.tour, len: best.len, lenBeam: b.lenBeam };
}

function beamFastTunnel(inst, K, RF, o) {
  var O = cfgWith(o);
  if (RF == null) RF = O.refineF;
  var R = Math.max(1, O.restarts | 0);
  var best = null;
  for (var r = 0; r < R; r++) {
    /* run 0 uses --starts; later runs use fresh random pole pairs */
    var oo = O;
    if (r > 0) {
      oo = cfgWith(O);
      oo.starts = 'random';
      oo.startSeed = (O.startSeed | 0) + r;
    }
    var res = beamFastTunnelOnce(inst, K, RF, oo);
    if (!best || res.len < best.len - O.epsilon) best = res;
  }
  return best;
}

/* ============================ exact optimum (n<=26) ====================== */

function heldKarp(inst) {
  var n = inst.n, m = n - 1, N = 1 << m, j, k, mask;
  if (N * m > 4e8) throw new Error('heldKarp too big for n=' + n);
  var D = inst.rows;
  var dp = new Float64Array(N * m).fill(Infinity);
  var par = new Int8Array(N * m).fill(-1);
  for (j = 0; j < m; j++) dp[(1 << j) * m + j] = D[0][j + 1];
  for (mask = 1; mask < N; mask++) {
    for (j = 0; j < m; j++) {
      if (!((mask >> j) & 1)) continue;
      var cur = dp[mask * m + j];
      if (cur === Infinity) continue;
      for (k = 0; k < m; k++) {
        if ((mask >> k) & 1) continue;
        var nm = mask | (1 << k), v = cur + D[j + 1][k + 1];
        if (v < dp[nm * m + k]) { dp[nm * m + k] = v; par[nm * m + k] = j; }
      }
    }
  }
  var full = N - 1, bj = 0, bv = Infinity;
  for (j = 0; j < m; j++) {
    var tv = dp[full * m + j] + D[j + 1][0];
    if (tv < bv) { bv = tv; bj = j; }
  }
  var tour = [], mk = full, cj = bj;
  while (cj !== -1) { tour.push(cj + 1); var pj = par[mk * m + cj]; mk ^= (1 << cj); cj = pj; }
  tour.push(0); tour.reverse();
  return { tour: tour, len: bv };
}

/* ================================= harness ================================ */

function clock(fn) {
  var t0 = process.hrtime.bigint();
  var v = fn();
  return [Number(process.hrtime.bigint() - t0) / 1e6, v];
}
function med(a) { var b = a.slice().sort(function (x, y) { return x - y; }); return b[b.length >> 1]; }
function mean(a) { var s = 0; for (var i = 0; i < a.length; i++) s += a[i]; return s / a.length; }
function mx(a) { return Math.max.apply(null, a); }
function padL(s, w) { s = String(s); while (s.length < w) s = ' ' + s; return s; }
function padR(s, w) { s = String(s); while (s.length < w) s = s + ' '; return s; }
function pcent(x) { return (x >= 0 ? '+' : '') + x.toFixed(2) + '%'; }
function ms(x) { return x < 1 ? (x * 1000).toFixed(1) + 'us' : x.toFixed(2) + 'ms'; }

var KINDS = ['uniform', 'cluster'];
var rows = [];
var bad = 0;
var refIsExact = !!CFG.exact && N <= 22;

console.log('');
console.log('beam_fast   n=' + N + '  K=' + K + '  seeds=' + SEEDS + '/family  refineB=' + RB +
            '  refineF=' + RF + '  near=' + KN + '  oropt=' + (CFG.oropt ? 1 : 0) + '  parity=' + (PARITY ? 1 : 0) +
            '  reference=' + (refIsExact ? 'heldKarp (exact)' : 'best of all methods'));
console.log('knobs       score=' + CFG.score + '  starts=' + CFG.starts + '(' + CFG.startCount + ',seed ' + CFG.startSeed +
            ')  lag=' + CFG.lag + '  extraRank=' + CFG.extraRank + '  maxBranch=' + CFG.maxBranch +
            '  dedupe=' + CFG.dedupe + '  oroptMaxL=' + CFG.oroptMaxL + '  passes=' + CFG.passes +
            '  guards=' + CFG.twoOptGuard + '/' + CFG.oroptGuard + '/' + CFG.sweepGuard + '  epsilon=' + CFG.epsilon +
            '  restarts=' + CFG.restarts + '  tunnelMode=' + CFG.tunnelMode +
            (CFG.preset ? '  preset=' + CFG.preset : ''));
console.log('');
console.log(padL('#', 3) + padR('kind', 9) + padL('greedy', 9) + padL('beamB', 9) + padL('tunB', 9) +
            padL('beamF', 9) + padL('tunF', 9) + padL('ref', 9) + padL('dBase', 8) + padL('dFast', 8) +
            padL('tBeamB', 9) + padL('tTunB', 9) + padL('tBeamF', 9) + padL('tTunF', 9) + padL('net', 8));

for (var s = 1; s <= SEEDS; s++) {
  for (var ki = 0; ki < KINDS.length; ki++) {
    var kind = KINDS[ki];
    var inst = buildInstance(N, s, kind), n = inst.n, start = inst.fp[0];

    /* greedy: median of 200 reps */
    var g = null, tg = 0, reps = 200, r;
    for (r = 0; r < reps; r++) { var a0 = clock(function () { return greedy(inst, start); }); g = a0[1]; tg += a0[0]; }
    var tG = tg / reps;

    /* baseline: beam only, then beam+tunnel (page semantics: 16 finals refined) */
    var tb0 = 0, qb = null;
    for (r = 0; r < 3; r++) { var a1 = clock(function () { return beamBase(inst, K, false); }); qb = a1[1]; tb0 += a1[0]; }
    var tBeamB = tb0 / 3;

    var tb1 = 0, qbt = null;
    for (r = 0; r < 3; r++) { var a2 = clock(function () { return beamBase(inst, K, true); }); qbt = a2[1]; tb1 += a2[0]; }
    var tTunB = Math.max(0, tb1 / 3 - tBeamB);

    /* fast: beam only, then beam + fast tunnel */
    var tf0 = 0, qf = null;
    for (r = 0; r < 3; r++) { var a3 = clock(function () { return beamFast(inst, K); }); qf = a3[1]; tf0 += a3[0]; }
    var tBeamF = tf0 / 3;

    var tf1 = 0, qft = null;
    for (r = 0; r < 3; r++) { var a4 = clock(function () { return beamFastTunnel(inst, K, RF); }); qft = a4[1]; tf1 += a4[0]; }
    var tTunF = Math.max(0, tf1 / 3 - tBeamF);

    /* reference */
    var ref, refLen;
    if (refIsExact) { var a5 = clock(function () { return heldKarp(inst); }); ref = a5[1]; refLen = ref.len; }
    else refLen = Math.min(tourLenRows(inst.rows, g), qbt.len, qft.len);

    var ok = checkTour(g, n) && checkTour(qbt.tour, n) && checkTour(qft.tour, n) &&
             Math.abs(tourLenRows(inst.rows, qbt.tour) - qbt.len) < 1e-6 &&
             Math.abs(tourLenFlat(inst.D, qft.tour, n) - qft.len) < 1e-6 &&
             Math.abs(tourLenFlat(inst.D, qf.finals[0].t, n) - qf.finals[0].len) < 1e-6;
    if (!ok) bad++;

    var dBase = (qbt.len / refLen - 1) * 100, dFast = (qft.len / refLen - 1) * 100;
    rows.push({ kind: kind, g: tourLenRows(inst.rows, g), bB: qbt.lenBeam, tB: qbt.len, bF: qf.lenBeam, tF: qft.len,
                ref: refLen, tG: tG, tBeamB: tBeamB, tTunB: tTunB, tBeamF: tBeamF, tTunF: tTunF, ok: ok });

    console.log(padL(rows.length, 3) + padR(kind, 9) +
      padL(rows[rows.length - 1].g.toFixed(1), 9) +
      padL(qbt.lenBeam.toFixed(1), 9) + padL(qbt.len.toFixed(1), 9) +
      padL(qf.lenBeam.toFixed(1), 9) + padL(qft.len.toFixed(1), 9) +
      padL(refLen.toFixed(1), 9) + padL(pcent(dBase), 8) + padL(pcent(dFast), 8) +
      padL(ms(tBeamB), 9) + padL(ms(tTunB), 9) + padL(ms(tBeamF), 9) + padL(ms(tTunF), 9) +
      padL(((tBeamF + tTunF) / (tBeamB + tTunB)).toFixed(2) + 'x', 8) + (ok ? '' : '  <-- INVALID TOUR'));
  }
}

/* ------------------------------- summary -------------------------------- */
var exB = rows.map(function (r) { return (r.tB / r.ref - 1) * 100; });
var exF = rows.map(function (r) { return (r.tF / r.ref - 1) * 100; });
var exBB = rows.map(function (r) { return (r.bB / r.ref - 1) * 100; });
var exBF = rows.map(function (r) { return (r.bF / r.ref - 1) * 100; });
var exG = rows.map(function (r) { return (r.g / r.ref - 1) * 100; });

var mBeamB = med(rows.map(function (r) { return r.tBeamB; }));
var mTunB = med(rows.map(function (r) { return r.tTunB; }));
var mBeamF = med(rows.map(function (r) { return r.tBeamF; }));
var mTunF = med(rows.map(function (r) { return r.tTunF; }));
var mG = med(rows.map(function (r) { return r.tG; }));

console.log('');
console.log('-----------------------------------------------------------------------------------------------------------');
console.log('SUMMARY   n=' + N + '  instances=' + rows.length + '  near=' + KN + '  oropt=' + (CFG.oropt ? 1 : 0) +
            '  score=' + CFG.score + '  starts=' + CFG.starts + '  dedupe=' + CFG.dedupe);
console.log('');
console.log(padR('', 15) + padL('median', 10) + padL('mean', 10) + padL('worst', 10) + padL('best', 10));
console.log(padR('greedy', 15) + padL(pcent(med(exG)), 10) + padL(pcent(mean(exG)), 10) + padL(pcent(mx(exG)), 10) + padL(pcent(Math.min.apply(null, exG)), 10));
console.log(padR('beam B', 15) + padL(pcent(med(exBB)), 10) + padL(pcent(mean(exBB)), 10) + padL(pcent(mx(exBB)), 10) + padL(pcent(Math.min.apply(null, exBB)), 10));
console.log(padR('beam+tunnel B', 15) + padL(pcent(med(exB)), 10) + padL(pcent(mean(exB)), 10) + padL(pcent(mx(exB)), 10) + padL(pcent(Math.min.apply(null, exB)), 10));
console.log(padR('beam F', 15) + padL(pcent(med(exBF)), 10) + padL(pcent(mean(exBF)), 10) + padL(pcent(mx(exBF)), 10) + padL(pcent(Math.min.apply(null, exBF)), 10));
console.log(padR('beam+tunnel F', 15) + padL(pcent(med(exF)), 10) + padL(pcent(mean(exF)), 10) + padL(pcent(mx(exF)), 10) + padL(pcent(Math.min.apply(null, exF)), 10));
console.log('');
console.log(padR('', 15) + padL('beam', 11) + padL('tunnel', 11) + padL('total', 11) + padL('speedup', 10));
console.log(padR('baseline', 15) + padL(ms(mBeamB), 11) + padL(ms(mTunB), 11) + padL(ms(mBeamB + mTunB), 11) + padL('1.00x', 10));
console.log(padR('fast', 15) + padL(ms(mBeamF), 11) + padL(ms(mTunF), 11) + padL(ms(mBeamF + mTunF), 11) +
            padL(((mBeamB + mTunB) / (mBeamF + mTunF)).toFixed(2) + 'x', 10));
console.log('');
console.log('beam speedup          : ' + (mBeamB / mBeamF).toFixed(2) + 'x');
console.log('tunnel speedup        : ' + (mTunB / mTunF).toFixed(2) + 'x   (' + RB + ' tours -> ' + RF + ' tours)');
console.log('total speedup         : ' + ((mBeamB + mTunB) / (mBeamF + mTunF)).toFixed(2) + 'x');
console.log('quality: median base  : ' + pcent(med(exB)) + '   fast: ' + pcent(med(exF)) +
            '   delta: ' + ((med(exF) - med(exB)) >= 0 ? '+' : '') + (med(exF) - med(exB)).toFixed(2) + ' pp');
console.log('quality: worst base   : ' + pcent(mx(exB)) + '   fast: ' + pcent(mx(exF)));
console.log('greedy time           : ' + ms(mG) + '   (fast total is ' + ((mBeamF + mTunF) / mG).toFixed(0) + 'x greedy)');
console.log('validation            : ' + (bad === 0 ? 'all tours are valid permutations, lengths consistent' : bad + ' INVALID instances'));
if (refIsExact) console.log('reference             : Held-Karp exact optimum for every instance');
console.log('');
