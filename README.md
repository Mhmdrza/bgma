# tsp-lab

**Beam-Guided Memetic Annealing (BGMA): a TSP heuristic with an effort dial, measured against known optima.**

BGMA is a fixed-budget heuristic for the symmetric Euclidean travelling salesman problem, written in
dependency-free JavaScript. It combines beam-search construction, edge-recombination crossover,
short annealing kicks and 2-opt / Or-opt polishing, and exposes five effort levels (`low` → `max`).
This repository holds the solver, several baselines, and the harnesses behind every number below.

What was measured:

- **Small instances, exact reference.** Every effort level matched the Held–Karp optimum on
  **26 of 26** instances at n = 18, 20 and 22 (uniform and clustered).
- **TSPLIB, published optima.** At `max`, with ten seeds per instance up to n = 442, BGMA returned
  the published optimum in **89 of 100 runs**: on every seed for 8 of the 10 instances, on 9 of 10
  for `eil51`, and on **none** for `pcb442` (median +0.66%). From n = 574 to 1060 the median gap is
  **+0.50% to +2.10%** (1–3 seeds per instance).
- **Cost.** `low` solves n = 400 in 0.6 s (+2.2% over the best tour found); `max` takes 49 s there,
  and one `max` run on `pr1002` costs 40 min of CPU (14 min on three threads). Runtime grows like
  n^2.1–2.2 from n = 20 to 400, steepening to n^2.9–3.1 between 100 and 400.
