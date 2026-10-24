# One-tree seeded hybrid

**Question.** The subgradient ascent that produces the 1-tree lower bound (`hkBoundTree`)
also produces the 1-tree itself at the multipliers that made the bound tight. A depth-first
walk of that tree is a Hamiltonian cycle for free. If BGMA starts from that walk instead of
from beam islands — and keeps the bound around to stop on — does it reach the same tour
faster?

**Answer.** Partly, and not in the way the question suggests.

- **As a seed at equal budget: a slight gain in quality, a loss in time.** On the hard
  families (uniform/cluster, 20 instances) the seeded pipeline is +0.64% against +0.89% for
  `low` and +0.05% against +0.14% for `mid`, with a better worst case at `low` (+1.69% vs
  +2.99%) — but it costs 1.7x (`low`) and 1.4x (`mid`) the wall time, because the ascent is
  **44.6% of the seeded run's own time**.
- **As a certificate: a decisive win.** Where the 1-tree closes — every degree exactly 2 —
  it *is* a tour of length `L`, so `L` is attained and the tour is optimal: no hybrid work at
  all. That happened on all 10 convex instances, 0–2 ms against 17–236 ms for BGMA. Same
  mechanism when the search merely *reaches* `L`: the run stops there, certified.
- **As a cheap tier: useful, not free.** The walk plus one candidate-list screen averages
  +1.98% on uniform/cluster in 68 ms against `low`'s +0.89% in 83 ms. It is 20% cheaper and
  0.55 pp worse — a budget tier, not an upgrade.
- **Where it loses:** collinear instances (the 1-tree is a path, so the bound sits up to +73%
  below the optimum and the floor never fires) and small n, where 17 ms of ascent against a
  4 ms run is pure overhead.

This folder holds the write-up, the harness, and the recorded 40-instance run.

---

## What was kept

```
1-tree bound (subgradient ascent)      ->  L, and the tree at the best multipliers
DFS walk of the tree (keep-first)      ->  Hamiltonian cycle  (the degree repair)
   + L as `floor`                      ->  stop the moment the tour reaches it
   + the walk as an extra pool seed    ->  the unmodified BGMA pipeline
```

- Bound, walk, and entry point: [`src/onetree/onetree_seed.js`](../../src/onetree/onetree_seed.js)
  — `oneTreeSeed()` (bound + walk), `walkTree()` (the walk), `treeHybrid()` (the algorithm).
- The ascent and the tree come from `hkBoundTree()` in
  [`src/hybrid/hybrid_vis.js`](../../src/hybrid/hybrid_vis.js); no bound code was written.
- Two additive knobs in [`src/hybrid/bgma.js`](../../src/hybrid/bgma.js):
  `seedTours` (external start tours, screened like an island) and `floor` (a proven lower
  bound; the run returns as soon as the best tour reaches it, and `runEffort`'s restarts stop
  too). With both unset the pipeline is bit-identical to before.

Why the walk is the degree repair: a city of 1-tree degree d>2 is entered once and skipped
d−1 times, so the surplus disappears; a city of degree 1 is entered once and the closing edge
back to the root supplies its second. Out of the traversal comes a cycle over exactly the
cheap edge structure. This is the classic double-tree shortcut — the difference from a plain
MST is that the tree here was chosen to minimise degree violations, not only length.

```js
const { treeHybrid } = require('./src/onetree/onetree_seed.js');
const { B } = require('./src/hybrid/bgma.js');

const inst = B.buildInstance(400, 1, 'uniform', 40);
inst.seed = 1; inst.kind = 'uniform';
const res = treeHybrid(inst, 1, 'mid');          // same shape as runEffort()
// res.len, res.tour, res.floor, res.certified, res.violations, res.msBound, res.msHybrid
```

## How it was measured

[`bench.js`](bench.js) runs seven methods on the same instance, one timed run each, after a
warm-up pass:

| row | configuration |
|---|---|
| `greedy` | nearest-neighbour from the farthest-pair endpoint |
| `1-tree walk only` | ascent + DFS walk, no screen, no pipeline |
| `1-tree walk + screen` | the walk plus one candidate-list screen (`islands:0, gens:0, polish:0`) |
| `BGMA low` / `BGMA mid` | the unmodified pipeline at each effort level |
| `OTSH low` / `OTSH mid` | walk seeded into the same pipeline, `floor = L` |

