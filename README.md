# tsp-lab

Experiments around a quantum-inspired TSP demo: a fast beam + tunnelling solver, a readable
reference implementation, a nature-model rewrite (weighted population, soft selection,
annealing with kicks, recombination), a tuned hybrid with an `--effort` dial, and benchmarks
against TSPLIB instances and a CSV dataset.

Read **[TSP_NOTES.md](TSP_NOTES.md)** first — it holds the findings, measured numbers,
known pitfalls, and every command. Knob-tuning observations and future ideas are in
**[TUNING_NOTES.md](TUNING_NOTES.md)**.

## Quick start

```bash
node fri26_bench.js                              # TSPLIB, optimum known
node dantzig42_bench.js
node att48_bench.js
node beam_fast.js --n=200 --seeds=6              # synthetic instances
node beam_fast.js --n=200 --preset=tuned         # best all-n rule (n=40..400)
node beam_fast.js --n=40 --seeds=2 --score=all   # score unvisited cities (MST bound)
node beam_fast.js --n=200 --K=n/2 --near=n/10    # n-based knob values
# every beam/tunnel knob is documented in beam_fast.js's header
node nature_tsp.js --n=200 --seeds=4
node bench_dataset.js --per-n=3                   # CSV dataset
node knob_bench.js --ns=50,100,200 --seeds=2      # greedy vs nature vs knob presets
node hybrid_tsp.js --ns=100,200,300 --seeds=2     # beam + ERX + nature anneal hybrid
node hybrid_effort.js --n=200 --effort=mid        # tuned BGMA, 5 effort levels
node hybrid_effort.js --n=200 --effort=max --bound=1
node hybrid_effort.js --ns=50,100,200 --efforts=low,mid,high,xhigh,max --seeds=2
node tune_effort.js --ns=40,80,150 --seeds=2      # learn the effort knobs
node validate_effort.js --ns=18,20,22 --seeds=5   # exact Held-Karp check
open nature_tsp.html                              # visual page (nature solver)
open hybrid_tsp.html                              # step-by-step hybrid, effort dial + Held–Karp
```

## Files

| file | role |
|---|---|
| `beam_fast.js` | optimised beam + tunnel (arena, bitsets, DLB 2-opt, Or-opt) |
| `beam_simple.js` | same solver written for reading |
| `nature_tsp.js` | population + annealing + recombination solver |
| `nature_tsp.html` | visual page with optimum / bound panel |
| `merge_bench.js` | "mix the wave, then contract" comparison |
| `bench_dataset.js` | dataset bench (greedy / beam+tunnel / nature) |
| `knob_bench.js` | greedy vs nature vs beam+tunnel under n-based knob presets |
| `tune_knobs.js` | knob sweep against greedy/nature/random-start heuristics; finds `--preset=tuned` |
| `hybrid_tsp.js` | Beam-Guided Memetic Annealing: beam islands + ERX + nature anneal + selective base polish |
| `bgma.js` | Parameterised BGMA core (`hybrid`, `effortPreset`, `runEffort`) shared by the effort CLI |
| `effort_profiles.js` | Shared `low|mid|high|xhigh|max` budgets for the CLI and the visualizer |
| `hybrid_effort.js` | Tuned BGMA CLI with `--effort=low|mid|high|xhigh|max`, `--bound`, `--tour`, `--json` |
| `tune_effort.js` | Sweep harness for the effort knobs (quality vs 1-tree bound vs runtime) |
| `validate_effort.js` | Checks every effort level against Held–Karp (n ≤ 22) |
| `hybrid_tsp.html` | Animated step-by-step hybrid demo with Held–Karp / 1-tree comparison (n ≤ 30) |
| `hybrid_vis.js` | Browser/Node core behind the demo: `makeInstance`, `buildSnapshots`, `effortOptions`, `heldKarp`, `hkBound` |
| `TUNING_NOTES.md` | observations from the tuning sweeps and future-work hypotheses |
| `fri26_bench.js`, `dantzig42_bench.js`, `att48_bench.js` | TSPLIB runs |
| `n22_bench.js` | n=22 greedy vs beam+tunnel vs exact (never executed) |

No dependencies. Node only; the visual page is static HTML plus `hybrid_vis.js`.
