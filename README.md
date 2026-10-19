# tsp-lab

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
node bench/bench_dataset.js --per-n=3                   # CSV dataset
node bench/knob_bench.js --ns=50,100,200 --seeds=2      # greedy vs nature vs knob presets
node src/hybrid/hybrid_tsp.js --ns=100,200,300 --seeds=2     # beam + ERX + nature anneal hybrid
node src/hybrid/hybrid_effort.js --n=200 --effort=mid        # tuned BGMA, 5 effort levels
node src/hybrid/hybrid_effort.js --n=200 --effort=max --bound=1
node src/hybrid/hybrid_effort.js --ns=50,100,200 --efforts=low,mid,high,xhigh,max --seeds=2
node tuning/tune_effort.js --ns=40,80,150 --seeds=2      # learn the effort knobs
node tuning/validate_effort.js --ns=18,20,22 --seeds=5   # exact Held-Karp check
open web/nature_tsp.html                              # visual page (nature solver)
open web/hybrid_tsp.html                              # step-by-step hybrid, effort dial + Held–Karp
```

## Files

| file | role |
|---|---|
| `src/beam/beam_fast.js` | optimised beam + tunnel (arena, bitsets, DLB 2-opt, Or-opt) |
| `src/beam/beam_simple.js` | same solver written for reading |
| `src/nature/nature_tsp.js` | population + annealing + recombination solver |
| `web/nature_tsp.html` | visual page with optimum / bound panel |
| `bench/merge_bench.js` | "mix the wave, then contract" comparison |
| `bench/bench_dataset.js` | dataset bench (greedy / beam+tunnel / nature) |
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
| `docs/gerdal.md` | Archival Org-mode note for BGMA: design, pseudocode, effort ladder, validation |
| `docs/TUNING_NOTES.md` | observations from the tuning sweeps and future-work hypotheses |
| `bench/fri26_bench.js`, `bench/dantzig42_bench.js`, `bench/att48_bench.js` | TSPLIB runs |
| `bench/n22_bench.js` | n=22 greedy vs beam+tunnel vs exact (never executed) |

No dependencies. Node only; the visual page is static HTML plus `src/hybrid/hybrid_vis.js`.
