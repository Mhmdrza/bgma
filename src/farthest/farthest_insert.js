/* farthest_insert.js -- farthest-pole construction: a two-front zigzag, and the
 * farthest-insertion reading (FPI) that works.
 *
 * The idea, from the farthest pole:
 *
 *   1. POLE    measure every pair, take the farthest pair A and Z. They are the
 *              two ends of the tour, and they are the far nodes each front is
 *              measured against.
 *   2. BOTH    grow two fronts at once: one from A, one from Z. The nearest
 *              unvisited city to a front is that front's natural next step
 *              (from the pole, the closest city is the least ambiguous edge the
 *              tour can take).
 *   3. ELIMINATE  a city can look near to both fronts. The farthest node's list
 *              breaks the tie: if the city nearest to A sits *far* from Z (high
 *              in Z's far list), it clearly belongs to the A front and is taken;
 *              if it sits close to Z, it belongs to the other end and the step
 *              is given to that front instead. A candidate nearer to the
 *              opposite pole than to its own front is eliminated.
 *   4. ZIGZAG  the two fronts therefore advance toward each other and meet in
 *              the middle; the path A ... seam ... Z closes into a cycle.
 *   5. TAIL    with only `tail` cities left, brute force orders them as the
 *              middle segment so the two fronts join on a short seam instead of
 *              a long one.
 *
 * Every city is visited exactly once, so the result is always a valid Hamiltonian
 * cycle. The walk is a construction heuristic with no local search: it is meant
 * to be screened or fed to BGMA as `seedTours`, exactly like the farthest-pole
 * walk in src/farthest/farthest_pole.js.
 *
 * Rules (`rule` option) all share the farthest-pole reading and differ in how the
 * tour is grown; they exist so the elimination can be measured against the
 * obvious alternatives:
 *   fi    farthest-pole insertion (default): grow the cycle from the two poles by
 *         inserting the city farthest from the cycle so far (see below)
 *   elim  eliminate the candidate that belongs to the other end (the literal
 *         two-front idea, using the two poles)
 *   far   the same, but "far" is the opposite pole's far half (distance to that
 *         pole at or above the median) rather than a head-to-head comparison
 *   nn2   no elimination: always extend the front with the shorter near edge
 *   alt   strict alternation A, Z, A, Z with each front's nearest city
 *   veto  one front only: from the cursor inside the map, take the nearest city
 *         that is not nearer to the far pole than to the cursor (a single-ended
 *         control for the elimination)
 *   ni    nearest insertion: the nearest-city cousin of `fi`, kept as a control
 *
 * `fi`, the winner, is the same idea read as insertion. The zigzag rules start
 * the cycle at the poles and therefore keep the A-Z edge -- the longest pair on
 * the map -- in the tour. That edge is the one thing that should be eliminated,
 * so instead start the cycle as the two poles and then, every step, take the city
 * farthest from the cycle so far (read off the same far list the elimination
 * uses) and splice it in at its cheapest position; the first insertion lands
 * between A and Z and removes the diameter. `ni` is the nearest-city cousin,
 * kept as a control.
 *
 * Complexity: O(n^2) pairs to find the poles, then O(n^2) for the walk (each
 * step scans the unvisited set; the insertion updates a distance-to-cycle row),
 * plus a bounded O(tail!) tail search.
 *
 * usage (Node):
 *   const { solve } = require('./farthest_insert.js');
 *   const { tour, len, stats } = solve(rows);            // rule 'fi'
 *   const { tour } = solve(rows, { rule: 'elim' });       // literal two-front idea
 */
'use strict';

const DEFAULTS = Object.freeze({ rule: 'fi', tail: 6 });

function tourLen(D, t) {
  let s = 0;
  for (let i = 0; i < t.length; i++) s += D[t[i]][t[(i + 1) % t.length]];
  return s;
}

function checkTour(t, n) {
  if (!t || t.length !== n) return false;
  const seen = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const c = t[i];
    if (c < 0 || c >= n || seen[c]) return false;
    seen[c] = 1;
  }
  return true;
}

function farthestPair(D) {
  const n = D.length;
  let A = 0, Z = 1, span = -Infinity;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (D[i][j] > span) { span = D[i][j]; A = i; Z = j; }
    }
  }
  return { A, Z, span };
}

function medianOf(vals) {
  const b = vals.slice().sort((a, b2) => a - b2);
  return b.length % 2 ? b[b.length >> 1] : (b[b.length / 2 - 1] + b[b.length / 2]) / 2;
}

