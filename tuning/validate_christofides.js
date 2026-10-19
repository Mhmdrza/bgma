#!/usr/bin/env node
/* validate_christofides.js -- checks the Christofides implementation.
 *
 *   1. the blossom matching equals a brute-force minimum-weight perfect matching
 *   2. every tour is a valid permutation, and its length is at most 1.5 x Held-Karp
 *      (the guarantee for metric TSP; the instances here are Euclidean)
 *
 * usage: node tuning/validate_christofides.js [--seeds=4]
 */
'use strict';
const path = require('path');
const { minWeightPerfectMatching, christofides } = require('../src/christofides/christofides.js');
const { B } = require('../src/hybrid/bgma.js');

const SEEDS = +((/--seeds=(\d+)/.exec(process.argv.join(' ')) || [0, 4])[1]);

function bruteMatching(D, verts) {
  const k = verts.length, memo = new Map();
  const f = mask => {
    if (mask === 0) return 0;
    if (memo.has(mask)) return memo.get(mask);
    let i = 0; while (!((mask >> i) & 1)) i++;
    let best = Infinity;
    for (let j = i + 1; j < k; j++) if ((mask >> j) & 1) {
      best = Math.min(best, D[verts[i]][verts[j]] + f(mask & ~(1 << i) & ~(1 << j)));
    }
    memo.set(mask, best);
    return best;
  };
  return f((1 << k) - 1);
}

let worstMatchErr = 0, matchCases = 0;
for (const k of [2, 4, 6, 8, 10, 12, 14]) for (let s = 1; s <= SEEDS; s++) {
  const inst = B.buildInstance(k + 2, s, 'uniform', 5);
  const D = inst.rows, verts = [...Array(k).keys()];
  const pairs = minWeightPerfectMatching(D, verts);
  if (pairs.length * 2 !== k || new Set(pairs.flat()).size !== k) throw new Error('matching is not perfect, k=' + k);
  const cost = pairs.reduce((t, [a, b]) => t + D[a][b], 0);
  worstMatchErr = Math.max(worstMatchErr, Math.abs(cost - bruteMatching(D, verts)) / bruteMatching(D, verts));
  matchCases++;
}
console.log('matching: ' + matchCases + ' cases, worst relative error vs brute force ' + worstMatchErr.toExponential(1));

let cnt = 0, sum = 0, worst = 0, violations = 0;
for (const n of [8, 12, 16, 18, 20]) for (const kind of ['uniform', 'cluster']) for (let s = 1; s <= SEEDS; s++) {
  const inst = B.buildInstance(n, s, kind, Math.min(n - 1, 10));
  const tour = christofides(inst.rows, n);
  if (!B.checkTour(tour, n)) throw new Error('invalid tour n=' + n + ' ' + kind + ' seed ' + s);
  const r = B.tourLenRows(inst.rows, tour) / B.heldKarp(inst).len;
  if (r > 1.5 + 1e-9) violations++;
  worst = Math.max(worst, r); sum += r; cnt++;
}
console.log('christofides vs Held-Karp: ' + cnt + ' instances (n=8..20), mean ' +
  (sum / cnt).toFixed(4) + ', worst ' + worst.toFixed(4) + ', bound violations ' + violations);
if (violations || worstMatchErr > 1e-6) process.exitCode = 1;
