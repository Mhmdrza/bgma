/* nature_effort_profiles.js -- shared effort ladder for the nature solver.
 *
 * Browser:  <script src="nature_effort_profiles.js"></script>  -> window.NatureEffortProfiles
 * Node:     const { effortPreset } = require('./nature_effort_profiles.js')
 *
 * `n` is the instance size. The numbers are the tuned nature budgets. Unlike
 * the BGMA ladder, the iterate budget grows with n^2: the old fixed cap
 * (120k proposals) stops scaling above n~51 and is the reason the historical
 * nature solver collapses at n = 300-400.
 *
 * The ladder spends, in order of cost effectiveness:
 *   1. iterations  (anneal proposals per tour)   -- the dominant lever
 *   2. restarts    (independent populations)     -- the second lever
 *   3. children    (ordered-crossover children)
 *   4. survivors   (distinct population tours annealed)
 *   5. polish      (cheap final 2-opt on the top tours)
 * Population size M, branch shape, and temperature shape stay near the
 * page defaults: the sweeps showed they are saturated or fragile.
 */
(function (global) {
  'use strict';

  var LEVELS = ['low', 'mid', 'high', 'xhigh', 'max'];

  function effortPreset(level, n) {
    var L = String(level || 'mid').toLowerCase();
    function r(x) { return Math.max(1, Math.round(x)); }
    /* iterates: floor keeps small n well searched; n^2 keeps large n alive */
    function it(floor, c) { return Math.max(floor, Math.round(c * n * n)); }

    if (L === 'low') {
      return { M: 24, selT: 0.5, survivors: 3, children: 2, parents: 2,
               restarts: 1, iters: it(8000, 4),
               nearK: Math.max(6, Math.min(10, r(n / 20))),
               polish: 'fast', polishTop: 2, polishOrOptMaxL: 3 };
    }
    if (L === 'mid') {
      return { M: 32, selT: 0.5, survivors: 5, children: 6, parents: 3,
               restarts: 1, iters: it(10000, 7.5),
               nearK: 10,
               polish: 'fast', polishTop: 2, polishOrOptMaxL: 3 };
    }
    if (L === 'high') {
      return { M: 48, selT: 0.5, survivors: 8, children: 10, parents: 4,
               restarts: 2, iters: it(12000, 6.5),
               nearK: Math.max(10, Math.min(14, r(n / 15))),
               polish: 'fast', polishTop: 3, polishOrOptMaxL: 4 };
    }
    if (L === 'xhigh') {
      return { M: 64, selT: 0.5, survivors: 10, children: 14, parents: 4,
               restarts: 3, iters: it(15000, 10),
               nearK: Math.max(10, Math.min(16, r(n / 12))),
               polish: 'fast', polishTop: 5, polishOrOptMaxL: 5 };
    }
    if (L === 'max') {
      return { M: 96, selT: 0.5, survivors: 12, children: 16, parents: 5,
               restarts: 4, iters: it(20000, 12),
               nearK: Math.max(10, Math.min(20, r(n / 10))),
               polish: 'base', polishTop: 8, polishOrOptMaxL: 5 };
    }
    throw new Error('unknown effort level: ' + level + ' (low|mid|high|xhigh|max)');
  }

  var api = { LEVELS: LEVELS, effortPreset: effortPreset };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.NatureEffortProfiles = api;
})(typeof window !== 'undefined' ? window : globalThis);
