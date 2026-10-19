#!/usr/bin/env node
/* christofides.js -- Christofides' algorithm for metric TSP.
 *
 * Guarantee: for distances that satisfy the triangle inequality, the tour is at most
 * 1.5 times the optimum, in polynomial time. The steps are
 *   1. minimum spanning tree (Prim, O(n^2) on the dense matrix)
 *   2. minimum-weight perfect matching on the odd-degree vertices of the tree
 *      (Edmonds' blossom algorithm, O(k^3) for k odd vertices, k <= n)
 *   3. Euler circuit of tree + matching (Hierholzer)
 *   4. shortcut repeated vertices (triangle inequality keeps the length no larger)
 *
 * Integer weights: the matching works on integers, so distances are scaled to
 * [0, 1e6] and rounded. The matching is then optimal up to 1e-6 of the largest
 * distance per edge, which is far below anything the 1.5 bound cares about.
 *
 * usage (as a module):
 *   const { christofides } = require('./christofides.js');
 *   const tour = christofides(rows, n);   // rows[i][j] = distance, returns a permutation
 */
'use strict';

/* Maximum-weight matching on the complete graph with vertices 1..n and integer
 * weights W(u,v) > 0. Edmonds' blossom algorithm with dual variables, the O(n^3)
 * formulation with explicit blossom contraction. Returns mate[] (1-based; 0 = free). */
