# tsp-lab

**A polynomial-time TSP solver that matches the exact optimum up to n = 22 and beats Christofides'
1.5-approximation by a wide margin beyond it.**

Beam-Guided Memetic Annealing (BGMA) found the **true optimum on every instance we could check against
Held–Karp**, in milliseconds. Held–Karp, the classic exact method, doubles its cost with every city, and
past n ≈ 22 its table no longer fits in memory on an ordinary machine. Christofides' algorithm is the
classic polynomial method with a proof (at most 1.5× optimal), but in practice it sits 10–13% above the
best tour, while BGMA's `low` level is within 0.1–2.2% of it from n = 50 to 400.

| | Held–Karp (exact) | BGMA |
|---|---|---|
| time at n=20 | 302 ms | **1.4 ms** (`low`) · 71 ms (`max`) |
| time at n=22 | 1.3–1.6 s, 378 MiB | **2–60 ms** |
| growth | doubles with every extra city | **≈ n²** (measured n^2.0–2.3) |
| n=30 | ≈ 100 GiB of table | ≈ 13 ms (`low`) |
| n=400 | impossible | 0.7 s (`low`) · 64 s (`max`) |
| tour excess vs best, n=400 | 0 (exact, n ≤ 22 only) | `low` +2.21% · `max` 0.00% (Christofides: +13.02%) |
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
- At n = 300–400 the best tours stay within **+1.13%** of the bound, and `low` finishes
  n=400 in under a second.

### Honest fine print

BGMA is a heuristic. "Optimal" above means *matched on every instance we could verify*, not a
proof that it always is, and no polynomial-time algorithm is known to guarantee TSP optima.
The exact check covers n ≤ 22 (26 instances); beyond that the evidence is the lower bound.
Details and caveats: [docs/gerdal.md](docs/gerdal.md).

---

Experiments around a quantum-inspired TSP demo: a fast beam + tunnelling solver, a readable
reference implementation, a nature-model rewrite (weighted population, soft selection,
annealing with kicks, recombination), a tuned hybrid with an `--effort` dial, and benchmarks
against TSPLIB instances and a CSV dataset.

Read **[docs/TSP_NOTES.md](docs/TSP_NOTES.md)** first — it holds the findings, measured numbers,
known pitfalls, and every command. Knob-tuning observations and future ideas are in
**[docs/TUNING_NOTES.md](docs/TUNING_NOTES.md)**.

## Layout

```
index.html, app.js      original polynomial-TSP canvas demo (untouched)
src/
  beam/                 beam + tunnel solvers          (beam_fast, beam_simple)
  nature/               population / annealing solver  (nature_tsp)
  hybrid/               BGMA: solver, effort ladder, CLI, demo core
bench/                  TSPLIB, dataset and comparison benchmarks
tuning/                 knob / effort sweeps and Held-Karp validation
web/                    visual pages (open from a static server or file://)
docs/                   notes: findings, tuning, algorithm write-up
```

Every script resolves its siblings from its own location, so commands work from any directory.

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
node bench/runtime_bench.js                          # runtime + quality of every algorithm
node bench/bench_dataset.js --per-n=3                   # CSV dataset
node bench/knob_bench.js --ns=50,100,200 --seeds=2      # greedy vs nature vs knob presets
node src/hybrid/hybrid_tsp.js --ns=100,200,300 --seeds=2     # beam + ERX + nature anneal hybrid
node src/hybrid/hybrid_effort.js --n=200 --effort=mid        # tuned BGMA, 5 effort levels
node src/hybrid/hybrid_effort.js --n=200 --effort=max --bound=1
node src/hybrid/hybrid_effort.js --ns=50,100,200 --efforts=low,mid,high,xhigh,max --seeds=2
node tuning/tune_effort.js --ns=40,80,150 --seeds=2      # learn the effort knobs
node tuning/validate_effort.js --ns=18,20,22 --seeds=5   # exact Held-Karp check
node tuning/validate_christofides.js                     # matching vs brute force, Christofides <= 1.5x
open web/nature_tsp.html                              # visual page (nature solver)
open web/hybrid_tsp.html                              # step-by-step hybrid, effort dial + Held–Karp
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
- `low` matches the tuned beam + tunnel at n=400 (+2.21% vs +2.22%) in **0.73 s instead of 6.4 s**;
  at n=100 `mid` is both faster and better (51 ms, +0.03% vs 66 ms, +0.69%).
- BGMA grows like n^2.0–2.3, the tuned beam + tunnel like n^2.7 (it polishes every beam final).
- Greedy and beam-only cost microseconds to milliseconds but stay 26–39% above the best tour.
- Nature looks cheap at n=400 (0.56 s) only because its annealing budget is capped; it is +35% there.
- **Christofides** is the only method here with a proof: its tour is at most 1.5× optimal on any metric instance.
  In practice it lands 10–13% above the best tour at every n, and it runs in 30 ms at n=400.
  On the n ≤ 20 instances checked against Held–Karp it averaged 1.07× optimal, worst 1.18×, never above 1.5×.
  From n=50 up, BGMA `low` has a 6 to 80 times smaller excess, at 8 to 24 times the runtime.
- The 1-tree bound costs about 35–55% of a `low` run; Held–Karp needs 0.30 s at n=20 and doubles per city.

Reproduce (about ten minutes): `node bench/runtime_bench.js --json=docs/runtime.json --web=web/runtime_data.js`.
The same data drives the runtime table in both pages under `web/`; the pages also show the live
runtime of each panel. Analysis and caveats: [docs/gerdal.md](docs/gerdal.md) (section "Measured runtime").

## Files

| file | role |
|---|---|
| `src/beam/beam_fast.js` | optimised beam + tunnel (arena, bitsets, DLB 2-opt, Or-opt) |
| `src/beam/beam_simple.js` | same solver written for reading |
| `src/nature/nature_tsp.js` | population + annealing + recombination solver |
| `web/nature_tsp.html` | visual page with optimum / bound panel |
| `bench/merge_bench.js` | "mix the wave, then contract" comparison |
| `bench/bench_dataset.js` | dataset bench (greedy / beam+tunnel / nature) |
| `bench/runtime_bench.js` | wall-clock runtime and quality of every algorithm; writes `docs/runtime.json` and `web/runtime_data.js` |
| `web/runtime_table.js` | renders the measured-runtime table inside both pages |
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
| `web/hybrid_tsp.html` | Animated step-by-step hybrid demo with Held–Karp / 1-tree comparison (n ≤ 30) |
| `src/hybrid/hybrid_vis.js` | Browser/Node core behind the demo: `makeInstance`, `buildSnapshots`, `effortOptions`, `heldKarp`, `hkBound` |
| `docs/gerdal.md` | Archival algorithm note for BGMA: design, pseudocode, effort ladder, validation |
| `docs/TUNING_NOTES.md` | observations from the tuning sweeps and future-work hypotheses |
| `bench/fri26_bench.js`, `bench/dantzig42_bench.js`, `bench/att48_bench.js` | TSPLIB runs |
| `bench/n22_bench.js` | n=22 greedy vs beam+tunnel vs exact (never executed) |

No dependencies. Node only; the visual page is static HTML plus `src/hybrid/hybrid_vis.js`.
