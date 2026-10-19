#!/usr/bin/env node
/* tune_knobs.js -- sweep beam+tunnel knob shapes against every heuristic in the repo.
 *
 * Reference on each instance = best result any method produced there (so the winner is 0%).
 * Runtime is reported, but ranking is by quality across sizes.
 *
 * usage:
 *   node tune_knobs.js --ns=50,100,200 --seeds=2
 *   node tune_knobs.js --ns=40,60,100,150,200,300,400 --seeds=2 --only=k4
 *   node tune_knobs.js --ns=200 --seeds=4 --out=tune.csv
 */
'use strict';
const fs = require('fs');
const path = require('path');

const CFG = { ns: '50,100,200', seeds: 2, M: 48, iters: 0, only: '', out: '' };
process.argv.slice(2).forEach(a => {
  const m = /^--([a-zA-Z]+)=(.*)$/.exec(a);
  if (!m || !(m[1] in CFG)) throw new Error('bad flag: ' + a);
  CFG[m[1]] = m[1] === 'out' || m[1] === 'ns' || m[1] === 'only' ? m[2] : +m[2];
});
const NS = CFG.ns.split(',').map(Number).filter(n => n > 3);
const SEEDS = CFG.seeds, M = CFG.M, FIXED_ITERS = CFG.iters;

/* --------------------------- load implementations ------------------------ */

const beamCore = fs.readFileSync(path.join(__dirname, 'beam_fast.js'), 'utf8')
  .split('/* ================================= harness')[0]
  .replace('process.argv.slice(2)', '[]');
const B = eval(beamCore + ';({buildInstance,beamFast,beamBase,beamFastTunnel,refineFast,refineBase,greedy,' +
  'tourLenRows,tourLenFlat,checkTour,rng})');

function sliceHtml(file, marker) {
  const txt = fs.readFileSync(file, 'utf8');
  const cut = txt.indexOf(marker);
  if (cut < 0) throw new Error('marker not found in ' + file + ': ' + marker);
  const start = txt.indexOf('<script>') >= 0 && txt.indexOf('<script>') < cut
    ? txt.indexOf('<script>') + '<script>'.length : 0;
  return txt.slice(start, cut);
}
const NAT = eval(sliceHtml(path.join(__dirname, 'nature_tsp.html'), '/* ============================== drawing') +
  ';({makeNear,popWave,anneal,ox,tourLength,setRand:fn=>{rand=fn;}})');

/* ------------------------------- configs -------------------------------- */

const rnd = (x, lo) => Math.max(lo == null ? 0 : lo, Math.round(x));
const allFinals = n => n;                       // refineF >= K for every K <= n

