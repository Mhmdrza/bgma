#!/usr/bin/env node
/* validate_nature_effort.js -- compare nature effort presets against Held-Karp.
 *
 * Small n only (default 18,20,22): this is the ground truth the larger sweeps
 * cannot provide. Reports optimal-hit rate, mean gap to optimum and time.
 *
 * usage:
 *   node tuning/validate_nature_effort.js --ns=18,20 --seeds=5
 *   node tuning/validate_nature_effort.js --ns=22 --seeds=3
 */
'use strict';
const { B, runEffort } = require('../src/nature/nature_core.js');

const CFG = { ns: '18,20', seeds: 5 };
process.argv.slice(2).forEach(a => {
  const m = /^--([a-zA-Z]+)=(.*)$/.exec(a);
  if (!m || !(m[1] in CFG)) throw new Error('bad flag: ' + a);
  CFG[m[1]] = m[1] === 'ns' ? m[2] : +m[2];
});
const NS = CFG.ns.split(',').map(Number);
const LEVELS = ['low', 'mid', 'high', 'xhigh', 'max'];

const clock = fn => { const t0 = process.hrtime.bigint(); const v = fn(); return [Number(process.hrtime.bigint() - t0) / 1e6, v]; };
const med = a => { const b = a.slice().sort((x, y) => x - y); return b[b.length >> 1]; };
const mean = a => a.reduce((s, x) => s + x, 0) / a.length;
const pct = x => (x >= 0 ? '+' : '') + x.toFixed(3) + '%';
const padR = (s, w) => { s = String(s); while (s.length < w) s += ' '; return s; };
const padL = (s, w) => { s = String(s); while (s.length < w) s = ' ' + s; return s; };
function ms(x) { return x < 1 ? (x * 1000).toFixed(0) + 'us' : x.toFixed(0) + 'ms'; }

const rows = [];
for (const n of NS) {
  for (let s = 1; s <= CFG.seeds; s++) {
    for (const kind of ['uniform', 'cluster']) {
      const inst = B.buildInstance(n, s, kind, Math.max(10, Math.round(n / 10)));
      inst.seed = s; inst.kind = kind;
      const [ot, opt] = clock(() => B.heldKarp(inst));
      const line = [];
      for (const level of LEVELS) {
        const [dt, res] = clock(() => runEffort(inst, s, level));
        if (!B.checkTour(res.tour, n)) throw new Error('invalid tour ' + level + ' n=' + n);
        const gap = (res.len / opt.len - 1) * 100;
        rows.push({ n, seed: s, kind, level, len: res.len, opt: opt.len, ms: dt, gap });
        line.push(level + '=' + pct(gap) + '/' + dt.toFixed(0) + 'ms');
      }
      console.log(padR('n=' + n + ' s=' + s + ' ' + kind, 20) + 'opt=' + opt.len.toFixed(3) +
                  '  hk=' + ot.toFixed(0) + 'ms  ' + line.join('  '));
    }
  }
}

console.log('');
console.log('OPTIMALITY SUMMARY  (' + rows.length / LEVELS.length + ' instances)');
console.log('');
console.log(padR('level', 8) + padL('optimal', 9) + padL('mean gap', 10) + padL('worst', 9) + padL('mean ms', 10));
for (const level of LEVELS) {
  const rr = rows.filter(r => r.level === level);
  const hits = rr.filter(r => r.gap <= 1e-6).length;
  console.log(padR(level, 8) + padL(hits + '/' + rr.length, 9) +
              padL(pct(mean(rr.map(r => r.gap))), 10) +
              padL(pct(Math.max.apply(null, rr.map(r => r.gap))), 9) +
              padL(ms(mean(rr.map(r => r.ms))), 10));
}
console.log('');
