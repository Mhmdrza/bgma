'use strict';
/* families.js -- instance families shared by the serial and parallel stress
 * harnesses. `familySpec` produces a serialisable description (points, or the
 * four numbers the synthetic builder needs) so a worker can rebuild the exact
 * same instance; `makeFamily` also builds it locally for the lower bound. */
const { B } = require('../src/hybrid/bgma.js');
const { instanceFromSpec } = require('../src/hybrid/instance.js');

const lcg = seed => { let s = seed >>> 0; return () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff); };

function familySpec(fam, n, seed) {
  if (fam === 'uniform' || fam === 'cluster') {
    return { kind: fam, n, seed, nearK: Math.max(10, Math.round(n / 10)) };
  }
  let pts;
  if (fam === 'convex') {            // strictly convex -> optimal tour is the hull cycle
    pts = [];
    for (let i = 0; i < n; i++) {
      const t = 2 * Math.PI * i / n;
      pts.push([100 * Math.cos(t), 62 * Math.sin(t)]);
    }
    return { points: pts, why: 'convex position: hull cycle is optimal' };
  }
  if (fam === 'line') {              // collinear -> optimal tour traverses the span twice
    pts = [];
    const r = lcg(seed * 7919 + 13);
    for (let i = 0; i < n; i++) pts.push([r() * 100, 0]);
    let lo = Infinity, hi = -Infinity;
    for (const p of pts) { lo = Math.min(lo, p[0]); hi = Math.max(hi, p[0]); }
    return { points: pts, known: 2 * (hi - lo), why: 'collinear: every gap is crossed twice' };
  }
  if (fam === 'grid') {              // integer lattice, many exact ties
    pts = [];
    const k = Math.ceil(Math.sqrt(n));
    for (let i = 0; i < n; i++) pts.push([i % k, Math.floor(i / k)]);
    return { points: pts };
  }
  if (fam === 'same') {              // every city at the same point: all distances 0
    pts = [];
    for (let i = 0; i < n; i++) pts.push([50, 50]);
    return { points: pts, known: 0, why: 'coincident cities: every tour has length 0' };
  }
  if (fam === 'fine' || fam === 'coarse') {   // uniform geometry, coordinates scaled
    const k = fam === 'fine' ? 1e-3 : 1e6;
    const r = lcg(seed * 7717 + 3);
    pts = [];
    for (let i = 0; i < n; i++) pts.push([(4 + r() * 92) * k, (4 + r() * 92) * k]);
    return { points: pts };
  }
  if (fam === 'dup') {               // half the cities coincide -> zero-length edges
    const r = lcg(seed * 104729 + 7);
    pts = [];
    for (let i = 0; i < n / 2; i++) { const p = [r() * 100, r() * 100]; pts.push(p, [p[0], p[1]]); }
    while (pts.length < n) { const p = [r() * 100, r() * 100]; pts.push(p); }
    return { points: pts.slice(0, n) };
  }
  throw new Error('unknown family: ' + fam);
}

function makeFamily(fam, n, seed) {
  const spec = familySpec(fam, n, seed);
  const inst = instanceFromSpec(B, spec);
  let known = spec.known != null ? spec.known : null;
  if (fam === 'convex') {            // exact hull-cycle length, same rows the solver sees
    known = 0;
    for (let i = 0; i < n; i++) known += inst.rows[i][(i + 1) % n];
  }
  return { inst, known, why: spec.why, spec };
}

module.exports = { lcg, familySpec, makeFamily };