/* every config is a function of n, so a single rule can win at every size */
const CONFIGS = [
  { name: 'K16_near10',                  make: n => ({ K: 16, near: 10, refineF: allFinals(n) }) },
  { name: 'Kmax16,n/4_near10',           make: n => ({ K: rnd(n / 4, 16), near: 10, refineF: allFinals(n) }) },
  { name: 'Kmax16,n/4_nearmax10,n/10',   make: n => ({ K: rnd(n / 4, 16), near: rnd(n / 10, 10), refineF: allFinals(n) }) },
  { name: 'Kmax16,n/3_nearmax10,n/10',   make: n => ({ K: rnd(n / 3, 16), near: rnd(n / 10, 10), refineF: allFinals(n) }) },
  { name: 'Kmax16,n/2_nearmax10,n/10',   make: n => ({ K: rnd(n / 2, 16), near: rnd(n / 10, 10), refineF: allFinals(n) }) },
  { name: 'Kn_nearmax10,n/10',           make: n => ({ K: n, near: rnd(n / 10, 10), refineF: allFinals(n) }) },

  { name: 'Kmax16,n/4_nearmax10,n/10_parity', make: n => ({ K: rnd(n / 4, 16), near: rnd(n / 10, 10), refineF: allFinals(n), parity: 1 }) },
  { name: 'Kmax16,n/3_nearmax10,n/10_parity', make: n => ({ K: rnd(n / 3, 16), near: rnd(n / 10, 10), refineF: allFinals(n), parity: 1 }) },
  { name: 'Kmax16,n/2_nearmax10,n/10_parity', make: n => ({ K: rnd(n / 2, 16), near: rnd(n / 10, 10), refineF: allFinals(n), parity: 1 }) },

  { name: 'Kmax16,n/4_nearmax10,n/10_oropt5', make: n => ({ K: rnd(n / 4, 16), near: rnd(n / 10, 10), refineF: allFinals(n), oroptMaxL: 5 }) },
  { name: 'Kmax16,n/4_nearmax10,n/10_oropt5_parity', make: n => ({ K: rnd(n / 4, 16), near: rnd(n / 10, 10), refineF: allFinals(n), oroptMaxL: 5, parity: 1 }) },
  { name: 'Kmax16,n/4_nearmax10,n/10_branch', make: n => ({ K: rnd(n / 4, 16), near: rnd(n / 10, 10), refineF: allFinals(n), lag: 4, extraRank: 3, maxBranch: 6 }) },
  { name: 'Kmax16,n/4_nearmax10,n/10_rand4', make: n => ({ K: rnd(n / 4, 16), near: rnd(n / 10, 10), refineF: allFinals(n), starts: 'random', startCount: 4, startSeed: 1 }) },
  { name: 'Kmax16,n/4_nearmax10,n/10_passes3', make: n => ({ K: rnd(n / 4, 16), near: rnd(n / 10, 10), refineF: allFinals(n), passes: 3 }) },
  { name: 'Kmax16,n/4_nearmax10,n/5', make: n => ({ K: rnd(n / 4, 16), near: rnd(n / 5, 10), refineF: allFinals(n) }) },

  { name: 'K16_near10_scoreall',             make: n => ({ K: 16, near: 10, refineF: allFinals(n), score: 'all' }) },
  { name: 'Kmax16,n/4_nearmax10,n/10_scoreall', make: n => ({ K: rnd(n / 4, 16), near: rnd(n / 10, 10), refineF: allFinals(n), score: 'all' }) },
  { name: 'Kmax16,n/3_nearmax10,n/10_scoreall', make: n => ({ K: rnd(n / 3, 16), near: rnd(n / 10, 10), refineF: allFinals(n), score: 'all' }) },
  { name: 'Kmax16,n/2_nearmax10,n/10_scoreall', make: n => ({ K: rnd(n / 2, 16), near: rnd(n / 10, 10), refineF: allFinals(n), score: 'all' }) },
  { name: 'Kmax16,n/4_nearmax10,n/10_scoreall_parity', make: n => ({ K: rnd(n / 4, 16), near: rnd(n / 10, 10), refineF: allFinals(n), score: 'all', parity: 1 }) },

  /* mix every tunnelled final (edge vote), then tunnel the consensus tour */
  { name: 'K16_near10_merge',                    make: n => ({ K: 16, near: 10, refineF: allFinals(n), merge: 1 }) },
  { name: 'Kmax16,n/4_nearmax10,n/10_merge',     make: n => ({ K: rnd(n / 4, 16), near: rnd(n / 10, 10), refineF: allFinals(n), merge: 1 }) },
  { name: 'Kmax16,n/4_nearmax10,n/10_oropt5_parity_merge', make: n => ({ K: rnd(n / 4, 16), near: rnd(n / 10, 10), refineF: allFinals(n), oroptMaxL: 5, parity: 1, merge: 1 }) },

  /* baseline full-restart tunnel on the fast beam's finals (quality first) */
  { name: 'K16_near10_basetunnel',               make: n => ({ K: 16, near: 10, refineF: allFinals(n), basetunnel: 1, oroptMaxL: 3 }) },
  { name: 'Kmax16,n/4_nearmax10,n/10_basetunnel', make: n => ({ K: rnd(n / 4, 16), near: rnd(n / 10, 10), refineF: allFinals(n), basetunnel: 1, oroptMaxL: 3 }) },
  { name: 'Kmax16,n/4_nearmax10,n/10_oropt5_basetunnel', make: n => ({ K: rnd(n / 4, 16), near: rnd(n / 10, 10), refineF: allFinals(n), basetunnel: 1, oroptMaxL: 5 }) },
  { name: 'beamBase K16',                        make: n => ({ K: 16, near: 10, refineF: allFinals(n), refineB: allFinals(n), basebeam: 1 }) },

  /* independent beam runs from different poles, keep the best */
  { name: 'K16_near10_restart4',                 make: n => ({ K: 16, near: 10, refineF: allFinals(n), restarts: 4 }) },
  { name: 'K16_near10_restart8',                 make: n => ({ K: 16, near: 10, refineF: allFinals(n), restarts: 8 }) },
  { name: 'Kmax16,n/4_nearmax10,n/10_restart4',  make: n => ({ K: rnd(n / 4, 16), near: rnd(n / 10, 10), refineF: allFinals(n), restarts: 4 }) },
  { name: 'Kmax16,n/4_nearmax10,n/10_oropt5_parity_restart4', make: n => ({ K: rnd(n / 4, 16), near: rnd(n / 10, 10), refineF: allFinals(n), oroptMaxL: 5, parity: 1, restarts: 4 }) },
  { name: 'Kmax16,n/4_nearmax10,n/10_oropt5_parity_restart8', make: n => ({ K: rnd(n / 4, 16), near: rnd(n / 10, 10), refineF: allFinals(n), oroptMaxL: 5, parity: 1, restarts: 8 }) },
  { name: 'Kmax16,n/4_nearmax10,n/10_oropt5_parity_restart16', make: n => ({ K: rnd(n / 4, 16), near: rnd(n / 10, 10), refineF: allFinals(n), oroptMaxL: 5, parity: 1, restarts: 16 }) },
  { name: 'Kmax16,n/3_nearmax10,n/10_oropt5_parity_restart4', make: n => ({ K: rnd(n / 3, 16), near: rnd(n / 10, 10), refineF: allFinals(n), oroptMaxL: 5, parity: 1, restarts: 4 }) },
  { name: 'Kmax16,n/2_nearmax10,n/10_oropt5_parity_restart4', make: n => ({ K: rnd(n / 2, 16), near: rnd(n / 10, 10), refineF: allFinals(n), oroptMaxL: 5, parity: 1, restarts: 4 }) },
  { name: 'Kmax16,n/4_nearmax10,n/10_oropt5_parity_restart4_basetunnel', make: n => ({ K: rnd(n / 4, 16), near: rnd(n / 10, 10), refineF: allFinals(n), oroptMaxL: 5, parity: 1, restarts: 4, basetunnel: 1 }) },

  /* final candidates */
  { name: 'final_n3',         make: n => ({ K: rnd(n / 3, 16), near: rnd(n / 10, 10), refineF: allFinals(n), oroptMaxL: 5, parity: 1, restarts: 4 }) },
  { name: 'final_n4',         make: n => ({ K: rnd(n / 4, 16), near: rnd(n / 10, 10), refineF: allFinals(n), oroptMaxL: 5, parity: 1, restarts: 4 }) },
  { name: 'final_n3_basetun', make: n => ({ K: rnd(n / 3, 16), near: rnd(n / 10, 10), refineF: allFinals(n), oroptMaxL: 5, parity: 1, restarts: 4, basetunnel: 1 }) },
  { name: 'final_n3_near12',  make: n => ({ K: rnd(n / 3, 16), near: rnd(n / 10, 12), refineF: allFinals(n), oroptMaxL: 5, parity: 1, restarts: 4 }) },
  { name: 'final_n3_r8',      make: n => ({ K: rnd(n / 3, 16), near: rnd(n / 10, 10), refineF: allFinals(n), oroptMaxL: 5, parity: 1, restarts: 8 }) },

  /* the exact CLI rule, routed through beamFastTunnel itself */
  { name: 'FINAL_cli_base',   make: n => ({ K: rnd(n / 3, 16), near: rnd(n / 10, 10), refineF: n, oroptMaxL: 5, restarts: 4, tunnelMode: 'base' }) },
  { name: 'FINAL_cli_fast',   make: n => ({ K: rnd(n / 3, 16), near: rnd(n / 10, 10), refineF: n, oroptMaxL: 5, restarts: 8, parity: 1, tunnelMode: 'fast' }) }
].filter(c => !CFG.only || c.name.includes(CFG.only));

