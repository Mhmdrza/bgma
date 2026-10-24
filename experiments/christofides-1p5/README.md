# Shapes that push Christofides into its 1.5× band

**Question.** Christofides is proven `CT ≤ 1.5·OPT` on any metric instance, but on ordinary
inputs it lands at 1.10–1.13×. Which instance shape actually drives it to the top of the band,
and how does BGMA `mid` compare there from n=10 to n=200?

**Answer.** A **diameter-2 two-cluster metric**: `n/2` cities on each side, distance `1` across
the cut, `2` inside a side. `CT/OPT` runs `1.40 → 1.4947` from n=10 to n=190 and converges to
`1.5` as `1.5 − 2/n`, invariant under relabelling. BGMA `mid` returns the optimum (`1.0000`)
at every n.

Everything below is measured by `bench.js`; the optimum is `n` by construction, not by solver.

## Why this shape reaches 1.5

`CT ≤ W + M` (`W` = MST weight, `M` = min matching on odd-degree vertices), and the band is
only reachable when **both** halves of the proof are tight: `W ≈ OPT` and `M ≈ OPT/2`. The
two-cluster metric pins both, and the Euler shortcut has nothing to recover:

| | `K_{⌊n/2⌋,⌈n/2⌉}`, unit edges |
|---|---|
| OPT | `n`. Every distance is ≥ 1 ⇒ `OPT ≥ n`; alternating across the cut gives `n` unit edges ⇒ `OPT ≤ n`. |
| MST | `n − 1`. Prim builds the double star — `v`, all of `v`'s opposite side, then that first opposite vertex wires up the rest of `v`'s side. All edges unit, so `W/OPT → 1`. |
| odd vertices | `n − 2`. Two hubs have degree `n/2`, every other city has degree 1. Nearly the whole instance is odd, so the matching is nearly a perfect matching. |
| matching | `(n−2)/2`. Odd cities pair across the cut at distance 1 ⇒ `M/OPT → 1/2`. |
| shortcut | saves **0**: measured `CT = W + M` exactly (`1.5n − 2`). Every already-visited vertex is re-entered at the price the walk paid. |

Small parity wrinkle: `n/2` even gives `CT = 1.5n − 2`, `n/2` odd gives `1.5n − 1` (the two
hubs become odd too, so `M = n/2`). Hence the wobble around the smooth `1.5 − 2/n` curve.

## Why the usual suspects do *not* reach it

- **`2 × k` Euclidean strip** (`ladder` below — the family in
  [`experiments/worst_case_benchmark.js`](../worst_case_benchmark.js)): row-major labelling
  gives `1.4900` at n=200, but that number is a tie-break artifact. Its MST lives inside a huge
  set of unit-weight ties (row edges vs rungs); row-major order makes Prim build *one row + all
  rungs*, leaving a whole row of leaves ⇒ `odd = n − 2` and the same `1.5n − 2`. Any other
  labelling walks the strip as a path ⇒ 2 odd vertices ⇒ ratio `1.05–1.28`. Mean over 6
  relabellings: **1.2378**, max 1.4900. The band needs the metric to *force* the branchy tree,
  not merely allow it — which is what `within side = 2` does in the two-cluster metric.
- **Wheel `W_n`**: identical diameter, `OPT = n`, same all-odd double-star MST, same `M = n/2`
  — and `CT = n`, ratio **1.0**. The rim edges are unit, so the DFS order `hub, v1, v2, …` is
  itself a length-`n` tour and the shortcut eats the whole `0.5n`. 1.5 needs the odd cities'
  cheap partners to be *far apart* in the Euler order.
- **Convex position / points on a circle**: MST is a path ⇒ 2 odd vertices ⇒ `M = O(1)`. **1.0**.
- **Random dense unit graphs**: 1.30–1.42 at n ≤ 16 and *falling* as n grows.

Recipe, in one line: `OPT` at its floor of one unit per city, an MST that is a unit tree with
almost every vertex odd, and a metric whose cheap pairs are not adjacent in the Euler walk.

Caveat: this is a **graph metric, not Euclidean** — `cross = 1`, `within = 2` cannot be
realised by points in Euclidean space. That is why TSPLIB-style instances never show the band.
`buildFromRows()` in [`src/hybrid/instance.js`](../../src/hybrid/instance.js) exists so the
harness can hand the solvers a raw metric matrix.

## Measured

`node experiments/christofides-1p5/bench.js --max=200 --step=10 --perms=6`
(Apple M3 Pro, Node v22.23.2; 6 relabellings per cell, identical results for the two-cluster
metric). OPT = n is cross-checked against Held–Karp at every n ≤ 18.

| family | n=10 | 20 | 50 | 100 | 150 | 190 | 200 |
|---|---:|---:|---:|---:|---:|---:|---:|
| two-cluster, CT/OPT | 1.4000 | 1.4000 | 1.4800 | 1.4800 | 1.4933 | **1.4947** | 1.4900 |
| ladder, CT/OPT mean (max over labellings) | 1.1631 (1.3414) | 1.1909 (1.4000) | 1.2249 (1.4683) | 1.2198 (1.4800) | 1.2379 (1.4894) | 1.2394 (1.4917) | 1.2378 (1.4900) |
| BGMA `mid`/OPT (both families) | 1.0000 | 1.0000 | 1.0000 | 1.0000 | 1.0000 | 1.0000 | 1.0000 |

Christofides costs 0.1–3.6 ms here and BGMA `mid` 4.7–282 ms, for a gap of ~49% vs 0%.
Full table with `MST/OPT`, odd count, `M/OPT` and times: [`results.txt`](results.txt),
[`bench_results.csv`](bench_results.csv).

## Files

```
bench.js             two-cluster + ladder generators, Christofides, BGMA mid, OPT = n check,
                     --perms relabelling spread
bench_results.csv    one row per (family, n)
results.txt          the printed table
```

Change outside this folder: `buildFromRows(rows)` was added to `src/hybrid/instance.js`
(`buildFromPoints` now builds its matrix and calls it). Nothing else in `src/` changed.
