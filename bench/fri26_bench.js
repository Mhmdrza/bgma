#!/usr/bin/env node
/* fri26_bench.js -- greedy / beam+tunnel / nature solver on TSPLIB fri26.
 * EDGE_WEIGHT_TYPE EXPLICIT, LOWER_DIAG_ROW. The file ships an optimal tour; known optimum 937.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const DATA = `
0
83 0
93 40 0
129 53 42 0
133 62 42 11 0
139 64 49 11 9 0
151 91 59 46 35 39 0
169 116 81 72 61 65 26 0
135 93 54 65 55 63 34 37 0
114 84 44 70 62 71 52 59 22 0
110 95 58 88 82 90 71 75 39 20 0
98 98 64 100 95 103 88 92 56 36 18 0
99 89 54 89 84 92 77 83 47 26 11 11 0
95 68 31 66 62 71 63 76 40 20 27 34 23 0
81 67 36 76 74 82 78 91 55 34 32 31 24 15 0
152 127 86 102 93 100 66 54 37 43 42 56 53 62 73 0
159 156 117 142 133 141 110 98 78 74 61 63 68 87 92 44 0
181 175 135 156 146 153 119 103 91 91 80 85 89 106 112 54 22 0
172 152 112 127 117 124 88 70 62 68 64 75 74 87 96 26 34 33 0
185 165 125 139 128 135 98 78 74 82 77 87 87 100 109 39 38 29 13 0
147 160 124 155 148 156 130 122 96 86 68 62 71 93 93 68 30 46 63 68 0
157 180 147 180 173 181 156 148 122 111 92 83 93 116 113 94 53 64 87 90 26 0
185 223 193 228 222 230 206 198 172 160 140 129 140 163 158 144 102 107 135 136 77 50 0
220 268 241 278 272 280 257 250 223 210 190 178 189 212 205 196 154 157 186 186 128 102 51 0
127 179 157 197 194 202 188 188 155 136 116 100 111 132 122 139 109 125 141 148 80 65 64 93 0
181 197 161 190 182 190 160 148 128 121 103 99 107 130 130 95 51 51 81 79 37 27 58 107 90 0
`;

const OPT_TOUR = [1,25,24,23,26,22,21,17,18,20,19,16,11,12,13,15,14,10,9,8,7,5,6,4,3,2].map(v => v - 1);

const n = 26;
const nums = DATA.trim().split(/\s+/).map(Number);
const expect = n * (n + 1) / 2;
if (nums.length !== expect) throw new Error('expected ' + expect + ' entries, got ' + nums.length);

const D = Array.from({ length: n }, () => new Float64Array(n));
let k = 0;
for (let i = 0; i < n; i++) for (let j = 0; j <= i; j++) {
  const v = nums[k++];
  D[i][j] = v; D[j][i] = v;
}
const len = t => { let s = 0; for (let i = 0; i < t.length; i++) s += D[t[i]][t[(i + 1) % t.length]]; return s; };

const html = fs.readFileSync(path.join(__dirname, '..', 'web', 'nature_tsp.html'), 'utf8');
const core = html.slice(html.indexOf('<script>') + 8, html.indexOf('/* ============================== drawing'));
const NAT = eval(core + ';({nearestOrder,makeNear,farthestPair,popWave,anneal,ox,hkBound,rng,tourLength,' +
  'setRand:(fn)=>{rand=fn;}})');
const beamCore = fs.readFileSync(path.join(__dirname, '..', 'src', 'beam', 'beam_fast.js'), 'utf8')
  .split('/* ================================= harness')[0].replace('process.argv.slice(2)', '[]');
const BM = eval(beamCore + ';({beamFast,refineFast})');

const ARG = kk => { const m = process.argv.find(a => a.startsWith('--' + kk + '=')); return m ? +m.split('=')[1] : null; };
const M = ARG('M') || 48, SEEDS = ARG('seeds') || 10;
const ITERS = ARG('iters') || Math.min(120000, 1500 + 45 * n * n);
const OPT = 937;

console.log('');
console.log('fri26   explicit LOWER_DIAG_ROW, ' + nums.length + ' entries (expected ' + expect + ')');
console.log('  tour supplied in the file: ' + len(OPT_TOUR) + '   (known optimum ' + OPT + ' -> ' +
  (len(OPT_TOUR) === OPT ? 'matches' : 'MISMATCH') + ')');
console.log('');

const order = NAT.nearestOrder(D);
const poles = NAT.farthestPair(D);
const flat = new Float64Array(n * n), orderFlat = new Int32Array(n * (n - 1));
for (let i = 0; i < n; i++) {
  for (let j = 0; j < n; j++) flat[i * n + j] = D[i][j];
  for (let j = 0; j < n - 1; j++) orderFlat[i * (n - 1) + j] = order[i][j];
}
const kn = 10, near = NAT.makeNear(D, order, kn);
const inst = { n, D: flat, orderFlat, fp: poles, near, kn };

function greedyFrom(s) {
  const seen = new Uint8Array(n), t = [s];
  seen[s] = 1;
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

t0 = process.hrtime.bigint();
const finals = BM.beamFast(inst, 16).finals;
let beamBest = Infinity;
for (const f of finals) beamBest = Math.min(beamBest, BM.refineFast(inst.D, f.t, inst.near, kn, n, false).len);
const beamMs = Number(process.hrtime.bigint() - t0) / 1e6;

const runs = [];
let totalMs = 0;
for (let seed = 1; seed <= SEEDS; seed++) {
  NAT.setRand(NAT.rng(seed * 7919 + 26 * 104729));
  const s0 = process.hrtime.bigint();
  const pop = NAT.popWave(D, order, poles, M);
  const uniq = [], seen = new Set();
  for (const st of pop) { const kk = st.t.join(','); if (seen.has(kk)) continue; seen.add(kk); uniq.push(st); }
  uniq.sort((a, b) => (a.len + D[a.t[n - 1]][a.start]) - (b.len + D[b.t[n - 1]][b.start]));
  const ann = [];
  for (const st of uniq.slice(0, 8)) ann.push(NAT.anneal(D, st.t, n, ITERS, Math.max(1, 0.03 * n), near, kn));
  const m = Math.min(4, uniq.length);
  for (let q = 0; q < 6; q++) ann.push(NAT.anneal(D, NAT.ox(uniq[q % m].t, uniq[(q + 1) % m].t), n, ITERS, Math.max(1, 0.03 * n), near, kn));
  ann.sort((a, b) => a.len - b.len);
  const ms = Number(process.hrtime.bigint() - s0) / 1e6;
  runs.push(ann[0].len);
  totalMs += ms;
  const gp = (ann[0].len / OPT - 1) * 100;
  process.stdout.write('    seed ' + String(seed).padStart(2) + ': ' + String(ann[0].len).padStart(4) +
    '  (' + (gp >= 0 ? '+' : '') + gp.toFixed(2) + '%, ' + ms.toFixed(0) + ' ms)\n');
}

const med = a => a.slice().sort((x, y) => x - y)[a.length >> 1];
const pct = x => (x >= 0 ? '+' : '') + x.toFixed(2) + '%';
const pad = (s, w) => { s = String(s); while (s.length < w) s = ' ' + s; return s; };

console.log('');
console.log('  method                    length     vs 937      time');
console.log('  greedy (pole start)      ' + pad(len(gPole), 7) + pad(pct((len(gPole) / OPT - 1) * 100), 11) + pad(gPoleMs.toFixed(2) + ' ms', 9));
console.log('  greedy (best of 26)      ' + pad(gBest, 7) + pad(pct((gBest / OPT - 1) * 100), 11) + pad(gBestMs.toFixed(2) + ' ms', 9));
console.log('  beam + tunnel (K=16)     ' + pad(beamBest, 7) + pad(pct((beamBest / OPT - 1) * 100), 11) + pad(beamMs.toFixed(1) + ' ms', 9));
console.log('  nature  best of ' + SEEDS + '      ' + pad(Math.min(...runs), 7) + pad(pct((Math.min(...runs) / OPT - 1) * 100), 11) + pad((totalMs / SEEDS).toFixed(0) + ' ms', 9));
console.log('  nature  median           ' + pad(med(runs), 7) + pad(pct((med(runs) / OPT - 1) * 100), 11));
console.log('  nature  worst            ' + pad(Math.max(...runs), 7) + pad(pct((Math.max(...runs) / OPT - 1) * 100), 11));
const lb = NAT.hkBound(D, Math.min(gBest, beamBest, ...runs), 400);
console.log('');
console.log('  1-tree lower bound       ' + lb.toFixed(0) + '   (optimum >= bound)');
console.log('');