/* ------------------------------- helpers -------------------------------- */

const clock = fn => { const t0 = process.hrtime.bigint(); const v = fn(); return [Number(process.hrtime.bigint() - t0) / 1e6, v]; };
const med = a => { const b = a.slice().sort((x, y) => x - y); return b[b.length >> 1]; };
const mean = a => a.reduce((s, x) => s + x, 0) / a.length;
const mx = a => Math.max.apply(null, a);
const padL = (s, w) => { s = String(s); while (s.length < w) s = ' ' + s; return s; };
const padR = (s, w) => { s = String(s); while (s.length < w) s = s + ' '; return s; };
const pcent = x => (x >= 0 ? '+' : '') + x.toFixed(2) + '%';
const ms = x => x < 1 ? (x * 1000).toFixed(1) + 'us' : x.toFixed(1) + 'ms';

function assemble(D, tours, n) {
  const w = new Float64Array(n * n);
  for (const t of tours) {
    if (!t || t.length !== n) continue;
    for (let i = 0; i < n; i++) {
      const a = t[i], b = t[(i + 1) % n];
      w[a * n + b] += 1; w[b * n + a] += 1;
    }
  }
  const list = [];
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    const x = w[i * n + j];
    if (x > 0) list.push([i, j, x]);
  }
  list.sort((p, q) => q[2] - p[2]);
  const deg = new Int32Array(n), parent = new Int32Array(n);
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
    parent[find(bi)] = find(bj); count++;
  }
  const tour = [0];
  let prev = -1, cur = 0;
  for (let k = 1; k < n; k++) {
    const nb = adj[cur];
    const nxt = nb[0] === prev ? nb[1] : nb[0];
    if (nxt === undefined || nxt === 0) return null;
    tour.push(nxt); prev = cur; cur = nxt;
  }
  return B.checkTour(tour, n) ? tour : null;
}

