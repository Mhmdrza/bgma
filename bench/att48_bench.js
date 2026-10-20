#!/usr/bin/env node
/* att48_bench.js -- greedy / beam+tunnel / nature solver on TSPLIB att48.
 * ATT distance: rij = sqrt((dx^2+dy^2)/10); tij = nint(rij); d = tij<rij ? tij+1 : tij.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const XY = [
  [6734,1453],[2233,10],[5530,1424],[401,841],[3082,1644],[7608,4458],[7573,3716],[7265,1268],
  [6898,1885],[1112,2049],[5468,2606],[5989,2873],[4706,2674],[4612,2035],[6347,2683],[6107,669],
  [7611,5184],[7462,3590],[7732,4723],[5900,3561],[4483,3369],[6101,1110],[5199,2182],[1633,2809],
  [4307,2322],[675,1006],[7555,4819],[7541,3981],[3177,756],[7352,4506],[7545,2801],[3245,3305],
  [6426,3173],[4608,1198],[23,2216],[7248,3779],[7762,4595],[7392,2244],[3484,2829],[6271,2135],
  [4985,140],[1916,1569],[7280,4899],[7509,3239],[10,2676],[6807,2993],[5185,3258],[3023,1942]
];
const OPT_TOUR = [1,8,38,31,44,18,7,28,6,37,19,27,17,43,30,36,46,33,20,47,21,32,39,48,5,42,24,10,
  45,35,4,26,2,29,34,41,16,22,3,23,14,25,13,11,12,15,40,9].map(v => v - 1);

function att(a, b) {
  const dx = XY[a][0] - XY[b][0], dy = XY[a][1] - XY[b][1];
  const rij = Math.sqrt((dx * dx + dy * dy) / 10);
  const tij = Math.round(rij);
  return tij < rij ? tij + 1 : tij;
}
const n = XY.length;
const D = [];
for (let i = 0; i < n; i++) {
  const row = new Float64Array(n);
  for (let j = 0; j < n; j++) row[j] = att(i, j);
  D.push(row);
}
const len = t => { let s = 0; for (let i = 0; i < t.length; i++) s += D[t[i]][t[(i + 1) % t.length]]; return s; };

/* solvers, extracted from the project files */
const html = fs.readFileSync(path.join(__dirname, '..', 'docs', 'nature_tsp.html'), 'utf8');
const core = html.slice(html.indexOf('<script>') + 8, html.indexOf('/* ============================== drawing'));
const NAT = eval(core + ';({nearestOrder,makeNear,farthestPair,popWave,anneal,ox,hkBound,rng,tourLength,' +
  'setRand:(fn)=>{rand=fn;}})');
const beamCore = fs.readFileSync(path.join(__dirname, '..', 'src', 'beam', 'beam_fast.js'), 'utf8')
  .split('/* ================================= harness')[0].replace('process.argv.slice(2)', '[]');
const BM = eval(beamCore + ';({beamFast,refineFast})');

const order = NAT.nearestOrder(D);
const poles = NAT.farthestPair(D);
const flat = new Float64Array(n * n), orderFlat = new Int32Array(n * (n - 1));
for (let i = 0; i < n; i++) {
  for (let j = 0; j < n; j++) flat[i * n + j] = D[i][j];
  for (let j = 0; j < n - 1; j++) orderFlat[i * (n - 1) + j] = order[i][j];
}
const kn = 10;
const near = NAT.makeNear(D, order, kn);
const inst = { n, D: flat, orderFlat, fp: poles, near, kn };

const med = a => a.slice().sort((x, y) => x - y)[a.length >> 1];
const pct = x => (x >= 0 ? '+' : '') + x.toFixed(2) + '%';

console.log('');
console.log('att48  (48 US capitals, ATT distance, TSPLIB optimum 10628)');
console.log('');

/* reference tour from the file */
const optLen = len(OPT_TOUR);
console.log('  tour given in the file          ' + optLen + '   (TSPLIB optimum 10628 -> ' +
  (optLen === 10628 ? 'matches' : 'MISMATCH') + ')');

