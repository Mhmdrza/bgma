/* onetree_seed.js -- One-Tree Seeded Hybrid (OTSH).
 *
 * BGMA (bgma.js) starts every run from beam islands: partial tours grown outward
 * by nearest-city rank. This module starts it from the 1-tree lower bound
 * instead, and keeps the bound around to stop early.
 *
 * Why the 1-tree is a good skeleton
 *   The subgradient ascent (hkBoundTree) does not just produce a number; it
 *   produces the Lagrange multipliers pi that made the bound tight, and the
 *   minimum 1-tree under those multipliers. As the ascent converges, the tree is
 *   driven toward "every city has degree 2" -- i.e. toward a tour. What survives
 *   is a connected structure of n-1 short edges plus two edges at the root, with
 *   a handful of degree violations left. Its edges are collectively the cheapest
 *   way to hold the cities together, so walking them visits the map in an order
 *   that is already locally coherent, unlike a nearest-neighbour greedy walk
 *   that commits to each step before seeing the rest.
 *
 * The degree repair is the walk itself
 *   walkTree() traverses the 1-tree depth-first and keeps each city the first
 *   time it is reached. A city with 1-tree degree d > 2 is entered once and
 *   skipped d-1 times, so every surplus degree disappears; a city of degree 1 is
 *   entered once and the closing edge back to the root supplies its second. Out
 *   comes a Hamiltonian cycle over exactly the cheap edge structure. (This is the
 *   classic double-tree shortcut; the difference from a plain MST is that the
 *   tree here was chosen to minimise degree violations, not only length.)
 *
 * What the floor buys, beyond a seed
 *   The bound L is admissible, so:
 *     - if the 1-tree already has every degree 2, it *is* a tour of length L and
 *       therefore optimal: OTSH returns in the time it took to prove it, with no
 *       hybrid work at all;
 *     - otherwise the screened skeleton is handed to the hybrid, and L is passed
 *       as `floor`, so the moment the search reaches L it stops -- the tour is
 *       optimal and the bound proves it. A certified run never pays for its
 *       remaining generations or restarts.
 *
 * usage (Node):
 *   const { treeHybrid } = require('./onetree_seed.js');
 *   treeHybrid(inst, seed, 'mid')                    -> same shape as runEffort()
 *   treeHybrid(inst, seed, 'max', { preset: { islands: 0 } })   -> skeleton only
 *
 * Cost: one subgradient ascent, O(iters * n^2), then the ordinary hybrid. At
 * n=400, 400 iterations cost ~0.3 s against a hybrid budget of ~1 s (low) to
 * minutes (max), so the bound is affordable where the hybrid is.
 */
'use strict';

const { hkBoundTree, greedy, tourLen } = require('../hybrid/hybrid_vis.js');
const { B, hybrid, effortPreset } = require('../hybrid/bgma.js');

const ms = () => Number(process.hrtime.bigint()) / 1e6;

/* Depth-first walk of the 1-tree's edges, keeping each city once. Iterative on
 * purpose: n can pass 1000 and the tree can be a path. */
function walkTree(n, edges, root) {
  const adj = Array.from({ length: n }, () => []);
  for (const [a, b] of edges) { adj[a].push(b); adj[b].push(a); }
  const seen = new Uint8Array(n), tour = [], stack = [root];
  while (stack.length) {
    const v = stack.pop();
    if (seen[v]) continue;
    seen[v] = 1; tour.push(v);
    const nb = adj[v];
    for (let i = nb.length - 1; i >= 0; i--) if (!seen[nb[i]]) stack.push(nb[i]);
  }
  return tour.length === n ? tour : null;   // null: the 1-tree does not span
}

/* Bound + skeleton in one shot. `base` is a beam-style instance (rows, order, n).
 * Returns { tour, len, L, violations, edges, deg, ub, iters, ms }. */
function oneTreeSeed(base, opts) {
  const O = opts || {};
  const n = base.n;
  const iters = O.iters > 0 ? O.iters | 0 : 400;
  const ub = O.ub != null ? O.ub : tourLen(base.rows, greedy(base.rows, base.order, 0));
  const t0 = ms();
  const b = hkBoundTree(base.rows, ub, iters);
  let violations = 0;
  for (let i = 0; i < n; i++) if (b.deg[i] !== 2) violations++;
  const tour = n > 2 ? walkTree(n, b.edges, 0) : null;
  return {
    tour: tour, len: tour ? tourLen(base.rows, tour) : null,
    L: b.L, violations: violations, edges: b.edges, deg: b.deg,
    ub: ub, iters: iters, ms: ms() - t0
  };
}

/* OTSH: the 1-tree seed plus the BGMA pipeline. Same return shape as runEffort,
 * plus { floor, violations, source, msBound, msHybrid, distilled }.
 * flags/opts: iters (bound iterations), ub (upper bound to aim the ascent at),
 *             preset (extra knobs merged over the effort level). */
function treeHybrid(inst, seed, level, opts) {
  const O = opts || {};
  const n = inst.n;
  const base = inst.base || B.buildInstance(n, inst.seed, inst.kind, O.nearK);
  const t0 = ms();
  const st = oneTreeSeed(base, O);
  const msBound = ms() - t0;

  const out = {
    len: st.len, tour: st.tour, floor: st.L, violations: st.violations,
    certified: false, source: 'one-tree', msBound: msBound, msHybrid: 0, ms: msBound,
    iters: st.iters
  };

  /* The 1-tree closed by itself: L is attained, so it is the optimum. */
  if (st.tour && st.violations === 0) {
    return Object.assign(out, { certified: true, distilled: true });
  }

  const seedTours = st.tour ? [st.tour] : [];
  const arm = (lvl, s) => hybrid(inst, s,
    Object.assign({}, effortPreset(lvl, n), O.preset || {}, { seedTours: seedTours, floor: st.L }));
  const t1 = ms();
  let res;
  if (String(level || 'mid').toLowerCase() === 'max') {
    /* same portfolio as runEffort('max'): the xhigh and max presets run
     * independently, but here they share one bound and one skeleton. */
    const a = arm('xhigh', seed), b = arm('max', (seed + 104729) >>> 0);
    res = b.len <= a.len ? b : a;
    res.certified = a.certified || b.certified;
  } else {
    res = arm(level || 'mid', seed);
  }
  out.msHybrid = ms() - t1;
  out.ms = out.msBound + out.msHybrid;
  return Object.assign(out, {
    len: res.len, tour: res.tour, certified: !!res.certified, pool: res.pool,
    source: res.certified ? 'hybrid+floor' : 'hybrid'
  });
}

module.exports = { treeHybrid, oneTreeSeed, walkTree };