/* ------------------------------ heuristics ------------------------------ */

function greedyRun(inst, start) {
  const [t, tour] = clock(() => B.greedy(inst, start));
  return { len: B.tourLenRows(inst.rows, tour), ms: t, ok: B.checkTour(tour, inst.n) };
}

function greedyBestStart(inst) {
  const [t, best] = clock(() => {
    let bl = Infinity;
    for (let s = 0; s < inst.n; s++) {
      const tour = B.greedy(inst, s);
      const l = B.tourLenRows(inst.rows, tour);
      if (l < bl) bl = l;
    }
    return bl;
  });
  return { len: best, ms: t, ok: true };
}

function natureRun(inst, seed, popOnly) {
  const n = inst.n, D = inst.rows, order = inst.order;
  NAT.setRand(B.rng((seed * 7919 + n * 104729 + (inst.kind === 'cluster' ? 17 : 0)) >>> 0));
  const kn = Math.min(10, n - 1), near = NAT.makeNear(D, order, kn);
  const iters = FIXED_ITERS || Math.min(120000, 1500 + 45 * n * n);
  const T0 = Math.max(1, 0.03 * n);

  const [t, res] = clock(() => {
    const pop = NAT.popWave(D, order, inst.fp, M);
    if (popOnly) {
      let best = null;
      for (const st of pop) {
        const full = st.len + D[st.t[n - 1]][st.start];
        if (!best || full < best.len) best = { tour: st.t, len: full };
      }
      return best;
    }
    const uniq = [], seen = new Set();
    for (const st of pop) {
      const k = st.t.join(',');
      if (!seen.has(k)) { seen.add(k); uniq.push(st); }
    }
    uniq.sort((a, b) => (a.len + D[a.t[n - 1]][a.start]) - (b.len + D[b.t[n - 1]][b.start]));
    const annealed = [];
    for (const st of uniq.slice(0, 8)) annealed.push(NAT.anneal(D, st.t, n, iters, T0, near, kn));
    const m = Math.min(4, uniq.length);
    if (m > 1) {
      for (let q = 0; q < 6; q++) {
        annealed.push(NAT.anneal(D, NAT.ox(uniq[q % m].t, uniq[(q + 1) % m].t), n, iters, T0, near, kn));
      }
    }
    annealed.sort((a, b) => a.len - b.len);
    return annealed[0];
  });
  return { len: res.len, ms: t, ok: B.checkTour(res.tour, n) };
}