function maxWeightMatching(n, W) {
  var M = 2 * n + 2;
  var gu = new Int32Array(M * M), gv = new Int32Array(M * M), gw = new Float64Array(M * M);
  var u, v, x, y, b, i, p;
  for (u = 1; u <= n; u++) for (v = 1; v <= n; v++) {
    gu[u * M + v] = u; gv[u * M + v] = v;
    gw[u * M + v] = u === v ? 0 : W(u, v);
  }
  var nx = n;
  var lab = new Float64Array(M), match = new Int32Array(M), slack = new Int32Array(M);
  var st = new Int32Array(M), pa = new Int32Array(M), S = new Int32Array(M), vis = new Int32Array(M);
  var flowerFrom = new Int32Array(M * (n + 1));
  var flower = [], visT = 0, q = [], qh = 0;
  for (i = 0; i < M; i++) flower.push([]);

  function eDelta(a, c) {
    var eu = gu[a * M + c], ev = gv[a * M + c];
    return lab[eu] + lab[ev] - gw[eu * M + ev] * 2;
  }
  function copyEdge(dr, dc, sr, sc) {
    gu[dr * M + dc] = gu[sr * M + sc]; gv[dr * M + dc] = gv[sr * M + sc]; gw[dr * M + dc] = gw[sr * M + sc];
  }
  function updateSlack(a, c) {
    if (!slack[c] || eDelta(a, c) < eDelta(slack[c], c)) slack[c] = a;
  }
  function setSlack(c) {
    slack[c] = 0;
    for (var a = 1; a <= n; a++) if (gw[a * M + c] > 0 && st[a] !== c && S[st[a]] === 0) updateSlack(a, c);
  }
  function qPush(c) {
    if (c <= n) q.push(c);
    else for (var k = 0; k < flower[c].length; k++) qPush(flower[c][k]);
  }
  function setSt(c, bb) {
    st[c] = bb;
    if (c > n) for (var k = 0; k < flower[c].length; k++) setSt(flower[c][k], bb);
  }
  function getPr(bb, xr) {
    var f = flower[bb], pr = f.indexOf(xr);
    if (pr % 2 === 1) {
      var rest = f.splice(1).reverse();
      for (var k = 0; k < rest.length; k++) f.push(rest[k]);
      return f.length - pr;
    }
    return pr;
  }
  function setMatch(a, c) {
    match[a] = gv[a * M + c];
    if (a > n) {
      var xr = flowerFrom[a * (n + 1) + gu[a * M + c]], pr = getPr(a, xr), f = flower[a];
      for (var k = 0; k < pr; k++) setMatch(f[k], f[k ^ 1]);
      setMatch(xr, c);
      var head = f.splice(0, pr);
      for (var j = 0; j < head.length; j++) f.push(head[j]);
    }
  }
  function augment(a, c) {
    for (;;) {
      var xnv = st[match[a]];
      setMatch(a, c);
      if (!xnv) return;
      setMatch(xnv, st[pa[xnv]]);
      a = st[pa[xnv]]; c = xnv;
    }
  }
  function getLca(a, c) {
    visT++;
    while (a || c) {
      if (a) {
        if (vis[a] === visT) return a;
        vis[a] = visT;
        a = st[match[a]];
        if (a) a = st[pa[a]];
      }
      var t = a; a = c; c = t;
    }
    return 0;
  }
  function addBlossom(a, lca, c) {
    b = n + 1;
    while (b <= nx && st[b]) b++;
    if (b > nx) nx++;
    lab[b] = 0; S[b] = 0; match[b] = match[lca];
    var f = flower[b];
    f.length = 0;
    f.push(lca);
    var yy = 0, xx;
    for (xx = a; xx !== lca; xx = st[pa[yy]]) { f.push(xx); yy = st[match[xx]]; f.push(yy); qPush(yy); }
    var rest = f.splice(1).reverse();
    for (var k = 0; k < rest.length; k++) f.push(rest[k]);
    for (xx = c; xx !== lca; xx = st[pa[yy]]) { f.push(xx); yy = st[match[xx]]; f.push(yy); qPush(yy); }
    setSt(b, b);
    for (x = 1; x <= nx; x++) { gw[b * M + x] = 0; gw[x * M + b] = 0; }
    for (x = 1; x <= n; x++) flowerFrom[b * (n + 1) + x] = 0;
    for (var m = 0; m < f.length; m++) {
      var xs = f[m];
      for (x = 1; x <= nx; x++) {
        if (gw[b * M + x] === 0 || eDelta(xs, x) < eDelta(b, x)) {
          copyEdge(b, x, xs, x);
          copyEdge(x, b, x, xs);
        }
      }
      for (x = 1; x <= n; x++) if (flowerFrom[xs * (n + 1) + x]) flowerFrom[b * (n + 1) + x] = xs;
    }
    setSlack(b);
  }
  function expandBlossom(bb) {
    var f = flower[bb], k;
    for (k = 0; k < f.length; k++) setSt(f[k], f[k]);
    var xr = flowerFrom[bb * (n + 1) + gu[bb * M + pa[bb]]], pr = getPr(bb, xr);
    f = flower[bb];
    for (k = 0; k < pr; k += 2) {
      var xs = f[k], xns = f[k + 1];
      pa[xs] = gu[xns * M + xs];
      S[xs] = 1; S[xns] = 0; slack[xs] = 0;
      setSlack(xns); qPush(xns);
    }
    S[xr] = 1; pa[xr] = pa[bb];
    for (k = pr + 1; k < f.length; k++) { S[f[k]] = -1; setSlack(f[k]); }
    st[bb] = 0;
  }
  function onFoundEdge(a, c) {
    var eu = gu[a * M + c], ev = gv[a * M + c];
    var uu = st[eu], vv = st[ev];
    if (S[vv] === -1) {
      pa[vv] = eu; S[vv] = 1;
      var nu = st[match[vv]];
      slack[vv] = 0; slack[nu] = 0;
      S[nu] = 0; qPush(nu);
    } else if (S[vv] === 0) {
      var lca = getLca(uu, vv);
      if (!lca) { augment(uu, vv); augment(vv, uu); return true; }
      addBlossom(uu, lca, vv);
    }
    return false;
  }
  function phase() {
    var c, a, bb, d;
    for (x = 1; x <= nx; x++) { S[x] = -1; slack[x] = 0; }
    q = []; qh = 0;
    for (x = 1; x <= nx; x++) if (st[x] === x && !match[x]) { pa[x] = 0; S[x] = 0; qPush(x); }
    if (q.length === 0) return false;
    for (;;) {
      while (qh < q.length) {
        a = q[qh++];
        if (S[st[a]] === 1) continue;
        for (c = 1; c <= n; c++) {
          if (gw[a * M + c] > 0 && st[a] !== st[c]) {
            if (eDelta(a, c) === 0) { if (onFoundEdge(a, c)) return true; }
            else updateSlack(a, st[c]);
          }
        }
      }
      d = Infinity;
      for (bb = n + 1; bb <= nx; bb++) if (st[bb] === bb && S[bb] === 1) d = Math.min(d, lab[bb] / 2);
      for (x = 1; x <= nx; x++) {
        if (st[x] === x && slack[x]) {
          if (S[x] === -1) d = Math.min(d, eDelta(slack[x], x));
          else if (S[x] === 0) d = Math.min(d, eDelta(slack[x], x) / 2);
        }
      }
      for (a = 1; a <= n; a++) {
        if (S[st[a]] === 0) { if (lab[a] <= d) return false; lab[a] -= d; }
        else if (S[st[a]] === 1) lab[a] += d;
      }
      for (bb = n + 1; bb <= nx; bb++) if (st[bb] === bb) {
        if (S[st[bb]] === 0) lab[bb] += d * 2;
        else if (S[st[bb]] === 1) lab[bb] -= d * 2;
      }
      q = []; qh = 0;
      for (x = 1; x <= nx; x++) {
        if (st[x] === x && slack[x] && st[slack[x]] !== x && eDelta(slack[x], x) === 0) {
          if (onFoundEdge(slack[x], x)) return true;
        }
      }
      for (bb = n + 1; bb <= nx; bb++) if (st[bb] === bb && S[bb] === 1 && lab[bb] === 0) expandBlossom(bb);
    }
  }

  for (u = 0; u <= n; u++) st[u] = u;
  for (u = 1; u <= n; u++) for (v = 1; v <= n; v++) flowerFrom[u * (n + 1) + v] = u === v ? u : 0;
  var wmax = 0;
  for (u = 1; u <= n; u++) for (v = 1; v <= n; v++) wmax = Math.max(wmax, gw[u * M + v]);
  for (u = 1; u <= n; u++) lab[u] = wmax;
  while (phase()) { /* one augmentation per call */ }
  var mate = new Int32Array(n + 1);
  for (u = 1; u <= n; u++) mate[u] = match[u];
  return mate;
}

