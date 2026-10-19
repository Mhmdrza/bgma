#!/usr/bin/env node
/* bench_dataset.js -- greedy vs beam+tunnel vs the nature solver, on a CSV dataset.
 *
 * Dataset columns (as provided):
 *   instance_id, num_cities, city_coordinates, distance_matrix, best_route, total_distance
 * Scores use the supplied distance_matrix; total_distance is the reference.
 *
 * Both solvers are extracted from the project files, not re-implemented:
 *   nature  <- nature_tsp.html (everything before the drawing section)
 *   beam    <- beam_fast.js    (everything before the harness section)
 *
 * usage:
 *   node bench/bench_dataset.js --per-n=3
 *   node bench/bench_dataset.js --per-n=0            # all instances
 *   node bench/bench_dataset.js --out=results.csv
 *   node bench/bench_dataset.js --exact=1 --max-n=22
 */
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const readline = require('readline');

const CFG = {
  file: path.join(os.homedir(), 'Downloads', 'tsp_dataset.csv'),
  'per-n': 3, limit: 0, 'min-n': 20, 'max-n': 100,
  M: 48, iters: 0, exact: 0, out: '', seed: 1
};
const STRING_FLAGS = new Set(['file', 'out']);
process.argv.slice(2).forEach(a => {
  const m = /^--([a-z-]+)=(.*)$/.exec(a);
  if (!m || !(m[1] in CFG)) throw new Error('bad flag: ' + a);
  CFG[m[1]] = STRING_FLAGS.has(m[1]) ? m[2] : (m[2] === 'auto' ? 0 : +m[2]);
});
const FILE = CFG.file, PER_N = CFG['per-n'], LIMIT = CFG.limit;
const MIN_N = CFG['min-n'], MAX_N = CFG['max-n'], M = CFG.M;
const FIXED_ITERS = CFG.iters, EXACT = CFG.exact;

/* ------------------------- load the two solvers ------------------------- */

function sliceFile(file, marker) {
  const txt = fs.readFileSync(file, 'utf8');
  const cut = txt.indexOf(marker);
  if (cut < 0) throw new Error('marker not found in ' + file + ': ' + marker);
  const start = txt.indexOf('<script>') >= 0 && txt.indexOf('<script>') < cut
    ? txt.indexOf('<script>') + '<script>'.length : 0;
  return txt.slice(start, cut);
}

const core = sliceFile(path.join(__dirname, '..', 'web', 'nature_tsp.html'), '/* ============================== drawing');
const N = eval(core + ';({makePoints,distRows,nearestOrder,makeNear,farthestPair,popWave,anneal,ox,' +
  'heldKarp,hkBound,tourLength,rng,setRand:(fn)=>{rand=fn;}})');

const beamCore = fs.readFileSync(path.join(__dirname, '..', 'src', 'beam', 'beam_fast.js'), 'utf8')
  .split('/* ================================= harness')[0]
  .replace('process.argv.slice(2)', '[]');      // beam_fast's own CLI must not see our flags
const B = eval(beamCore + ';({beamFast,refineFast,KN})');

/* -------------------------------- parsing -------------------------------- */

function firstFour(line) {
  const fields = [];
  let cur = '', inQ = false;
  for (let i = 0; i < line.length && fields.length < 4; i++) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') inQ = false;
      else cur += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ',') { fields.push(cur); cur = ''; }
    else cur += ch;
  }
  fields.push(cur);
  return fields;
}
const refOf = line => parseFloat(line.slice(line.lastIndexOf(',') + 1));

/* -------------------------------- solvers -------------------------------- */

function greedyRun(D, order, poles) {
  const t0 = process.hrtime.bigint();
  const n = D.length, seen = new Uint8Array(n), tour = [poles[0]];
  seen[poles[0]] = 1;
  while (tour.length < n) {
    let c = -1;
    for (const x of order[tour[tour.length - 1]]) if (!seen[x]) { c = x; break; }
    tour.push(c); seen[c] = 1;
  }
  return { len: N.tourLength(D, tour), ms: Number(process.hrtime.bigint() - t0) / 1e6 };
}

