#!/usr/bin/env node
/* gen_tables.js -- turn paper/data/ into the LaTeX the paper inputs.
 *
 * The paper types no measured number by hand: every value comes from a file that
 * paper/verify.sh wrote, via a macro or a table generated here.
 *
 *   node paper/gen_tables.js          -> paper/generated/*.tex
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const DATA = path.join(__dirname, 'data');
const OUT = path.join(__dirname, 'generated');
fs.mkdirSync(OUT, { recursive: true });
const read = f => JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8'));
const has = f => fs.existsSync(path.join(DATA, f));

/* ------------------------------ formatting ------------------------------ */
const tex = s => String(s).replace(/%/g, '\\%');
function t(ms) {                    // a duration, compact
  if (ms == null) return '---';
  if (ms < 1) return (ms * 1000).toFixed(0) + '\\,\\textmu s';
  if (ms < 10) return ms.toFixed(1) + '\\,ms';
  if (ms < 1000) return ms.toFixed(0) + '\\,ms';
  if (ms < 10000) return (ms / 1000).toFixed(2) + '\\,s';
  if (ms < 120000) return (ms / 1000).toFixed(1) + '\\,s';
  return (ms / 60000).toFixed(1) + '\\,min';
}
const g = (x, d) => x == null ? '---' : (x > 5e-7 ? '+' : '') + Math.max(0, x).toFixed(d == null ? 2 : d) + '\\%';
const med = a => { const b = a.slice().sort((x, y) => x - y), h = b.length >> 1; return b.length % 2 ? b[h] : (b[h - 1] + b[h]) / 2; };
const sum = a => a.reduce((s, x) => s + x, 0);

const macros = [];
const def = (name, val) => macros.push(`\\expandafter\\def\\csname ${name}\\endcsname{${val}}`);

/* ------------------------------ provenance ------------------------------ */
const sh = c => execSync(c, { cwd: path.join(__dirname, '..') }).toString().trim();
const RT = read('runtime.json');
macros.push(`\\newcommand{\\Commit}{${sh('git log -1 --format=%h --abbrev=12 -- src tuning bench paper/verify.sh')}}`);
macros.push(`\\newcommand{\\RepoDate}{${RT.meta.date}}`);
macros.push(`\\newcommand{\\NodeVersion}{${RT.meta.node}}`);
macros.push(`\\newcommand{\\CPU}{${RT.meta.cpu}}`);
macros.push(`\\newcommand{\\Platform}{${RT.meta.platform.replace('/', ', ')}}`);
/* lookups: \rt{method}{n}{ms|gap}, \ts{instance}{field}, \num{key}; missing keys print ?? */
macros.push('\\newcommand{\\lookup}[1]{\\ifcsname #1\\endcsname\\csname #1\\endcsname\\else\\textbf{??#1}\\fi}');
macros.push('\\newcommand{\\rt}[3]{\\lookup{rt@#1@#2@#3}}');
macros.push('\\newcommand{\\ts}[2]{\\lookup{ts@#1@#2}}');
macros.push('\\newcommand{\\val}[1]{\\lookup{v@#1}}');

/* ------------------------- Held-Karp, n = 18..22 ------------------------ */
{
  let inst = 0, hits = {}, hk = { 18: [], 20: [], 22: [] };
  for (const f of ['validate_18_20.txt', 'validate_22.txt']) {
    const txt = fs.readFileSync(path.join(DATA, f), 'utf8');
    for (const m of txt.matchAll(/^n=(\d+) s=\d+ \w+\s+opt=\S+\s+hk=(\d+)ms/gm)) { inst++; hk[m[1]].push(+m[2]); }
    for (const m of txt.matchAll(/^(low|mid|high|xhigh|max)\s+(\d+)\/(\d+)/gm)) hits[m[1]] = (hits[m[1]] || 0) + +m[2];
  }
  def('v@hkInstances', inst);
  def('v@hkHitsAll', Object.values(hits).every(h => h === inst) ? `${inst}/${inst}` : 'not all');
  for (const n of [18, 20, 22]) def('v@hk' + n, `${t(Math.min(...hk[n]))}--${t(Math.max(...hk[n]))}`);
}

