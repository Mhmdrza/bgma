/* hybrid_vis.js -- browser/Node core for the Beam-Guided Memetic Annealing demo.
 *
 * No DOM. The only dependency is ./effort_profiles.js (loaded first in the
 * browser, required directly in Node). Exposes one namespace:
 *
 *   HybridTSP.makeInstance(n, seed, kind) -> { n, seed, kind, pts, D, order, near, kn }
 *   HybridTSP.buildSnapshots(inst, opts)  -> snapshot[]
 *   HybridTSP.heldKarp(D)                 -> { tour, len }        exact, n <= EXACT_MAX
 *   HybridTSP.hkBound(D, ub, iters)       -> number              proven 1-tree lower bound
 *   HybridTSP.tourLen(D, tour)            -> number
 *   HybridTSP.greedy(D, order, start)     -> tour
 *   HybridTSP.effortOptions(level, n)     -> demo-capped snapshot options
 *   HybridTSP.EXACT_MAX                   -> 20
 *   HybridTSP.DEFAULTS                    -> default snapshot options
 *
 * Snapshot shape (everything is copied, so the player can hold on to it):
 *   { stage, note, pool: tour[], best: { t, len } | null, active: [{t,color,alpha,partial}],
 *     poolLen, work }
 */
(function (global) {
  'use strict';

  var EXACT_MAX = 20;
  var DEFAULTS = Object.freeze({ islands: 3, gens: 4, children: 4, elites: 10, polish: 3 });

  /* The visualizer uses the same level names as the CLI, but caps the budget so
   * a long --effort=max run stays watchable. The caps are rank-based: each level
   * is strictly larger than the previous one even when the real preset is much
   * bigger than n=30 can use. */
  var EP = (typeof module !== 'undefined' && module.exports)
    ? require('./effort_profiles.js')
    : global.EffortProfiles;
  var DEMO_CAPS = {
    low:   { islands: 1, K: 12, gens: 1, children: 2, elites: 6,  polish: 1 },
    mid:   { islands: 2, K: 16, gens: 3, children: 3, elites: 10, polish: 2 },
    high:  { islands: 3, K: 20, gens: 4, children: 4, elites: 14, polish: 3 },
    xhigh: { islands: 4, K: 24, gens: 5, children: 5, elites: 18, polish: 4 },
    max:   { islands: 6, K: 32, gens: 8, children: 6, elites: 24, polish: 5 }
  };
  function effortOptions(level, n) {
    var L = String(level || 'mid').toLowerCase();
    var real = EP ? EP.effortPreset(L, n)
      : { islands: 3, K: Math.max(6, Math.round(n / 3)), gens: 4, children: 4, elites: 10, polish: 3 };
    var cap = DEMO_CAPS[L] || DEMO_CAPS.mid;
    return {
      islands: Math.min(real.islands, cap.islands),
      K: Math.min(real.K, cap.K),
      gens: Math.min(real.gens, cap.gens),
      children: Math.min(real.children, cap.children),
      elites: Math.min(real.elites, cap.elites),
      polish: Math.min(real.polish, cap.polish)
    };
  }

  /* ============================== utilities ============================== */

  function rng(seed) {
    let a = seed >>> 0;
    return function () {
      a += 0x6D2B79F5; let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function gauss(r) { return Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(2 * Math.PI * r()); }
  function clampv(v) { return Math.min(96, Math.max(4, v)); }

  function makePoints(n, seed, kind) {
    const r = rng(seed * 7919 + n * 104729 + (kind === 'cluster' ? 17 : 0));
    const pts = [];
    if (kind === 'cluster') {
      const k = 3 + Math.floor(r() * 2), centers = [];
      for (let c = 0; c < k; c++) centers.push([18 + r() * 64, 18 + r() * 64]);
      for (let i = 0; i < n; i++) {
        const ce = centers[Math.floor(r() * k)];
        pts.push([clampv(ce[0] + gauss(r) * 8), clampv(ce[1] + gauss(r) * 8)]);
      }
    } else {
      for (let i = 0; i < n; i++) pts.push([4 + r() * 92, 4 + r() * 92]);
    }
    return pts;
  }
  function distRows(pts) {
    const n = pts.length, D = [];
    for (let i = 0; i < n; i++) {
      D.push(new Float64Array(n));
      for (let j = 0; j < n; j++) D[i][j] = Math.hypot(pts[i][0] - pts[j][0], pts[i][1] - pts[j][1]);
    }
    return D;
  }
  function nearestOrder(D) {
    const n = D.length, order = [];
    for (let i = 0; i < n; i++) {
      const rest = [];
      for (let j = 0; j < n; j++) if (j !== i) rest.push(j);
      rest.sort((a, b) => D[i][a] - D[i][b]);
      order.push(rest);
    }
    return order;
  }
  function makeNear(D, order, k) {
    const n = D.length, near = new Int32Array(n * k);
    for (let i = 0; i < n; i++) for (let q = 0; q < k; q++) near[i * k + q] = order[i][q % (n - 1)];
    return near;
  }
  function farthestPair(D) {
    const n = D.length; let best = -1, p = 0, q = 1;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      if (D[i][j] > best) { best = D[i][j]; p = i; q = j; }
    }
    return [p, q];
  }
  function tourLen(D, t) {
    let s = 0;
    for (let i = 0; i < t.length; i++) s += D[t[i]][t[(i + 1) % t.length]];
    return s;
  }
  function checkTour(t, n) {
    if (!t || t.length !== n) return false;
    const seen = new Uint8Array(n);
    for (const c of t) { if (c < 0 || c >= n || seen[c]) return false; seen[c] = 1; }
    return true;
  }
  function tourKey(t) {
    const n = t.length;
    let p = 0; while (t[p] !== 0) p++;
    let f = [], r = [];
    for (let i = 0; i < n; i++) { f.push(t[(p + i) % n]); r.push(t[(p - i + n) % n]); }
    const fs = f.join(','), rs = r.join(',');
    return fs < rs ? fs : rs;
  }
  function greedy(D, order, start) {
    const n = D.length, seen = new Uint8Array(n), tour = [start];
    seen[start] = 1;
    while (tour.length < n) {
      let c = -1;
      for (const x of order[tour[tour.length - 1]]) if (!seen[x]) { c = x; break; }
      tour.push(c); seen[c] = 1;
    }
    return tour;
  }
  function makeInstance(n, seed, kind) {
    const pts = makePoints(n, seed, kind);
    const D = distRows(pts), order = nearestOrder(D);
    const kn = Math.min(10, n - 1), near = makeNear(D, order, kn);
    return { n, seed, kind, pts, D, order, near, kn };
  }

  /* ================================ beam ================================= */

  function beamRun(D, order, poles, K, onDepth) {
    const n = D.length;
    let wave = poles.map(p => {
      const seen = new Uint8Array(n); seen[p] = 1;
      return { t: [p], seen, len: 0, start: p };
    });
    for (let step = 1; step < n; step++) {
      const next = [];
      for (const st of wave) {
        const m = st.t.length, cur = st.t[m - 1], cand = [];
        const kth = (city, rank) => {
          let k = 0;
          for (const c of order[city]) if (!st.seen[c]) { if (++k === rank) return c; }
          return -1;
        };
        for (let lag = 0; lag < Math.min(3, m); lag++) {
          const c = kth(st.t[m - 1 - lag], lag + 1);
          if (c >= 0 && cand.indexOf(c) < 0) cand.push(c);
        }
        const c2 = kth(cur, 2);
        if (c2 >= 0 && cand.indexOf(c2) < 0) cand.push(c2);
        for (const c of cand) {
          const seen = st.seen.slice(); seen[c] = 1;
          next.push({ t: st.t.concat(c), seen, len: st.len + D[cur][c], start: st.start });
        }
      }
      const uniq = new Map();
      for (const x of next) {
        const key = x.seen.join('') + '|' + x.t[x.t.length - 1] + '|' + x.start;
        const old = uniq.get(key);
        if (!old || x.len < old.len) uniq.set(key, x);
      }
      wave = Array.from(uniq.values())
        .sort((a, b) => (a.len + D[a.t[a.t.length - 1]][a.start]) - (b.len + D[b.t[b.t.length - 1]][b.start]))
        .slice(0, K);
      if (onDepth && (step % Math.max(1, Math.floor(n / 6)) === 0 || step === n - 1)) onDepth(wave, step);
    }
    return wave
      .map(st => ({ t: st.t, len: st.len + D[st.t[n - 1]][st.start] }))
      .sort((a, b) => a.len - b.len);
  }
  function randomPair(n, r) {
    const a = Math.floor(r() * n);
    let b = Math.floor(r() * n);
    while (b === a) b = Math.floor(r() * n);
    return [a, b];
  }

  /* =============================== tunnels =============================== */

  function apply2(D, t, pos, i, j) {
    const n = t.length;
    if (i === j) return false;
    let lo = i, hi = j;
    if (hi < lo) { const s = lo; lo = hi; hi = s; }
    if (hi === lo + 1 || (lo === 0 && hi === n - 1)) return false;
    const a = t[lo], b = t[(lo + 1) % n], c = t[hi], d = t[(hi + 1) % n];
    if (!(D[a][c] + D[b][d] < D[a][b] + D[c][d] - 1e-9)) return false;
    for (let x = lo + 1, y = hi; x < y; x++, y--) { const tmp = t[x]; t[x] = t[y]; t[y] = tmp; }
    for (let q = 0; q < n; q++) pos[t[q]] = q;
    return true;
  }

  function fastTunnel(D, tour, near, kn) {
    const n = tour.length, t = tour.slice(), pos = new Int32Array(n);
    for (let i = 0; i < n; i++) pos[t[i]] = i;
    const queue = t.slice(), dlb = new Uint8Array(n);
    let guard = 0;
    while (queue.length && guard++ < 60 * n) {
      const a = queue.pop();
      if (dlb[a]) continue;
      const b = t[(pos[a] + 1) % n];
      let moved = false;
      for (let q = 0; q < kn && !moved; q++) {
        const c = near[a * kn + q];
        if (c === a || c === b) continue;
        const d = t[(pos[c] + 1) % n];
        if (d === a || d === b) continue;
        if (apply2(D, t, pos, pos[a], pos[c])) {
          dlb.fill(0); queue.push(a, b, c, d); moved = true;
        }
      }
      if (!moved) dlb[a] = 1;
    }
    return orOptFull(D, t, 3);
  }

  function orOptFull(D, t0, maxL) {
    let t = t0.slice(), improved = true, guard = 0;
    const n = t.length;
    while (improved && guard++ < 20) {
      improved = false;
      for (let L = 1; L <= maxL && !improved; L++) {
        for (let i = 0; i < n && !improved; i++) {
          const seg = [];
          for (let z = 0; z < L; z++) seg.push(t[(i + z) % n]);
          const segSet = new Set(seg);
          const prev = t[(i - 1 + n) % n], next = t[(i + L) % n];
          const save = D[prev][seg[0]] + D[seg[L - 1]][next] - D[prev][next];
          let best = -1e-9, bestU = -1, rev = false;
          for (let u = 0; u < n; u++) {
            if (segSet.has(u)) continue;
            const v = t[(t.indexOf(u) + 1) % n];
            if (segSet.has(v)) continue;
            const f = D[u][seg[0]] + D[seg[L - 1]][v] - D[u][v] - save;
            if (f < best) { best = f; bestU = u; rev = false; }
            const r = D[u][seg[L - 1]] + D[seg[0]][v] - D[u][v] - save;
            if (r < best) { best = r; bestU = u; rev = true; }
          }
          if (bestU < 0) continue;
          const rest = t.filter(c => !segSet.has(c));
          const at = rest.indexOf(bestU) + 1;
          rest.splice(at, 0, ...(rev ? seg.slice().reverse() : seg));
          t = rest; improved = true;
        }
      }
    }
    return t;
  }

  function baseTunnel(D, tour) {
    const n = tour.length;
    let t = tour.slice(), improved = true;
    while (improved) {
      improved = false;
      outer: for (let i = 0; i < n - 1; i++) {
        for (let j = i + 2; j < n; j++) {
          if (i === 0 && j === n - 1) continue;
          const a = t[i], b = t[i + 1], c = t[j], d = t[(j + 1) % n];
          if (D[a][c] + D[b][d] < D[a][b] + D[c][d] - 1e-9) {
            for (let x = i + 1, y = j; x < y; x++, y--) { const z = t[x]; t[x] = t[y]; t[y] = z; }
            improved = true; break outer;
          }
        }
      }
      if (improved) continue;
      t = orOptFull(D, t, 5);
      improved = tourLen(D, t) < tourLen(D, tour.slice()) - 1e-9;
      if (!improved) break;
      tour = t.slice();
    }
    return t;
  }

  /* =============================== hybrid ================================ */

  function erx(A, B, D, n, r) {
    const adj = Array.from({ length: n }, () => []);
    const add = (a, b) => { if (a !== b && adj[a].indexOf(b) < 0) adj[a].push(b); };
    for (let i = 0; i < n; i++) { const j = (i + 1) % n; add(A[i], A[j]); add(B[i], B[j]); }
    const seen = new Uint8Array(n), out = [];
    let cur = Math.floor(r() * n);
    out.push(cur); seen[cur] = 1;
    for (let step = 1; step < n; step++) {
      let best = -1, bestRem = Infinity, bestD = Infinity;
      for (const c of adj[cur]) {
        if (seen[c]) continue;
        let rem = 0; for (const z of adj[c]) if (!seen[z]) rem++;
        const d = D[cur][c];
        if (rem < bestRem || (rem === bestRem && d < bestD)) { best = c; bestRem = rem; bestD = d; }
      }
      if (best < 0) for (let c = 0; c < n; c++) if (!seen[c] && D[cur][c] < bestD) { bestD = D[cur][c]; best = c; }
      out.push(best); seen[best] = 1; cur = best;
    }
    return out;
  }

  function doubleBridge(t, n, r) {
    const a = 1 + Math.floor(r() * (n - 3));
    const b = a + 1 + Math.floor(r() * (n - a - 2));
    const c = b + 1 + Math.floor(r() * (n - b - 1));
    const out = [];
    for (let i = 0; i < a; i++) out.push(t[i]);
    for (let i = c; i < n; i++) out.push(t[i]);
    for (let i = b; i < c; i++) out.push(t[i]);
    for (let i = a; i < b; i++) out.push(t[i]);
    return out;
  }

  function anneal(D, tour, iters, T0, near, kn, r) {
    const n = tour.length, t = tour.slice(), pos = new Int32Array(n);
    for (let i = 0; i < n; i++) pos[t[i]] = i;
    let len = tourLen(D, t), best = t.slice(), bestL = len, T = T0, since = 0;
    for (let it = 0; it < iters; it++) {
      T *= 0.9997;
      if (T < 1e-7) T = 1e-7;
      const i = Math.floor(r() * (n - 2));
      let j;
      if (r() < 0.85) {
        const c = near[t[i] * kn + Math.floor(r() * kn)];
        j = pos[c];
        if (j <= i + 1) continue;
      } else {
        j = i + 2 + Math.floor(r() * (n - i - 2));
      }
      if (i === 0 && j === n - 1) continue;
      const a = t[i], b = t[i + 1], c = t[j], d = t[(j + 1) % n];
      const delta = D[a][c] + D[b][d] - D[a][b] - D[c][d];
      if (delta < 0 || r() < Math.exp(-delta / T)) {
        for (let x = i + 1, y = j; x < y; x++, y--) { const z = t[x]; t[x] = t[y]; t[y] = z; }
        for (let q = 0; q < n; q++) pos[t[q]] = q;
        len += delta;
        if (len < bestL - 1e-9) { bestL = len; best = t.slice(); since = 0; }
        else since++;
      } else since++;
      if (since > 40 * n) {
        const k = doubleBridge(t, n, r);
        for (let q = 0; q < n; q++) t[q] = k[q];
        for (let q = 0; q < n; q++) pos[t[q]] = q;
        len = tourLen(D, t); T = Math.max(T, T0 * 0.4); since = 0;
      }
    }
    return best;
  }

  function buildSnapshots(inst, options) {
    const { n, D, order, near, kn } = inst;
    const P = Object.assign({}, DEFAULTS, options || {});
    P.K = P.K || Math.max(6, Math.round(n / 3));
    const r = rng(inst.seed * 99991 + n * 313);
    const snaps = [];
    let pool = [], best = null, work = 0;

    const rebuild = list => {
      const m = new Map();
      for (const x of list) {
        const k = tourKey(x.t), old = m.get(k);
        if (!old || x.len < old.len) m.set(k, x);
      }
      return Array.from(m.values()).sort((a, b) => a.len - b.len).slice(0, P.elites);
    };
    const copy = x => ({ t: x.slice(), len: tourLen(D, x) });
    const push = o => {
      snaps.push(Object.assign({
        stage: '', note: '', pool: pool.map(x => x.t.slice()),
        best: best ? { t: best.t.slice(), len: best.len } : null, poolLen: pool.length, work
      }, o));
    };
    const consider = x => { if (!best || x.len < best.len - 1e-9) { best = { t: x.t.slice(), len: x.len }; return true; } return false; };
    const fast = t => { work++; const x = fastTunnel(D, t, near, kn); return copy(x); };
    const polish = t => { work++; const x = baseTunnel(D, t); return copy(x); };

    /* 1. beam islands */
    for (let i = 0; i < P.islands; i++) {
      const poles = i === 0 ? farthestPair(D) : randomPair(n, r);
      const wave = beamRun(D, order, poles, P.K, (w, depth) => {
        push({
          stage: 'island ' + (i + 1) + '/' + P.islands + ' · beam depth ' + depth,
          note: 'beam keeps ' + w.length + ' partial tours; the last three cities vote for the next city',
          active: w.map(s => ({ t: s.t.slice(), color: 'var(--algo)', alpha: .38, partial: true }))
        });
      });
      const finals = wave.map(f => fast(f.t));
      pool = rebuild(pool.concat(finals));
      consider(pool[0]);
      push({
        stage: 'island ' + (i + 1) + '/' + P.islands + ' · finals screened',
        note: 'fast candidate-list tunnel turned ' + finals.length + ' beam finals into local optima',
        active: finals.slice(0, 8).map(x => ({ t: x.t.slice(), color: 'var(--algo)', alpha: .45 }))
      });
    }

    /* 2. initial polish */
    for (let i = 0; i < Math.min(P.polish, pool.length); i++) {
      const x = polish(pool[i].t);
      consider(x);
      pool = rebuild(pool.concat([x]));
      push({
        stage: 'initial polish ' + (i + 1) + '/' + P.polish,
        note: 'full-restart 2-opt + Or-opt on an elite; only contenders get this expensive pass',
        active: [{ t: x.t.slice(), color: 'var(--algo)', alpha: .95 }]
      });
    }

    /* 3. generations */
    for (let g = 0; g < P.gens; g++) {
      for (let c = 0; c < P.children; c++) {
        const pa = pool[Math.floor(r() * Math.min(4, pool.length))];
        let pb = pool[Math.floor(r() * pool.length)];
        for (let tries = 0; tries < 4 && pb === pa && pool.length > 1; tries++) pb = pool[Math.floor(r() * pool.length)];
        push({
          stage: 'gen ' + (g + 1) + ' · child ' + (c + 1) + ' · parents',
          note: 'ERX will inherit edges from both parents',
          active: [
            { t: pa.t.slice(), color: 'var(--pa)', alpha: .9 },
            { t: pb.t.slice(), color: 'var(--pb)', alpha: .9 }
          ]
        });

        let t = erx(pa.t, pb.t, D, n, r);
        if (r() < 0.55) {
          t = doubleBridge(t, n, r);
          push({
            stage: 'gen ' + (g + 1) + ' · child ' + (c + 1) + ' · double-bridge kick',
            note: 'an avulsion jumps the child to a different basin',
            active: [{ t: t.slice(), color: 'var(--child)', alpha: .9 }]
          });
        } else {
          t = anneal(D, t, Math.min(1600, n * 70), Math.max(1, .04 * n), near, kn, r);
          push({
            stage: 'gen ' + (g + 1) + ' · child ' + (c + 1) + ' · short anneal',
            note: 'uphill 2-opt moves escape the local basin before screening',
            active: [{ t: t.slice(), color: 'var(--child)', alpha: .9 }]
          });
        }

        let x = fast(t);
        push({
          stage: 'gen ' + (g + 1) + ' · child ' + (c + 1) + ' · fast screen',
          note: 'candidate-list 2-opt/Or-opt: cheap, used on every child',
          active: [{ t: x.t.slice(), color: 'var(--child)', alpha: .85 }]
        });

        if (c < P.polish) {
          x = polish(x.t);
          push({
            stage: 'gen ' + (g + 1) + ' · child ' + (c + 1) + ' · elite polish',
            note: 'full-restart polish only for the few children that can win',
            active: [{ t: x.t.slice(), color: 'var(--algo)', alpha: .95 }]
          });
        }
        consider(x);
        pool = rebuild(pool.concat([x]));
      }
      push({
        stage: 'generation ' + (g + 1) + ' complete',
        note: 'elite pool re-sorted; best tour is kept for the next generation',
        active: pool.slice(0, 4).map(x => ({ t: x.t.slice(), color: 'var(--algo)', alpha: .6 }))
      });
    }

    push({ stage: 'done', note: 'best tour found by the hybrid', active: [], done: true });
    return snaps;
  }

  /* ============================ exact / bound ============================ */

  function heldKarp(D) {
    const n = D.length, m = n - 1, N = 1 << m;
    const dp = new Float64Array(N * m).fill(Infinity);
    const par = new Int8Array(N * m).fill(-1);
    for (let j = 0; j < m; j++) dp[(1 << j) * m + j] = D[0][j + 1];
    for (let mask = 1; mask < N; mask++) {
      for (let j = 0; j < m; j++) {
        if (!((mask >> j) & 1)) continue;
        const cur = dp[mask * m + j];
        if (cur === Infinity) continue;
        for (let k = 0; k < m; k++) {
          if ((mask >> k) & 1) continue;
          const nm = mask | (1 << k), v = cur + D[j + 1][k + 1];
          if (v < dp[nm * m + k]) { dp[nm * m + k] = v; par[nm * m + k] = j; }
        }
      }
    }
    const full = N - 1;
    let bj = 0, bv = Infinity;
    for (let j = 0; j < m; j++) {
      const tv = dp[full * m + j] + D[j + 1][0];
      if (tv < bv) { bv = tv; bj = j; }
    }
    const tour = [];
    let mk = full, cj = bj;
    while (cj !== -1) { tour.push(cj + 1); const pj = par[mk * m + cj]; mk ^= (1 << cj); cj = pj; }
    tour.push(0); tour.reverse();
    return { tour, len: bv };
  }

  function oneTree(D, pi) {
    const n = D.length, inTree = new Uint8Array(n), best = new Float64Array(n);
    const par = new Int32Array(n).fill(-1), deg = new Int32Array(n);
    for (let i = 0; i < n; i++) best[i] = Infinity;
    best[1] = 0;
    let total = 0;
    for (let it = 0; it < n - 1; it++) {
      let v = -1, bv = Infinity;
      for (let i = 1; i < n; i++) if (!inTree[i] && best[i] < bv) { bv = best[i]; v = i; }
      if (v < 0) break;
      inTree[v] = 1; total += bv;
      if (par[v] >= 0) { deg[v]++; deg[par[v]]++; }
      for (let j = 1; j < n; j++) if (!inTree[j]) {
        const w = D[v][j] + pi[v] + pi[j];
        if (w < best[j]) { best[j] = w; par[j] = v; }
      }
    }
    let e1 = Infinity, e2 = Infinity, a1 = -1, a2 = -1;
    for (let i = 1; i < n; i++) {
      const e = D[0][i] + pi[0] + pi[i];
      if (e < e1) { e2 = e1; a2 = a1; e1 = e; a1 = i; }
      else if (e < e2) { e2 = e; a2 = i; }
    }
    total += e1 + e2;
    deg[0] = 2; deg[a1]++; deg[a2]++;
    let sum = 0;
    for (let i = 0; i < n; i++) sum += pi[i];
    return { L: total - 2 * sum, deg };
  }

  function hkBound(D, ub, iters) {
    const n = D.length, pi = new Float64Array(n);
    let bestL = -Infinity, lam = 2, stall = 0;
    for (let it = 0; it < iters; it++) {
      const r = oneTree(D, pi);
      if (r.L > bestL + 1e-12) { bestL = r.L; stall = 0; }
      else if (++stall >= 25) { lam *= 0.6; stall = 0; }
      let sq = 0;
      for (let i = 0; i < n; i++) { const g = r.deg[i] - 2; sq += g * g; }
      if (sq === 0) break;
      const step = lam * (ub - r.L) / sq;
      if (!isFinite(step) || step <= 0) break;
      for (let i = 0; i < n; i++) pi[i] += step * r.deg[i];
    }
    return bestL;
  }

  /* =============================== export ================================ */

  const api = {
    EXACT_MAX, DEFAULTS, effortOptions,
    makeInstance, makePoints, distRows, nearestOrder, makeNear, farthestPair,
    buildSnapshots, heldKarp, hkBound, tourLen, checkTour, greedy, rng
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.HybridTSP = api;
})(typeof window !== 'undefined' ? window : globalThis);