function makeInst(D, order, poles, n) {
  const flat = new Float64Array(n * n);
  const orderFlat = new Int32Array(n * (n - 1));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) flat[i * n + j] = D[i][j];
    for (let j = 0; j < n - 1; j++) orderFlat[i * (n - 1) + j] = order[i][j];
  }
  const kn = Math.min(10, n - 1);
  return { n, D: flat, orderFlat, fp: poles, near: N.makeNear(D, order, kn), kn };
}

function beamRun(inst) {
  const t0 = process.hrtime.bigint();
  const finals = B.beamFast(inst, 16).finals;
  let best = Infinity;
  for (const f of finals) {
    const r = B.refineFast(inst.D, f.t, inst.near, inst.kn, inst.n, false);
    if (r.len < best) best = r.len;
  }
  return { len: best, ms: Number(process.hrtime.bigint() - t0) / 1e6, finals: finals.length };
}

function natureRun(D, n, order, poles) {
  const t0 = process.hrtime.bigint();
  const kn = Math.min(10, n - 1);
  const near = N.makeNear(D, order, kn);
  const iters = FIXED_ITERS || Math.min(120000, 1500 + 45 * n * n);
  const T0 = Math.max(1, 0.03 * n);

  const pop = N.popWave(D, order, poles, M);
  const uniq = [], seen = new Set();
  let popBest = Infinity;
  for (const st of pop) {
    const full = st.len + D[st.t[n - 1]][st.start];
    if (full < popBest) popBest = full;
    const k = st.t.join(',');
    if (seen.has(k)) continue;
    seen.add(k);
    uniq.push(st);
  }
  uniq.sort((a, b) => (a.len + D[a.t[n - 1]][a.start]) - (b.len + D[b.t[n - 1]][b.start]));

  const annealed = [];
  for (const st of uniq.slice(0, 8)) annealed.push(N.anneal(D, st.t, n, iters, T0, near, kn));
  const m = Math.min(4, uniq.length);
  if (m > 1) {
    for (let q = 0; q < 6; q++) {
      const A = uniq[q % m].t, Bb = uniq[(q + 1) % m].t;
      annealed.push(N.anneal(D, N.ox(A, Bb), n, iters, T0, near, kn));
    }
  }
  annealed.sort((a, b) => a.len - b.len);
  return { len: annealed[0].len, ms: Number(process.hrtime.bigint() - t0) / 1e6, popBest };
}

/* ------------------------------ pass 1: index ------------------------------ */

async function indexFile() {
  const byN = new Map();
  let total = 0;
  const rl = readline.createInterface({ input: fs.createReadStream(FILE), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line || line.startsWith('instance_id')) continue;
    const a = line.indexOf(','), b = line.indexOf(',', a + 1);
    if (a < 0 || b < 0) continue;
    const id = +line.slice(0, a), n = +line.slice(a + 1, b);
    if (!isFinite(id) || !isFinite(n) || n < MIN_N || n > MAX_N) continue;
    total++;
    if (!byN.has(n)) byN.set(n, []);
    byN.get(n).push(id);
  }
  return { byN, total };
}

function choose(byN) {
  const chosen = new Map();
  for (const [n, ids] of [...byN.entries()].sort((a, b) => a[0] - b[0])) {
    const k = PER_N === 0 ? ids.length : Math.min(PER_N, ids.length);
    const pick = new Set();
    for (let i = 0; i < k; i++) pick.add(ids[Math.floor(i * ids.length / k)]);
    chosen.set(n, pick);
  }
  return chosen;
}

/* --------------------------------- harness -------------------------------- */

const med = a => a.slice().sort((x, y) => x - y)[a.length >> 1];
const mean = a => a.reduce((s, x) => s + x, 0) / a.length;
const padL = (s, w) => { s = String(s); while (s.length < w) s = ' ' + s; return s; };
const padR = (s, w) => { s = String(s); while (s.length < w) s = s + ' '; return s; };
const pct = x => (x >= 0 ? '+' : '') + x.toFixed(2) + '%';