/* ------------------- synthetic runtime / quality table ------------------- */
const RT_ROWS = [
  ['greedy', 'Greedy nearest neighbour'], ['christofides', 'Christofides'],
  ['tuned', 'Beam + polish (4 restarts)'], ['lkh', 'LK-style ILS'],
  ['bgma-low', 'BGMA \\lvl{low}'], ['bgma-mid', 'BGMA \\lvl{mid}'], ['bgma-high', 'BGMA \\lvl{high}'],
  ['bgma-xhigh', 'BGMA \\lvl{xhigh}'], ['bgma-max', 'BGMA \\lvl{max}'],
  ['bound', '1-tree bound (400 it.)'], ['exact', 'Held--Karp']
];
const byId = Object.fromEntries(RT.methods.map(m => [m.id, m]));
for (const m of RT.methods) for (const n of RT.ns) {
  const c = m.cells[n];
  if (!c) continue;
  def(`rt@${m.id}@${n}@ms`, t(c.ms));
  if (c.gapPct != null) def(`rt@${m.id}@${n}@gap`, g(c.gapPct));
}
{
  const head = RT.ns.map(n => `$n=${n}$`).join(' & ');
  let s = `\\begin{tabular}{@{}l${'r'.repeat(RT.ns.length * 2)}@{}}\n\\toprule\n` +
    ` & \\multicolumn{${RT.ns.length}}{c}{median time} & \\multicolumn{${RT.ns.length}}{c}{mean excess over best found}\\\\\n` +
    `\\cmidrule(lr){2-${RT.ns.length + 1}}\\cmidrule(l){${RT.ns.length + 2}-${2 * RT.ns.length + 1}}\n` +
    `method & ${head} & ${head}\\\\\n\\midrule\n`;
  for (const [id, label] of RT_ROWS) {
    const m = byId[id];
    if (!m) continue;
    if (id === 'bound') s += '\\midrule\n';
    s += label + ' & ' + RT.ns.map(n => m.cells[n] ? t(m.cells[n].ms) : '---').join(' & ') + ' & ' +
      RT.ns.map(n => m.cells[n] && m.cells[n].gapPct != null ? g(m.cells[n].gapPct) : '').join(' & ') + '\\\\\n';
  }
  s += '\\bottomrule\n\\end{tabular}\n';
  fs.writeFileSync(path.join(OUT, 'runtime_table.tex'), s);

  /* time-vs-excess curve at the two largest sizes: BGMA levels as a line, baselines as points */
  const pt = (id, n) => { const c = byId[id].cells[n]; return `(${(c.ms / 1000).toPrecision(4)},${Math.max(c.gapPct, 0.003).toFixed(3)})`; };
  const LV = ['low', 'mid', 'high', 'xhigh', 'max'];
  const axes = RT.ns.slice(-2).map((n, i) =>
    `\\begin{axis}[name=a${i},${i ? 'at={(a0.east)},anchor=west,xshift=1.2cm,' : ''}width=0.47\\textwidth,height=5.2cm,xmode=log,ymode=log,` +
    `clip=false,title={$n=${n}$},xlabel={time (s)},${i ? '' : 'ylabel={mean excess (\\%)},'}grid=major,grid style={gray!20},` +
    `legend style={font=\\scriptsize,at={(0.03,0.03)},anchor=south west},tick label style={font=\\scriptsize}]\n` +
    `\\addplot[thick,mark=*,blue!70!black] coordinates {${LV.map(l => pt('bgma-' + l, n)).join(' ')}};\n` +
    LV.map(l => `\\node[font=\\tiny,anchor=south west] at (axis cs:${pt('bgma-' + l, n).slice(1, -1)}) {${l}};\n`).join('') +
    `\\addplot[only marks,mark=square*,red!70!black] coordinates {${pt('lkh', n)}};\n` +
    `\\addplot[only marks,mark=triangle*,orange!80!black] coordinates {${pt('tuned', n)}};\n` +
    `\\addplot[only marks,mark=diamond*,gray] coordinates {${pt('christofides', n)}};\n` +
    (i ? `\\legend{BGMA levels,LK-style ILS,beam + polish,Christofides}\n` : '') +
    `\\end{axis}\n`);
  fs.writeFileSync(path.join(OUT, 'curve.tex'), `\\begin{tikzpicture}\n${axes.join('')}\\end{tikzpicture}\n`);
  /* the ladder: cost ratio between consecutive levels, at every n */
  const L = ['low', 'mid', 'high', 'xhigh', 'max'];
  for (const n of RT.ns) {
    const ms = L.map(l => byId['bgma-' + l].cells[n].ms);
    const r = ms.slice(1).map((x, i) => x / ms[i]);
    def(`v@ratios${n}`, r.map(x => x.toFixed(1)).join(', '));
  }
  def('v@lowVsLkTime400', (byId['bgma-low'].cells[400].ms / byId.lkh.cells[400].ms).toFixed(2));
  def('v@xhighVsLk400', (byId['bgma-xhigh'].cells[400].ms / byId.lkh.cells[400].ms).toFixed(0));
  def('v@maxVsLk400', (byId['bgma-max'].cells[400].ms / byId.lkh.cells[400].ms).toFixed(0));
  def('v@tunedVsLow400', (byId.tuned.cells[400].ms / byId['bgma-low'].cells[400].ms).toFixed(1));
  const ex = (id, a, b) => Math.log(byId[id].cells[b].ms / byId[id].cells[a].ms) / Math.log(b / a);
  for (const id of ['bgma-low', 'bgma-max', 'lkh']) {
    def(`v@exp@${id}`, ex(id, 100, 400).toFixed(1));
  }
  /* Christofides excess against BGMA low excess, n >= 50 */
  const ratios = RT.ns.filter(n => n >= 50).map(n => byId.christofides.cells[n].gapPct / byId['bgma-low'].cells[n].gapPct);
  def('v@chrVsLow', `${Math.min(...ratios).toFixed(0)}--${Math.max(...ratios).toFixed(0)}`);
  const cg = RT.ns.filter(n => n >= 50).map(n => byId.christofides.cells[n].gapPct);
  def('v@chrRange', `${g(Math.min(...cg))} to ${g(Math.max(...cg))}`);
  for (const id of ['bgma-low', 'bgma-max', 'lkh']) def(`v@expAll@${id}`, ex(id, RT.ns[0], RT.ns[RT.ns.length - 1]).toFixed(1));
}

