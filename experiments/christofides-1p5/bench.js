'use strict';
/* christofides-1p5/bench.js -- instances that push Christofides into its 3/2 band,
 * and what BGMA mid does on them, n=10..200.
 *
 * Every family here is a metric closure of a unit-edge graph, so the optimum is
 * known without solving: all distances are >= 1, hence OPT >= n, and a
 * Hamiltonian cycle of unit edges gives OPT <= n. OPT = n exactly.
 *
 *   two-cluster  K_{a,b}, a = floor(n/2), b = ceil(n/2): 1 across the cut, 2 inside
 *                a side. Not Euclidean. Christofides ends at 1.5n - 2 = W + M.
 *   ladder       the 2 x (n/2) unit grid strip (Euclidean). Reaches the same
 *                number only for the row-major labelling: the MST is picked out
 *                of unit-weight ties, so `--perms` reports the spread.
 *
 * Run: node experiments/christofides-1p5/bench.js [--max=200] [--step=10] [--perms=8]
 */

const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const { christofides, minWeightPerfectMatching } = require(ROOT + '/src/christofides/christofides.js');
const { heldKarp, tourLen } = require(ROOT + '/src/hybrid/hybrid_vis.js');
const { runEffort } = require(ROOT + '/src/hybrid/bgma.js');
const { buildFromRows } = require(ROOT + '/src/hybrid/instance.js');

const argv = Object.fromEntries(process.argv.slice(2).map(s => {
  const m = /^--([^=]+)=?(.*)$/.exec(s);
  return m ? [m[1], m[2] === '' ? true : m[2]] : [s, true];
}));
const MAX = Number(argv.max) || 200;
const STEP = Number(argv.step) || 10;
const PERMS = Number(argv.perms) || 8;

/* ------------------------------ instances ------------------------------- */

function twoCluster(n) {
  const cut = Math.floor(n / 2), M = [];
  for (let i = 0; i < n; i++) {
    const row = new Float64Array(n);
    for (let j = 0; j < n; j++) row[j] = i === j ? 0 : ((i < cut) === (j < cut) ? 2 : 1);
    M.push(row);
  }
  return M;
}

/* Euclidean 2 x k strip, laid out row-major (the labelling the stress harness uses). */
function ladder(n) {
  const k = Math.ceil(n / 2), pts = [];
  for (let y = 0; y < 2; y++) for (let x = 0; x < k; x++) pts.push([x, y]);
  return pts.slice(0, n).map(a => Float64Array.from(pts.slice(0, n).map(b => Math.hypot(a[0] - b[0], a[1] - b[1]))));
}

const FAMILIES = [
  { id: 'two-cluster', gen: twoCluster },
  { id: 'ladder', gen: ladder }
];

/* ------------------------------- helpers -------------------------------- */

function rng(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* Relabel the cities (a metric property, not a tour property). seed 0 = identity. */
function relabel(M, seed) {
  const n = M.length;
  if (!seed) return M;
  const R = rng(seed), p = [...Array(n).keys()];
  for (let i = n - 1; i > 0; i--) { const j = Math.floor(R() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; }
  return p.map(i => Float64Array.from(p.map(j => M[i][j])));
}

function makeInst(M) {
  const inst = buildFromRows(M);
  inst.base = inst;                     // runEffort must reuse this instance
  inst.seed = 1;
  inst.kind = 'custom';
  return inst;
}

/* MST weight, odd-degree count, min perfect matching weight. */
function structure(M) {
  const n = M.length;
  const inT = new Uint8Array(n), key = new Float64Array(n).fill(Infinity);
  const par = new Int32Array(n).fill(-1), deg = new Int32Array(n);
  key[0] = 0;
  let W = 0;
  for (let s = 0; s < n; s++) {
    let v = -1;
    for (let i = 0; i < n; i++) if (!inT[i] && (v < 0 || key[i] < key[v])) v = i;
    inT[v] = 1; W += key[v];
    if (par[v] >= 0) { deg[v]++; deg[par[v]]++; }
    for (let j = 0; j < n; j++) if (!inT[j] && M[v][j] < key[j]) { key[j] = M[v][j]; par[j] = v; }
  }
  const odd = [];
  for (let i = 0; i < n; i++) if (deg[i] % 2) odd.push(i);
  let Mw = 0;
  if (odd.length) for (const [a, b] of minWeightPerfectMatching(M, odd)) Mw += M[a][b];
  return { W, Mw, odd: odd.length };
}

const ms = t0 => Number(process.hrtime.bigint() - t0) / 1e6;
const mean = a => a.reduce((x, y) => x + y, 0) / a.length;

/* -------------------------------- run ----------------------------------- */

const rows = [];
for (let n = STEP; n <= MAX; n += STEP) {
  for (const fam of FAMILIES) {
    const base = fam.gen(n);
    const hk = n <= 18 ? heldKarp(base).len : null;      // OPT claim, verified where cheap
    if (hk !== null && hk !== n) throw new Error('OPT claim broken: ' + fam.id + ' n=' + n + ' HK=' + hk);

    const ctR = [], midR = [], ctT = [], midT = [];
    let st = null;
    for (let s = 0; s < PERMS; s++) {
      const M = relabel(base, s);
      if (s === 0) st = structure(M);
      const t0 = process.hrtime.bigint();
      ctR.push(tourLen(M, christofides(M, n)) / n);
      ctT.push(ms(t0));
      const t1 = process.hrtime.bigint();
      midR.push(runEffort(makeInst(M), 1, 'mid').len / n);
      midT.push(ms(t1));
    }
    rows.push({ n, n0: n, family: fam.id, opt: n, perms: PERMS,
      ct: mean(ctR), ctMax: Math.max(...ctR), ctMs: mean(ctT),
      mid: mean(midR), midMax: Math.max(...midR), midMs: mean(midT),
      mst: st.W, odd: st.odd, match: st.Mw });
  }
}

/* -------------------------------- output -------------------------------- */

const H = 'n,family,perms,opt,opt_proof,ct_over_opt_mean,ct_over_opt_max,ct_ms,mid_over_opt_mean,mid_over_opt_max,mid_ms,mst_over_opt,odd,match_over_opt';
const csv = [H];
for (const r of rows) csv.push([r.n, r.family, r.perms, r.opt, 'n', r.ct.toFixed(4), r.ctMax.toFixed(4),
  r.ctMs.toFixed(2), r.mid.toFixed(4), r.midMax.toFixed(4), r.midMs.toFixed(1),
  (r.mst / r.opt).toFixed(4), r.odd, (r.match / r.opt).toFixed(4)].join(','));

const t = ['family       n   CT/OPT mean   [max]    BGMA-mid mean  [max]   MST/OPT  odd  M/OPT   ms CT/mid'];
for (const r of rows) t.push(
  r.family.padEnd(12) + String(r.n).padStart(3) +
  r.ct.toFixed(4).padStart(11) + (' [' + r.ctMax.toFixed(4) + ']').padStart(11) +
  r.mid.toFixed(4).padStart(14) + (' [' + r.midMax.toFixed(4) + ']').padStart(10) +
  (r.mst / r.opt).toFixed(4).padStart(10) + String(r.odd).padStart(5) +
  (r.match / r.opt).toFixed(4).padStart(8) +
  (r.ctMs.toFixed(1) + '/' + r.midMs.toFixed(1)).padStart(15));

const text = t.join('\n');
console.log('\n' + text + '\n');
fs.writeFileSync(path.join(__dirname, 'bench_results.csv'), csv.join('\n') + '\n');
fs.writeFileSync(path.join(__dirname, 'results.txt'), text + '\n');