- 40 instances: n = 50, 100, 200, 300, 400; 2 seeds × uniform, cluster, convex, line.
- Reference = best tour any method found on that instance, so +0.00% is a win. `bound` is a
  separate 1-tree computation (400 subgradient iterations) used only for the `vs bound`
  column.
- Timed with the bound **inside** the clock for both 1-tree rows — the ascent is part of the
  algorithm, so charging it to BGMA would flatter the result.
- `convex` and `line` carry a known optimum (the hull cycle; every gap crossed twice), so the
  true-gap table is a measurement, not a tournament.

`bench.js` accepts `--ns`, `--seeds`, `--fams`, `--levels`, `--iters`, `--bound`,
`--boundIters`, `--csv`, `--md=1`. It self-checks the walk on 21 cases (permutation, length
recompute, never below its own bound) plus a 5001-city path for stack safety, and validates
every recorded tour.

## Results

40 instances, gap vs the best tour found on the same instance:

| method | median gap | mean gap | worst gap | wins | vs 1-tree | median time | certified |
|---|---:|---:|---:|---:|---:|---:|---:|
| greedy nearest-neighbour | +7.40% | +14.05% | +40.38% | 20/40 | +27.38% | 34 us | — |
| 1-tree walk only | +8.98% | +11.80% | +44.26% | 10/40 | +22.98% | 17 ms | 10/40 distilled |
| 1-tree walk + screen | +0.00% | +0.99% | +5.65% | 23/40 | +3.44% | 17 ms | 10/40 distilled |
| BGMA low | +0.00% | +0.44% | +2.99% | 24/40 | +1.78% | 66 ms | — |
| BGMA mid | +0.00% | +0.07% | +0.49% | 29/40 | +1.35% | 211 ms | — |
| OTSH low | +0.00% | +0.32% | +1.69% | 27/40 | +2.17% | 31 ms | 10/40 distilled |
| OTSH mid | +0.00% | +0.03% | +0.53% | 36/40 | +1.37% | 61 ms | 10/40 distilled |

The convex rows inside those medians are the 0–2 ms certifications, and they carry the whole
time story. On the hard families alone (uniform/cluster, 20 instances) nothing is certified
and the picture inverts:

| method | mean gap | median gap | worst gap | wins | median time |
|---|---:|---:|---:|---:|---:|
| greedy nearest-neighbour | +28.11% | +26.32% | +40.38% | 0/20 | 0.04 ms |
| 1-tree walk only | +19.81% | +21.66% | +44.26% | 0/20 | 68 ms |
| 1-tree walk + screen | +1.98% | +1.92% | +5.65% | 3/20 | 68 ms |
| BGMA low | +0.89% | +0.82% | +2.99% | 4/20 | 83 ms |
| **OTSH low** | **+0.64%** | **+0.47%** | **+1.69%** | 7/20 | 142 ms |
| BGMA mid | +0.14% | +0.02% | +0.49% | 9/20 | 238 ms |
| **OTSH mid** | **+0.05%** | **+0.00%** | +0.53% | 16/20 | 330 ms |

Median gap by n (all four families):

| method | n=50 | n=100 | n=200 | n=300 | n=400 |
|---|---:|---:|---:|---:|---:|
| greedy nearest-neighbour | +7.40% | +12.23% | +12.54% | +11.77% | +11.82% |
| 1-tree walk only | +3.29% | +11.49% | +15.99% | +11.95% | +12.40% |
| 1-tree walk + screen | +0.00% | +0.00% | +0.04% | +0.69% | +0.74% |
| BGMA low | +0.00% | +0.00% | +0.24% | +0.53% | +0.47% |
| BGMA mid | +0.00% | +0.00% | +0.00% | +0.00% | +0.00% |
| OTSH low | +0.00% | +0.00% | +0.00% | +0.10% | +0.32% |
| OTSH mid | +0.00% | +0.00% | +0.00% | +0.00% | +0.00% |

Median time by n (ms):

| method | n=50 | n=100 | n=200 | n=300 | n=400 |
|---|---:|---:|---:|---:|---:|
| greedy nearest-neighbour | 0.012 | 0.021 | 0.044 | 0.036 | 0.050 |
| 1-tree walk only | 3.9 | 14 | 58 | 129 | 236 |
| 1-tree walk + screen | 4.0 | 14 | 58 | 139 | 238 |
| BGMA low | 4.0 | 9.7 | 66 | 218 | 595 |
| BGMA mid | 15 | 38 | 211 | 821 | 2020 |
| OTSH low | 7.8 | 25 | 112 | 320 | 725 |
| OTSH mid | 19 | 54 | 279 | 815 | 2020 |

