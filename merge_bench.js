#!/usr/bin/env node
/* merge_bench.js -- does "mix the wave, then contract" beat "tunnel each tour, pick the best"?
 *
 * Methods compared on identical instances:
 *   greedy            nearest-neighbour, no tunnel
 *   beam              the page's wave, every surviving tour tunnelled, best kept
 *   beam + mix(raw)   the wave's raw finals -> edge consensus -> one tour -> tunnel
 *   beam + mix(locals) same, but merging the *tunnelled* finals (classic tour-merging input)
 *   random best       16 random starts -> greedy -> tunnel each -> best
 *   random + mix      16 tunnelled locals -> edge consensus -> one tour -> tunnel
 *
 * The mixing operator is edge voting + greedy assembly:
 *   weight(i,j) = how many input tours use edge (i,j)
 *   add edges heaviest-first subject to degree <= 2 and no premature subtour
 *   repair the loose ends by nearest distance, close the cycle, then tunnel.
 *
 * usage: node merge_bench.js --n=200 --seeds=6 --K=16 [--exact=1]
 *
 * Reuses the implementations from beam_fast.js (same directory) instead of copying them.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const CFG = { n: 200, seeds: 6, K: 16, exact: 0 };
process.argv.slice(2).forEach(a => {
  const m = /^--([a-z]+)=(.*)$/.exec(a);
  if (!m || !(m[1] in CFG)) throw new Error('bad flag: ' + a);
  CFG[m[1]] = +m[2];
});
const N = CFG.n, SEEDS = CFG.seeds, K = CFG.K, EXACT = !!CFG.exact;

/* ---- pull the algorithms in (the harness section of beam_fast.js is stripped) ---- */
const core = fs.readFileSync(path.join(__dirname, 'beam_fast.js'), 'utf8')
  .split('/* ================================= harness')[0];
eval(core + ';globalThis.TSP={buildInstance,beamFast,refineFast,greedy,tourLenFlat,tourLenRows,heldKarp,checkTour,KN};');
const TSP = globalThis.TSP;
const { buildInstance, beamFast, refineFast, greedy, tourLenFlat, tourLenRows, heldKarp, checkTour, KN } = TSP;

/* ============================ mixing operator ============================ */

function assemble(D, tours, n) {
  const w = new Float64Array(n * n);
  for (const t of tours) {
    if (!t || t.length !== n) continue;
    for (let i = 0; i < n; i++) {
      const a = t[i], b = t[(i + 1) % n];
      w[a * n + b] += 1;
      w[b * n + a] += 1;
    }
  }

  const list = [];
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    const x = w[i * n + j];
    if (x > 0) list.push([i, j, x]);
  }
  list.sort((p, q) => q[2] - p[2]);

  const deg = new Int32Array(n);
  const parent = new Int32Array(n);
  const adj = Array.from({ length: n }, () => []);
  for (let i = 0; i < n; i++) parent[i] = i;
  const find = x => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };

  let count = 0;
  for (const [i, j] of list) {
    if (deg[i] >= 2 || deg[j] >= 2) continue;
    if (find(i) === find(j) && count < n - 1) continue;
    adj[i].push(j); adj[j].push(i); deg[i]++; deg[j]++;
    parent[find(i)] = find(j);
    if (++count === n - 1) break;
  }

  for (let guard = 0; guard < 2 * n; guard++) {
    let bi = -1, bj = -1, bd = Infinity;
    for (let i = 0; i < n; i++) {
      if (deg[i] >= 2) continue;
      for (let j = i + 1; j < n; j++) {
        if (deg[j] >= 2) continue;
        if (find(i) === find(j) && count < n - 1) continue;
        if (D[i][j] < bd) { bd = D[i][j]; bi = i; bj = j; }
      }
    }
    if (bi < 0) break;
    adj[bi].push(bj); adj[bj].push(bi); deg[bi]++; deg[bj]++;
    parent[find(bi)] = find(bj);
    count++;
  }

  const tour = [0];
  let prev = -1, cur = 0;
  for (let k = 1; k < n; k++) {
    const nb = adj[cur];
    const nxt = nb[0] === prev ? nb[1] : nb[0];
    if (nxt === undefined || nxt === 0) return null;
    tour.push(nxt); prev = cur; cur = nxt;
  }
  return checkTour(tour, n) ? tour : null;
}

/* ================================ harness ================================= */

function clock(fn) {
  const t0 = process.hrtime.bigint();
  const v = fn();
  return [Number(process.hrtime.bigint() - t0) / 1e6, v];
}
const med = a => a.slice().sort((x, y) => x - y)[a.length >> 1];
const padL = (s, w) => { s = String(s); while (s.length < w) s = ' ' + s; return s; };
const padR = (s, w) => { s = String(s); while (s.length < w) s = s + ' '; return s; };
const pcent = x => (x >= 0 ? '+' : '') + x.toFixed(2) + '%';

const rows = [];
let bad = 0;

console.log('');
console.log('merge_bench   n=' + N + '  seeds=' + SEEDS + '/family  K=' + K + '  near=' + KN +
            '  reference=' + (EXACT && N <= 22 ? 'heldKarp (exact)' : 'best of all methods'));
console.log('');