/* Minimum-weight perfect matching on the vertices verts[] (even count) of distance matrix D.
 * Returns an array of pairs [a, b] with original vertex indices. */
function minWeightPerfectMatching(D, verts) {
  var k = verts.length, i, j, maxD = 0;
  if (k % 2) throw new Error('perfect matching needs an even vertex count');
  for (i = 0; i < k; i++) for (j = i + 1; j < k; j++) maxD = Math.max(maxD, D[verts[i]][verts[j]]);
  var scale = maxD > 0 ? 1e6 / maxD : 0, C = k * 1e6 + 1;
  var mate = maxWeightMatching(k, function (a, b) {
    return C - Math.round(D[verts[a - 1]][verts[b - 1]] * scale);
  });
  var pairs = [];
  for (i = 1; i <= k; i++) if (mate[i] > i) pairs.push([verts[i - 1], verts[mate[i] - 1]]);
  return pairs;
}

/* Christofides tour for a metric distance matrix rows[i][j] over n cities. */
function christofides(rows, n) {
  var i, j;
  var inTree = new Uint8Array(n), key = new Float64Array(n).fill(Infinity), par = new Int32Array(n).fill(-1);
  var edges = [], deg = new Int32Array(n);
  key[0] = 0;
  for (var step = 0; step < n; step++) {
    var best = -1;
    for (i = 0; i < n; i++) if (!inTree[i] && (best < 0 || key[i] < key[best])) best = i;
    inTree[best] = 1;
    if (par[best] >= 0) { edges.push([par[best], best]); deg[par[best]]++; deg[best]++; }
    for (j = 0; j < n; j++) if (!inTree[j] && rows[best][j] < key[j]) { key[j] = rows[best][j]; par[j] = best; }
  }
  var odd = [];
  for (i = 0; i < n; i++) if (deg[i] % 2) odd.push(i);
  if (odd.length) edges = edges.concat(minWeightPerfectMatching(rows, odd));

  var adj = [], used = [], ptr = new Int32Array(n);
  for (i = 0; i < n; i++) adj.push([]);
  edges.forEach(function (e, id) { adj[e[0]].push(id); adj[e[1]].push(id); used.push(false); });
  var stack = [0], circuit = [];
  while (stack.length) {
    var v = stack[stack.length - 1];
    while (ptr[v] < adj[v].length && used[adj[v][ptr[v]]]) ptr[v]++;
    if (ptr[v] < adj[v].length) {
      var id = adj[v][ptr[v]++];
      used[id] = true;
      stack.push(edges[id][0] === v ? edges[id][1] : edges[id][0]);
    } else {
      circuit.push(stack.pop());
    }
  }
  var seen = new Uint8Array(n), tour = [];
  for (i = 0; i < circuit.length; i++) if (!seen[circuit[i]]) { seen[circuit[i]] = 1; tour.push(circuit[i]); }
  return tour;
}

module.exports = { christofides: christofides, minWeightPerfectMatching: minWeightPerfectMatching, maxWeightMatching: maxWeightMatching };
