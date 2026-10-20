# Beam + screen only

**Question.** BGMA has six stages: beam search, fast screen, full polish, ERX crossover,
kick/anneal, and (optional) final polish. What if the solver keeps only the first two?

**Answer.** At n=50 it ties the full hybrid. At n=100 it is within about 0.7 pp of `mid` and
already behind `low` on time. From n=200 up the cheapest full-pipeline level (`low`) beats
the best two-step rule on **both** quality and time; at n=400 the tuned rule is +4.17%
against +2.55% for `low` and +0.94% for `mid`. An n-scaled budget improves the large-n end
(5.04% → 4.17% at 400) but does not change the ordering — the dropped stages are still worth
about 1.6 pp there.

This folder holds the implementation note, both harnesses, and the recorded run.

---

## What was kept

```
beam islands  ->  fast candidate-list screen  ->  shortest tour wins
```

- Beam: `B.beamFast` from `src/beam/beam_fast.js`, same beam as BGMA uses.
- Screen: `B.refineFast` — neighbour-list 2-opt with don't-look bits plus Or-opt
  (`oroptMaxL=3`), i.e. the same fast screen BGMA applies to every beam final.
- No elite pool, no ERX, no double-bridge kicks, no annealing, no base/full polish.
- `restarts` repeats the same two steps with fresh beam seeds. It is still steps 1+2.

The entry point is `beamScreen()` in [`src/hybrid/bgma.js`](../../src/hybrid/bgma.js);
`beamScreenOnce()` is one pass. Nothing in the existing pipeline was changed or removed —
`runEffort()` and the effort ladder are untouched.

```js
const { B, beamScreen } = require('./src/hybrid/bgma.js');
const inst = B.buildInstance(200, 1, 'uniform', 20);
inst.seed = 1; inst.kind = 'uniform';

const rule = n => ({
  islands: Math.min(32, Math.max(16, Math.round(n / 20))),  // first starts at the farthest pair
  K: Math.max(16, Math.round(n / 5)),                       // beam width
  near: Math.max(10, Math.round(n / 8)),                    // screen candidate width
  screenF: 16,                                              // top 16 finals per island
  restarts: 1
});
const res = beamScreen(inst, 1, rule(inst.n));
// res.tour, res.len
```

## How it was measured

[`bench.js`](bench.js) runs the ablation against the full hybrid:

| row | configuration |
|---|---|
| `beam+screen (low budget)` | 2 islands, K=n/4, screen all — BGMA `low`'s beam+screen shape |
| `beam+screen (fixed rule)` | 16 islands, K=n/4, near=n/10, screen all — the pre-tuning winner |
| `beam+screen (n-scaled)` | islands=max(16,n/20), K=n/5, near=n/8, top 16 finals |
| `beam + tunnel (tuned)` | the repo's all-n tuned beam+tunnel baseline |
| `BGMA low … max` | the unmodified pipeline at each effort level |

- 32 synthetic instances: n = 50…400 in steps of 50; 2 seeds × uniform/cluster.
- Reference = best tour any method found on that instance, so a gap of +0.00% means a win.
  The 1-tree column is an absolute lower-bound comparison (400 subgradient iterations).
- One timed run per instance after a warm-up pass; medians over the four instances per n.
  Only the solve is timed; the distance-matrix build and the bound are outside the clock.
- `beam+screen (low budget)` differs from `low` only by the dropped stages (K is identical
  for n≥64; it is slightly wider at n=50). That row isolates the value of stages 3–6.

The first pass ([`tune.js`](tune.js), recorded in [`tuning.txt`](tuning.txt)) swept 60
configurations (`islands` 2/4/8/16 × `K` n/4,n/3,n/2 × `screenF` 1,2,4,8,all) on 12 instances
and picked **16 islands, K=n/4, screen every final**. Its gap column is a tournament gap —
best configuration on the same instance, not BGMA.

The second pass ([`tune_nscale.js`](tune_nscale.js), recorded in
[`tuning_nscale.txt`](tuning_nscale.txt)) makes every knob a function of n and measures BGMA
`low`/`mid` on each instance as fixed references:

```
islands = clamp(round(n / A), floor, 64)
K       = max(16, round(n / B))
near    = max(10, round(n / C))
screenF = F
```