/* --------------------------------- TSPLIB -------------------------------- */
const OPT = { eil51: 426, berlin52: 7542, st70: 675, kroA100: 21282, pr124: 59030, bier127: 118282,
  ch130: 6110, tsp225: 3916, fl417: 11861, pcb442: 50778, u574: 36905, rat783: 8806, pr1002: 259045, u1060: 224094 };
const runs = {};
for (const f of fs.readdirSync(path.join(DATA, 'tsplib')).filter(f => f.endsWith('.json'))) {
  const j = JSON.parse(fs.readFileSync(path.join(DATA, 'tsplib', f), 'utf8'));
  if (j.optimum !== OPT[j.name]) throw new Error(f + ': optimum ' + j.optimum + ' != ' + OPT[j.name]);
  (runs[j.name] = runs[j.name] || []).push(j);
}
const tsRows = [];
for (const name of Object.keys(OPT)) {
  const R = runs[name];
  if (!R) continue;
  R.sort((a, b) => a.seed - b.seed);
  const opt = OPT[name], n = R[0].n;
  const row = r => level => r.rows.find(x => x.level === level);
  const mx = R.map(r => row(r)('max')), lk = R.map(r => row(r)('lk'));
  for (const x of mx.concat(lk)) {
    if (x.tour.length !== n || new Set(x.tour).size !== n) throw new Error(name + ': invalid tour');
  }
  const gap = L => (L / opt - 1) * 100;
  const mxSerial = mx.map(x => sum(x.units.map(u => u.ms)));
  const mxWall = mx.map(x => Math.max(...x.units.map(u => u.ms)));
  const T = {
    name, n, opt, seeds: R.length,
    maxHits: mx.filter(x => x.len === opt).length,
    maxBest: Math.min(...mx.map(x => x.len)), maxMedGap: med(mx.map(x => gap(x.len))),
    maxWorstGap: Math.max(...mx.map(x => gap(x.len))),
    maxSerial: med(mxSerial), maxWall: med(mxWall),
    xhighHits: mx.filter(x => x.units.find(u => u.arm === 0).len === opt).length,
    lkHits: lk.filter(x => x.len === opt).length,
    lkBest: Math.min(...lk.map(x => x.len)), lkMedGap: med(lk.map(x => gap(x.len))),
    lkMs: med(lk.map(x => x.ms)), lkTotal: sum(lk.map(x => x.ms)),
    boundBelow: (1 - R[0].bound / opt) * 100, boundGap: (R[0].bestLen / R[0].bound - 1) * 100
  };
  /* LK-style restarted until it has spent the median serial cost of one BGMA max run */
  const eq = path.join(DATA, 'lk_budget', name + '.json');
  if (fs.existsSync(eq)) {
    const r = JSON.parse(fs.readFileSync(eq, 'utf8')).rows.find(x => x.level === 'lk');
    if (r.tour.length !== n || new Set(r.tour).size !== n) throw new Error(name + ': invalid LK tour');
    Object.assign(T, { eqGap: gap(r.len), eqRuns: r.runs.length, eqMs: r.ms,
      /* when, in cumulative CPU time, the restarts first reached BGMA max's median tour */
      eqMatchMs: (() => { let c = 0; const target = med(mx.map(x => x.len));
        for (const u of r.runs) { c += u.ms; if (u.len <= target) return c; } return null; })() });
  }
  tsRows.push(T);
  for (const [k, v] of Object.entries(T)) {
    const fmt = /Gap|bound/.test(k) ? g(v, 3) : /Serial|Wall|Ms|Total/.test(k) ? t(v) : v == null ? '---' : v;
    def(`ts@${name}@${k}`, fmt);
  }
  def(`ts@${name}@maxBestGap`, g(gap(T.maxBest), 3));
  /* seed-1 portfolio arms: the xhigh unit and the two max restarts */
  const u1 = mx[0].units;
  def(`ts@${name}@armXhigh`, g(gap(u1.find(u => u.arm === 0).len)));
  def(`ts@${name}@armMax`, u1.filter(u => u.arm === 1).map(u => g(gap(u.len))).join(' and '));
  def(`ts@${name}@wallS1`, t(R[0].wallMs));
  def(`ts@${name}@serialS1`, t(R[0].serialMs));
  def(`ts@${name}@lkBestGap`, g(gap(T.lkBest), 3));
}
{
  const EQ = tsRows.every(T => T.eqGap != null);   // only once every instance has its equal-time run
  let s = `\\begin{tabular}{@{}lrrrrrrrrr${EQ ? 'rrr' : ''}r@{}}\n\\toprule\n` +
    ` & & & \\multicolumn{4}{c}{BGMA \\lvl{max}} & \\multicolumn{3}{c}{LK-style, one run} & ` +
    (EQ ? `\\multicolumn{3}{c}{LK-style, equal time} & ` : '') + `1-tree\\\\\n` +
    `\\cmidrule(lr){4-7}\\cmidrule(lr){8-10}` + (EQ ? `\\cmidrule(lr){11-13}\\cmidrule(l){14-14}` : `\\cmidrule(l){11-11}`) + `\n` +
    `instance & $n$ & seeds & opt. & median & best & serial & opt. & median & time & ` +
    (EQ ? `best & runs & reached & ` : '') + `below\\\\\n` +
    ` & & & hits & gap & gap & time & hits & gap & & ` + (EQ ? `gap & & median & ` : '') + `opt.\\\\\n\\midrule\n`;
  for (const T of tsRows) {
    s += `${T.name} & ${T.n} & ${T.seeds} & ${T.maxHits}/${T.seeds} & ${g(T.maxMedGap)} & ${g((T.maxBest / T.opt - 1) * 100)} & ${t(T.maxSerial)} & ` +
      `${T.lkHits}/${T.seeds} & ${g(T.lkMedGap)} & ${t(T.lkMs)} & ` +
      (EQ ? (T.eqGap != null ? `${g(T.eqGap)} & ${T.eqRuns} & ${T.eqMatchMs == null ? 'never' : t(T.eqMatchMs)} & ` : '--- & --- & --- & ') : '') +
      `${T.boundBelow.toFixed(2)}\\%\\\\\n`;
  }
  s += '\\bottomrule\n\\end{tabular}\n';
  fs.writeFileSync(path.join(OUT, 'tsplib_table.tex'), s);

  const small = tsRows.filter(T => T.n <= 442), big = tsRows.filter(T => T.n > 442);
  def('v@tsSmallCount', small.length);
  def('v@tsSmallAllSeeds', small.filter(T => T.maxHits === T.seeds).length);
  def('v@tsSmallSomeSeed', small.filter(T => T.maxHits > 0).length);
  def('v@tsSmallRuns', sum(small.map(T => T.seeds)));
  def('v@tsSmallHits', sum(small.map(T => T.maxHits)));
  def('v@tsSmallLkHits', sum(small.map(T => T.lkHits)));
  def('v@tsSmallLkAny', small.filter(T => T.lkHits > 0).length);
  if (big.length) {
    def('v@tsBigRange', `${g(Math.min(...big.map(T => T.maxMedGap)))} to ${g(Math.max(...big.map(T => T.maxMedGap)))}`);
    def('v@tsBigLkRange', `${g(Math.min(...big.map(T => T.lkMedGap)))} to ${g(Math.max(...big.map(T => T.lkMedGap)))}`);
  }
  const E = tsRows.filter(T => T.eqGap != null);
  if (EQ) {
    const cmp = T => T.eqGap < T.maxMedGap - 1e-9 ? -1 : T.eqGap > T.maxMedGap + 1e-9 ? 1 : 0;
    def('v@eqCount', E.length);
    def('v@eqBetter', E.filter(T => cmp(T) < 0).length);
    def('v@eqEqual', E.filter(T => cmp(T) === 0).length);
    def('v@eqWorse', E.filter(T => cmp(T) > 0).length);
    def('v@eqBetterList', E.filter(T => cmp(T) < 0).map(T => T.name).join(', ') || 'none');
    def('v@eqWorseList', E.filter(T => cmp(T) > 0).map(T => T.name).join(', ') || 'none');
    def('v@eqOptSmall', E.filter(T => T.n <= 442 && T.eqGap <= 1e-9).length);
    def('v@eqSmallCount', E.filter(T => T.n <= 442).length);
  }
  const bb = tsRows.map(T => T.boundBelow);
  def('v@boundBelowRange', `${Math.min(...bb).toFixed(2)}--${Math.max(...bb).toFixed(2)}\\%`);
}