function randomStartsRun(inst, count, mix) {
  const n = inst.n;
  const [t, res] = clock(() => {
    const locals = [];
    for (let q = 0; q < count; q++) {
      const tour = B.greedy(inst, (q * 2654435761 >>> 0) % n);
      locals.push(B.refineFast(inst.D, tour, inst.near, inst.kn, n, false));
    }
    let best = Infinity;
    for (const r of locals) best = Math.min(best, r.len);
    if (!mix) return { len: best, tour: null };
    const merged = assemble(inst.rows, locals.map(r => r.tour), n);
    if (!merged) return { len: best, tour: null };
    const r = B.refineFast(inst.D, merged, inst.near, inst.kn, n, false);
    return { len: Math.min(best, r.len), tour: r.tour };
  });
  return { len: res.len, ms: t, ok: true };
}

function beamRestarts(inst, o) {
  let best = null;
  for (let r = 0; r < o.restarts; r++) {
    const oo = Object.assign({}, o, {
      starts: r === 0 ? 'farthest' : 'random',
      startCount: 2,
      startSeed: r + 1
    });
    const x = oo.basetunnel
      ? baseTunnel(inst, oo)
      : B.beamFastTunnel(inst, oo.K, oo.refineF, oo);
    if (!best || x.len < best.len) best = x;
  }
  return best;
}

function baseTunnel(inst, o) {
  const n = inst.n, b = B.beamFast(inst, o.K, o);
  let best = null;
  const lim = Math.min(b.finals.length, o.refineF);
  for (let i = 0; i < lim; i++) {
    const t = B.refineBase(inst.rows, b.finals[i].t, o);
    const len = B.tourLenRows(inst.rows, t);
    if (!best || len < best.len) best = { tour: t, len: len };
  }
  return best;
}

function beamMerge(inst, o) {
  const n = inst.n, b = B.beamFast(inst, o.K, o);
  const locals = [];
  const lim = Math.min(b.finals.length, o.refineF);
  for (let i = 0; i < lim; i++) {
    locals.push(B.refineFast(inst.D, b.finals[i].t, inst.near, inst.kn, n, !!o.parity, o));
  }
  let best = null;
  for (const r of locals) if (!best || r.len < best.len) best = r;
  const merged = assemble(inst.rows, locals.map(r => r.tour), n);
  if (merged) {
    const r = B.refineFast(inst.D, merged, inst.near, inst.kn, n, !!o.parity, o);
    if (r.len < best.len) best = r;
  }
  return best;
}

/* --------------------------------- run ---------------------------------- */

const methods = ['greedy', 'greedy-best', 'nature-pop', 'nature', 'rand16+tun', 'rand16+merge'].concat(CONFIGS.map(c => c.name));
const rows = [];
let bad = 0;

console.log('');
console.log('tune_knobs   n=' + NS.join('/') + '  seeds=' + SEEDS + '/family  nature M=' + M +
            '  configs=' + CONFIGS.length + (CFG.only ? '  only=' + CFG.only : ''));
console.log('');