/* Best order of the last few cities as the middle segment: walked from `from`
 * (one front) and closed onto `to` (the other front). `tail` <= 6, so the honest
 * brute force (720 permutations) is cheaper than any cleverness. */
function bestTail(D, from, rest, to) {
  let best = null, bestLen = Infinity;
  const cur = rest.slice();
  const permute = k => {
    if (k === cur.length) {
      let s = D[from][cur[0]];
      for (let i = 0; i < cur.length - 1; i++) s += D[cur[i]][cur[i + 1]];
      s += D[cur[cur.length - 1]][to];
      if (s < bestLen) { bestLen = s; best = cur.slice(); }
      return;
    }
    for (let i = k; i < cur.length; i++) {
      const t = cur[k]; cur[k] = cur[i]; cur[i] = t;
      permute(k + 1);
      cur[i] = cur[k]; cur[k] = t;
    }
  };
  permute(0);
  return best || rest.slice();
}

/* ------------------------------ insertion -------------------------------- */

/* Farthest insertion (opts.farthest, default true) from the pole. Start the cycle
 * on the farthest pair A-Z, then repeatedly take the unvisited city FARTHEST from
 * the cycle (opts.farthest=false: the nearest) and splice it in at the cheapest
 * position. Each insertion replaces an edge a-b by a-c + c-b, so the first pick
 * breaks the A-Z diameter the zigzag rules keep. O(n^2): one scan for the pick and
 * one for the position, plus an O(n) distance-to-cycle update per city. */
function insertion(D, opts) {
  const O = opts || {};
  const far = O.farthest !== false;
  const n = D.length;
  if (n <= 2) return n === 2 ? [0, 1] : [0];
  const { A, Z } = O.poles || farthestPair(D);
  const cyc = [A, Z];
  const used = new Uint8Array(n);
  used[A] = used[Z] = 1;
  const dist = new Float64Array(n).fill(Infinity);   // distance to the cycle so far
  for (let c = 0; c < n; c++) if (!used[c]) dist[c] = Math.min(D[c][A], D[c][Z]);
  for (let it = 2; it < n; it++) {
    let pick = -1, bd = far ? -1 : Infinity;
    for (let c = 0; c < n; c++) {
      if (used[c]) continue;
      if (far ? dist[c] > bd : dist[c] < bd) { bd = dist[c]; pick = c; }
    }
    let pos = 0, delta = Infinity;
    const m = cyc.length;
    for (let i = 0; i < m; i++) {
      const a = cyc[i], b = cyc[(i + 1) % m];
      const d = D[a][pick] + D[pick][b] - D[a][b];   // cost of splicing the pick in
      if (d < delta) { delta = d; pos = i; }
    }
    cyc.splice(pos + 1, 0, pick);
    used[pick] = 1;
    for (let c = 0; c < n; c++) if (!used[c] && D[c][pick] < dist[c]) dist[c] = D[c][pick];
  }
  return cyc;
}

/* ------------------------------ the solver ------------------------------ */

