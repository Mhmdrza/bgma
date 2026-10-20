# Beam + screen only

**Question.** BGMA has six stages: beam search, fast screen, full polish, ERX crossover,
kick/anneal, and (optional) final polish. What if the solver keeps only the first two?

**Answer.** At n=50 it works — same tour as the full hybrid, about 1.7× faster. From n=100
up it loses, and at n≥200 the cheapest full-pipeline level (`low`) beats the best two-step
configuration on **both** quality and time. The four dropped stages cost little and buy
1.6–2.6 percentage points.

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

const res = beamScreen(inst, 1, {
  islands: 16,     // beam islands (first one starts from the farthest pair)
  K: 50,           // beam width, here n/4
  screenF: 0,      // 0 = screen every final; N = screen the top N per island
  restarts: 1
});
// res.tour, res.len
```

## How it was measured

[`bench.js`](bench.js) runs the ablation against the full hybrid:

| row | configuration |
|---|---|
| `beam+screen (low budget)` | 2 islands, K=n/4, screen all — BGMA `low`'s beam+screen shape |
| `beam+screen (8× beam)` | 16 islands, K=n/4, screen all — 8× the beam+screen work |
| `beam+screen (8×, r2)` | the same, two independent restarts |
| `beam + tunnel (tuned)` | the repo's all-n tuned beam+tunnel baseline |
| `BGMA low … max` | the unmodified pipeline at each effort level |

- 24 synthetic instances: n = 50, 100, 150, 200, 250, 300; 2 seeds × uniform/cluster.
- Reference = best tour any method found on that instance, so a gap of +0.00% means a win.
  The 1-tree column is an absolute lower-bound comparison (400 subgradient iterations).
- One timed run per instance after a warm-up pass; medians over the four instances per n.
  Only the solve is timed; the distance-matrix build and the bound are outside the clock.
- `beam+screen (low budget)` differs from `low` only by the dropped stages (K is identical
  for n≥64; it is slightly wider at n=50). That row isolates the value of stages 3–6.

The quality-maxed configuration was picked by [`tune.js`](tune.js): 60 configurations
(`islands` 2/4/8/16 × `K` n/4,n/3,n/2 × `screenF` 1,2,4,8,all), one restart, 12 instances
(n=100/200/300, 2 seeds × both families). The harness can then spend 2/4 restarts on the top
eight (`--top=8`); the recorded [`tuning.txt`](tuning.txt) is the stage-1 sweep. Its gap
column is a tournament gap — best configuration on the same instance, not BGMA. The winner by
median was **16 islands, K=n/4, screen every final**. The top few configurations are within
noise of each other; the time/quality curve is the real result.

## Results

24 instances, gap vs the best tour found on the same instance:

| method | median gap | mean gap | worst gap | median vs 1-tree | median time |
|---|---:|---:|---:|---:|---:|
| beam only (K=n/3, no screen) | +35.51% | +35.26% | +45.64% | +36.46% | 7.2 ms |
| beam+screen (low budget) | +3.08% | +2.88% | +6.42% | +3.76% | 30 ms |
| beam+screen (8× beam) | +1.63% | +1.68% | +3.80% | +2.46% | 222 ms |
| beam+screen (8×, r2) | +1.22% | +1.44% | +3.44% | +1.81% | 441 ms |
| beam + tunnel (tuned) | +1.05% | +1.18% | +2.82% | +2.05% | 330 ms |
| BGMA low | +1.40% | +1.29% | +2.79% | +1.96% | 57 ms |
| BGMA mid | +0.38% | +0.45% | +1.86% | +1.08% | 170 ms |
| BGMA high | +0.06% | +0.16% | +0.63% | +0.89% | 449 ms |

Median gap by n:

| n | screen (low budget) | screen (8×) | screen (8×, r2) | BGMA low | BGMA mid |
|---:|---:|---:|---:|---:|---:|
| 50 | +0.00% | +0.00% | +0.00% | +0.00% | +0.00% |
| 100 | +1.84% | +1.37% | +0.73% | +0.25% | +0.03% |
| 150 | +2.87% | +1.21% | +0.78% | +1.63% | +0.17% |
| 200 | +2.85% | +2.04% | +1.86% | +1.09% | +0.50% |
| 250 | +4.27% | +2.57% | +2.57% | +2.32% | +0.76% |
| 300 | +4.40% | +3.04% | +2.92% | +1.77% | +0.90% |

Median time by n (ms):

| n | screen (low budget) | screen (8×) | screen (8×, r2) | BGMA low | BGMA mid |
|---:|---:|---:|---:|---:|---:|
| 50 | 2.3 | 15 | 30 | 3.9 | 15 |
| 100 | 7.9 | 56 | 108 | 11 | 41 |
| 150 | 21 | 154 | 306 | 32 | 122 |
| 200 | 40 | 290 | 575 | 85 | 246 |
| 250 | 60 | 480 | 908 | 132 | 516 |
| 300 | 94 | 641 | 1.32 s | 227 | 854 |

The full terminal output is in [`results.txt`](results.txt); the same numbers per instance
are in [`bench_results.csv`](bench_results.csv).

## What it shows

- **n=50: the ablation wins.** Every method finds the same tour; two steps do it in 2.3 ms
  against 3.9 ms for `low`. The dropped stages have nothing left to win.
- **n≥100: stages 3–6 pay for themselves.** Keeping `low`'s beam+screen budget and deleting
  everything after it costs +1.84% at n=100 and +4.40% at n=300. The rest of `low` takes
  3 ms / 133 ms at those sizes and buys 1.6 / 2.6 percentage points.
- **n≥200: `low` dominates on both axes.** At n=300 the best two-step run is +2.92% in 1.32 s;
  `low` is +1.77% in 227 ms, `mid` +0.90% in 854 ms.
- **Reallocating the freed budget does not close it.** 2 → 16 islands cuts the n=300 gap from
  4.40% to 3.04% at ~7× the time. A second restart adds 0.12 pp. The last two points are not
  in the beam+screen budget; they need recombination and polish.
- **The screen is what makes the beam competitive at all** (+35.5% → +3.1%), but only when it
  is applied broadly: the beam ranks finals by partial-path length, and the tour that wins
  after 2-opt/Or-opt is often not the one that was shortest before. Screening just the top
  final is measurably worse; screening all finals is the default here.

## Caveats

- Synthetic uniform/cluster instances only. Nothing here says the same holds on TSPLIB or the
  CSV dataset; `low`'s quality advantage is large enough that it probably does, but it is
  untested.
- The two-step configuration was tuned in-sample on the same families. Restarts and the
  island count were chosen after seeing these results; neither changes the ordering.
- Gaps are relative to the best tour found, not to the optimum. The 1-tree bound is loose at
  n=250 (one instance sits ~3% above it at the best-known tour), so the "vs 1-tree" column is
  an upper bound on the true gap.
- Times are medians of four single runs (one per instance), not repeated timings.

## Reproduce

```bash
node experiments/beam-screen-only/tune.js --ns=100,200,300 --seeds=2 --top=0
node experiments/beam-screen-only/bench.js --seeds=2 \
  --csv=experiments/beam-screen-only/bench_results.csv
node experiments/beam-screen-only/bench.js --ns=200,300 --seeds=2 --levels=low,mid,high
```

`bench.js` accepts `--ns`, `--seeds`, `--kinds`, `--levels`, `--bound`, `--boundIters`,
`--csv`, and `--md`. `tune.js` accepts the grid flags shown in its header and `--top=0` to
skip the restart stage.

## Files

| file | what it is |
|---|---|
| `bench.js` | ablation benchmark: two-step variants vs beam+tunnel and BGMA levels |
| `tune.js` | knob sweep for the two-step solver |
| `bench_results.csv` | per-instance lengths and times of the recorded 24-instance run |
| `results.txt` | terminal output of that run |
| `tuning.txt` | stage-1 sweep used to pick 16 islands / K=n/4 / screen all |
| `README.md` | this write-up |

The solver code itself is shared, not copied: [`src/hybrid/bgma.js`](../../src/hybrid/bgma.js)
exports `beamScreen` and `SCREEN_DEFAULTS`. The summary in the main notes is
[`docs/TSP_NOTES.md` §11](../../docs/TSP_NOTES.md#11-ablation-keep-only-steps-12-beam--fast-screen).
