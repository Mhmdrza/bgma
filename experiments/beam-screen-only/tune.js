#!/usr/bin/env node
/* tune.js -- sweep the knobs of the two-step solver (beam + fast screen).
 *
 * The pipeline under test is steps 1 and 2 of BGMA and nothing else:
 *   beam islands -> fast candidate-list screen -> shortest tour wins
 * There is no elite pool, no ERX, no kick/anneal, no full polish. The question
 * is how close this gets, and at what cost, to the full hybrid.
 *
 * Stage 1 sweeps islands x K x screenF with one restart. Stage 2 takes the best
 * stage-1 configurations and spends more restarts on them. Everything is
 * scored against the best length any configuration found on the same instance,
 * so the reported gap is a tournament gap, not a gap to the optimum.
 *
 * usage:
 *   node experiments/beam-screen-only/tune.js
 *   node experiments/beam-screen-only/tune.js --ns=100,200,300 --seeds=2 --kinds=uniform,cluster
 *   node experiments/beam-screen-only/tune.js --islands=2,4 --kfrac=4,3 --screenF=1,4,0
 *   node experiments/beam-screen-only/tune.js --top=0     # stage 1 only
 *   node experiments/beam-screen-only/tune.js --json=experiments/beam-screen-only/tuning.json
 */
'use strict';
const fs = require('fs');
const { B, beamScreen } = require('../../src/hybrid/bgma.js');

const CFG = {
  ns: '100,200,300', seeds: 2, kinds: 'uniform,cluster',
  islands: '2,4,8,16', kfrac: '4,3,2', screenF: '1,2,4,8,0',
  restarts: '2,4', top: 8, json: ''
};
const NUM = { seeds: 1, top: 1 };
process.argv.slice(2).forEach(a => {
  const m = /^--([a-zA-Z]+)=(.*)$/.exec(a);
  if (!m || !(m[1] in CFG)) throw new Error('bad flag: ' + a);
  CFG[m[1]] = NUM[m[1]] ? +m[2] : m[2];
});
const NS = CFG.ns.split(',').map(Number).filter(n => n > 3);
const KINDS = CFG.kinds.split(',').filter(Boolean);
const ISLANDS = CFG.islands.split(',').map(Number);
const KFRAC = CFG.kfrac.split(',').map(Number);
const SCREENF = CFG.screenF.split(',').map(Number);
const RESTARTS = CFG.restarts.split(',').map(Number);

const clock = fn => { const t0 = process.hrtime.bigint(); const v = fn(); return [Number(process.hrtime.bigint() - t0) / 1e6, v]; };
const med = a => { const b = a.slice().sort((x, y) => x - y); return b.length % 2 ? b[b.length >> 1] : (b[b.length / 2 - 1] + b[b.length / 2]) / 2; };
const padR = (s, w) => { s = String(s); while (s.length < w) s += ' '; return s; };
const padL = (s, w) => { s = String(s); while (s.length < w) s = ' ' + s; return s; };
const pcent = x => (x >= 0 ? '+' : '') + x.toFixed(2) + '%';
const ms = x => x < 1 ? (x * 1000).toFixed(0) + 'us' : x < 1000 ? x.toFixed(0) + 'ms' : (x / 1000).toFixed(2) + 's';
const rnd = (x, lo) => Math.max(lo, Math.round(x));

/* ------------------------------- instances ------------------------------- */

const insts = [];
for (const n of NS) for (let s = 1; s <= CFG.seeds; s++) for (const kind of KINDS) {
  const inst = B.buildInstance(n, s, kind, Math.max(10, Math.round(n / 10)));
  inst.seed = s;
  inst.kind = kind;
  insts.push(inst);
}

function configFor(n, islands, kfrac, screenF, restarts) {
  return {
    islands,
    K: rnd(n / kfrac, 16),
    screenF,
    restarts
  };
}

function label(c, n) {
  return 'i' + c.islands + ' K=n/' + Math.round(n / c.K) + ' F' + (c.screenF || 'all') +
    (c.restarts > 1 ? ' r' + c.restarts : '');
}