/* greedy from the pole and best of all 48 starts */
function greedyFrom(start) {
  const seen = new Uint8Array(n), t = [start];
  seen[start] = 1;
  while (t.length < n) {
    let c = -1;
    for (const x of order[t[t.length - 1]]) if (!seen[x]) { c = x; break; }
    t.push(c); seen[c] = 1;
  }
  return t;
}
let t0 = process.hrtime.bigint();
const gPole = greedyFrom(poles[0]);
const gPoleMs = Number(process.hrtime.bigint() - t0) / 1e6;
let gBest = Infinity;
t0 = process.hrtime.bigint();
for (let s = 0; s < n; s++) gBest = Math.min(gBest, len(greedyFrom(s)));
const gBestMs = Number(process.hrtime.bigint() - t0) / 1e6;

/* beam + tunnel */
t0 = process.hrtime.bigint();
const finals = BM.beamFast(inst, 16).finals;
let beamBest = Infinity;
for (const f of finals) beamBest = Math.min(beamBest, BM.refineFast(inst.D, f.t, inst.near, kn, n, false).len);
const beamMs = Number(process.hrtime.bigint() - t0) / 1e6;

/* nature, several seeds */
const ARG = k => { const m = process.argv.find(a => a.startsWith("--" + k + "=")); return m ? +m.split("=")[1] : null; };
const M = ARG("M") || 48;
const iters = ARG("iters") || Math.min(120000, 1500 + 45 * n * n);
const SEEDS = ARG("seeds") || 10;
const T0 = Math.max(1, 0.03 * n);
const runs = [];
let totalMs = 0;
for (let seed = 1; seed <= SEEDS; seed++) {
  NAT.setRand(NAT.rng(seed * 7919 + 48 * 104729));
  const s0 = process.hrtime.bigint();
  const pop = NAT.popWave(D, order, poles, M);
  const uniq = [], seen = new Set();
  for (const st of pop) { const k = st.t.join(','); if (seen.has(k)) continue; seen.add(k); uniq.push(st); }
  uniq.sort((a, b) => (a.len + D[a.t[n - 1]][a.start]) - (b.len + D[b.t[n - 1]][b.start]));
  const ann = [];
  for (const st of uniq.slice(0, 8)) ann.push(NAT.anneal(D, st.t, n, iters, T0, near, kn));
  const m = Math.min(4, uniq.length);
  for (let q = 0; q < 6; q++) ann.push(NAT.anneal(D, NAT.ox(uniq[q % m].t, uniq[(q + 1) % m].t), n, iters, T0, near, kn));
  ann.sort((a, b) => a.len - b.len);
  const ms = Number(process.hrtime.bigint() - s0) / 1e6;
  runs.push(ann[0].len);
  totalMs += ms;
  process.stdout.write('    seed ' + String(seed).padStart(2) + ': ' + ann[0].len.toFixed(0) +
    '  (' + pct((ann[0].len / 10628 - 1) * 100) + ', ' + ms.toFixed(0) + ' ms)\n');
}

const lb2 = NAT.hkBound(D, Math.min(gBest, beamBest, ...runs), 500);

console.log('');
console.log('  method                    length     vs 10628     time');
console.log('  greedy (pole start)      ' + String(len(gPole)).padStart(6) + '     ' +
  pct((len(gPole) / 10628 - 1) * 100).padStart(8) + '   ' + gPoleMs.toFixed(2) + ' ms');
console.log('  greedy (best of 48)      ' + String(gBest).padStart(6) + '     ' +
  pct((gBest / 10628 - 1) * 100).padStart(8) + '   ' + gBestMs.toFixed(2) + ' ms');
console.log('  beam + tunnel (K=16)     ' + String(beamBest).padStart(6) + '     ' +
  pct((beamBest / 10628 - 1) * 100).padStart(8) + '   ' + beamMs.toFixed(1) + ' ms');
console.log('  nature  best of 10       ' + String(Math.min(...runs)).padStart(6) + '     ' +
  pct((Math.min(...runs) / 10628 - 1) * 100).padStart(8) + '   ' + (totalMs / SEEDS).toFixed(0) + ' ms/run');
console.log('  nature  median           ' + String(med(runs)).padStart(6) + '     ' +
  pct((med(runs) / 10628 - 1) * 100).padStart(8));
console.log('  nature  worst            ' + String(Math.max(...runs)).padStart(6) + '     ' +
  pct((Math.max(...runs) / 10628 - 1) * 100).padStart(8));
console.log('');
console.log('  1-tree lower bound       ' + lb2.toFixed(0) + '   (optimum >= bound, gap of the');
console.log('                                     heuristic to the bound is an upper bound on its true gap)');
console.log('');