for (let s = 1; s <= SEEDS; s++) {
  for (const kind of ['uniform', 'cluster']) {
    const inst = buildInstance(N, s, kind), n = inst.n;

    /* greedy */
    const gRes = clock(() => greedy(inst, inst.fp[0]));
    const gLen = tourLenRows(inst.rows, gRes[1]);

    /* beam, and every final tunnelled */
    const bRes = clock(() => beamFast(inst, K));
    const finals = bRes[1].finals;

    const locRes = clock(() => finals.map(f => refineFast(inst.D, f.t, inst.near, KN, n, false)));
    const locals = locRes[1];
    let beamBest = Infinity;
    for (const r of locals) beamBest = Math.min(beamBest, r.len);

    /* mix raw finals, then tunnel */
    const mrRes = clock(() => {
      const t = assemble(inst.rows, finals.map(f => f.t), n);
      return t ? refineFast(inst.D, t, inst.near, KN, n, false) : null;
    });
    const mergeRaw = mrRes[1] ? mrRes[1].len : Infinity;

    /* mix tunnelled finals, then tunnel again */
    const mlRes = clock(() => {
      const t = assemble(inst.rows, locals.map(r => r.tour), n);
      return t ? refineFast(inst.D, t, inst.near, KN, n, false) : null;
    });
    const mergeLoc = mlRes[1] ? mlRes[1].len : Infinity;

    /* 16 random starts, tunnelled, and their merge */
    const rndRes = clock(() => {
      const out = [];
      for (let q = 0; q < 16; q++) {
        const t = greedy(inst, (q * 2654435761 >>> 0) % n);
        out.push(refineFast(inst.D, t, inst.near, KN, n, false));
      }
      return out;
    });
    const rnd = rndRes[1];
    let rndBest = Infinity;
    for (const r of rnd) rndBest = Math.min(rndBest, r.len);

    const rmRes = clock(() => {
      const t = assemble(inst.rows, rnd.map(r => r.tour), n);
      return t ? refineFast(inst.D, t, inst.near, KN, n, false) : null;
    });
    const rndMerge = rmRes[1] ? rmRes[1].len : Infinity;

    const opt = (EXACT && N <= 22) ? heldKarp(inst).len
              : Math.min(gLen, beamBest, mergeRaw, mergeLoc, rndBest, rndMerge);

    const tBeam = bRes[0], tLoc = locRes[0], tMR = mrRes[0], tML = mlRes[0], tRnd = rndRes[0], tRM = rmRes[0];

    rows.push({ kind, gLen, beamBest, mergeRaw, mergeLoc, rndBest, rndMerge, opt,
                tBeam, tLoc, tMR, tML, tRnd, tRM,
                totBeam: tBeam + tLoc, totMergeRaw: tBeam + tMR,
                totMergeLoc: tBeam + tLoc + tML, totRand: tRnd, totRandMix: tRnd + tRM });

    const tick = (v) => (v === Infinity ? '  --  ' : v.toFixed(1));
    console.log(padL(rows.length, 3) + padR(kind, 9) +
      padL(gLen.toFixed(1), 9) + padL(tick(beamBest), 9) + padL(tick(mergeRaw), 9) +
      padL(tick(mergeLoc), 9) + padL(tick(rndBest), 9) + padL(tick(rndMerge), 9) +
      padL(opt.toFixed(1), 9) +
      padL(((beamBest / opt - 1) * 100).toFixed(2), 8) +
      padL(((mergeLoc / opt - 1) * 100).toFixed(2), 8) +
      padL(((rndBest / opt - 1) * 100).toFixed(2), 8) +
      padL(((rndMerge / opt - 1) * 100).toFixed(2), 8));
  }
}

const key = ['gLen', 'beamBest', 'mergeRaw', 'mergeLoc', 'rndBest', 'rndMerge'];
const label = ['greedy', 'beam + tunnel', 'beam mix(raw) + tunnel', 'beam mix(locals) + tunnel',
               '16 random + tunnel', '16 random mix + tunnel'];
const tkey = [null, 'totBeam', 'totMergeRaw', 'totMergeLoc', 'totRand', 'totRandMix'];

console.log('');
console.log('--------------------------------------------------------------------------------------------------');
console.log('SUMMARY   n=' + N + '  instances=' + rows.length + '   (median tour length, then median time)');
console.log('');
for (let i = 0; i < key.length; i++) {
  const v = med(rows.map(r => r[key[i]]).filter(x => isFinite(x)));
  const t = tkey[i] ? med(rows.map(r => r[tkey[i]])) : null;
  const vsOpt = ((v / med(rows.map(r => r.opt)) - 1) * 100);
  const wins = rows.filter(r => r[key[i]] === Math.min(r.gLen, r.beamBest, r.mergeRaw, r.mergeLoc, r.rndBest, r.rndMerge)).length;
  console.log(padR(label[i], 24) + padL(v.toFixed(1), 10) + padL(pcent(vsOpt), 9) +
              padL(wins + '/' + rows.length, 8) + padL(t === null ? '-' : t.toFixed(2) + ' ms', 11));
}

const mb = med(rows.map(r => r.beamBest));
const mr = med(rows.map(r => r.mergeRaw));
const ml = med(rows.map(r => r.mergeLoc));
const rb = med(rows.map(r => r.rndBest));
const rm = med(rows.map(r => r.rndMerge));

console.log('');
console.log('mixing vs picking the best parent');
console.log('  beam finals (raw)      ' + pcent((mr / mb - 1) * 100) + '   (' + mb.toFixed(1) + ' -> ' + mr.toFixed(1) + ')');
console.log('  beam finals (tunnelled)' + pcent((ml / mb - 1) * 100) + '   (' + mb.toFixed(1) + ' -> ' + ml.toFixed(1) + ')');
console.log('  random locals          ' + pcent((rm / rb - 1) * 100) + '   (' + rb.toFixed(1) + ' -> ' + rm.toFixed(1) + ')');
console.log('');
console.log('beam vs 16 random starts: ' + pcent((rb / mb - 1) * 100) + ' (positive = random starts are better)');
console.log('');
