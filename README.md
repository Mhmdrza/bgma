# tsp-lab

**Routes exact solvers can’t reach — in milliseconds.**

Routing has always forced a choice: pay exponentially for an exact answer, or ship a fast one that is
quietly 10–13% longer than it needs to be. Beam-Guided Memetic Annealing (BGMA) ends that trade-off:
it reproduces the exact Held–Karp optimum wherever that answer can still be computed, then keeps
finding tours the exact method could never reach.

- **26/26 exact optima reproduced** at n = 18, 20 and 22, at *every* effort level, including the cheapest.
- **215× faster than the exact solver** at 20 cities: 1.4 ms against 302 ms for the identical, provably
  shortest tour.
- **+1.13% of the proven bound at 400 cities, +2.16% at 1000** — and exactly optimal on every
  1000-city instance whose optimum is known by construction (convex position).

**[Open the interactive demo →](docs/hybrid_tsp.html)** — 18 cities with the exact optimum side by side.
Drag the effort dial, roll a new seed, and watch the gap.

| | Held–Karp (exact) | BGMA |
|---|---|---|
| time at n=20 | 302 ms | **1.4 ms** (`low`) · 71 ms (`max`) |
| time at n=22 | 1.3–1.6 s, 378 MiB | **2–60 ms** |
| growth | doubles with every extra city | **≈ n² to 400, ≈ n³–n⁴ beyond** (measured 2.0–2.3, then 3.7–4.6) |
| n=30 | ≈ 100 GiB of table | ≈ 13 ms (`low`) |
| n=400 | impossible | 0.7 s (`low`) · 64 s (`max`) |
| n=1000 | impossible | 24 s (`low`) · 72 min (`max`) |
| tour excess vs best, n=400 | 0 (exact, n ≤ 22 only) | `low` +2.21% · `max` 0.00% (Christofides: +13.02%) |
| tour gap vs bound, n=1000 | impossible | `low` +3.72% · `xhigh`/`max` +2.16% (single instance) |
| quality guarantee | exact | none proven; Christofides has a proven 1.5× but is 6–80× worse in practice |

### n ≤ 22: matched the exact optimum, every time

Every effort level, from `low` to `max`, hit the Held–Karp optimum on **26 of 26 instances**
(n = 18, 20, 22; uniform and clustered). Even the cheapest level never missed.

### n > 22: Held–Karp is out, so we measured against a proof instead

Past n=22 there is nothing exact left to compare with. Rather than stop there, every run is
measured against a **proven 1-tree (Held–Karp–style subgradient) lower bound**. The optimum can
never be below it, so the reported gap is a guarantee, not an estimate.

- On **fri26** the tour meets the bound exactly (937 = 937), so it is **proven optimal** without
  trusting any reference answer.
- At n = 80–200 the median tour is within **+0.71%** of the bound at `xhigh`/`max`. The bound is
  loose, so the true gap is smaller still.
- At n = 300–400 `xhigh` stays within **+1.25%** of the bound and `max` within **+1.13%**, while
  `low` finishes n=400 in under a second.
- The gap is not flat in n: it grows to **+1.33%** at 600, **+1.59%** at 800 and **+2.16%** at 1000.
  "+1.25% at 300–400" is where the curve is lowest, not a scaling law.

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
- **The certificate is still the binding constraint.** The 1-tree bound converges by ~600 subgradient
  iterations at every size tested (n=1000: 2.176% at 400 iterations, 2.164% at 600, 2.163% at 6000).
  So the residual is real duality gap or real tour excess, not a lazy bound — and it costs 2.6 s
  against 72 minutes for the tour.

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
  every size tested.

What does not survive is the certificate's *tightness*: on a collinear instance at n = 400 the tour is
provably optimal while the 1-tree bound sits **69% below it** (28–37% at n = 100). A gap to that bound
is an upper bound on the true gap, and how tight it is depends on the geometry, not only the tour.

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

### Honest fine print

Every number here comes from a run you can reproduce — nothing is a marketing estimate. BGMA is a
heuristic. "Optimal" above means *matched on every instance we could verify*, not a proof that it
always is, and no polynomial-time algorithm is known to guarantee TSP optima. The exact check covers
n ≤ 22 (26 instances); beyond that the evidence is the lower bound, and the bound is only as tight as
the geometry allows: on a collinear instance at n=400 it sits 69% below a provably optimal tour. So
the +2.16% at n=1000 is an **upper** bound on the true gap, not a measured excess over the optimum.

The 1-tree is a *relaxation*, not a tour: a spanning tree plus the two cheapest edges at one root,
with the degree-2 constraint dropped. That is why its length is shorter than every tour — any tour
contains such a 1-tree, so `1-tree ≤ tour` is a theorem, not an estimate. It is deterministic given
the iteration budget (600 subgradient steps here; 6000 moves the n=1000 bound by 0.002 pp), and it is
checked against exact optima at n ≤ 22: the bound never exceeded the optimum in 18/18 runs.
Details and caveats: [docs/gerdal.md](docs/gerdal.md).

---

Experiments around a quantum-inspired TSP demo: a fast beam + tunnelling solver, a readable
reference implementation, a nature-model rewrite (weighted population, soft selection,
annealing with kicks, recombination), and two tuned solvers with `--effort` dials — BGMA and
the nature solver — plus benchmarks against TSPLIB instances and a CSV dataset.

Read **[docs/TSP_NOTES.md](docs/TSP_NOTES.md)** first — it holds the findings, measured numbers,
known pitfalls, and every command. Knob-tuning observations and future ideas are in
**[docs/TUNING_NOTES.md](docs/TUNING_NOTES.md)**.

