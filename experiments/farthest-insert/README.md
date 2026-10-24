# Farthest-pole insertion (FPI): the two-front zigzag, and the reading that works

**Question.** The farthest pair A–Z is the one structure every construction heuristic in the repo
already leans on: the farthest-pole walk starts there and the beam starts there. So grow the tour
itself from those two poles, with the **far list of the opposite pole** deciding each next move:
the city nearest to A is the pick *if* it also sits far from Z; if it sits close to Z it belongs to
the other end and the other front takes the step. Does that build a tour the hybrid can use?

**Answer.** Not as a two-front zigzag — but yes in the reading of the same idea that clicks.

- **The literal zigzag loses, structurally.** Two fronts rooted on the poles can only close the
  cycle on the A–Z edge, the longest pair on the map. Median gap **+34.02%** over the best tour
  found (worst +82.88%); on the hard families (uniform/cluster) that is **+34% against +26% for
  greedy and +25% for the existing farthest-pole walk**. Convex position is total failure
  (+78%): the diameter edge crosses the hull. The elimination itself adds nothing — `elim`,
  `nn2` (no elimination) and the one-front `veto` all land in a 31–34% band.
- **The same poles and the same far list, read as insertion, win.** Start the cycle as A–Z, then
  every step take the city **farthest from the cycle so far** and splice it in at its cheapest
  position. The first insertion lands *between* A and Z, deleting the diameter. That is **FPI**,
  and it is the best pure constructor measured here: **+8.11% median on uniform/cluster** against
  +26.10% (greedy) and +25.06% (farthest-pole walk), and +0.35% median across all 40 instances.
  `ni` (nearest insertion) reaches +16.74% on the same rows, so "farthest from the cycle" is what
  does the work, not the poles.
- **But a construction is still 8% long.** One candidate-list screen takes FPI to **+4.35%**
  (1 ms) and full `BGMA low` to **+0.58%** (80 ms). So **FPI + one screen is an 83× cheaper tier
  that trades 3.2 pp** — the pole helps at construction time, not inside the pipeline.
- **Handing FPI to BGMA as a seed changes nothing.** 5 instances better, 4 worse, 31 equal.
  Third time the repo has seen this (beam screen, 1-tree seed, now an FPI seed): the search stage
  decides, the constructor only sets where it starts.

The folder holds the write-up, the harness, and the recorded 40-instance run.

---

## What was kept

```
farthest pair (A, Z)                      -> the two poles; O(n^2), no pair ranking
two fronts from the poles + far-list veto -> the literal idea          (rules elim/far/nn2/alt/veto)
poles as the start cycle + farthest-from-cycle insertion -> FPI         (the one that works)
```

- [`src/farthest/farthest_insert.js`](../../src/farthest/farthest_insert.js) — `solve(D, { rule })`
  with seven rules, and `insertion(D, { farthest })`, the shared farthest/nearest insertion
  routine. Default rule is `fi`.
- No changes to any existing solver: the seeded rows go through BGMA's existing `seedTours` hook
  ([`src/hybrid/bgma.js`](../../src/hybrid/bgma.js)), the same one the 1-tree experiment added.
- `solve` returns `{ tour, len, stats }`; `stats.eliminations` counts the steps where the
  elimination overrode "nearest front wins", so a run can show whether the rule fired at all.

Why the poles, in one line: a city on the far list of the opposite pole cannot belong to this
end, so the two farthest-apart points give the least ambiguous labelling of the map into "near A"
and "near Z" that a construction can start from. The error is not in reading the far list, it is
in making the two poles *adjacent* instead of letting an insertion delete that edge.

```js
const { solve, insertion } = require('./src/farthest/farthest_insert.js');
const { B, runEffort } = require('./src/hybrid/bgma.js');

const inst = B.buildInstance(400, 1, 'uniform', 40);
const { tour, len } = solve(inst.rows);                 // rule 'fi' (FPI)
solve(inst.rows, { rule: 'elim' });                     // the literal two-front zigzag
runEffort(inst, 1, 'low', { seedTours: [tour] });       // FPI as a BGMA seed
```

