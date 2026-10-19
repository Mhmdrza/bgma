#!/usr/bin/env node
/* beam_simple.js -- the same solver as beam_fast.js, written only to be read.
 *
 * The rules, and nothing else:
 *
 *   1. superposition : keep K partial tours alive, grown from the two poles
 *   2. branching     : extend each along the short edges leaving its last 3 cities
 *   3. interference  : two histories with the same visited set and the same last
 *                      city are indistinguishable -> keep the shorter one
 *   4. measurement   : keep the K best by (length so far + distance home)
 *   5. tunnelling    : 2-opt until no move shortens the tour
 *
 * Deliberately absent: bitsets, arenas, parent pointers, hashes, don't-look bits,
 * delta evaluation, Or-opt, typed arrays. Every list is an Array, every visited
 * set is a boolean array, every key is a string.
 *
 * usage:  node beam_simple.js [n] [seeds] [K]
 *         node beam_simple.js 200 6 16
 */
'use strict';

var N = +(process.argv[2] || 200);
var SEEDS = +(process.argv[3] || 6);
var K = +(process.argv[4] || 16);

/* ------------------------------- instances ------------------------------- */

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
  var pts = [];
  if (kind === 'cluster') {
    var k = 3 + Math.floor(r() * 2), centers = [];
    for (var c = 0; c < k; c++) centers.push([18 + r() * 64, 18 + r() * 64]);
    for (var i = 0; i < n; i++) {
      var ce = centers[Math.floor(r() * k)];
      pts.push([clamp(ce[0] + gauss(r) * 8), clamp(ce[1] + gauss(r) * 8)]);
    }
  } else {
    for (var j = 0; j < n; j++) pts.push([4 + r() * 92, 4 + r() * 92]);
  }
  return pts;
}

function distMatrix(pts) {
  var n = pts.length, D = [];
  for (var i = 0; i < n; i++) {
    D.push([]);
    for (var j = 0; j < n; j++) D[i].push(Math.hypot(pts[i][0] - pts[j][0], pts[i][1] - pts[j][1]));
  }
  return D;
}

/* for every city, the other cities sorted by distance */
function nearestOrder(D) {
  var n = D.length, order = [];
  for (var i = 0; i < n; i++) {
    var rest = [];
    for (var j = 0; j < n; j++) if (j !== i) rest.push(j);
    order.push(rest.sort(function (a, b) { return D[i][a] - D[i][b]; }));
  }
  return order;
}

function farthestPair(D) {
  var n = D.length, best = -1, p = 0, q = 1;
  for (var i = 0; i < n; i++) for (var j = i + 1; j < n; j++) {
    if (D[i][j] > best) { best = D[i][j]; p = i; q = j; }
  }
  return [p, q];
}

function tourLength(D, tour) {
  var s = 0;
  for (var i = 0; i < tour.length; i++) s += D[tour[i]][tour[(i + 1) % tour.length]];
  return s;
}

/* -------------------------------- the wave -------------------------------- */

/* the rank-th nearest city that has not been visited yet */
function nearestUnvisited(order, seen, city, rank) {
  var k = 0;
  for (var i = 0; i < order[city].length; i++) {
    var c = order[city][i];
    if (!seen[c] && ++k === rank) return c;
  }
  return -1;
}

/* the cities this partial tour is allowed to grow towards */
function branches(state, order) {
  var tour = state.tour, depth = tour.length, out = [];
  for (var lag = 0; lag < Math.min(3, depth); lag++) {
    var c = nearestUnvisited(order, state.seen, tour[depth - 1 - lag], lag + 1);
    if (c >= 0 && out.indexOf(c) < 0) out.push(c);
  }
  var second = nearestUnvisited(order, state.seen, tour[depth - 1], 2);
  if (second >= 0 && out.indexOf(second) < 0) out.push(second);
  return out;
}

function extend(state, city, D) {
  var seen = state.seen.slice();
  seen[city] = true;
  return {
    tour: state.tour.concat(city),
    seen: seen,
    len: state.len + D[state.tour[state.tour.length - 1]][city],
    start: state.start
  };
}

/* length so far + the edge we will still need to close the loop */
function score(state, D) {
  var last = state.tour[state.tour.length - 1];
  return state.len + D[last][state.start];
}

/* the visited set is all that distinguishes two configurations, and the last
   city decides where the wave can branch next -- so that pair is the key */
function keyOf(state) {
  return state.seen.map(function (v) { return v ? 1 : 0; }).join('') +
         '|' + state.tour[state.tour.length - 1] + '|' + state.start;
}

function beam(D, order, poles, K) {
  var wave = poles.map(function (p) {
    var seen = new Array(D.length).fill(false);
    seen[p] = true;
    return { tour: [p], seen: seen, len: 0, start: p };
  });

  for (var step = 1; step < D.length; step++) {
    /* superposition: every branch of every surviving tour */
    var next = [];
    for (var w = 0; w < wave.length; w++) {
      var cities = branches(wave[w], order);
      for (var c = 0; c < cities.length; c++) next.push(extend(wave[w], cities[c], D));
    }

    /* interference: same configuration -> the shorter history survives */
    var unique = new Map();
    for (var i = 0; i < next.length; i++) {
      var key = keyOf(next[i]);
      var old = unique.get(key);
      if (old === undefined || next[i].len < old.len) unique.set(key, next[i]);
    }

    /* measurement: keep the K best */
    wave = Array.from(unique.values())
      .sort(function (a, b) { return score(a, D) - score(b, D); })
      .slice(0, K);
  }
  return wave;
}