Stage 1 is a 12-rule grid (`A` 8…32, `B` 4/5, `C` 8, `F` 16) over n=100…400, seeds 1–2.
Stage 2 refines `C`, then checks the top rules on held-out seeds 3–4, with n extended to 500.

What the sweep found:

- **Islands alone do not close it.** 16 → 33 islands at n=400 buys about 0.7 pp for ~2×
  the time; 33 → 50 buys nothing. The cheaper levers were the beam width and the screen
  width.
- **`K=n/5` beats `K=n/4`** on both axes: the old width was spending beam time on states the
  screen discards anyway.
- **The screen's candidate width is the largest single lever.** `near=n/8` vs the old n/10
  moved the n=400 probe from +3.32% to +2.97% for ~10% more time; going wider (`n/6`, `n/5`)
  does not improve on it.
- **Top 16 finals ties screening every final**, at n=400 and below. The screen was the cheap
  stage; the beam was the expensive one.

The chosen rule sits at the budget knee (`islands=max(16,round(n/20))`, capped at 32), narrows the
beam to `n/5`, widens the screen to `n/8`, and screens the top 16 finals. The fixed rule and
the n-scaled rule both appear in the bench below, on the same instances.

## Results

32 instances, gap vs the best tour found on the same instance:

| method | median gap | mean gap | worst gap | median vs 1-tree | median time |
|---|---:|---:|---:|---:|---:|
| beam only (K=n/3, no screen) | +36.41% | +36.05% | +45.64% | +37.86% | 12 ms |
| beam+screen (low budget) | +3.85% | +3.62% | +6.57% | +4.71% | 48 ms |
| beam+screen (fixed rule) | +2.41% | +2.46% | +5.59% | +3.30% | 361 ms |
| beam+screen (n-scaled) | +2.56% | +2.28% | +5.05% | +3.33% | 370 ms |
| beam + tunnel (tuned) | +1.56% | +1.50% | +3.14% | +2.45% | 624 ms |
| BGMA low | +1.71% | +1.60% | +3.17% | +2.93% | 108 ms |
| BGMA mid | +0.50% | +0.60% | +1.86% | +1.49% | 338 ms |
| BGMA high | +0.16% | +0.27% | +1.04% | +1.15% | 927 ms |

Median gap by n:

| n | screen (low budget) | screen (fixed) | screen (n-scaled) | BGMA low | BGMA mid |
|---:|---:|---:|---:|---:|---:|
| 50 | +0.00% | +0.00% | +0.00% | +0.00% | +0.00% |
| 100 | +1.84% | +1.37% | +0.67% | +0.25% | +0.03% |
| 150 | +2.87% | +1.21% | +1.34% | +1.63% | +0.17% |
| 200 | +2.85% | +2.04% | +1.69% | +1.09% | +0.50% |
| 250 | +4.27% | +2.57% | +2.96% | +2.32% | +0.76% |
| 300 | +4.40% | +3.04% | +3.02% | +1.77% | +0.90% |
| 350 | +5.82% | +4.44% | +3.86% | +2.75% | +1.05% |
| 400 | +5.95% | +5.04% | +4.17% | +2.55% | +0.94% |

Median time by n (ms):

| n | screen (low budget) | screen (fixed) | screen (n-scaled) | BGMA low | BGMA mid |
|---:|---:|---:|---:|---:|---:|
| 50 | 2.1 | 16 | 16 | 3.9 | 15 |
| 100 | 7.7 | 54 | 52 | 11 | 41 |
| 150 | 20 | 152 | 141 | 32 | 120 |
| 200 | 39 | 288 | 300 | 85 | 245 |
| 250 | 60 | 487 | 472 | 131 | 514 |
| 300 | 95 | 658 | 631 | 238 | 866 |
| 350 | 118 | 902 | 969 | 377 | 1.32 s |
| 400 | 158 | 1.12 s | 1.35 s | 585 | 2.01 s |

The full terminal output is in [`results.txt`](results.txt); the same numbers per instance
are in [`bench_results.csv`](bench_results.csv).

## What it shows

- **n=50: every method ties.** The two-step rules coincide there (K=16, near=10, top 16 =
  all finals), and 16 ms buys the same tour as `mid` in 15 ms. The dropped stages have
  nothing left to win.
- **n=100: the tuned rule is the better two-step setting** (+0.67% vs +1.37%, 52 vs 54 ms),
  but `low` (+0.25%, 11 ms) and `mid` (+0.03%, 41 ms) are still both cheaper and better.