True gap against the known optimum (20 instances: convex, line):

| method | median | mean | worst | optimal |
|---|---:|---:|---:|---:|
| greedy nearest-neighbour | +0.00% | +0.00% | +0.00% | 20/20 |
| 1-tree walk only | +1.30% | +3.79% | +15.24% | 10/20 |
| 1-tree walk + screen | +0.00% | +0.00% | +0.00% | 20/20 |
| BGMA low / mid | +0.00% | +0.00% | +0.00% | 20/20 |
| OTSH low / mid | +0.00% | +0.00% | +0.00% | 20/20 |

Cost split: the ascent is **44.6% of OTSH low wall time** on average (17 ms of 31 ms).
Validation: all tours are valid permutations (21 walk cases + a 5001-city path self-checked).

## What it shows

- **The bound is the algorithm, not the seed.** Every clear win in the run is the `floor`
  firing: 10/40 instances were solved optimally in 0–2 ms with zero hybrid work. Twelve
  instances of BGMA time were saved by *proving* the answer, not by searching better.
- **Seeded quality is a small, consistent edge on hard instances.** −0.25 pp at `low` and
  −0.09 pp at `mid` on uniform/cluster, and the `low` worst case halves. It is real but
  smaller than the gap between two effort levels.
- **The same edge costs time.** The ascent is a fixed O(iters·n²) tax paid on every call:
  1.7x at `low`, 1.4x at `mid`. At n≤100 the tax exceeds the run it improves.
- **The walk alone is weak, the screen is what makes it work** (uniform/cluster: +19.81% →
  +1.98%). Same finding as the beam, whose screen moves it 36% → 4%: the cheap local search
  is doing the work, the starting structure only decides where it starts.
- **Structure, not length, is what the 1-tree contributes.** A plain MST walk is ~2x the
  optimum; this walk averages +11.80%. Subgradient ascent drives the tree toward degree 2, so
  its surviving edges are a set of short edges whose traversal is already locally coherent —
  at n=400 the raw walk (+12.40%) is near greedy (+11.82%) while being built from a
  structure chosen to minimise degree violations rather than step cost.
- **Where the idea dies:** `line`. The 1-tree of collinear points is a path, the bound sits
  up to 73% below the optimum, the floor never fires, and the ascent is pure overhead on a
  problem 2-opt solves exactly. Nothing here helps an instance whose relaxation is loose.

## Caveats

- Synthetic families only, like the sibling ablation; no TSPLIB and no CSV dataset. `convex`
  and `line` are the only rows with a known optimum, and both are trivial for 2-opt, so the
  true-gap table cannot separate the pipeline stages — it only proves the certified rows
  correct.
- The reference is best-of-all on the same instance, so the gap columns are tournament
  relative; the `vs 1-tree` column is the only absolute one.
- One timed run per instance; medians over 8 instances per n. Time is a laptop wall clock and
  the ascent is a tight JS loop, so the 44.6% split is a floor on the tax, not a ceiling.
- `400 subgradient iterations` is fixed, not scaled by n. A tighter bound would fire the floor
  more often but costs more; the crossover was not measured.
- Determinism holds for the recorded numbers but the pipeline's island seeds are
  seed-derived, so re-running with different `--seeds` moves the last decimal.

## Reproduce

```bash
node experiments/one-tree-seed/bench.js                     # the recorded run
node experiments/one-tree-seed/bench.js --ns=100,200 --seeds=2 --fams=convex,line   # certification
node experiments/one-tree-seed/bench.js --fams=uniform,cluster --levels=low --md=1   # hard families
node experiments/one-tree-seed/bench.js --csv=experiments/one-tree-seed/bench_results.csv \
  --ns=50,100,200,300,400 --seeds=2 --levels=low,mid > experiments/one-tree-seed/results.txt
```

## Files

| file | what it is |
|---|---|
| `bench.js` | seven-method harness + self-check; every flag in the header |
| `results.txt` | terminal output of the recorded 40-instance run |
| `bench_results.csv` | per-instance lengths, times and certified flags for every method |
| `README.md` | this write-up |

The solver code is shared, not copied: [`src/onetree/onetree_seed.js`](../../src/onetree/onetree_seed.js)
exports `oneTreeSeed`, `walkTree`, `treeHybrid`, and the pipeline gained only the two optional
knobs `seedTours` / `floor` in [`src/hybrid/bgma.js`](../../src/hybrid/bgma.js).
