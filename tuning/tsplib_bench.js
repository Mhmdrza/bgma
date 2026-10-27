#!/usr/bin/env node
/* tsplib_bench.js -- measure BGMA against a *known optimum*, not a lower bound.
 *
 * The 1-tree number reported by the stress harness is a relaxation, so
 * `tour / bound - 1` is only a ceiling on the true gap. TSPLIB instances ship
 * with a proven optimum, which turns the same run into a real measurement:
 *
 *   true gap = tour / OPT - 1
 *
 * TSPLIB EUC_2D distances are nint(sqrt(dx^2 + dy^2)), so the instance is built
 * with integer-rounded distances and the solver optimises exactly the published
 * objective.
 *
 * usage:
 *   node tuning/tsplib_bench.js --file=pr1002.tsp --opt=259045 --levels=max --jobs=3
 *   node tuning/tsplib_bench.js --file=eil51.tsp --opt=426 --levels=low,mid,high,xhigh,max
 *   node tuning/tsplib_bench.js --file=pr1002.tsp --opt=259045 --check
 *   node tuning/tsplib_bench.js --file=eil51.tsp --opt=426 --levels=lk,max   # lk = src/lkh/lkh.js baseline
 *
 *   node tuning/tsplib_bench.js --file=pcb442.tsp --opt=50778 --levels=lk --lkBudget=60000   # LK restarts for 60 s of CPU
 *
 * flags: --file --opt --levels --jobs --boundIters --seed --json --check --lkBudget
 */
'use strict';
const fs = require('fs');
const os = require('os');
const { unitsFor, combineUnits } = require('../src/hybrid/bgma.js');
const { runPool } = require('../src/hybrid/pool.js');
const { buildFromPoints } = require('../src/hybrid/instance.js');
const { hkBound, greedy, tourLen } = require('../src/hybrid/hybrid_vis.js');
const lkh = require('../src/lkh/lkh.js');

const CFG = {
  file: '', opt: 0, levels: 'max', seed: 1, boundIters: 600, json: '', check: 0, lkBudget: 0,
  jobs: Math.min(6, Math.max(1, os.cpus().length - 1))
};
const NUM = new Set(['opt', 'seed', 'boundIters', 'jobs', 'check', 'lkBudget']);
process.argv.slice(2).forEach(a => {
  if (a === '--check') { CFG.check = 1; return; }
  const m = /^--([a-zA-Z]+)=(.*)$/.exec(a);
  if (!m || !(m[1] in CFG)) throw new Error('bad flag: ' + a);
  CFG[m[1]] = NUM.has(m[1]) ? +m[2] : m[2];
});
if (!CFG.file) throw new Error('need --file=<name>.tsp');

/* ---------------------------------------------------------------- parser --- */
function parseTSPLIB(text) {
  const head = {};
  const lines = text.split(/\r?\n/);
  let i = 0;
  for (; i < lines.length; i++) {
    const ln = lines[i].trim();
    if (!ln) continue;
    const m = /^([A-Z_]+)\s*:\s*(.*)$/.exec(ln);
    if (m) { head[m[1]] = m[2].trim(); continue; }
    if (/^(NODE_COORD_SECTION|EDGE_WEIGHT_SECTION)/.test(ln)) break;
  }
  const n = +head.DIMENSION;
  const ewt = (head.EDGE_WEIGHT_TYPE || '').toUpperCase();
  if (!n) throw new Error('no DIMENSION in file');
  if (ewt !== 'EUC_2D') throw new Error('this bench handles EUC_2D only, got ' + ewt);

  const pts = [];
  for (i++; i < lines.length; i++) {
    const t = lines[i].trim();
    if (!t || /^EOF$/i.test(t)) break;
    const p = t.split(/\s+/).map(Number);
    if (p.length < 3 || !isFinite(p[0])) continue;
    pts[p[0] - 1] = [p[1], p[2]];
  }
  if (pts.length !== n || pts.some(p => !p)) throw new Error('parsed ' + pts.filter(Boolean).length + ' of ' + n + ' nodes');
  return { name: head.NAME || CFG.file, n, ewt, pts };
}