- **A simpler baseline wins at equal time.** Restarted for the CPU time of one `max` run, the
  LK-style search in `src/lkh/` matches or beats BGMA `max` on all 14 TSPLIB instances (on `pr1002`
  it reaches BGMA's tour in 12 s instead of 40 min). The full write-up is the paper,
  [`paper/main.pdf`](paper/main.pdf).
- **The 1-tree bound is a loose ceiling.** It overstated the true gap by 0.00–5.34 percentage
  points on TSPLIB (`fl417`: +5.64% claimed for an optimal tour).

**[Open the demo →](https://mhmdrza.github.io/bgma/)** — 18 cities with the exact optimum
side by side. Drag the effort dial, roll a new seed, and watch the gap.

### Where this sits

BGMA is a heuristic. It carries no approximation guarantee and proves nothing about tours it does
not match; like any bounded-budget heuristic it runs in polynomial time, which says nothing about
P vs NP. It is **not** state of the art: [Concorde](https://www.math.uwaterloo.ca/tsp/concorde.html)
(branch-and-cut) proves optimality for instances far larger than any here, and Helsgaun's
[LKH](http://akira.ruc.dk/~keld/research/LKH-3/) is the standard heuristic and typically finds the
optimal tour on TSPLIB instances of this size. Neither was run in this repository. The solver in `src/lkh/` is an
independent LK-style local search (5-opt chains, kicks, no alpha-nearness, no tour merging), not
Helsgaun's LKH; restarted for equal CPU time it matches or beats BGMA `max` on every TSPLIB instance
tested (see the paper).

What this repository does offer: a readable, dependency-free implementation; an effort dial whose
cost/quality trade-off is measured level by level; and an evaluation that separates three
references people often conflate — exact optima, published optima, and a lower bound.

| | Held–Karp DP (exact) | BGMA |
|---|---|---|
| time at n=20 | 299 ms | **1.3 ms** (`low`) · 65 ms (`max`) |
| time at n=22 | 1.2–1.5 s, 378 MiB | **4–72 ms** (mean, `low`–`max`) |
| growth | doubles with every extra city | **≈ n^2.1–2.2 from 20 to 400, ≈ n^3 between 100 and 400** |
| n=30 | ≈ 100 GiB of table | ≈ 2 ms (`low`) |
| n=400 | out of reach for the DP | 0.6 s (`low`) · 49 s (`max`) |
| n≈1000 | out of reach for the DP | `max` on `pr1002`: 40 min of CPU (serial cost of the 3-unit portfolio) |
| tour excess vs best, n=400 | 0 (exact, n ≤ 22 only) | `low` +2.21% · `max` 0.00% (Christofides: +13.02%) |
| tour gap vs bound, n=1000 (*ceiling*) | — | `low` +3.72% · `xhigh`/`max` +2.16% (single instance) |
| **true gap vs optimum**, n≈1000 | — | **+2.10%** (`pr1002`, 1002 cities) · **+1.45%** (`u1060`) |
| quality guarantee | exact | none proven; Christofides has a proven 1.5× but its excess is 6–86× that of `low` from n=50 |

"Out of reach" refers to the Held–Karp dynamic program only; branch-and-cut solvers handle these sizes.

### n ≤ 22: matched the exact optimum, every time

Every effort level, from `low` to `max`, hit the Held–Karp optimum on **26 of 26 instances**
(n = 18, 20, 22; uniform and clustered). Even the cheapest level never missed.

### n > 22: a proven bound, and published optima

Past n=22 there is nothing exact left to compare with. Synthetic families are measured against a
**proven 1-tree (Held–Karp–style subgradient) lower bound**; because the optimum can never be below
it, that gap is a guarantee — but a one-sided one, so it can only *overstate* the excess. Real
instances are therefore also scored against **published TSPLIB optima**, which give the true gap.

- On **fri26** the tour meets the bound exactly (937 = 937), so it is **proven optimal** without
  trusting any reference answer.
- Against published optima, **all 9 TSPLIB instances up to n=417 are exactly optimal** — including
  `fl417`, where the bound claims a 5.64% gap for that optimal tour.
- At n = 80–200 the median tour is within **+0.71%** of the bound at `xhigh`/`max`. That is a ceiling:
  wherever an optimum exists the true gap is smaller, and through n=417 it is zero.
- At n = 300–400 `xhigh` stays within **+1.25%** of the bound and `max` within **+1.13%**, while
  `low` finishes n=400 in under a second.
- The *bound* gap is not flat in n: +1.33% at 600, +1.59% at 800, +2.16% at 1000. Measured against
  real optima, the true gap is **+0.33% at 574, +1.05% at 783, +2.10% at 1002** — noticeably better
  than the ceiling suggested.

### n = 800–1000: where the curve bends

A stress sweep at the top of the range (gap to a *converged* 1-tree bound, 600 subgradient
iterations; validated against 6000 iterations so the number is not an under-converged artefact):

| n | `max` gap ≤ | `max` time | `low` gap ≤ | `low` time |
|---|---:|---:|---:|---:|
| 400 | +1.11% | 64 s | +3.70% | 1.3 s |
| 500 | +1.14% | 147 s | — | — |
| 600 | +1.33% | 341 s | — | — |
| 800 | +1.59% (uniform) · +1.48% (cluster) | 27 min | — | — |
| 1000 | +2.16% (uniform) · +2.21% (cluster) | 72 min | +3.72% | 24 s |

Times at 400–600 are clean, sequential runs; the 800 and 1000 rows are wall clock with several runs
in flight, so read them as upper bounds. Clean sequential points grow as **t ≈ n^3.7–4.6**, not the
n² the runtime table reports below (that exponent is fitted over 20→400, where the cheap small-n
cells dominate).

Two things the sweep settled:

- **`max` stops paying at the top.** The full ladder at n=1000 is `low` 3.72% / 24 s, `mid` 3.06% /
  123 s, `high` 2.57% / 429 s, `xhigh` 2.16% / 948 s, `max` **2.16% / 72 min** — `xhigh` and `max`
  returned the *identical tour*. For n ≥ 80 both profiles already share the same beam width (n/2)
  and generation count (n/8); the extra budget buys only restarts and elite capacity, and here it
  bought nothing.
- **The certificate converges, but it cannot separate slack from excess.** The 1-tree bound moves by
  0.002 pp between 600 and 6000 subgradient iterations at n=1000, so it is not lazy — yet it still
  cannot tell a 2% tour excess from a 2% loose bound. The TSPLIB runs below settle that per instance:
  on `pr1002` the ceiling is +3.02% and the true gap +2.10%; on `fl417` the tour is optimal and the
  +5.64% ceiling is pure slack. Only a known optimum separates the two.

### Stress validation: what held, and what did not

~160 runs across n = 4–1000 and seven instance families (uniform, clustered, convex position,
collinear, integer grid, duplicated cities, coincident cities), at every effort level:

- **0 invalid tours, 0 length mismatches, 0 bound violations.**
- **Deterministic**: three repeats of one seed returned the identical tour and length.
- **Scale-invariant**: coordinates at 10⁻³ and 10⁶ give the same relative gaps.
- **Degenerate input survives**: coincident cities (tour length 0), duplicate points, exact ties.
- **Memory**: 367 MB at n = 1000.
- **Provably optimal wherever a proof exists**: convex position at n = 20, 100, 200, 400 and
  **1000** (the hull cycle), a 20×20 grid at n = 400 (400 against a bound of 400), collinear sets at
  every size tested, and all 9 published TSPLIB instances up to n = 417.

What does not survive is the certificate's *tightness*: on a collinear instance at n = 400 the tour is
provably optimal while the 1-tree bound sits **69% below it** (28–37% at n = 100). A gap to that bound
is an upper bound on the true gap, and how tight it is depends on the geometry, not only the tour.

### The true gap: measured against known optima, not a bound

TSPLIB instances carry proven optima, which turns the same `max` run into a real measurement instead
of a ceiling. TSPLIB `EUC_2D` declares distances as `nint(sqrt(dx²+dy²))`, so `tuning/tsplib_bench.js`
builds the rounded matrix and the solver optimises exactly the published objective. Every tour below
was re-validated as a permutation and its length recomputed from the matrix before reporting.

| instance | n | optimum | `max` tour | **true gap** | bound ceiling | bound below OPT |
|---|---:|---:|---:|---:|---:|---:|
| eil51 | 51 | 426 | 426 | **0.000%** | +0.829% | 0.823% |
| berlin52 | 52 | 7542 | 7542 | **0.000%** | +0.000% | 0.000% |
| st70 | 70 | 675 | 675 | **0.000%** | +0.596% | 0.593% |
| kroA100 | 100 | 21282 | 21282 | **0.000%** | +1.650% | 1.624% |
| pr124 | 124 | 59030 | 59030 | **0.000%** | +1.658% | 1.631% |
| bier127 | 127 | 118282 | 118282 | **0.000%** | +0.725% | 0.720% |
| ch130 | 130 | 6110 | 6110 | **0.000%** | +0.568% | 0.565% |
| tsp225 | 225 | 3916 | 3916 | **0.000%** | +0.982% | 0.973% |
| fl417 | 417 | 11861 | 11861 | **0.000%** | +5.639% | 5.338% |
| pcb442 | 442 | 50778 | 51136 | +0.705% | +1.282% | 0.570% |
| u574 | 574 | 36905 | 37028 | +0.333% | +0.864% | 0.526% |
| rat783 | 783 | 8806 | 8898 | +1.045% | +1.430% | 0.380% |
| pr1002 | 1002 | 259045 | 264473 | +2.095% | +3.018% | 0.896% |
| u1060 | 1060 | 224094 | 227345 | +1.451% | +2.327% | 0.856% |

Three things this settles:

- **The bound cannot rank instances.** `fl417` is optimal to the last unit while its bound claims a
  5.64% gap; `berlin52`'s bound is tight to the unit. Across these instances the ceiling overstates
  the true gap by **0.00–5.34 percentage points**, and the size of that slack is a property of the
  geometry, not of the tour. So a gap to the bound is only meaningful *within one instance*.
- **The degradation with n is real but not monotone**: everything through n=417 is solved exactly;
  beyond that the gap is 0.33–0.71% at n=442–574, 1.05% at 783, and 1.45–2.10% at n=1002–1060.
  Instance structure matters as much as size (`fl417` exact, `pcb442` +0.71% at almost the same n).
- **The synthetic n=1000 ceiling (+2.16%) happened to sit near the true `pr1002` gap (+2.10%)**, but
  that is coincidence: on `pr1002` the ceiling itself was +3.02%, and on `u1060` +2.33% against a
  true +1.45%.

### Running the 1000-city suite without waiting 72 minutes

A `max` run is not one computation. It is **three independent, deterministic hybrid runs** — the
`xhigh` arm plus the two `max` restarts — and `runEffort` takes the shortest. Splitting them across
threads therefore cannot change the answer, only the wall clock. `tuning/stress_parallel.js` does
exactly that with `worker_threads`, and also spreads independent levels / seeds / families over the
pool. The workers rebuild the instance locally from its point list, so nothing large crosses a thread
boundary.

| workload | serial | parallel | speedup |
|---|---:|---:|---:|
| n=100, 3 families × 5 levels × 2 seeds (30 rows) | 12.1 s | 2.2 s (6 jobs) | **5.5×** |
| n=400, uniform+cluster, `max` (2 rows) | 131.9 s | 23.3 s (6 jobs) | **5.7×** |
| n=1000, uniform, `max` (1 row) | 3445 s | **19.5 min** (3 jobs) | **2.94×** |

The single-row case is bounded by its longest unit — one `max` restart. End to end, the n=1000 row
went from 72 minutes to 19.5 minutes (**3.7×**) and returned the identical tour (2176.903, +2.164%).
A five-level, two-family sweep at n=1000 is 14 units with very different costs (`low` 24 s, one `max`
restart ~20 min); the pool balances them as workers free up, so 10 rows cost about half an hour
instead of 2.8 hours — roughly **6×**. Every parallel run is checked against the serial harness:
30/30 rows matched to the last digit.

Two kernel changes came out of the same profiling pass: `refineBase` and `orOptFast` no longer
allocate inside their scan loops (they allocated an `O(n)` array per position, per segment length),
which makes the local search **1.37×** faster. Both rewrites preserve the exact move order, so the
tours are bit-identical — verified on 60 A/B cases from n=20 to 1000.

**Why not the GPU?** The hot loop is sequential 2-opt: each accepted move mutates the tour in place
and invalidates the positions the next comparison reads, so there is no data-parallel batch to hand
to a GPU. The irregular, pointer-chasing memory access also defeats coalescing, and Node has no
native WebGPU compute. The parallelisable dimension is *independent runs*, which is what threads
already exploit. The remaining lever is algorithmic — a stronger local search (3-opt / LK) that needs
fewer generations — not more hardware.

### Fine print

Every number here comes from a script in this repository. BGMA is a heuristic, not an exact
solver. The exact check covers n ≤ 22 (26/26 instances); past that, tours were checked against
**published TSPLIB optima** (14 instances, 51–1060 cities, one `max` run each): all 9 up to n = 417
are exact (0.000% gap), and the five above that are +0.33% to +2.10% long. That is evidence on these
instances, not a guarantee for others. The older "+2.16% at n=1000" is a gap to the 1-tree bound — a
*ceiling* that is 0.00–5.34 percentage points loose here (on `fl417` it claims 5.64% for an optimal
tour), so it should not be read as an excess over the optimum.

To rerun the TSPLIB table, download the `.tsp` files from
[TSPLIB95](https://comopt.ifi.uni-heidelberg.de/software/TSPLIB95/) (they are not redistributed here)
(or a mirror such as [mastqe/tsplib](https://github.com/mastqe/tsplib)) and pass each to
`tuning/tsplib_bench.js` with its published optimum, e.g.
`node tuning/tsplib_bench.js --file=fl417.tsp --opt=11861 --levels=max`. The raw output of every run
in the table is in `tuning/out/<instance>_max.json`; the ten instances up to `pcb442` take about a
minute in total and reproduce the table to the unit.

The 1-tree is a *relaxation*, not a tour: a spanning tree plus the two cheapest edges at one root,
with the degree-2 constraint dropped. That is why its length is shorter than every tour — any tour
contains such a 1-tree, so `1-tree ≤ tour` is a theorem, not an estimate. It is deterministic given
the iteration budget (600 subgradient steps here; 6000 moves the n=1000 bound by 0.002 pp), and it is
checked against exact optima at n ≤ 22: the bound never exceeded the optimum in 18/18 runs.
Details and caveats: [docs/gerdal.md](docs/gerdal.md).

---

How the project grew: it started as a quantum-inspired TSP demo (the vocabulary is borrowed; there
is no quantum mechanics in it) and became a fast beam + tunnelling solver, a readable
reference implementation, a nature-model rewrite (weighted population, soft selection,
annealing with kicks, recombination), and two tuned solvers with `--effort` dials — BGMA and
the nature solver — plus benchmarks against TSPLIB instances and a CSV dataset.

The design note is **[docs/gerdal.md](docs/gerdal.md)** (algorithm, pseudocode, validation, claim audit). Read **[docs/TSP_NOTES.md](docs/TSP_NOTES.md)** next — it holds the findings, measured numbers,
known pitfalls, and every command. Knob-tuning observations and future ideas are in
**[docs/TUNING_NOTES.md](docs/TUNING_NOTES.md)**; [docs/philosophy.md](docs/philosophy.md) is an informal note on what
the search actually does (one wide expansion, then repeated selection).

## Layout

```
index.html, app.js      the original 2020 canvas demo (untouched)
src/
  beam/                 beam + tunnel solvers          (beam_fast, beam_simple)
  nature/               population / annealing solver  (nature_tsp, nature_core, nature_effort)
  hybrid/               BGMA: solver, effort ladder, CLI, demo core
  lkh/                  LK-style solver (LK chains + kicks; not Helsgaun's LKH)
  farthest/             farthest-pole constructions (walk, farthest-pole insertion, FPI)
bench/                  TSPLIB, dataset and comparison benchmarks
tuning/                 knob / effort sweeps and Held-Karp validation
experiments/            self-contained experiments with their own write-up and results
docs/                   notes + the published pages (GitHub Pages serves /docs)
```

Every script resolves its siblings from its own location, so commands work from any directory.

The visual pages live in `docs/` so GitHub Pages can serve them. Pages serves only that folder, so
the two browser modules they load are mirrored into `docs/js/` by `node bench/sync_docs.js`; rerun it
after editing `src/hybrid/hybrid_vis.js` or `src/hybrid/effort_profiles.js` (`--check` fails if the
mirror is stale).

## Quick start

```bash
npm test                                               # ~20 s: 26/26 Held-Karp check, Christofides <= 1.5x, docs mirror
node bench/fri26_bench.js                              # TSPLIB, optimum known
node bench/dantzig42_bench.js
node bench/att48_bench.js
node src/beam/beam_fast.js --n=200 --seeds=6              # synthetic instances
node src/beam/beam_fast.js --n=200 --preset=tuned         # best all-n rule (n=40..400)
node src/beam/beam_fast.js --n=40 --seeds=2 --score=all   # score unvisited cities (MST bound)
node src/beam/beam_fast.js --n=200 --K=n/2 --near=n/10    # n-based knob values
# every beam/tunnel knob is documented in src/beam/beam_fast.js's header
node src/nature/nature_tsp.js --n=200 --seeds=4
node src/nature/nature_effort.js --n=200 --effort=mid       # tuned nature, 5 effort levels
node src/nature/nature_effort.js --n=200 --effort=max --bound=1
node src/nature/nature_effort.js --ns=50,100,200 --efforts=low,mid,high,xhigh,max --seeds=2
node tuning/tune_nature.js --ns=50,100,150 --seeds=2        # learn the nature knobs
node tuning/validate_nature_effort.js --ns=18,20,22 --seeds=3  # exact Held-Karp check
node bench/runtime_bench.js                          # runtime + quality of every algorithm
node bench/bench_dataset.js --per-n=3                   # CSV dataset
node bench/knob_bench.js --ns=50,100,200 --seeds=2      # greedy vs nature vs knob presets
node src/hybrid/hybrid_tsp.js --ns=100,200,300 --seeds=2     # beam + ERX + nature anneal hybrid
node src/hybrid/hybrid_effort.js --n=200 --effort=mid        # tuned BGMA, 5 effort levels
node src/hybrid/hybrid_effort.js --n=200 --effort=max --bound=1
node src/hybrid/hybrid_effort.js --ns=50,100,200 --efforts=low,mid,high,xhigh,max --seeds=2
node tuning/tune_effort.js --ns=40,80,150 --seeds=2      # learn the effort knobs
node tuning/validate_effort.js --ns=18,20,22 --seeds=5   # exact Held-Karp check
node src/lkh/lkh.js --n=200 --seeds=3                    # LK-style local search (not Helsgaun's LKH)
node src/lkh/lkh.js --check=1                            # validate vs Held-Karp, n <= 12
node bench/lkh_bench.js --ns=100,200,400 --seeds=2       # LK-style vs BGMA, head to head
node experiments/beam-screen-only/bench.js               # ablation: beam + fast screen only vs BGMA
node experiments/beam-screen-only/tune_nscale.js --ns=100,200,300,400 --seeds=2  # n-scaled two-step knobs
node experiments/one-tree-seed/bench.js                  # 1-tree bound as a seed + a stop floor
node experiments/farthest-insert/bench.js                 # farthest-pole insertion (FPI) vs BGMA
node experiments/christofides-1p5/bench.js                # shapes that push Christofides to 1.5x; BGMA mid vs it
node tuning/stress_parallel.js --ns=1000 --families=uniform,cluster --levels=max --jobs=3
node tuning/stress_max.js --ns=1000 --families=uniform --levels=max   # serial reference
node tuning/validate_christofides.js                     # matching vs brute force, Christofides <= 1.5x
open docs/nature_tsp.html                             # nature-model visual page
open docs/hybrid_tsp.html                             # the pitch: exact optimum vs BGMA, live
```

### A proven guarantee, for comparison

Christofides' algorithm (`src/christofides/christofides.js`) is the classic polynomial-time method
with a proof: on any metric instance its tour is at most **1.5× the optimum**. It is implemented
here with a real minimum-weight perfect matching (Edmonds' blossom algorithm), checked against
brute force and against Held–Karp. Its measured excess is **+10–13%** at every n, while BGMA's
`low` level is within +0.1–2.2% of the best tour from n=50 to 400 and BGMA gives up the proof.
The 1.5 band is reachable, but only on adversarial metrics: see
[experiments/christofides-1p5](experiments/christofides-1p5/) — a two-cluster diameter-2 metric
drives it to 1.495x at n=190, and BGMA `mid` still returns the optimum there.

## Runtime

The numbers behind the headline. Median wall time per instance, 4 instances per cell (2 seeds × uniform/cluster), Apple M3 Pro, Node v22.23.2.
Only the solve is timed (distance-matrix setup excluded). The last column is the empirical
exponent in time ∝ n^k between n=20 and n=400.

| method | n=20 | n=50 | n=100 | n=200 | n=400 | scaling ~ n^k |
|---|---:|---:|---:|---:|---:|---:|
| greedy nearest-neighbour | 3 µs | 7 µs | 12 µs | 25 µs | 55 µs | 0.92 |
| beam only (K=n/3) | 213 µs | 490 µs | 2.1 ms | 9.4 ms | 42 ms | 1.77 |
| beam + tunnel (tuned) | 1.1 ms | 6.0 ms | 45 ms | 441 ms | 4.22 s | 2.77 |
| nature (population + anneal) | 12 ms | 66 ms | 86 ms | 180 ms | 553 ms | 1.29 |
| Christofides (1.5-approx) | 225 µs | 606 µs | 1.1 ms | 11 ms | 27 ms | 1.60 |
| LK-style (5-opt, iterated) | 13 ms | 50 ms | 98 ms | 660 ms | 1.36 s | 1.54 |
| BGMA low | 1.3 ms | 4.0 ms | 12 ms | 83 ms | 596 ms | 2.04 |
| BGMA mid | 5.0 ms | 15 ms | 38 ms | 220 ms | 1.96 s | 1.99 |
| BGMA high | 9.7 ms | 31 ms | 86 ms | 643 ms | 6.37 s | 2.17 |
| BGMA xhigh | 16 ms | 53 ms | 213 ms | 1.81 s | 15.0 s | 2.28 |
| BGMA max | 65 ms | 202 ms | 676 ms | 5.50 s | 48.5 s | 2.21 |
| 1-tree lower bound | 102 µs | 3.4 ms | 15 ms | 65 ms | 260 ms | 2.62 |
| Held-Karp exact | 315 ms | — | — | — | — | — |

Mean excess over the best tour any method found on the same instance:

| method | n=20 | n=50 | n=100 | n=200 | n=400 |
|---|---:|---:|---:|---:|---:|
| greedy nearest-neighbour | +14.03% | +27.72% | +31.90% | +31.05% | +26.46% |
| beam only (K=n/3) | +14.94% | +32.13% | +32.43% | +37.64% | +38.88% |
| beam + tunnel (tuned) | +0.00% | +0.04% | +0.69% | +1.54% | +2.22% |
| nature (population + anneal) | +0.00% | +0.07% | +0.69% | +3.40% | +35.39% |
| Christofides (1.5-approx) | +10.50% | +10.07% | +13.07% | +13.49% | +13.03% |
| LK-style (5-opt, iterated) | +0.00% | +0.00% | +0.00% | +0.11% | +0.37% |
| BGMA low | +0.00% | +0.12% | +0.52% | +1.70% | +2.22% |
| BGMA mid | +0.00% | +0.00% | +0.03% | +0.69% | +1.13% |
| BGMA high | +0.00% | +0.00% | +0.02% | +0.31% | +0.60% |
| BGMA xhigh | +0.00% | +0.00% | +0.00% | +0.02% | +0.12% |
| BGMA max | +0.00% | +0.00% | +0.00% | +0.01% | +0.00% |

What it shows:

- Each BGMA effort level costs about **3×** the previous one and roughly **halves** the gap
  (n=400: +2.22% → +1.13% → +0.60% → +0.12% → 0.00%, in 0.60 s → 2.0 s → 6.4 s → 15 s → 49 s).
  That holds up to 400; at n=1000 the last step buys nothing (see the stress section above).
- `low` matches the tuned beam + tunnel at n=400 (+2.22% vs +2.22%) in **0.60 s instead of 4.2 s**;
  at n=100 `mid` is both faster and better (38 ms, +0.03% vs 45 ms, +0.69%).
- BGMA grows like n^2.0–2.3 up to n=400 and like n^3.7–4.6 beyond it, the tuned beam + tunnel like
  n^2.8 (it polishes every beam final).
- Greedy and beam-only cost microseconds to milliseconds but stay 26–39% above the best tour.
- Nature looks cheap at n=400 (0.55 s) only because its annealing budget is capped; it is +35% there.
- **LK-style** reaches +0.37% at n=400 in 1.36 s — better than `high` (6.4 s, +0.60%), worse than `xhigh`
  (15 s, +0.12%) and `max` (49 s, +0.00%). Its time grows like n^1.5, the flattest of the strong methods.
- **Christofides** is the only method here with a proof: its tour is at most 1.5× optimal on any metric instance.
  In practice it lands 10–13% above the best tour at every n, and it runs in 27 ms at n=400.
  On the n ≤ 20 instances checked against Held–Karp it averaged 1.07× optimal, worst 1.18×, never above 1.5×.
  From n=50 up, BGMA `low` has a 6 to 80 times smaller excess, at 8 to 24 times the runtime.
- The 1-tree bound costs about 45–80% of a `low` run at n=200–400; Held–Karp needs 0.30 s at n=20 and
  doubles per city. At n=1000 the bound takes 2.6 s against 24 s for `low` and 72 minutes for `max`.

### LK-style local search, head to head against BGMA

`src/lkh/lkh.js` is a Lin–Kernighan style search modelled loosely on LKH: candidate-restricted LK
chains (up to 5-opt) plus double-bridge kicks, no alpha-nearness and no tour merging. It is a
from-scratch reimplementation, far simpler than Helsgaun's LKH, and is used here as a baseline. Same instances,
same 1-tree bound, defaults everywhere (`--kicks` auto):

| method | vs 1-tree bound | vs best-of-all | median ms | wins / 12 |
|---|---:|---:|---:|---:|
| LK-style (5-opt, iterated) | **+0.80%** | +0.03% | 665 | 6 |
| BGMA low | +2.31% | +1.45% | 83 | 0 |
| BGMA mid | +1.22% | +0.65% | 218 | 1 |
| BGMA high | +0.97% | +0.30% | 624 | 3 |
| BGMA xhigh | +0.76% | +0.00% | 1814 | 9 |
| BGMA max | **+0.76%** | +0.00% | 5478 | 10 |

12 instances (n=100/200/400; 2 seeds × uniform/cluster), medians. Per n (median excess over the bound):

| n | LK-style | BGMA low | BGMA mid | BGMA high | BGMA xhigh |
|---|---:|---:|---:|---:|---:|
| 100 | +0.54% | +1.08% | +0.57% | +0.54% | +0.54% |
| 200 | +0.69% | +2.31% | +1.22% | +0.92% | +0.58% |
| 400 | +1.47% | +3.36% | +2.02% | +1.67% | +1.23% |

The LK-style search is shorter than BGMA `high` on most instances (median −0.11%) at the same median cost, and
loses to `xhigh` from n=200 up — `xhigh` pays ~3× the time for that last 0.2–0.3 pp.

Against `max` (n=100/200/400, 2 seeds × uniform/cluster): `max` is the better tour on 10/12
instances but by a median of **0.03%** only; at n=100 the two are tied (+0.54% vs +0.54%), and the
gap opens with n (n=200 +0.58% vs +0.69%, n=400 +1.16% vs +1.47%). `max` pays **5.48 s** per
instance against the LK-style search's 0.66 s — 8× the time for 0.03 pp.
Reproduce: `node bench/lkh_bench.js --ns=100,200,400 --seeds=2 --levels=low,mid,high,xhigh,max --json=bench/lkh_results.json`.
Validation: `node src/lkh/lkh.js --check=1` matches Held–Karp on 6/6 instances at n=11.

### Nature, with an effort dial

The nature solver (`src/nature/nature_core.js`) now exposes the same five-level ladder. Its
old fixed 120k-proposal budget stopped scaling above n≈51, which is why the historical nature
column collapses at n=400. The ladder scales proposals with `n²` and adds independent restarts:

| effort | median gap vs 1-tree bound | n=50 | n=100 | n=200 | n=300 |
|---|---:|---:|---:|---:|---:|
| `low` | +1.55% | 9 ms | 35 ms | 142 ms | 309 ms |
| `mid` | +1.49% | 22 ms | 86 ms | 361 ms | 896 ms |
| `high` | +1.35% | 68 ms | 263 ms | 1.06 s | 2.83 s |
| `xhigh` | +1.08% | 180 ms | 681 ms | 3.07 s | 7.42 s |
| `max` | +1.02% | 499 ms | 2.05 s | 8.79 s | 22.5 s |

16 synthetic instances (n=50/100/200/300; 2 seeds × uniform/cluster), 1-tree bound with 400
subgradient iterations. `max` is a portfolio of the `xhigh` run and a heavier run, so it can
never be worse than `xhigh` on the same instance. At n ≤ 22 every level matched Held–Karp on
**18/18 instances**. Reproduce: `node src/nature/nature_effort.js --ns=50,100,200 --efforts=low,mid,high,xhigh,max --seeds=2 --kind=both --bound=1`.

At n=400/500 only `max` holds (median +3.3/+3.9% vs the bound, 40/72 s); `low` drifts to
+4.2/+7.9% and `high` beat `max` once at a ninth of the cost. Larger-n detail:
[TSP_NOTES §4.4](docs/TSP_NOTES.md#44-large-n-n400-and-n500).

Reproduce the runtime table above (about ten minutes): `node bench/runtime_bench.js --json=docs/runtime.json --web=docs/runtime_data.js`.
The same data drives the runtime table in both pages under `docs/`; the pages also show the live
runtime of each panel. Analysis and caveats: [docs/gerdal.md](docs/gerdal.md) (section "Measured runtime").

## Files

| file | role |
|---|---|
| `src/beam/beam_fast.js` | optimised beam + tunnel (arena, bitsets, DLB 2-opt, Or-opt) |
| `src/beam/beam_simple.js` | same solver written for reading |
| `src/nature/nature_tsp.js` | population + annealing + recombination solver |
| `src/nature/nature_core.js` | Parameterised nature core (`nature`, `runEffort`, all knobs); defaults reproduce the page |
| `src/nature/nature_effort_profiles.js` | Shared `low|mid|high|xhigh|max` nature budgets |
| `src/nature/nature_effort.js` | Tuned nature CLI with `--effort`, `--bound`, `--tour`, `--json` |
| `tuning/tune_nature.js` | Nature knob sweep (quality vs 1-tree bound vs runtime) |
| `tuning/validate_nature_effort.js` | Checks every nature effort level against Held–Karp (n ≤ 22) |
| `docs/nature_tsp.html` | visual page with optimum / bound panel |
| `bench/merge_bench.js` | "mix the wave, then contract" comparison |
| `bench/bench_dataset.js` | dataset bench (greedy / beam+tunnel / nature) |
| `bench/runtime_bench.js` | wall-clock runtime and quality of every algorithm; writes `docs/runtime.json` and `docs/runtime_data.js` |
| `docs/runtime_table.js` | renders the measured-runtime table inside both pages |
| `src/christofides/christofides.js` | Christofides 1.5-approximation: MST, blossom minimum-weight perfect matching, Euler tour |
| `tuning/validate_christofides.js` | checks the matching against brute force and the tour against Held–Karp (≤ 1.5×) |
| `src/lkh/lkh.js` | LK-style solver (not Helsgaun's LKH): LK chains over 8 nearest candidates, don't-look bits, double-bridge kicks |
| `bench/lkh_bench.js` | LK-style search vs every BGMA effort level on the same instances, scored against the 1-tree bound and best-of-all |
| `bench/knob_bench.js` | greedy vs nature vs beam+tunnel under n-based knob presets |
| `tuning/tune_knobs.js` | knob sweep against greedy/nature/random-start heuristics; finds `--preset=tuned` |
| `src/hybrid/hybrid_tsp.js` | Beam-Guided Memetic Annealing: beam islands + ERX + nature anneal + selective base polish |
| `src/hybrid/bgma.js` | Parameterised BGMA core (`hybrid`, `effortPreset`, `runEffort`) shared by the effort CLI |
| `src/hybrid/effort_profiles.js` | Shared `low|mid|high|xhigh|max` budgets for the CLI and the visualizer |
| `src/hybrid/hybrid_effort.js` | Tuned BGMA CLI with `--effort=low|mid|high|xhigh|max`, `--bound`, `--tour`, `--json` |
| `tuning/tune_effort.js` | Sweep harness for the effort knobs (quality vs 1-tree bound vs runtime) |
| `tuning/validate_effort.js` | Checks every effort level against Held–Karp (n ≤ 22) |
| `tuning/stress_max.js` | Adversarial stress harness: validity, known-optimum families, 1-tree bound at scale (serial) |
| `tuning/stress_parallel.js` | Same harness over `worker_threads`; splits `max` into its three independent runs (result-identical) |
| `tuning/tsplib_bench.js` | True-gap bench: parses TSPLIB `EUC_2D` (rounded distances) and scores runs against published optima |
| `tuning/families.js` | Instance families shared by both harnesses |
| `src/hybrid/instance.js` | `buildFromPoints`, `instanceFromSpec` — instance rebuilding for workers |
| `src/hybrid/pool.js`, `src/hybrid/unit_runner.js` | Worker-thread pool and worker entry point |
| `docs/hybrid_tsp.html` | interactive demo and pitch page: exact optimum vs BGMA, effort dial, timeline, live stats (n ≤ 30) |
| `docs/js/` | generated mirror of the two browser modules, so Pages can serve the demo (`node bench/sync_docs.js`) |
| `bench/sync_docs.js` | copies `src/hybrid/{effort_profiles,hybrid_vis}.js` into `docs/js/`; `--check` fails when stale |
| `src/hybrid/hybrid_vis.js` | Browser/Node core behind the demo: `makeInstance`, `buildSnapshots`, `effortOptions`, `heldKarp`, `hkBound` |
| `docs/gerdal.md` | Archival algorithm note for BGMA: design, pseudocode, effort ladder, validation, demo-claim audit |
| `docs/TUNING_NOTES.md` | observations from the tuning sweeps and future-work hypotheses |
| `bench/fri26_bench.js`, `bench/dantzig42_bench.js`, `bench/att48_bench.js` | TSPLIB runs |
| `bench/n22_bench.js` | n=22 greedy vs beam+tunnel vs exact (never executed) |

No dependencies. Node 18+ only; the visual page is static HTML plus the `docs/js/` mirror of
`src/hybrid/hybrid_vis.js` (regenerate with `node bench/sync_docs.js`).

## Cite this

Metadata in [`CITATION.cff`](CITATION.cff).

```bibtex
@software{aala_tsp_lab_2026,
  author  = {Aala, Mohammadreza},
  title   = {tsp-lab: Beam-Guided Memetic Annealing (BGMA), benchmarked against known TSP optima},
  year    = {2026},
  version = {1.1.0},
  url     = {https://github.com/Mhmdrza/bgma}
}
```

## License

MIT — see [`LICENSE`](LICENSE). Questions and results from reruns are welcome: **mrala@ut.ac.ir**.