## Layout

```
index.html, app.js      original polynomial-TSP canvas demo (untouched)
src/
  beam/                 beam + tunnel solvers          (beam_fast, beam_simple)
  nature/               population / annealing solver  (nature_tsp, nature_core, nature_effort)
  hybrid/               BGMA: solver, effort ladder, CLI, demo core
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
node experiments/beam-screen-only/bench.js               # ablation: beam + fast screen only vs BGMA
node experiments/beam-screen-only/tune.js --ns=100,200,300 --seeds=2  # learn the two-step knobs
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

## Runtime

The numbers behind the headline. Median wall time per instance, 4 instances per cell (2 seeds × uniform/cluster), Apple M3 Pro, Node v22.23.2.
Only the solve is timed (distance-matrix setup excluded). The last column is the empirical
exponent in time ∝ n^k between n=20 and n=400.

| method | n=20 | n=50 | n=100 | n=200 | n=400 | scaling ~ n^k |
|---|---:|---:|---:|---:|---:|---:|
| greedy nearest-neighbour | 3 µs | 6 µs | 12 µs | 24 µs | 52 µs | 0.94 |
| beam only (K=n/3) | 194 µs | 517 µs | 2.1 ms | 9.5 ms | 43 ms | 1.81 |
| beam + tunnel (tuned) | 1.7 ms | 9.2 ms | 66 ms | 664 ms | 6.41 s | 2.75 |
| nature (population + anneal) | 11 ms | 68 ms | 87 ms | 179 ms | 561 ms | 1.32 |
| Christofides (1.5-approx) | 195 µs | 628 µs | 1.1 ms | 11 ms | 30 ms | 1.68 |
| BGMA low | 1.4 ms | 4.9 ms | 16 ms | 115 ms | 732 ms | 2.10 |
| BGMA mid | 5.1 ms | 17 ms | 51 ms | 281 ms | 2.46 s | 2.06 |
| BGMA high | 10 ms | 36 ms | 113 ms | 776 ms | 8.38 s | 2.24 |
| BGMA xhigh | 18 ms | 64 ms | 276 ms | 2.21 s | 19.5 s | 2.33 |
| BGMA max | 71 ms | 232 ms | 864 ms | 6.79 s | 64.1 s | 2.27 |
| 1-tree lower bound | 98 µs | 3.5 ms | 14 ms | 64 ms | 267 ms | 2.64 |
| Held-Karp exact | 302 ms | — | — | — | — | — |

Mean excess over the best tour any method found on the same instance:

| method | n=20 | n=50 | n=100 | n=200 | n=400 |
|---|---:|---:|---:|---:|---:|
| greedy nearest-neighbour | +14.03% | +27.72% | +31.90% | +31.04% | +26.46% |
| beam only (K=n/3) | +14.94% | +32.13% | +32.43% | +37.63% | +38.88% |
| beam + tunnel (tuned) | +0.00% | +0.04% | +0.69% | +1.53% | +2.22% |
| nature (population + anneal) | +0.00% | +0.07% | +0.69% | +3.39% | +35.39% |
| Christofides (1.5-approx) | +10.50% | +10.07% | +13.07% | +13.48% | +13.02% |
| BGMA low | +0.00% | +0.12% | +0.52% | +1.69% | +2.21% |
| BGMA mid | +0.00% | +0.00% | +0.03% | +0.69% | +1.13% |
| BGMA high | +0.00% | +0.00% | +0.02% | +0.31% | +0.59% |
| BGMA xhigh | +0.00% | +0.00% | +0.00% | +0.02% | +0.12% |
| BGMA max | +0.00% | +0.00% | +0.00% | +0.00% | +0.00% |

What it shows:

- Each BGMA effort level costs about **3×** the previous one and roughly **halves** the gap
  (n=400: +2.21% → +1.13% → +0.59% → +0.12% → 0.00%, in 0.73 s → 2.5 s → 8.4 s → 19.5 s → 64 s).
  That holds up to 400; at n=1000 the last step buys nothing (see the stress section above).
- `low` matches the tuned beam + tunnel at n=400 (+2.21% vs +2.22%) in **0.73 s instead of 6.4 s**;
  at n=100 `mid` is both faster and better (51 ms, +0.03% vs 66 ms, +0.69%).
- BGMA grows like n^2.0–2.3 up to n=400 and like n^3.7–4.6 beyond it, the tuned beam + tunnel like
  n^2.7 (it polishes every beam final).
- Greedy and beam-only cost microseconds to milliseconds but stay 26–39% above the best tour.
- Nature looks cheap at n=400 (0.56 s) only because its annealing budget is capped; it is +35% there.
- **Christofides** is the only method here with a proof: its tour is at most 1.5× optimal on any metric instance.
  In practice it lands 10–13% above the best tour at every n, and it runs in 30 ms at n=400.
  On the n ≤ 20 instances checked against Held–Karp it averaged 1.07× optimal, worst 1.18×, never above 1.5×.
  From n=50 up, BGMA `low` has a 6 to 80 times smaller excess, at 8 to 24 times the runtime.
- The 1-tree bound costs about 35–55% of a `low` run at n=200–400; Held–Karp needs 0.30 s at n=20 and
  doubles per city. At n=1000 the bound takes 2.6 s against 24 s for `low` and 72 minutes for `max`.

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

No dependencies. Node only; the visual page is static HTML plus the `docs/js/` mirror of
`src/hybrid/hybrid_vis.js` (regenerate with `node bench/sync_docs.js`).