/* ------------------------------- robustness ------------------------------ */
if (has('stress.json')) {
  const S = read('stress.json');
  const fams = [...new Set(S.map(r => r.family))];
  let s = '\\begin{tabular}{@{}llrrrl@{}}\n\\toprule\nfamily & level & $n$ & runs & invalid & result\\\\\n\\midrule\n';
  const convexLen = n => { let L = 0; for (let i = 0; i < n; i++) { const a = 2 * Math.PI * i / n, b = 2 * Math.PI * (i + 1) / n;
    L += Math.hypot(100 * (Math.cos(b) - Math.cos(a)), 62 * (Math.sin(b) - Math.sin(a))); } return L; };
  for (const fam of fams) for (const level of [...new Set(S.map(r => r.level))]) {
    const rr = S.filter(r => r.family === fam && r.level === level);
    if (!rr.length) continue;
    const bad = rr.filter(r => !r.ok || !r.lenOk).length;
    let res;
    if (fam === 'convex') res = rr.every(r => Math.abs(r.len / convexLen(r.n) - 1) < 1e-6) ? 'hull cycle (optimal) at every $n$' : 'not always the hull';
    else if (rr[0].gapKnown != null) res = rr.every(r => r.gapKnown <= 1e-6) ? 'known optimum at every $n$' : 'max true gap ' + g(Math.max(...rr.map(r => r.gapKnown)));
    else res = 'gap to bound ' + rr.map(r => g(r.gapBound)).join(', ');
    s += `${fam} & \\lvl{${level}} & ${[...new Set(rr.map(r => r.n))].join(', ')} & ${rr.length} & ${bad} & ${res}\\\\\n`;
  }
  s += '\\bottomrule\n\\end{tabular}\n';
  fs.writeFileSync(path.join(OUT, 'stress_table.tex'), s);
  for (const r of S) def(`v@stress@${r.family}@${r.level}@${r.n}`, g(r.gapBound, 2));
  def('v@stressRuns', S.length);
  def('v@stressInvalid', S.filter(r => !r.ok || !r.lenOk).length);
  def('v@stressViolations', S.filter(r => r.gapBound < -1e-6).length);
}
if (has('repeat.json')) {
  const S = read('repeat.json');
  const groups = new Map();
  for (const r of S) {
    const k = [r.n, r.family, r.seed, r.level].join('|');
    (groups.get(k) || groups.set(k, []).get(k)).push(r.len + ':' + r.tourDigest);
  }
  def('v@repeatGroups', groups.size);
  def('v@repeatRuns', S.length);
  def('v@repeatIdentical', [...groups.values()].filter(v => new Set(v).size === 1).length);
}
if (has('convex1000.json')) {
  const S = read('convex1000.json');
  for (const r of S) {
    let L = 0;   // the generator's ellipse, visited in angular order: the hull cycle
    for (let i = 0; i < r.n; i++) { const a = 2 * Math.PI * i / r.n, b = 2 * Math.PI * (i + 1) / r.n;
      L += Math.hypot(100 * (Math.cos(b) - Math.cos(a)), 62 * (Math.sin(b) - Math.sin(a))); }
    def(`v@convex1000@${r.level}`, t(r.serialMs));
    def(`v@convex1000@${r.level}@hull`, Math.abs(r.len / L - 1) < 1e-6 ? 'the hull cycle' : 'not the hull cycle');
  }
}

fs.writeFileSync(path.join(OUT, 'numbers.tex'), macros.join('\n') + '\n');
console.log('wrote ' + fs.readdirSync(OUT).join(', '));