/* ------------------------------ tunnelling -------------------------------- */

/* 2-opt: try every pair of edges, take the first improving swap, start over */
function tunnel(D, tour) {
  var t = tour.slice(), improved = true;
  while (improved) {
    improved = false;
    for (var i = 0; i < t.length - 1 && !improved; i++) {
      for (var j = i + 2; j < t.length; j++) {
        if (i === 0 && j === t.length - 1) continue;
        var a = t[i], b = t[i + 1], c = t[j], d = t[(j + 1) % t.length];
        if (D[a][c] + D[b][d] < D[a][b] + D[c][d] - 1e-9) {
          t.splice(i + 1, j - i, ...t.slice(i + 1, j + 1).reverse());
          improved = true;
          break;
        }
      }
    }
  }
  return t;
}

function solve(D, order, poles, K) {
  var finals = beam(D, order, poles, K)
    .sort(function (a, b) { return score(a, D) - score(b, D); });
  var best = null;
  for (var i = 0; i < finals.length; i++) {
    var t = tunnel(D, finals[i].tour), len = tourLength(D, t);
    if (!best || len < best.len) best = { tour: t, len: len };
  }
  return { best: best, finals: finals };
}

/* -------------------------------- harness --------------------------------- */

function greedy(D, order, start) {
  var seen = new Array(D.length).fill(false), tour = [start];
  seen[start] = true;
  while (tour.length < D.length) {
    var c = nearestUnvisited(order, seen, tour[tour.length - 1], 1);
    tour.push(c); seen[c] = true;
  }
  return tour;
}

function clock(fn) {
  var t0 = process.hrtime.bigint();
  var v = fn();
  return [Number(process.hrtime.bigint() - t0) / 1e6, v];
}
function med(a) { var b = a.slice().sort(function (x, y) { return x - y; }); return b[b.length >> 1]; }
function padL(s, w) { s = String(s); while (s.length < w) s = ' ' + s; return s; }
function padR(s, w) { s = String(s); while (s.length < w) s = s + ' '; return s; }
function pcent(x) { return (x >= 0 ? '+' : '') + x.toFixed(1) + '%'; }
function ms(x) { return x < 1 ? (x * 1000).toFixed(0) + 'us' : x.toFixed(1) + 'ms'; }

var rows = [];
console.log('');
console.log('beam_simple   n=' + N + '  seeds=' + SEEDS + '/family  K=' + K);
console.log('tunnel = 2-opt only (the page also runs Or-opt; that is a different trade, not this one)');
console.log('');
console.log(padL('#', 3) + padR('kind', 9) + padL('greedy', 9) + padL('beam', 9) + padL('beam+tun', 9) +
            padL('best', 9) + padL('g%', 7) + padL('b%', 7) + padL('t%', 7) +
            padL('tBeam', 9) + padL('tTun', 10) + padL('total', 10));

for (var s = 1; s <= SEEDS; s++) {
  for (var ki = 0; ki < 2; ki++) {
    var kind = ki === 0 ? 'uniform' : 'cluster';
    var D = distMatrix(makePoints(N, s, kind));
    var order = nearestOrder(D);
    var poles = farthestPair(D);

    var g = greedy(D, order, poles[0]);
    var gLen = tourLength(D, g);

    var tb = clock(function () { return beam(D, order, poles, K); });
    var wave = tb[1];

    var tt = clock(function () { return solve(D, order, poles, K); });
    var bestLen = tt[1].best.len;

    var ref = Math.min(gLen, bestLen);
    rows.push({ g: gLen, beam: score(wave[0], D), tun: bestLen, ref: ref,
                tb: tb[0], tt: tt[0] });

    var r = rows[rows.length - 1];
    console.log(padL(rows.length, 3) + padR(kind, 9) +
      padL(gLen.toFixed(1), 9) + padL(r.beam.toFixed(1), 9) + padL(bestLen.toFixed(1), 9) +
      padL(ref.toFixed(1), 9) +
      padL(pcent((gLen / ref - 1) * 100), 7) +
      padL(pcent((r.beam / ref - 1) * 100), 7) +
      padL(pcent((bestLen / ref - 1) * 100), 7) +
      padL(ms(tb[0]), 9) + padL(ms(tt[0]), 10) + padL(ms(tb[0] + tt[0]), 10));
  }
}

var mG = med(rows.map(function (r) { return r.g; }));
var mB = med(rows.map(function (r) { return r.beam; }));
var mT = med(rows.map(function (r) { return r.tun; }));
var mBeam = med(rows.map(function (r) { return r.tb; }));
var mTun = med(rows.map(function (r) { return r.tt - r.tb; }));
var mTot = med(rows.map(function (r) { return r.tt; }));

console.log('');
console.log('-----------------------------------------------------------------------------');
console.log('SUMMARY   median over ' + rows.length + ' instances');
console.log('  length   greedy ' + mG.toFixed(1) + '   beam ' + mB.toFixed(1) + '   beam+tunnel ' + mT.toFixed(1));
console.log('  time     beam ' + ms(mBeam) + '   tunnel ' + ms(mTun) + '   total ' + ms(mTot));
console.log('  tunnel is ' + (100 * mTun / mTot).toFixed(0) + '% of the total');
console.log('');
