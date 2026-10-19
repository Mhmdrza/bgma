#!/usr/bin/env node
/* hybrid_effort.js -- BGMA with an --effort dial.
 *
 * The pipeline is the same as hybrid_tsp.js; what changes is how much of the
 * search budget each level spends. The levels were tuned on synthetic
 * uniform/cluster instances (see TUNING_NOTES.md):
 *
 *   low    ~0.1 s at n=200   interactive / seed for another solver
 *   mid    ~0.3 s at n=200   clearly better than the tuned beam
 *   high   ~0.8 s at n=200
 *   xhigh  ~2.2 s at n=200   usually within a few tour edges of the best
 *   max    ~7 s at n=200     xhigh run + heavier max run, shorter tour wins
 *
 * usage:
 *   node hybrid_effort.js --n=200 --effort=mid
 *   node hybrid_effort.js --n=200 --effort=max --bound=1 --tour=tour.txt
 *   node hybrid_effort.js --ns=50,100,200 --efforts=low,mid,high,xhigh,max --seeds=2
 *   node hybrid_effort.js --n=200 --effort=high --set=children=20,polish=10
 *   node hybrid_effort.js --n=20 --effort=max --exact=1
 *
 * flags:
 *   --n=200              instance size
 *   --ns=50,100,200      benchmark several sizes instead of --n
 *   --effort=mid         low | mid | high | xhigh | max
 *   --efforts=a,b,c      benchmark several levels (overrides --effort)
 *   --seed=1 --seeds=1   instance seed / number of seeds
 *   --kind=uniform       uniform | cluster | both
 *   --bound=0            print a proven 1-tree lower bound
 *   --boundIters=600     subgradient iterations for the bound
 *   --exact=0            Held-Karp comparison (n <= 22)
 *   --tour=FILE          write the best tour of a single run
 *   --json=FILE          write every run as JSON
 *   --verbose=0          print the expanded knob mapping
 *   --set=k=v,k=v        override individual knobs after the preset
 */
'use strict';
const fs = require('fs');
const { B, runEffort, effortPreset, DEFAULTS } = require('./bgma.js');
const { hkBound } = require('./hybrid_vis.js');

const CFG = {
  n: 200, ns: '', effort: 'mid', efforts: '', seed: 1, seeds: 1, kind: 'uniform',
  bound: 0, boundIters: 600, exact: 0, tour: '', json: '', verbose: 0, set: ''
};
const NUM = { n: 1, seed: 1, seeds: 1, bound: 1, boundIters: 1, exact: 1, verbose: 1 };
process.argv.slice(2).forEach(a => {
  const m = /^--([a-zA-Z]+)=(.*)$/.exec(a);
  if (!m || !(m[1] in CFG)) throw new Error('bad flag: ' + a);
  CFG[m[1]] = NUM[m[1]] ? +m[2] : m[2];
});

const NS = CFG.ns ? CFG.ns.split(',').map(Number).filter(x => x > 3) : [CFG.n];
if (!NS.length || NS.some(n => !isFinite(n) || n < 4)) throw new Error('n must be >= 4');
const EFFORTS = CFG.efforts ? CFG.efforts.split(',').map(s => s.trim()).filter(Boolean) : [CFG.effort];
const KINDS = CFG.kind === 'both' ? ['uniform', 'cluster'] : [CFG.kind];
const OVERRIDES = {};
if (CFG.set) {
  for (const kv of CFG.set.split(',')) {
    const [k, v] = kv.split('=');
    if (!k || v == null || !(k in DEFAULTS)) throw new Error('bad override: ' + kv);
    const num = Number(v);
    if (!isFinite(num)) throw new Error('override needs a number: ' + kv);
    OVERRIDES[k] = num;
  }
}

const clock = fn => { const t0 = process.hrtime.bigint(); const v = fn(); return [Number(process.hrtime.bigint() - t0) / 1e6, v]; };
const ms = x => x < 1 ? (x * 1000).toFixed(0) + 'us' : x < 1000 ? x.toFixed(0) + 'ms' : (x / 1000).toFixed(2) + 's';
const pct = x => (x >= 0 ? '+' : '') + x.toFixed(2) + '%';
const padR = (s, w) => { s = String(s); while (s.length < w) s += ' '; return s; };
const padL = (s, w) => { s = String(s); while (s.length < w) s = ' ' + s; return s; };

function mapping(level, n) {
  const L = String(level).toLowerCase();
  const p = Object.assign({}, effortPreset(L, n), OVERRIDES);
  const near = p.near || Math.max(10, Math.round(n / 10));
  return Object.assign({ near: near }, p, L === 'max' ? { portfolio: 'xhigh+max' } : {});
}

const results = [];
let worstInvalid = 0;