async function main() {
  const tStart = Date.now();
  const { byN, total } = await indexFile();
  const chosen = choose(byN);
  let todo = 0;
  for (const ids of chosen.values()) todo += ids.size;
  if (LIMIT > 0) todo = Math.min(todo, LIMIT);

  console.log('');
  console.log('bench_dataset  ' + FILE);
  console.log('  ' + total + ' instances (n=' + MIN_N + '..' + MAX_N + '), sampling ' + PER_N +
    '/size -> ' + todo + ' runs, M=' + M + ', iters=' + (FIXED_ITERS || 'auto') +
    ', index ' + ((Date.now() - tStart) / 1000).toFixed(1) + 's');
  console.log('');
  console.log(padL('id', 6) + padL('n', 4) + padL('route', 10) + padL('greedy', 10) + padL('beam+tun', 10) +
    padL('nature', 10) + padL('g%', 7) + padL('b%', 7) + padL('n%', 7) +
    padL('msG', 7) + padL('msB', 8) + padL('msN', 8));
  console.log('-'.repeat(100));

  const rows = [];
  let done = 0;
  let maxMatrixDelta = 0, euclidChecked = 0;

  const rl = readline.createInterface({ input: fs.createReadStream(FILE), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line || line.startsWith('instance_id')) continue;
    const a = line.indexOf(','), b = line.indexOf(',', a + 1);
    if (a < 0 || b < 0) continue;
    const id = +line.slice(0, a), n = +line.slice(a + 1, b);
    const pick = chosen.get(n);
    if (!pick || !pick.has(id)) continue;
    if (LIMIT > 0 && done >= LIMIT) break;

    const fields = firstFour(line);
    const coords = JSON.parse(fields[2]);
    const matrix = JSON.parse(fields[3]);
    const ref = refOf(line);

    const D = [];
    for (let i = 0; i < n; i++) {
      const row = new Float64Array(n);
      for (let j = 0; j < n; j++) row[j] = matrix[i][j];
      D.push(row);
    }
    if (euclidChecked < 20) {
      euclidChecked++;
      let d = 0;
      for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
        const e = Math.abs(Math.hypot(coords[i][0] - coords[j][0], coords[i][1] - coords[j][1]) - matrix[i][j]);
        if (e > d) d = e;
      }
      if (d > maxMatrixDelta) maxMatrixDelta = d;
    }

    const order = N.nearestOrder(D);
    const poles = N.farthestPair(D);
    const inst = makeInst(D, order, poles, n);

    N.setRand(N.rng(CFG.seed * 7919 + id * 104729 + n));
    const g = greedyRun(D, order, poles);
    const bm = beamRun(inst);
    N.setRand(N.rng(CFG.seed * 7919 + id * 104729 + n));   // same random stream for nature
    const nt = natureRun(D, n, order, poles);

    const exact = (EXACT && n <= 22) ? N.heldKarp(D).len : null;
    const lb = N.hkBound(D, Math.min(g.len, bm.len, nt.len), 300);
    const gG = (g.len / ref - 1) * 100, gB = (bm.len / ref - 1) * 100, gN = (nt.len / ref - 1) * 100;
    done++;
    rows.push({ id, n, ref, lb, g: g.len, b: bm.len, t: nt.len, pop: nt.popBest,
                gG, gB, gN, msG: g.ms, msB: bm.ms, msN: nt.ms, exact });

    console.log(padL(id, 6) + padL(n, 4) + padL(ref.toFixed(2), 10) + padL(g.len.toFixed(2), 10) +
      padL(bm.len.toFixed(2), 10) + padL(nt.len.toFixed(2), 10) +
      padL(pct(gG), 7) + padL(pct(gB), 7) + padL(pct(gN), 7) +
      padL(g.ms.toFixed(1), 7) + padL(bm.ms.toFixed(1), 8) + padL(nt.ms.toFixed(0), 8));
  }

  /* -------------------------------- summary -------------------------------- */
  const cols = [
    ['greedy', r => r.g, r => r.msG],
    ['beam + tunnel', r => r.b, r => r.msB],
    ['nature', r => r.t, r => r.msN]
  ];
  console.log('');
  console.log('='.repeat(100));
  console.log('SUMMARY   ' + rows.length + ' instances   n=' + MIN_N + '..' + MAX_N +
    '   total ' + ((Date.now() - tStart) / 1000).toFixed(1) + 's');
  console.log('');
  console.log(padR('method', 16) + padL('vs route', 10) + padL('vs bound', 10) +
    padL('worst vs bound', 16) + padL('median ms', 11) + padL('worst ms', 10));
  for (const [name, lf, mf] of cols) {
    const vsRoute = rows.map(r => (lf(r) / r.ref - 1) * 100);
    const vsLb = rows.map(r => (lf(r) / r.lb - 1) * 100);
    const ms = rows.map(mf);
    console.log(padR(name, 16) + padL(pct(med(vsRoute)), 10) + padL(pct(med(vsLb)), 10) +
      padL(pct(Math.max(...vsLb)), 16) + padL(med(ms).toFixed(1), 11) +
      padL(Math.max(...ms).toFixed(1), 10));
  }
  console.log(padR('nature (pre-tunnel)', 16) +
    padL(pct(med(rows.map(r => (r.pop / r.ref - 1) * 100))), 10) +
    padL(pct(med(rows.map(r => (r.pop / r.lb - 1) * 100))), 10));

  console.log('');
  console.log('wins (within 1e-6 of the best of the three):');
  for (const [name, lf] of cols) {
    const w = rows.filter(r => Math.abs(lf(r) - Math.min(r.g, r.b, r.t)) < 1e-6).length;
    console.log('  ' + padR(name, 16) + padL(w + '/' + rows.length, 8));
  }
  const rel = rows.map(r => (r.t / r.b - 1) * 100);
  console.log('  nature vs beam+tunnel: median ' + pct(med(rel)) +
    ', worst ' + pct(Math.max(...rel)) + ' (negative = nature shorter)');

  console.log('');
  console.log('note: total_distance is the cost of the dataset\'s stored route');
  console.log('      (within a few % of simply visiting cities in file order), not an optimum.');
  console.log('      "vs bound" is against a 1-tree lower bound, so it brackets the true gap.');

  const buckets = [[20, 29], [30, 39], [40, 49], [50, 59], [60, 69], [70, 79], [80, 89], [90, 100]];
  console.log('');
  console.log(padR('n', 8) + padL('runs', 6) + padL('greedy', 9) + padL('beam+tun', 10) +
    padL('nature', 9) + padL('msG', 8) + padL('msB', 8) + padL('msN', 8));
  for (const [lo, hi] of buckets) {
    const rs = rows.filter(r => r.n >= lo && r.n <= hi);
    if (!rs.length) continue;
    console.log(padR(lo + '-' + hi, 8) + padL(rs.length, 6) +
      padL(pct(med(rs.map(r => r.gG))), 9) + padL(pct(med(rs.map(r => r.gB))), 10) +
      padL(pct(med(rs.map(r => r.gN))), 9) +
      padL(med(rs.map(r => r.msG)).toFixed(2), 8) +
      padL(med(rs.map(r => r.msB)).toFixed(2), 8) +
      padL(med(rs.map(r => r.msN)).toFixed(0), 8));
  }

  if (maxMatrixDelta > 1e-6) {
    console.log('');
    console.log('note: supplied matrix differs from Euclidean distance on the coordinates');
    console.log('      (max |delta| ' + maxMatrixDelta.toFixed(4) + ' over 20 sampled instances);');
    console.log('      the bench scores with the matrix, as total_distance does.');
  }

  if (EXACT) {
    const v = rows.filter(r => r.exact !== null);
    if (v.length) {
      console.log('');
      console.log('EXACT CHECK (Held-Karp, n<=22): reference matches exact on ' +
        v.filter(r => Math.abs(r.exact - r.ref) < 1e-6).length + '/' + v.length +
        '; nature is exact on ' + v.filter(r => Math.abs(r.exact - r.t) < 1e-6).length + '/' + v.length);
    }
  }

  if (CFG.out) {
    const out = ['instance_id,n,reference,greedy,beam_tunnel,nature,gap_greedy,gap_beam,gap_nature,ms_greedy,ms_beam,ms_nature'];
    for (const r of rows) {
      out.push([r.id, r.n, r.ref.toFixed(6), r.g.toFixed(6), r.b.toFixed(6), r.t.toFixed(6),
        r.gG.toFixed(3), r.gB.toFixed(3), r.gN.toFixed(3),
        r.msG.toFixed(2), r.msB.toFixed(2), r.msN.toFixed(1)].join(','));
    }
    fs.writeFileSync(CFG.out, out.join('\n') + '\n');
    console.log('\n  wrote ' + rows.length + ' rows to ' + CFG.out);
  }
  console.log('');
}

main().catch(e => { console.error(e); process.exit(1); });