/* One configuration over every instance. Returns per-instance lengths and ms. */
function runConfig(make) {
  return insts.map(inst => {
    const c = make(inst.n);
    const [msv, res] = clock(() => beamScreen(inst, 1, c));
    return { n: inst.n, kind: inst.kind, seed: inst.seed, len: res.len, ms: msv, cfg: c };
  });
}

const stage1 = [];
for (const islands of ISLANDS) for (const kfrac of KFRAC) for (const screenF of SCREENF) {
  stage1.push({
    name: label(configFor(NS[0], islands, kfrac, screenF, 1), NS[0]),
    islands, kfrac, screenF, restarts: 1,
    rows: runConfig(n => configFor(n, islands, kfrac, screenF, 1))
  });
}

/* best length per instance across stage 1 (the tournament reference) */
const ref = new Map();
for (const c of stage1) for (const r of c.rows) {
  const k = r.n + '|' + r.seed + '|' + r.kind;
  if (!ref.has(k) || r.len < ref.get(k)) ref.set(k, r.len);
}
const gapOf = (rows, fn) => rows.map(r => (fn(r.len) / ref.get(r.n + '|' + r.seed + '|' + r.kind) - 1) * 100);

function summarise(c) {
  const g = gapOf(c.rows, x => x);
  return { gap: med(g), meanGap: g.reduce((s, x) => s + x, 0) / g.length, ms: med(c.rows.map(r => r.ms)) };
}

console.log('');
console.log('beam+screen tuning   n=' + NS.join('/') + '  seeds=' + CFG.seeds + '  ' + KINDS.join('+') +
            '  (' + insts.length + ' instances)');
console.log('');
console.log(padR('config', 26) + padL('med gap', 9) + padL('mean gap', 10) + padL('med ms', 9));
const ranked = stage1.map(c => ({ c, s: summarise(c) })).sort((a, b) => a.s.gap - b.s.gap);
for (const { c, s } of ranked) {
  console.log(padR(c.name, 26) + padL(pcent(s.gap), 9) + padL(pcent(s.meanGap), 10) + padL(ms(s.ms), 9));
}

/* stage 2: spend more restarts on the best few configurations */
const extra = [];
for (const { c } of ranked.slice(0, CFG.top)) {
  for (const r of RESTARTS) {
    if (r <= 1) continue;
    extra.push({
      name: label(configFor(NS[0], c.islands, c.kfrac, c.screenF, r), NS[0]),
      islands: c.islands, kfrac: c.kfrac, screenF: c.screenF, restarts: r,
      rows: runConfig(n => configFor(n, c.islands, c.kfrac, c.screenF, r))
    });
  }
}
if (extra.length) {
  console.log('');
  console.log('RESTARTS on the top ' + CFG.top + ' configurations');
  console.log(padR('config', 26) + padL('med gap', 9) + padL('mean gap', 10) + padL('med ms', 9));
  const ex = extra.map(c => ({ c, s: summarise(c) })).sort((a, b) => a.s.gap - b.s.gap);
  for (const { c, s } of ex.slice(0, 20)) {
    console.log(padR(c.name, 26) + padL(pcent(s.gap), 9) + padL(pcent(s.meanGap), 10) + padL(ms(s.ms), 9));
  }
}

if (CFG.json) {
  const out = [{ stage: 1, configs: ranked.map(({ c, s }) => ({
    islands: c.islands, kfrac: c.kfrac, screenF: c.screenF, restarts: 1,
    medGap: s.gap, meanGap: s.meanGap, medMs: s.ms,
    rows: c.rows.map(r => ({ n: r.n, seed: r.seed, kind: r.kind, len: r.len, ms: r.ms }))
  })) }];
  if (extra.length) out.push({ stage: 2, configs: extra.map(c => ({
    islands: c.islands, kfrac: c.kfrac, screenF: c.screenF, restarts: c.restarts,
    medGap: summarise(c).gap, meanGap: summarise(c).meanGap, medMs: summarise(c).ms,
    rows: c.rows.map(r => ({ n: r.n, seed: r.seed, kind: r.kind, len: r.len, ms: r.ms }))
  })) });
  fs.writeFileSync(CFG.json, JSON.stringify(out, null, 2) + '\n');
  console.log('');
  console.log('wrote      : ' + CFG.json);
}
console.log('');