## How it was measured

[`bench.js`](bench.js) runs twelve methods on the same instance, one timed run each, after a
warm-up pass:

| row | configuration |
|---|---|
| `greedy` | nearest-neighbour from the farthest-pair endpoint |
| `FBW` | the farthest-pole walk already in the repo (`src/farthest/farthest_pole.js`) |
| `zigzag elim / nn2 / veto` | the literal two-front idea, with and without the far-list elimination |
| `FPI` / `NPI` | farthest-pole insertion / nearest insertion from the poles (`fi` / `ni`) |
| `FPI + screen` | FPI, then one candidate-list 2-opt + Or-opt screen |
| `BGMA low` / `mid` | the unmodified pipeline |
| `FPI + BGMA low` / `mid` | the FPI tour handed to the same pipeline as `seedTours` (timed with the construction) |

- 40 instances: n = 50, 100, 200, 300, 400; 2 seeds × uniform, cluster, convex, line.
- Reference = best tour any method found on that instance, so +0.00% is a win. The `vs bound`
  column is a separate 400-iteration 1-tree computation.
- `convex` and `line` carry a known optimum, so the true-gap table is a measurement, not a
  tournament.
- Self-check: every rule must return a permutation whose length recomputes from the matrix
  (35 rule/family cases, including `grid`, `same`, `dup`), plus a 5001-city line so the loop is
  known to be iterative.
- Flag set matches the sibling: `--ns`, `--seeds`, `--fams`, `--levels`, `--bound`,
  `--boundIters`, `--csv`, `--md=1`.

## Results

40 instances, gap vs the best tour found on the same instance:

| method | median gap | mean gap | worst gap | wins | vs 1-tree | median time |
|---|---:|---:|---:|---:|---:|---:|
| greedy nearest-neighbour | +7.40% | +14.04% | +39.94% | 20/40 | +27.40% | 39 us |
| FBW (farthest-pole walk) | +7.32% | +13.20% | +38.30% | 20/40 | +26.08% | 5.7 ms |
| zigzag `elim` | +34.02% | +37.39% | +82.88% | 10/40 | +41.87% | 186 us |
| zigzag `nn2` | +33.80% | +37.28% | +82.88% | 10/40 | +41.47% | 176 us |
| zigzag `veto` (one front) | +31.06% | +35.40% | +77.79% | 10/40 | +38.24% | 144 us |
| NPI (`ni`, nearest insertion) | +3.33% | +8.17% | +23.73% | 20/40 | +17.48% | 218 us |
| **FPI (`fi`, farthest insertion)** | **+0.35%** | **+3.87%** | +13.00% | 20/40 | +9.53% | 245 us |
| FPI + screen | +0.00% | +2.09% | +8.16% | 21/40 | +5.77% | 813 us |
| BGMA low | +0.00% | +0.43% | +2.86% | 23/40 | +1.78% | 69 ms |
| BGMA mid | +0.00% | +0.06% | +1.16% | 32/40 | +1.35% | 221 ms |
| FPI + BGMA low | +0.00% | +0.43% | +2.74% | 24/40 | +1.78% | 69 ms |
| FPI + BGMA mid | +0.00% | +0.04% | +0.79% | 35/40 | +1.12% | 230 ms |

Half those instances (convex, line) are solved exactly by every method, so the medians above are
diluted by ties. The discriminating rows are the hard families alone (uniform/cluster, 20
instances):