for (const n of NS) {
  for (let s = 1; s <= SEEDS; s++) {
    for (const kind of ['uniform', 'cluster']) {
      const base = B.buildInstance(n, s, kind, 10);
      base.kind = kind;
      const res = {};
      res.greedy = greedyRun(base, base.fp[0]);
      res['greedy-best'] = greedyBestStart(base);
      res['nature-pop'] = natureRun(base, s, true);
      res.nature = natureRun(base, s, false);
      res['rand16+tun'] = randomStartsRun(base, 16, false);
      res['rand16+merge'] = randomStartsRun(base, 16, true);

      for (const c of CONFIGS) {
        const [msx, r] = (() => {
          const o = c.make(n);
          const inst = B.buildInstance(n, s, kind, o.near);
          const [tm, rr] = clock(() => o.tunnelMode
            ? B.beamFastTunnel(inst, o.K, o.refineF, o)
            : o.basebeam
              ? B.beamBase(inst, o.K, true, o)
              : o.restarts
                ? beamRestarts(inst, o)
                : o.basetunnel
                  ? baseTunnel(inst, o)
                  : o.merge
                    ? beamMerge(inst, o)
                    : B.beamFastTunnel(inst, o.K, o.refineF, o));
          return [tm, rr];
        })();
        res[c.name] = { len: r.len, ms: msx, ok: B.checkTour(r.tour, n) };
      }

      for (const k in res) if (!res[k].ok) bad++;
      const ref = Math.min.apply(null, methods.map(k => res[k].len));
      rows.push({ n, seed: s, kind, ref, res });
    }
  }
}

/* ------------------------------- report --------------------------------- */

const gap = (r, k) => (r.res[k].len / r.ref - 1) * 100;

const ranking = methods.map(k => {
  const g = rows.map(r => gap(r, k));
  return {
    k,
    med: med(g),
    mean: mean(g),
    worst: mx(g),
    best: Math.min.apply(null, g),
    wins: rows.filter(r => r.res[k].len <= r.ref + 1e-9).length,
    ms: med(rows.map(r => r.res[k].ms))
  };
}).sort((a, b) => a.med - b.med || a.mean - b.mean);

console.log('RANKING  (' + rows.length + ' instances; gap vs best-of-all per instance)');
console.log('');
console.log(padR('method', 44) + padL('median', 9) + padL('mean', 9) + padL('worst', 9) +
            padL('best', 9) + padL('wins', 7) + padL('med ms', 10));
for (const r of ranking) {
  console.log(padR(r.k, 44) + padL(pcent(r.med), 9) + padL(pcent(r.mean), 9) + padL(pcent(r.worst), 9) +
              padL(pcent(r.best), 9) + padL(r.wins + '/' + rows.length, 7) + padL(ms(r.ms), 10));
}

console.log('');
console.log('MEDIAN GAP BY n');
console.log(padR('method', 44) + NS.map(n => padL('n=' + n, 10)).join(''));
for (const r of ranking) {
  console.log(padR(r.k, 44) + NS.map(n => {
    const rr = rows.filter(x => x.n === n);
    return padL(pcent(med(rr.map(x => gap(x, r.k)))), 10);
  }).join(''));
}

if (CFG.out) {
  const head = ['n', 'seed', 'kind', 'reference'].concat(methods.reduce((a, k) => a.concat([k + '_len', k + '_ms']), []));
  const out = [head.join(',')];
  for (const r of rows) {
    const line = [r.n, r.seed, r.kind, r.ref.toFixed(6)];
    for (const k of methods) line.push(r.res[k].len.toFixed(6), r.res[k].ms.toFixed(3));
    out.push(line.join(','));
  }
  fs.writeFileSync(CFG.out, out.join('\n') + '\n');
  console.log('\nwrote      : ' + CFG.out + ' (' + rows.length + ' rows)');
}
console.log('');
console.log('validation : ' + (bad === 0 ? 'all tours are valid permutations' : bad + ' INVALID tours'));
console.log('');
