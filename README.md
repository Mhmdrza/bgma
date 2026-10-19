# tsp-lab

Experiments around a quantum-inspired TSP demo: a fast beam + tunnelling solver, a readable
reference implementation, a nature-model rewrite (weighted population, soft selection,
annealing with kicks, recombination), and benchmarks against TSPLIB instances and a CSV
dataset.

Read **[TSP_NOTES.md](TSP_NOTES.md)** first — it holds the findings, measured numbers,
known pitfalls, and every command.

## Quick start

```bash
node fri26_bench.js                              # TSPLIB, optimum known
node dantzig42_bench.js
node att48_bench.js
node beam_fast.js --n=200 --seeds=6              # synthetic instances
node nature_tsp.js --n=200 --seeds=4
node bench_dataset.js --per-n=3                   # CSV dataset
open nature_tsp.html                              # visual page
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
| `fri26_bench.js`, `dantzig42_bench.js`, `att48_bench.js` | TSPLIB runs |
| `n22_bench.js` | n=22 greedy vs beam+tunnel vs exact (never executed) |

No dependencies. Node only; the visual page is a single self-contained HTML file.