| method | median gap | mean gap | worst gap | vs 1-tree | median time |
|---|---:|---:|---:|---:|---:|
| greedy nearest-neighbour | +26.10% | +28.08% | +39.94% | +28.69% | 0.04 ms |
| FBW (farthest-pole walk) | +25.06% | +26.39% | +38.30% | +27.02% | 6 ms |
| zigzag `elim` | +34.02% | +35.65% | +51.22% | +36.67% | 0.19 ms |
| zigzag `nn2` | +33.80% | +35.42% | +53.14% | +35.59% | 0.19 ms |
| zigzag `veto` (one front) | +31.06% | +31.98% | +46.35% | +32.74% | 0.15 ms |
| NPI (`ni`, nearest insertion) | +16.74% | +16.34% | +23.73% | +18.03% | 0.26 ms |
| **FPI (`fi`, farthest insertion)** | **+8.11%** | **+7.73%** | **+13.00%** | **+9.94%** | 0.27 ms |
| FPI + screen | +4.35% | +4.19% | +8.16% | +5.77% | 1 ms |
| BGMA low | +0.58% | +0.86% | +2.86% | +1.78% | 83 ms |
| BGMA mid | +0.00% | +0.12% | +1.16% | +1.35% | 246 ms |
| FPI + BGMA low | +0.64% | +0.86% | +2.74% | +1.78% | 85 ms |
| FPI + BGMA mid | +0.00% | +0.07% | +0.79% | +1.12% | 258 ms |

Median gap by n (all four families):

| method | n=50 | n=100 | n=200 | n=300 | n=400 |
|---|---:|---:|---:|---:|---:|
| greedy nearest-neighbour | +7.40% | +12.26% | +12.71% | +11.66% | +11.67% |
| FBW (farthest-pole walk) | +7.32% | +12.26% | +11.71% | +11.57% | +11.67% |
| zigzag `elim` | +41.63% | +34.28% | +35.19% | +31.97% | +34.63% |
| FPI (`fi`) | +0.35% | +2.01% | +3.13% | +4.36% | +4.12% |
| NPI (`ni`) | +3.33% | +7.74% | +6.48% | +7.61% | +10.41% |
| FPI + screen | +0.00% | +1.29% | +1.91% | +2.33% | +2.87% |
| BGMA low | +0.00% | +0.03% | +0.28% | +0.42% | +0.27% |
| BGMA mid | +0.00% | +0.00% | +0.00% | +0.00% | +0.00% |
| FPI + BGMA low | +0.00% | +0.00% | +0.28% | +0.49% | +0.32% |

Median time by n (ms), and the true gap against the known optimum (the 20 convex and line
instances — both families are trivial, so this table certifies correctness, it does not rank):

| method | n=50 | n=100 | n=200 | n=300 | n=400 | true gap (median / mean / optimal) |
|---|---:|---:|---:|---:|---:|---|
| greedy nearest-neighbour | 0.009 | 0.027 | 0.067 | 0.039 | 0.062 | +0.00% / +0.00% / 20-20 |
| FBW (farthest-pole walk) | 0.4 | 1.3 | 5.7 | 15 | 27 | +0.00% / +0.00% / 20-20 |
| zigzag `elim` | 0.039 | 0.073 | 0.186 | 0.583 | 0.877 | +37.99% / +39.14% / 10-20 |
| FPI (`fi`) | 0.023 | 0.071 | 0.245 | 0.551 | 0.924 | +0.00% / +0.00% / **20-20** |
| NPI (`ni`) | 0.022 | 0.067 | 0.218 | 0.514 | 0.835 | +0.00% / +0.00% / 20-20 |
| FPI + screen | 0.065 | 0.179 | 0.821 | 1.8 | 2.5 | +0.00% / +0.00% / 20-20 |
| BGMA low | 3.7 | 11 | 69 | 211 | 575 | +0.00% / +0.00% / 20-20 |
| BGMA mid | 14 | 40 | 221 | 839 | 2030 | +0.00% / +0.00% / 20-20 |
| FPI + BGMA low | 3.4 | 10 | 69 | 232 | 518 | +0.00% / +0.00% / 20-20 |

Two readings of the same idea, on the 40 instances:
the zigzag is **+23.44% longer than FPI on the median instance** and FPI is the shorter one on
30/40 (the other 10 are ties, all at n=50). Against `ni`, farthest insertion is +0.52% shorter on
the median instance — at n=50 both hit the optimum often and the difference only opens up with n.
One screen drops the raw FPI tour by 1.63% on average (245 us → 813 us). Seeding BGMA low with
FPI moves the final tour by +0.00% on average (5 better, 4 worse, 31 equal).

## What it shows