for (const n of NS) {
  for (let s = CFG.seed; s < CFG.seed + CFG.seeds; s++) {
    for (const kind of KINDS) {
      const nearK = Math.max(10, Math.round(n / 10));
      const inst = B.buildInstance(n, s, kind, nearK);
      inst.seed = s; inst.kind = kind;
      let exact = null;
      if (CFG.exact) {
        if (n > 22) throw new Error('--exact needs n <= 22');
        exact = B.heldKarp(inst).len;
      }

      const runRows = [];
      for (const level of EFFORTS) {
        const opts = mapping(level, n);
        const [t, res] = clock(() => runEffort(inst, s, level, OVERRIDES));
        const ok = B.checkTour(res.tour, n);
        if (!ok) worstInvalid++;
        const row = { n, seed: s, kind, effort: level, len: res.len, ms: t, ok,
                      tour: res.tour, knobs: opts };
        runRows.push(row);
      }
      const ref = runRows.reduce((a, r) => Math.min(a, r.len), Infinity);
      let bound = null;
      if (CFG.bound) {
        const [bt, bv] = clock(() => hkBound(inst.rows, exact || ref, CFG.boundIters));
        bound = bv;
      }
      for (const r of runRows) {
        r.gapRef = (r.len / ref - 1) * 100;
        r.exact = exact;
        r.gapExact = exact != null ? (r.len / exact - 1) * 100 : null;
        r.bound = bound;
        r.gapBound = bound != null ? (r.len / bound - 1) * 100 : null;
        results.push(r);
        if (CFG.verbose) {
          const k = r.knobs;
          console.log(padR('effort=' + r.effort + ' n=' + n, 22) +
            'islands=' + k.islands + ' K=' + k.K + ' elites=' + k.elites + ' gens=' + k.gens +
            ' children=' + k.children + ' polish=' + k.polish + ' finalPolish=' + k.finalPolish +
            ' restarts=' + k.restarts + ' oroptL=' + (k.polishOrOptMaxL || 5));
        }
      }

      {
        const best = runRows.slice().sort((a, b) => a.len - b.len)[0];
        if (EFFORTS.length === 1) {
          console.log(padR('n=' + n + ' s=' + s + ' ' + kind, 22) +
            padR('effort=' + best.effort, 16) + padL(best.len.toFixed(2), 10) +
            padL(ms(best.ms), 8) +
            (exact != null ? '  exact=' + exact.toFixed(2) + '  gap=' + pct(best.gapExact) +
              (best.len <= exact + 1e-9 ? '  OPTIMAL' : '') : '') +
            (bound != null ? '  bound=' + bound.toFixed(2) + '  gap<=' + pct(best.gapBound) +
              (best.len <= bound + 1e-6 ? '  PROVEN OPTIMAL' : '') : ''));
        } else {
          for (const r of runRows.slice().sort((a, b) => a.len - b.len)) {
            console.log(padR('n=' + n + ' s=' + s + ' ' + kind, 22) +
              padR('effort=' + r.effort, 16) + padL(r.len.toFixed(2), 10) +
              padL(ms(r.ms), 8) + padL(pct(r.gapRef), 9) +
              (exact != null ? '  gap=' + pct(r.gapExact) +
                (r.len <= exact + 1e-9 ? '  OPTIMAL' : '') : '') +
              (bound != null ? '  gap<=' + pct(r.gapBound) +
                (r.len <= bound + 1e-6 ? '  PROVEN OPTIMAL' : '') : ''));
          }
        }
      }
    }
  }
}

/* summary when more than one effort/size was requested */
if (EFFORTS.length > 1 || NS.length > 1 || KINDS.length > 1 || CFG.seeds > 1) {
  console.log('');
  console.log('SUMMARY  (' + (results.length / EFFORTS.length) + ' instances per level)');
  console.log('');
  console.log(padR('effort', 10) + padL('med len', 11) + padL('med ref', 10) + padL('mean ref', 10) +
              padL('worst ref', 11) + padL('med bound', 11) + padL('med ms', 10));
  const med = a => { const b = a.slice().sort((x, y) => x - y); return b[b.length >> 1]; };
  for (const level of EFFORTS) {
    const rr = results.filter(r => r.effort === level);
    const refs = rr.map(r => r.gapRef);
    const gb = rr.map(r => r.gapBound).filter(x => x != null);
    console.log(padR(level, 10) + padL(med(rr.map(r => r.len)).toFixed(2), 11) +
      padL(pct(med(refs)), 10) + padL(pct(refs.reduce((s, x) => s + x, 0) / refs.length), 10) +
      padL(pct(Math.max.apply(null, refs)), 11) +
      padL(gb.length ? pct(med(gb)) : '—', 11) +
      padL(ms(med(rr.map(r => r.ms))), 10));
  }
}

if (worstInvalid) console.error('WARNING: ' + worstInvalid + ' invalid tours');

/* single-run tour output */
if (CFG.tour) {
  if (results.length !== 1) throw new Error('--tour needs exactly one run (one n, seed, kind and effort)');
  const r = results[0];
  const head = '# hybrid_effort n=' + r.n + ' seed=' + r.seed + ' kind=' + r.kind +
               ' effort=' + r.effort + ' len=' + r.len.toFixed(6);
  fs.writeFileSync(CFG.tour, head + '\n' + r.tour.join(',') + '\n');
}

if (CFG.json) {
  const clean = results.map(r => ({
    n: r.n, seed: r.seed, kind: r.kind, effort: r.effort, len: r.len, ms: r.ms, ok: r.ok,
    exact: r.exact, bound: r.bound, gapRef: r.gapRef, gapExact: r.gapExact, gapBound: r.gapBound,
    knobs: r.knobs
  }));
  fs.writeFileSync(CFG.json, JSON.stringify(clean, null, 2) + '\n');
}

if (CFG.tour) console.log('tour      : ' + CFG.tour);
if (CFG.json) console.log('json      : ' + CFG.json);
