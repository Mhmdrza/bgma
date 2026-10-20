'use strict';
/* instance.js -- shared instance builders.
 *
 * `buildFromPoints` turns an explicit point set into the `base` object that the
 * beam/tunnel code expects (D, rows, neighbour lists, farthest pair). It is used
 * by the stress harness for families whose optimum is known by construction, and
 * by the worker-thread runner, which must rebuild the same instance on every
 * thread without shipping an 8 MB distance matrix through postMessage.
 */

function buildFromPoints(pts, opts) {
  /* TSPLIB EUC_2D declares distances as nint(sqrt(dx^2 + dy^2)), i.e. rounded to
   * the nearest integer. Comparing against a published optimum requires exactly
   * that objective, so `opts.round` rounds each entry before anything else sees
   * it (neighbour lists included). */
  const rnd = !!(opts && opts.round);
  const n = pts.length, D = new Float64Array(n * n), rows = [];
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    const d = i === j ? 0 : Math.hypot(pts[i][0] - pts[j][0], pts[i][1] - pts[j][1]);
    D[i * n + j] = rnd ? Math.floor(d + 0.5) : d;
  }
  for (let i = 0; i < n; i++) rows.push(D.subarray(i * n, (i + 1) * n));
  const order = [], orderFlat = new Int32Array(n * (n - 1));
  for (let i = 0; i < n; i++) {
    const idx = [];
    for (let j = 0; j < n; j++) if (j !== i) idx.push(j);
    idx.sort((a, b) => rows[i][a] - rows[i][b]);
    order.push(idx);
    for (let j = 0; j < n - 1; j++) orderFlat[i * (n - 1) + j] = idx[j];
  }
  const kn = Math.min(Math.max(10, Math.round(n / 10)), n - 1);
  const near = new Int32Array(n * kn);
  for (let i = 0; i < n; i++) for (let j = 0; j < kn; j++) near[i * kn + j] = order[i][j];
  let best = -1, p = 0, q = 1;
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++)
    if (D[i * n + j] > best) { best = D[i * n + j]; p = i; q = j; }
  return { D, rows, order, orderFlat, near, kn, fp: [p, q], n };
}

/* Rebuild the instance a worker was asked for. `spec.points` wins; otherwise the
 * deterministic synthetic builder is used with the same arguments the parent used. */
function instanceFromSpec(B, spec) {
  if (spec.points) {
    const inst = buildFromPoints(spec.points, spec);
    inst.base = inst;
    return inst;
  }
  const inst = B.buildInstance(spec.n, spec.seed, spec.kind, spec.nearK);
  inst.seed = spec.seed;
  inst.kind = spec.kind;
  inst.base = inst;          // reuse it as the base: never rebuild with lost args
  return inst;
}

module.exports = { buildFromPoints, instanceFromSpec };