- **Where the idea breaks is the closing edge, not the far list.** A two-front build from the
  poles has only one way to close: the A–Z edge. That edge is the diameter, and the optimal tour
  almost never uses it — convex position makes the failure unambiguous (+82.88% worst). Reading
  the far list as an insertion order instead means the first insertion *removes* the diameter,
  and the same information that failed as a veto succeeds as an order.
- **FPI is the strongest constructor in the repo, and cheap.** On the hard families it is about
  3× closer to the best tour than greedy and FBW (8.11% median against 26.10% and 25.06%) while
  taking 0.26 ms to FBW's 6 ms, and it beats nearest insertion by 8.63 pp, which is the classic
  farthest-insertion result reproduced here.
- **It is still a construction, and BGMA still wins on quality.** One screen closes half the gap
  to BGMA low (FPI +8.11% → +4.35% → BGMA low +0.58%), which is exactly the beam-screen-only
  finding: the cheap local search does the work, the constructor only matters as far as it starts
  somewhere sane. FPI + screen buys a 3.2 pp-worse tour for 83× less time.
- **A good seed is not a good search.** Handing FPI (a +8% tour) to BGMA as a pool seed is a
  no-op, so the pipeline's own beam start is already at least as good. This is the third
  independent construction measured to vanish inside the hybrid.
- **The all-40 medians understate everything.** Convex and line are solved exactly by every
  method including greedy, so half the table are ties; only the uniform/cluster rows separate the
  algorithms, and there the 1-tree ceiling is only ~1.8 pp below the best tour (a +9.94% bound gap
  for a +8.11% reference gap), so it is tight enough on this set to be informative.

## Caveats

- Synthetic families only; no TSPLIB, no CSV dataset. Convex and line are the only rows with a
  known optimum and both are trivial for every method here, so they prove the tours correct but
  cannot rank FPI where it matters. There is no exact reference on uniform/cluster at n > 22.
- The claim behind the idea — "the closest city to a pole is the optimal choice" — is a heuristic
  and false in general; nothing here proves anything about tour length. FPI has no guarantee
  either; it is the standard O(n^2) farthest-insertion construction and it is measured, not
  derived.
- The 1-tree column is a ceiling, not the true gap; its slack is geometry-dependent (the repo's
  own notes record 5.34 pp on `fl417` and 69% on a collinear set at n=400). Only the `vs bound`
  column is absolute; the gap columns are relative to the best tour any of the twelve found.
- One timed run per instance and 8 instances per (n, family); the microsecond rows (greedy, both
  insertions at n=50) are within timer and JIT noise of each other.
- n stops at 400. Both constructions are O(n^2) and the walk was self-checked at n=5001, but no
  quality measurement exists past 400.
- Determinism: the constructions are deterministic; the BGMA rows are deterministic given the
  seed (1 everywhere), so the recorded quality columns reproduce exactly, while the times move
  with machine load.

## Reproduce

```bash
node experiments/farthest-insert/bench.js                                  # the recorded run
node experiments/farthest-insert/bench.js --fams=uniform,cluster --levels=low --md=1   # the hard families
node experiments/farthest-insert/bench.js --ns=50,100,200 --fams=convex,line           # the certificate
node experiments/farthest-insert/bench.js --csv=experiments/farthest-insert/bench_results.csv \
  --ns=50,100,200,300,400 --seeds=2 --levels=low,mid > experiments/farthest-insert/results.txt
```

## Files

| file | what it is |
|---|---|
| `bench.js` | twelve-method harness + self-check; every flag in the header |
| `results.txt` | terminal output of the recorded 40-instance run |
| `bench_results.csv` | per-instance lengths and times for every method |
| `README.md` | this write-up |

The solver is shared, not copied: [`src/farthest/farthest_insert.js`](../../src/farthest/farthest_insert.js)
exports `solve`, `insertion`, `tourLen`, `checkTour`, `farthestPair`. The seeded rows reuse the
`seedTours` hook in [`src/hybrid/bgma.js`](../../src/hybrid/bgma.js); no pipeline code changed.
