#!/usr/bin/env node
/* n22_bench.js -- 22-node TSP benchmark: greedy vs beam (+ tunnelling) vs exact Held-Karp.
 *
 * The four algorithms below are copied verbatim from
 *   "Voting Greedy TSP (1).html"   (greedy, refine, quantum, heldKarp)
 * so the numbers describe the page's own code, not a re-implementation.
 *
 * Held-Karp at n=22 allocates (n-1)*2^(n-1)*9 bytes = ~378 MiB and takes ~1.3 s
 * per instance, so it is the whole cost of this benchmark.
 *
 * usage:
 *   node bench/n22_bench.js                          # 8 seeds/family, K=16, tunnel on
 *   node bench/n22_bench.js --seeds=12 --K=64
 *   node bench/n22_bench.js --refine=0               # beam only
 *   node bench/n22_bench.js --n=20 --seeds=4         # any n from 8..26
 *
 * flags: --n=22  --seeds=8  --K=16  --refine=1|0
 */
'use strict';

var CFG = { n: 22, seeds: 8, K: 16, refine: 1 };
process.argv.slice(2).forEach(function (a) {
  var m = /^--([a-z]+)=(.*)$/.exec(a);
  if (!m) throw new Error('bad flag: ' + a + '  (use --n=, --seeds=, --K=, --refine=)');
  if (!(m[1] in CFG)) throw new Error('unknown flag: ' + m[1]);
  CFG[m[1]] = +m[2];
});
var N = CFG.n, SEEDS = CFG.seeds, K = CFG.K, DO_REFINE = !!CFG.refine;
if (N < 8 || N > 26) throw new Error('n must be 8..26 (heldKarp: 1<<m is 32-bit, memory explodes)');
if ([1, 4, 16, 64].indexOf(K) < 0) throw new Error('K must be 1, 4, 16 or 64');

