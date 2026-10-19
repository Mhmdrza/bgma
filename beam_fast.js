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
 *   node beam_fast.js --n=200 --seeds=6 --K=16 --refineB=16 --refineF=5
 *   node beam_fast.js --n=22 --seeds=4 --exact=1        # verify against Held-Karp
 *
 * flags: --n=200 --seeds=6 --K=16 --refineB=16 --refineF=5 --near=10 --oropt=1 --exact=0
 */
'use strict';

var CFG = { n: 200, seeds: 6, K: 16, refineB: 16, refineF: 16, near: 10, oropt: 1, parity: 0, exact: 0 };
process.argv.slice(2).forEach(function (a) {
  var m = /^--([a-zA-Z]+)=(.*)$/.exec(a);
  if (!m) throw new Error('bad flag: ' + a);
  if (!(m[1] in CFG)) throw new Error('unknown flag: ' + m[1]);
  CFG[m[1]] = +m[2];
});
var N = CFG.n, SEEDS = CFG.seeds, K = CFG.K;
var RB = CFG.refineB, RF = CFG.refineF, KN = Math.min(CFG.near, N - 1), OROPT = !!CFG.oropt, PARITY = !!CFG.parity;

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
function buildInstance(n, seed, kind) {
  var pts = makePoints(n, seed, kind), i, j;
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
  var near = new Int32Array(n * KN);
  for (i = 0; i < n; i++) for (j = 0; j < KN; j++) near[i * KN + j] = order[i][j];
  var fp = farthestPair(D, n);
  return { D: D, rows: rows, order: order, orderFlat: orderFlat, near: near, fp: fp, n: n };
}
function farthestPair(D, n) {
  var best = -1, p = 0, q = 1;
  for (var i = 0; i < n; i++) for (var j = i + 1; j < n; j++) if (D[i * n + j] > best) { best = D[i * n + j]; p = i; q = j; }
  return [p, q];
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
 * verbatim from the page; only D access is unchanged (array of rows)
 */
function refineBase(D, tour) {
  var n = tour.length, t = tour.slice(), improved = true, i, j, k, len;
  while (improved) {
    improved = false;
    for (i = 0; i < n - 1 && !improved; i++) {
      for (j = i + 2; j < n; j++) {
        if (i === 0 && j === n - 1) continue;
        var a = t[i], b = t[i + 1], c = t[j], d = t[(j + 1) % n];
        if (D[a][c] + D[b][d] - D[a][b] - D[c][d] < -1e-9) {
          var seg = t.slice(i + 1, j + 1).reverse();
          t = t.slice(0, i + 1).concat(seg, t.slice(j + 1));
          improved = true; break;
        }
      }
    }
    if (improved) continue;
    for (len = 1; len <= 3 && !improved; len++) {
      for (i = 0; i < n && !improved; i++) {
        var tt = t.slice(i).concat(t.slice(0, i));
        var sg = tt.slice(0, len), rest = tt.slice(len);
        var prev = rest[rest.length - 1], next = rest[0];
        var s0 = sg[0], s1 = sg[len - 1];
        var gain = D[prev][s0] + D[s1][next] - D[prev][next];
        for (k = 0; k < rest.length - 1; k++) {
          var u = rest[k], v = rest[k + 1], base = D[u][v];
          var fwd = D[u][s0] + D[s1][v] - base, rev = D[u][s1] + D[s0][v] - base;
          if (fwd < gain - 1e-9) { t = rest.slice(0, k + 1).concat(sg, rest.slice(k + 1)); improved = true; break; }
          if (rev < gain - 1e-9) { t = rest.slice(0, k + 1).concat(sg.slice().reverse(), rest.slice(k + 1)); improved = true; break; }
        }
      }
    }
  }
  return t;
}

/* ============================ baseline beam ==============================
 * the page's quantum(), ported past the 32-bit bitmask (visited array + hashed key)
 */
function beamBase(inst, K, doRefine) {
  var D = inst.rows, order = inst.order, n = inst.n, poles = inst.fp, step;
  var states = poles.map(function (s) {
    var v = new Uint8Array(n); v[s] = 1;
    return { t: [s], vis: v, len: 0, s: s, f: 0 };
  });
  for (step = 1; step < n; step++) {
    var seen = new Map();
    for (var si = 0; si < states.length; si++) {
      var st = states[si], m = st.t.length, cur = st.t[m - 1], cand = [];
      for (var lag = 0; lag < Math.min(3, m); lag++) {
        var v = st.t[m - 1 - lag], rank = lag + 1, k = 0, c = -1, o = order[v];
        for (var q = 0; q < o.length; q++) if (!st.vis[o[q]]) { k++; if (k === rank) { c = o[q]; break; } }
        if (c >= 0 && cand.indexOf(c) < 0) cand.push(c);
      }
      var k2 = 0, c2 = -1, o2 = order[cur];
      for (var q2 = 0; q2 < o2.length; q2++) if (!st.vis[o2[q2]]) { k2++; if (k2 === 2) { c2 = o2[q2]; break; } }
      if (c2 >= 0 && cand.indexOf(c2) < 0) cand.push(c2);
      for (var ci = 0; ci < cand.length; ci++) {
        var cc = cand[ci], len = st.len + D[cur][cc];
        var nv = new Uint8Array(st.vis); nv[cc] = 1;
        var h = 2166136261;
        for (var w = 0; w < n; w++) h = Math.imul(h ^ nv[w], 16777619);
        var key = (h ^ Math.imul(cc + 1, 2654435761) ^ Math.imul(st.s + 1, 40503)) >>> 0;
        var old = seen.get(key);
        if (old === undefined || len < old.len) seen.set(key, { t: st.t.concat(cc), vis: nv, len: len, s: st.s, f: len + D[cc][st.s] });
      }
    }
    states = Array.from(seen.values()).sort(function (a, b) { return a.f - b.f; }).slice(0, K);
  }
  var finals = states.map(function (st) { return { t: st.t, len: st.len + D[st.t[n - 1]][st.s] }; })
    .sort(function (a, b) { return a.len - b.len; });
  var best = finals[0];
  for (var i = 0; i < Math.min(finals.length, doRefine ? RB : 0); i++) {
    var rt = refineBase(D, finals[i].t);
    var post = tourLenRows(D, rt);
    if (post < best.len - 1e-9) best = { t: rt, len: post };
  }
  return { tour: best.t, len: best.len, lenBeam: finals[0].len, finals: finals };
}

/* ============================== fast tunnel ============================== */

/* candidate 2-opt: both endpoints' neighbour lists, don't-look bits, in-place reversal */
function twoOptFast(D, t, pos, near, kn, n) {
  var dlb = new Uint8Array(n), queue = [], i;
  for (i = 0; i < n; i++) queue.push(t[i]);
  var guard = 0, limit = 200 * n;

  function apply(a, b, c, d) {
    var ia = pos[a], ic = pos[c];
    if (ia === ic || (ia + 1) % n === ic || (ic + 1) % n === ia) return false;
    var ii = ia, jj = ic;
    if (jj < ii) { var sw = ii; ii = jj; jj = sw; }
    if (jj === ii + 1 || (ii === 0 && jj === n - 1)) return false;
    if (!(D[a * n + c] + D[b * n + d] - D[a * n + b] - D[c * n + d] < -1e-9)) return false;
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
function sweep2opt(D, t, pos, n) {
  var improved = true, guard = 0;
  while (improved && guard++ < 80) {
    improved = false;
    for (var i = 0; i < n - 1; i++) {
      var a = t[i], b = t[i + 1];
      for (var j = i + 2; j < n; j++) {
        if (i === 0 && j === n - 1) continue;
        var c = t[j], d = t[(j + 1) % n];
        if (D[a * n + c] + D[b * n + d] - D[a * n + b] - D[c * n + d] < -1e-9) {
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

/* Or-opt: move a segment of 1..3 cities, best move per position, apply by rebuild */
function orOptFast(D, t, pos, near, kn, n, maxL) {
  var improved = true, guard = 0;
  while (improved && guard++ < 20) {
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
        var best = -1e-9, bestU = -1, bestRev = false;

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

function refineFast(D, tour, near, kn, n, parity) {
  var t = Int32Array.from(tour), pos = new Int32Array(n), i;
  for (i = 0; i < n; i++) pos[t[i]] = i;
  twoOptFast(D, t, pos, near, kn, n);
  orOptFast(D, t, pos, near, kn, n, 3);
  twoOptFast(D, t, pos, near, kn, n);
  if (parity) {                       // full O(n^2) sweeps: baseline-equivalent local optimum
    sweep2opt(D, t, pos, n);
    orOptFast(D, t, pos, near, kn, n, 3);
    sweep2opt(D, t, pos, n);
  }
  var out = new Array(n);
  for (i = 0; i < n; i++) out[i] = t[i];
  return { tour: out, len: tourLenFlat(D, t, n) };
}

/* =============================== fast beam ===============================
 * Arena of persistent nodes: parent index, city, length, f, start, visited bits.
 * No per-candidate tour copy: O(W) bitset copy + O(1) bookkeeping.
 */
function beamFast(inst, K) {
  var n = inst.n, D = inst.D, orderFlat = inst.orderFlat, no = n - 1, poles = inst.fp;
  var W = (n + 31) >> 5;
  var cap = 4 * K * (n + 1) + 16;

  var AP = new Int32Array(cap), AC = new Int32Array(cap), AS = new Int32Array(cap);
  var AL = new Float64Array(cap), AF = new Float64Array(cap), AH = new Uint32Array(cap);
  var AB = new Uint32Array(cap * W);
  var nn = 0;

  var Z = new Uint32Array(n), zr = rng(0x9E3779B9 ^ n);
  for (var i = 0; i < n; i++) Z[i] = (zr() * 4294967296) >>> 0;

  function mkNode(parent, city, len, f, start) {
    var id = nn++;
    AP[id] = parent; AC[id] = city; AL[id] = len; AF[id] = f; AS[id] = start;
    var b = id * W;
    if (parent >= 0) {
      var pb = parent * W;
      for (var w = 0; w < W; w++) AB[b + w] = AB[pb + w];
      AH[id] = AH[parent] ^ Z[city];
    } else {
      AH[id] = Z[city];
    }
    AB[b + (city >> 5)] |= (1 << (city & 31));
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

  var states = [mkNode(-1, poles[0], 0, 0, poles[0]), mkNode(-1, poles[1], 0, 0, poles[1])];

  for (var step = 1; step < n; step++) {
    var slotOf = new Map(), created = [];
    for (var si = 0; si < states.length; si++) {
      var sid = states[si], cur = AC[sid], base = sid * W, cand = [];
      var depth = step;
      for (var lag = 0; lag < Math.min(3, depth); lag++) {
        var v = sid;
        for (var up = 0; up < lag; up++) v = AP[v];
        var c = nthU(AC[v], lag + 1, base);
        if (c >= 0 && cand.indexOf(c) < 0) cand.push(c);
      }
      var c2 = nthU(cur, 2, base);
      if (c2 >= 0 && cand.indexOf(c2) < 0) cand.push(c2);

      for (var ci = 0; ci < cand.length; ci++) {
        var cc = cand[ci], len = AL[sid] + D[cur * n + cc];
        var key = (AH[sid] ^ Z[cc] ^ Math.imul(cc + 1, 0x9E3779B1) ^ Math.imul(AS[sid] + 1, 0x85EBCA77)) >>> 0;
        var slot = slotOf.get(key);
        if (slot === undefined) {
          slotOf.set(key, created.length);
          created.push(mkNode(sid, cc, len, len + D[cc * n + AS[sid]], AS[sid]));
        } else if (len < AL[created[slot]]) {
          /* the shorter path must be rebuilt, not just re-priced: its parent chain
             is what the tour is reconstructed from */
          created[slot] = mkNode(sid, cc, len, len + D[cc * n + AS[sid]], AS[sid]);
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

function beamFastTunnel(inst, K, RF) {
  var b = beamFast(inst, K), best = null;
  var lim = Math.min(b.finals.length, RF);
  for (var i = 0; i < lim; i++) {
    var r = refineFast(inst.D, b.finals[i].t, inst.near, KN, inst.n, PARITY);
    if (!best || r.len < best.len - 1e-9) best = r;
  }
  return { tour: best.tour, len: best.len, lenBeam: b.lenBeam };
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
            '  refineF=' + RF + '  near=' + KN + '  oropt=' + (OROPT ? 1 : 0) + '  parity=' + (PARITY ? 1 : 0) +
            '  reference=' + (refIsExact ? 'heldKarp (exact)' : 'best of all methods'));
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
console.log('SUMMARY   n=' + N + '  instances=' + rows.length + '  near=' + KN + '  oropt=' + (OROPT ? 1 : 0));
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