function tourLenOf(rows, tour) {
  let s = 0;
  for (let i = 0; i < tour.length; i++) s += rows[tour[i]][tour[(i + 1) % tour.length]];
  return s;
}
function validTour(tour, n) {
  if (!Array.isArray(tour) || tour.length !== n) return false;
  const seen = new Uint8Array(n);
  for (const v of tour) { if (!(v >= 0 && v < n) || seen[v]) return false; seen[v] = 1; }
  return true;
}

const pct = x => (x >= 0 ? '+' : '') + x.toFixed(3) + '%';
const ms = x => x < 1000 ? x.toFixed(0) + 'ms' : (x / 1000).toFixed(1) + 's';
const padR = (s, w) => { s = String(s); while (s.length < w) s += ' '; return s; };
const padL = (s, w) => { s = String(s); while (s.length < w) s = ' ' + s; return s; };

(async function main() {
  const T = parseTSPLIB(fs.readFileSync(CFG.file, 'utf8'));
  const spec = { points: T.pts, round: true, n: T.n };
  const inst = buildFromPoints(T.pts, { round: true });

  /* Greedy is deterministic and only used as a valid upper bound for the
   * subgradient step. It is also a crude parser sanity check (~25% over OPT). */
  const greedyLen = tourLen(inst.rows, greedy(inst.rows, inst.order, 0));

  console.log(`${T.name}  n=${T.n}  EUC_2D (rounded)  optimum=${CFG.opt || '?'}  greedy=${greedyLen.toFixed(0)}`);

  if (CFG.check) {
    const ub = CFG.opt || greedyLen;
    const t0 = process.hrtime.bigint();
    const bound = hkBound(inst.rows, ub, CFG.boundIters);
    const msb = Number(process.hrtime.bigint() - t0) / 1e6;
    console.log(`certificate ${bound.toFixed(2)}  (${ms(msb)}, ${CFG.boundIters} iters)`);
    if (CFG.opt) {
      const below = (1 - bound / CFG.opt) * 100;
      console.log(`bound vs optimum: ${below.toFixed(3)}% below  ${bound <= CFG.opt + 1e-9 ? 'OK (valid)' : 'BUG: bound > optimum'}`);
    }
    return;
  }

  const LEVELS = CFG.levels.split(',');
  const tasks = [], meta = [];
  for (const level of LEVELS) if (level !== 'lk') for (const u of unitsFor(level, T.n, CFG.seed)) {
    tasks.push({ instSpec: spec, seed: u.seed, preset: u.preset, restart: u.restart });
    meta.push({ level, arm: u.arm });
  }

  const t0 = Date.now();
  const out = await runPool(tasks, CFG.jobs);
  /* the LK-style baseline runs in this thread, after the pool: one run, or with
   * --lkBudget=ms independent restarts (seed, seed+1, ...) until that much CPU time is spent */
  let lk = null;
  if (LEVELS.includes('lk')) {
    const runs = [];
    let spent = 0, s = CFG.seed, best = null;
    do {
      const lt = process.hrtime.bigint();
      const r = lkh.solve(inst.rows, { seed: s });
      const ms = Number(process.hrtime.bigint() - lt) / 1e6;
      spent += ms;
      runs.push({ seed: s++, len: r.len, ms });
      if (!best || r.len < best.len) best = { len: r.len, tour: Array.from(r.tour) };
    } while (spent < CFG.lkBudget);
    lk = { len: best.len, tour: best.tour, ms: spent, runs };
  }
  const wall = Date.now() - t0;
  const serial = out.reduce((a, r) => a + r.ms, 0) + (lk ? lk.ms : 0);

  /* fold units into the level's answer, keeping per-arm detail for `max` */
  const rows = [];
  for (const level of LEVELS) {
    if (level === 'lk') { rows.push({ level, res: lk, units: [] }); continue; }
    const units = out.map((r, i) => meta[i].level === level ? { ...r, arm: meta[i].arm } : null).filter(Boolean);
    const best = combineUnits(level, units);
    rows.push({ level, res: best, units });
  }

  const bestLen = Math.min(...rows.map(r => r.res.len));
  const bt = process.hrtime.bigint();
  const bound = hkBound(inst.rows, bestLen, CFG.boundIters);
  const boundMs = Number(process.hrtime.bigint() - bt) / 1e6;

  /* A gap is only meaningful from a real tour: check the permutation and
   * recompute the length from the distance matrix on every row. */
  let invalid = 0;
  for (const r of rows) {
    const ok = validTour(r.res.tour, T.n) && Math.abs(tourLenOf(inst.rows, r.res.tour) - r.res.len) < 1e-6;
    if (!ok) { invalid++; console.log('INVALID TOUR at level ' + r.level); }
  }
  if (invalid) throw new Error(invalid + ' invalid tour(s); refusing to report a gap');

  console.log('');
  console.log(padR('level', 8) + padL('wall', 9) + padL('tour', 12) +
    (CFG.opt ? padL('true gap', 11) : '') + padL('gap<=bound', 12));
  for (const r of rows) {
    const trueGap = CFG.opt ? (r.res.len / CFG.opt - 1) * 100 : null;
    console.log(padR(r.level, 8) + padL(ms(r.res.ms), 9) + padL(r.res.len.toFixed(3), 12) +
      (CFG.opt ? padL(pct(trueGap), 11) : '') + padL(pct((r.res.len / bound - 1) * 100), 12));
  }

  /* per-arm detail makes the `max` row interpretable: arm 0 is `xhigh`. */
  const maxRow = rows.find(r => r.level === 'max');
  if (maxRow && maxRow.units.length > 1) {
    console.log('');
    for (const u of maxRow.units) {
      const tag = u.arm === 0 ? 'max/xhigh' : 'max/restart';
      console.log(padR(tag, 14) + padL(ms(u.ms), 9) + padL(u.len.toFixed(3), 12) +
        (CFG.opt ? padL(pct((u.len / CFG.opt - 1) * 100), 11) : ''));
    }
  }

  console.log('');
  console.log(`best tour ${bestLen.toFixed(3)}   ${CFG.opt ? 'optimum ' + CFG.opt + '   true gap ' + pct((bestLen / CFG.opt - 1) * 100) : ''}   tours valid (${rows.length}/${rows.length})`);
  console.log(`1-tree certificate ${bound.toFixed(2)} (${ms(boundMs)}, ${CFG.boundIters} iters)` +
    (CFG.opt ? `   ${((1 - bound / CFG.opt) * 100).toFixed(3)}% below optimum  ->  the reported ceiling overstates the true gap by ${((bestLen / bound) / (bestLen / CFG.opt) * 100 - 100).toFixed(3)}% of tour length` : ''));
  console.log(`wall ${ms(wall)} for ${ms(serial)} of work (${(serial / wall).toFixed(2)}x with ${CFG.jobs} jobs)`);

  if (CFG.json) {
    fs.writeFileSync(CFG.json, JSON.stringify({
      name: T.name, n: T.n, seed: CFG.seed, jobs: CFG.jobs, optimum: CFG.opt || null, bound, bestLen,
      wallMs: wall, serialMs: serial,
      rows: rows.map(r => ({ level: r.level, len: r.res.len, ms: r.res.ms,
        units: r.units.map(u => ({ arm: u.arm, len: u.len, ms: u.ms })),
        runs: r.res.runs,
        tour: Array.from(r.res.tour) }))
    }, null, 2) + '\n');
    console.log('wrote ' + CFG.json);
  }
})().catch(e => { console.error(e.stack || String(e)); process.exit(1); });