/* ============================ page code (verbatim) ============================ */

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
  var r = rng(seed * 7919 + n * 104729 + (kind === "cluster" ? 17 : 0));
  var pts = [], i;
  if (kind === "cluster") {
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
function distMatrix(pts) {
  var n = pts.length, D = [], i, j;
  for (i = 0; i < n; i++) D.push(new Float64Array(n));
  for (i = 0; i < n; i++) for (j = i + 1; j < n; j++) {
    var d = Math.hypot(pts[i][0] - pts[j][0], pts[i][1] - pts[j][1]);
    D[i][j] = d; D[j][i] = d;
  }
  return D;
}
function neighbourOrder(D) {
  var n = D.length, out = [], i;
  for (i = 0; i < n; i++) {
    var idx = [];
    for (var j = 0; j < n; j++) if (j !== i) idx.push(j);
    idx.sort(function (a, b) { return D[i][a] - D[i][b]; });
    out.push(idx);
  }
  return out;
}
function farthestPair(D) {
  var n = D.length, best = -1, p = 0, q = 1;
  for (var i = 0; i < n; i++) for (var j = i + 1; j < n; j++) if (D[i][j] > best) { best = D[i][j]; p = i; q = j; }
  return [p, q];
}
function tourLen(D, t) {
  var s = 0;
  for (var i = 0; i < t.length; i++) s += D[t[i]][t[(i + 1) % t.length]];
  return s;
}

function greedy(D, order, start) {
  var n = D.length, visited = new Array(n).fill(false), tour = [start];
  visited[start] = true;
  while (tour.length < n) {
    var o = order[tour[tour.length - 1]], c = -1;
    for (var i = 0; i < o.length; i++) if (!visited[o[i]]) { c = o[i]; break; }
    tour.push(c); visited[c] = true;
  }
  return tour;
}

/* Tunnelling: 2-opt and Or-opt moves until no move shortens the tour. */
function refine(D, tour) {
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

/* Superposition beam: many partial tours from both poles, merged by interference, collapsed by measurement. */
function quantum(D, order, poles, K, doRefine) {
  var n = D.length, step, i;
  var states = poles.map(function (s) { return { t: [s], mask: 1 << s, len: 0, s: s, f: 0 }; });
  for (step = 1; step < n; step++) {
    var seen = new Map();
    states.forEach(function (st) {
      var m = st.t.length, cur = st.t[m - 1], cand = [];
      function nthU(v, rank) {
        var k = 0, o = order[v];
        for (var q = 0; q < o.length; q++) if (!((st.mask >> o[q]) & 1)) { k++; if (k === rank) return o[q]; }
        return -1;
      }
      for (var lag = 0; lag < Math.min(3, m); lag++) {
        var c = nthU(st.t[m - 1 - lag], lag + 1);
        if (c >= 0 && cand.indexOf(c) < 0) cand.push(c);
      }
      var c2 = nthU(cur, 2);
      if (c2 >= 0 && cand.indexOf(c2) < 0) cand.push(c2);
      cand.forEach(function (c) {
        var len = st.len + D[cur][c], mask = st.mask | (1 << c);
        var key = (mask * 16 + c) * 16 + st.s, old = seen.get(key);
        if (old === undefined || len < old.len) {
          seen.set(key, { t: st.t.concat(c), mask: mask, len: len, s: st.s, f: len + D[c][st.s] });
        }
      });
    });
    states = Array.from(seen.values()).sort(function (a, b) { return a.f - b.f; }).slice(0, K);
  }
  var finals = states.map(function (st) {
    return { t: st.t, len: st.len + D[st.t[n - 1]][st.s] };
  }).sort(function (a, b) { return a.len - b.len; });
  var best = finals[0], wave = [];
  for (i = 0; i < Math.min(finals.length, 32); i++) {
    var post = null;
    if (doRefine && i < 16) {
      var rt = refine(D, finals[i].t);
      post = tourLen(D, rt);
      if (post < best.len - 1e-9) best = { t: rt, len: post };
    }
    wave.push({ pre: finals[i].len, post: post });
  }
  return { tour: best.t, len: best.len, lenBeam: finals[0].len, wave: wave };
}

function heldKarp(D) {
  var n = D.length, m = n - 1, N = 1 << m, j, k, mask;
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
  while (cj !== -1) {
    tour.push(cj + 1);
    var pj = par[mk * m + cj];
    mk ^= (1 << cj);
    cj = pj;
  }
  tour.push(0);
  tour.reverse();
  return tour;
}

/* ============================== benchmark harness ============================== */

function clock(fn) {                       // -> [milliseconds, result]
  var t0 = process.hrtime.bigint();
  var v = fn();
  return [Number(process.hrtime.bigint() - t0) / 1e6, v];
}
function pct(a, b) { return (a / b - 1) * 100; }
function med(a) { var b = a.slice().sort(function (x, y) { return x - y; }); return b.length ? b[b.length >> 1] : NaN; }
function mean(a) { var s = 0; for (var i = 0; i < a.length; i++) s += a[i]; return s / a.length; }
function max(a) { return Math.max.apply(null, a); }
function padL(s, w) { s = String(s); while (s.length < w) s = ' ' + s; return s; }
function padR(s, w) { s = String(s); while (s.length < w) s = s + ' '; return s; }
function p2(x) { return x.toFixed(2); }
function pc(x) { return (x >= 0 ? '+' : '') + x.toFixed(1) + '%'; }

var WIDTHS = [4, 5, 8, 9, 9, 9, 9, 8, 8, 8, 9, 9, 9, 8];
var CENTER = { 2: 1 };   // left-align the "kind" column
function line(cells) {
  var out = '';
  for (var i = 0; i < cells.length; i++) out += (CENTER[i] ? padR(String(cells[i]), WIDTHS[i]) : padL(String(cells[i]), WIDTHS[i]));
  return out;
}

var HK_MIB = (N - 1) * Math.pow(2, N - 1) * 9 / 1048576;
var KINDS = ['uniform', 'cluster'];

console.log('');
console.log('n22_bench  n=' + N + '  K=' + K + '  tunnelling=' + (DO_REFINE ? 'on' : 'off') +
            '  instances=' + (SEEDS * 2) + '  heldKarp DP ~' + HK_MIB.toFixed(0) + ' MiB / call');
console.log('each row blocks ~' + (N <= 20 ? '0.3' : N <= 22 ? '1.3' : N <= 23 ? '3' : N <= 24 ? '7' : '15') +
            ' s inside heldKarp; the timings below exclude instance generation');
console.log('');
console.log(line(['#', 'seed', 'kind', 'opt', 'greedy', 'beam', 'beam+tun', 'g%', 'b%', 't%', 'g_us', 'beam_ms', 'tun_ms', 'hk_s']));
console.log(line(['-', '----', '------', '-------', '-------', '-------', '-------', '-----', '-----', '-----', '------', '-------', '------', '-----']));

var exG = [], exB = [], exT = [];                 // % above the optimum
var msG = [], msBeam = [], msTun = [], msTot = [], msHK = [];
var hitG = 0, hitB = 0, hitT = 0, inst = 0, optSum = 0;

for (var s = 1; s <= SEEDS; s++) {
  for (var ki = 0; ki < KINDS.length; ki++) {
    var kind = KINDS[ki];
    var pts = makePoints(N, s, kind);
    var D = distMatrix(pts);
    var order = neighbourOrder(D);
    var fp = farthestPair(D);
    var start = fp[0];

    /* greedy: median of 200 reps (it is microseconds) */
    var gTour = null, tg = 0, reps = 200, r;
    for (r = 0; r < reps; r++) { var a1 = clock(function () { return greedy(D, order, start); }); gTour = a1[1]; tg += a1[0]; }
    var gUs = (tg / reps) * 1000;

    /* beam only (no tunnelling) */
    var tb = 0, q0 = null;
    for (r = 0; r < 5; r++) { var a2 = clock(function () { return quantum(D, order, fp, K, false); }); q0 = a2[1]; tb += a2[0]; }
    tb /= 5;

    /* beam + tunnelling (the page's default path) */
    var tq = 0, q1 = null;
    for (r = 0; r < 5; r++) { var a3 = clock(function () { return quantum(D, order, fp, K, DO_REFINE); }); q1 = a3[1]; tq += a3[0]; }
    tq /= 5;
    var tTun = Math.max(0, tq - tb);

    /* exact optimum */
    var a4 = clock(function () { return heldKarp(D); });
    var hkTour = a4[1], hkMs = a4[0];
    var opt = tourLen(D, hkTour);

    var gLen = tourLen(D, gTour);
    var bLen = q1.lenBeam;
    var tLen = q1.len;

    inst++; optSum += opt;
    exG.push(pct(gLen, opt)); exB.push(pct(bLen, opt)); exT.push(pct(tLen, opt));
    msG.push(gUs / 1000); msBeam.push(tb); msTun.push(tTun); msTot.push(tb + tTun); msHK.push(hkMs);
    if (Math.abs(gLen - opt) < 1e-6) hitG++;
    if (Math.abs(bLen - opt) < 1e-6) hitB++;
    if (Math.abs(tLen - opt) < 1e-6) hitT++;

    console.log(line([
      inst, s, kind, opt.toFixed(1), gLen.toFixed(1), bLen.toFixed(1), tLen.toFixed(1),
      pc(exG[exG.length - 1]), pc(exB[exB.length - 1]), pc(exT[exT.length - 1]),
      gUs.toFixed(1), tb.toFixed(3), tTun.toFixed(3), (hkMs / 1000).toFixed(2)
    ]));
  }
}

console.log('');
console.log('------------------------------------------------------------------------------------------------------');
console.log('SUMMARY   n=' + N + '   instances=' + inst + '   K=' + K + '   tunnelling=' + (DO_REFINE ? 'on' : 'off'));
console.log('------------------------------------------------------------------------------------------------------');
var labels = ['greedy', 'beam', 'beam + tunnel', 'held-Karp'];
var ex = [exG, exB, exT, [0]];
var tm = [med(msG), med(msBeam), med(msTot), med(msHK)];
var hits = [hitG, hitB, hitT, inst];
console.log(padR('method', 15) + padL('median', 9) + padL('mean', 9) + padL('worst', 9) +
            padL('hit opt', 9) + padL('median time', 13));
for (var i = 0; i < labels.length; i++) {
  console.log(padR(labels[i], 15) +
              padL(i === 3 ? 'exact' : pc(med(ex[i])), 9) +
              padL(i === 3 ? 'exact' : pc(mean(ex[i])), 9) +
              padL(i === 3 ? 'exact' : pc(max(ex[i])), 9) +
              padL(hits[i] + '/' + inst, 9) +
              padL(tm[i] < 1 ? (tm[i] * 1000).toFixed(1) + ' us' : tm[i].toFixed(2) + ' ms', 13));
}

console.log('------------------------------------------------------------------------------------------------------');
console.log(padR('totals', 15) +
            padL('opt sum ' + optSum.toFixed(1), 26) +
            padL('greedy ' + med(msG).toFixed(3) + ' ms', 20) +
            padL('beam+tun ' + med(msTot).toFixed(3) + ' ms', 22) +
            padL('heldKarp ' + med(msHK).toFixed(1) + ' ms', 22));
console.log('');
console.log('beam+tunnel vs greedy     : ' + (med(msTot) / med(msG)).toFixed(0) + 'x slower, ' +
            (med(exG) - med(exT)).toFixed(1) + ' percentage points closer to the optimum');
console.log('beam+tunnel vs held-Karp  : ' + (med(msHK) / med(msTot)).toFixed(0) + 'x faster, worst case ' +
            pc(max(exT)) + ' above the optimum');
console.log('beam -> tunnelling gain   : ' + (med(exB) - med(exT)).toFixed(1) +
            ' points for ' + med(msTun).toFixed(3) + ' ms (' + (100 * med(msTun) / med(msTot)).toFixed(0) + '% of beam+tunnel)');
console.log('heldKarp DP memory        : ' + HK_MIB.toFixed(0) + ' MiB allocated per instance');
console.log('');