- **n≥200: `low` dominates on both axes.** At n=400 the tuned two-step rule is +4.17% in
  1.35 s; `low` is +2.55% in 585 ms, `mid` +0.94% in 2.01 s.
- **The n-scaled rule moves the large end, not the verdict.** At n=400 the fixed rule is
  +5.04%; the n-scaled rule is +4.17% for 20% more time. The same holds at n=350. The gains
  at 100/200 are offset by small regressions at 150/250, so the overall median is flat
  (2.41% → 2.56%) while the mean and worst case improve (2.46% → 2.28%, 5.59% → 5.05%).
  Treat it as a reallocation of the two-step budget, not a breakthrough.
- **Islands alone do not close it.** Going from 2 to 16 islands cuts the n=300 gap from
  4.40% to 3.04%; 16 → 33 at n=400 buys about 0.7 pp for ~2× the time, and 33 → 50 buys
  nothing. The cheaper levers were the beam width (`K=n/5` instead of `n/4`) and the
  screen's candidate width (`near=n/8` instead of `n/10`).
- **The screen is what makes the beam competitive at all** (+36.4% → +3.9%), and it does not
  need every final: screening the top 16 per island matches screening all of them at these
  sizes, at lower cost.
- **The last ~1.6 pp is still the dropped stages.** `low`'s two generations and two polishes
  cost 585 ms at n=400 and return +2.55%; no reallocation of beam islands and screen width
  reaches that basin.

## Caveats

- Synthetic uniform/cluster instances only. Nothing here says the same holds on TSPLIB or the
  CSV dataset; `low`'s quality advantage is large enough that it probably does, but it is
  untested.
- The n-scaled rule was fitted on seeds 1–2 and checked on seeds 3–4 before the recorded
  run; the bench itself is seeds 1–2 and uses solver seed 1 for every two-step row, so part
  of the per-n swing is seed noise (n=150/250 regress, n=350/400 improve). The fixed rule is
  kept in the run for a same-instance comparison.
- Gaps are relative to the best tour found, not to the optimum. The 1-tree bound is loose at
  n=250 (one instance sits ~3% above it at the best-known tour), so the "vs 1-tree" column is
  an upper bound on the true gap.
- Times are medians of four single runs per n (one per instance, 32 total), not repeated timings.

## Reproduce

```bash
node experiments/beam-screen-only/tune.js --ns=100,200,300 --seeds=2 --top=0
node experiments/beam-screen-only/tune_nscale.js --ns=100,200,300,400 --seeds=1,2 \
  --A=8,12,16,20,25,32 --B=4,5 --C=8 --F=16
node experiments/beam-screen-only/tune_nscale.js --ns=100,200,300,400,500 --seeds=3,4 \
  --A=16,20,25 --B=5 --C=8 --F=16
node experiments/beam-screen-only/bench.js --seeds=2 \
  --csv=experiments/beam-screen-only/bench_results.csv
```

`bench.js` accepts `--ns`, `--seeds`, `--kinds`, `--levels`, `--bound`, `--boundIters`,
`--csv`, and `--md`. `tune.js` accepts the grid flags in its header and `--top=0` to skip the
restart stage. `tune_nscale.js` accepts `--A/--B/--C/--F`, `--floor`, `--cap`, `--budget`
(the time cap as a multiple of `low`), and `--json`.

## Files

| file | what it is |
|---|---|
| `bench.js` | ablation benchmark: two-step variants vs beam+tunnel and BGMA levels |
| `tune.js` | first knob sweep for the two-step solver (fixed grid) |
| `tune_nscale.js` | n-scaled sweep: every knob is a rule of n, scored against BGMA low/mid |
| `bench_results.csv` | per-instance lengths and times of the recorded 32-instance run |
| `results.txt` | terminal output of that run |
| `tuning.txt` | stage-1 sweep used to pick the fixed rule |
| `tuning_nscale.txt` | n-scaled grid and held-out validation |
| `README.md` | this write-up |

The solver code itself is shared, not copied: [`src/hybrid/bgma.js`](../../src/hybrid/bgma.js)
exports `beamScreen` and `SCREEN_DEFAULTS`. The summary in the main notes is
[`docs/TSP_NOTES.md` §11](../../docs/TSP_NOTES.md#11-ablation-keep-only-steps-12-beam--fast-screen).