function solve(D, options) {
  const P = Object.assign({}, DEFAULTS, options || {});
  const n = D.length;
  const t0 = Date.now();
  const stats = { n, moves: 0, tailCities: 0, startSpan: 0, eliminations: 0, ms: 0 };

  if (n <= 1) {
    stats.ms = Date.now() - t0;
    return { tour: n === 1 ? [0] : [], len: 0, stats };
  }
  if (n === 2) {
    stats.ms = Date.now() - t0;
    stats.moves = 1; stats.startSpan = D[0][1];
    return { tour: [0, 1], len: 2 * D[0][1], stats };
  }

  if (P.rule === 'fi' || P.rule === 'ni') {
    const tour = insertion(D, { farthest: P.rule === 'fi' });
    stats.ms = Date.now() - t0;
    return { tour, len: tourLen(D, tour), stats };
  }

  const { A, Z, span } = farthestPair(D);
  stats.startSpan = span;

  const medZ = P.rule === 'far' ? medianOf(D.map((row, i) => row[Z])) : 0;
  const medA = P.rule === 'far' ? medianOf(D.map((row, i) => row[A])) : 0;

  function nearestUnvisited(from, used) {
    let c = -1, d = Infinity;
    for (let i = 0; i < n; i++) if (!used[i] && D[from][i] < d) { d = D[from][i]; c = i; }
    return { c, d };
  }

  /* `far`/`elim` certification: a candidate belongs to its own front when it is
   * not drawn to the opposite pole. Because the fronts start on the poles, the
   * opposite pole *is* the farthest node's list. */
  function belongs(c, own, opposite) {
    if (P.rule === 'far') return D[c][opposite] >= (own === A ? medZ : medA);
    return D[c][own] < D[c][opposite];
  }

  if (P.rule === 'veto') return solveVeto(D, P, n, stats, t0, A, Z);

  const left = [A], right = [Z];
  const used = new Uint8Array(n);
  used[A] = used[Z] = 1;
  let count = 2, turn = 0;

  while (count < n) {
    const lh = left[left.length - 1], rh = right[right.length - 1];
    const bL = nearestUnvisited(lh, used), bR = nearestUnvisited(rh, used);

    /* Tail: brute-force the middle segment, then two fronts are joined. */
    if (P.tail > 0 && n - count <= P.tail) {
      const rest = [];
      for (let i = 0; i < n; i++) if (!used[i]) rest.push(i);
      const order = bestTail(D, lh, rest, rh);
      for (const c of order) { left.push(c); used[c] = 1; count++; stats.moves++; }
      stats.tailCities = order.length;
      break;
    }

    let side;
    if (P.rule === 'alt') {
      side = turn++ % 2 === 0 ? 'L' : 'R';
    } else if (P.rule === 'nn2') {
      side = bL.d <= bR.d ? 'L' : 'R';
    } else {
      const certL = bL.c >= 0 && belongs(bL.c, A, Z);
      const certR = bR.c >= 0 && belongs(bR.c, Z, A);
      if (certL && certR) side = bL.d <= bR.d ? 'L' : 'R';
      else if (certL) side = 'L';
      else if (certR) side = 'R';
      else side = bL.d <= bR.d ? 'L' : 'R';
      if ((side === 'L' && bL.d > bR.d) || (side === 'R' && bR.d > bL.d)) stats.eliminations++;
    }

    if (bL.c === bR.c) {
      /* both fronts want the same city: attach it where the edge is shorter */
      side = D[bL.c][lh] <= D[bL.c][rh] ? 'L' : 'R';
      stats.eliminations++;
    }

    const pick = side === 'L' ? bL.c : bR.c;
    if (pick < 0) break;
    (side === 'L' ? left : right).push(pick);
    used[pick] = 1;
    count++;
    stats.moves++;
  }

  const tour = left.concat(right.slice().reverse());
  if (!checkTour(tour, n)) {
    const seenT = new Uint8Array(n), fix = [];
    for (const c of tour) if (!seenT[c]) { seenT[c] = 1; fix.push(c); }
    for (let i = 0; i < n; i++) if (!seenT[i]) fix.push(i);
    tour.length = 0;
    for (const c of fix) tour.push(c);
  }

  stats.ms = Date.now() - t0;
  return { tour, len: tourLen(D, tour), stats };
}

/* Single-front control: cursor on A, next = nearest unvisited city that the far
 * pole Z does not claim (distance to the cursor below distance to Z), falling
 * back to the nearest when every candidate is claimed. Closes back onto A. */
function solveVeto(D, P, n, stats, t0, A, Z) {
  const used = new Uint8Array(n);
  const path = [A];
  used[A] = 1;
  let cursor = A;
  for (let step = 1; step < n; step++) {
    if (P.tail > 0 && n - step <= P.tail) {
      const rest = [];
      for (let i = 0; i < n; i++) if (!used[i]) rest.push(i);
      const order = bestTail(D, cursor, rest, A);
      for (const c of order) { path.push(c); used[c] = 1; stats.moves++; }
      stats.tailCities = order.length;
      break;
    }
    let best = -1, bestD = Infinity, fallback = -1, fbD = Infinity;
    for (let i = 0; i < n; i++) {
      if (used[i]) continue;
      const d = D[cursor][i];
      if (d < fbD) { fbD = d; fallback = i; }
      if (d < D[i][Z] && d < bestD) { bestD = d; best = i; }
    }
    if (best < 0) best = fallback;
    if (best < 0) break;
    path.push(best); used[best] = 1; cursor = best; stats.moves++;
  }
  const tour = path;
  stats.ms = Date.now() - t0;
  return { tour, len: tourLen(D, tour), stats };
}

module.exports = { DEFAULTS, solve, insertion, tourLen, checkTour, farthestPair };
