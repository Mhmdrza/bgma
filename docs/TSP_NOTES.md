# TSP notes — quantum-inspired demo, fast solvers, nature model, benchmarks

Last updated: 2026-10-19
Working dir: `/Users/mohammadreza/Documents/Default Project`

This file is the context hand-off for future sessions. It records what exists, what was
measured, what was disproved, and what is still open.

---

## TL;DR

- The original artifact is a **beam search with deduplication plus 2-opt/Or-opt**, dressed in
  quantum vocabulary. There is no quantum mechanics in it.
- The **beam's score ignores unvisited cities**; an MST-based score fixes that at n ≤ 15
  (optimum hit rate goes from 1–2/20 to 11–12/20) but is absorbed by tunnelling at n ≥ 100.
- At n ≥ 100 **diversity beats the beam**: 16 random starts + tunnel beat beam + tunnel by
  1.2–2.4%.
- A fast rewrite (`src/beam/beam_fast.js`) is **10× faster at n=200 / 41× at n=400** with the beam
  producing bit-identical tours; the tunnel trades 0.9–3.7pp of quality for 12–57× speed.
- A "nature model" rewrite (weighted population + soft selection + annealing + recombination)
  is the best-quality solver in the set, but ~10–50× slower than beam+tunnel.
- On classic TSPLIB instances (`fri26`, `dantzig42`, `att48`) **beam + tunnel is optimal,
  deterministic, and 5–20× faster** than the nature solver.
- The 216 MB CSV dataset (`~/Downloads/tsp_dataset.csv`) has **no optimal tours**; its
  `total_distance` is a stored-route cost. Benchmark against it only as a baseline.

---

## 1. The original artifact

`/Users/mohammadreza/Downloads/Voting Greedy TSP (1).html` — a self-contained demo.

Pipeline (n = 5…15 only):

1. **Geometry** — random or 3-cluster points; distance matrix; per-city sorted neighbour list;
   two poles = farthest pair.
2. **Voting greedy** — the last three cities each nominate their 1st/2nd/3rd nearest
   unvisited; two agreeing votes win; otherwise fall back to nearest-to-current.
3. **Superposition (beam)** — K ∈ {1,4,16,64} partial tours grown from both poles. Each step
   each tour branches to ≤4 cities (nearest of the last 3 at ranks 1–3, plus 2nd nearest of
   the current). Dedupe on `(visited set, last city, start)` = "interference". Keep the K
   lowest `f = len + d(last, home)` = "measurement".
4. **Tunnelling** — 2-opt + Or-opt (segments 1–3), first improvement, full restart after each
   move, on the best ≤16 finals.
5. **Held–Karp** — exact optimum for the comparison panel.

Known limitations found:

- beam width is a hard top-K cut, not real amplitude;
- `refine()` only accepts improving moves, so "tunnelling" never crosses a barrier;
- the score `len + d(last, home)` is blind to unvisited cities (now selectable:
  `--score=all` uses `len + MST(unvisited ∪ {last, start})`).

---

## 2. Files in this directory

| file | what it is |
|---|---|
| `src/beam/beam_fast.js` | Optimised beam + tunnel (arena, parent pointers, bitsets, Zobrist dedupe, DLB 2-opt, Or-opt). Includes its own bench. Baseline implementations included for comparison. |
| `src/beam/beam_simple.js` | Same solver written only to be read (~55 lines of algorithm). Strings/arrays/boolean sets, no bitsets. |
| `src/nature/nature_tsp.js` | Nature-model solver: weighted population, soft selection, simulated annealing with avulsion kicks, ordered-crossover recombination. Includes a bench. |
| `docs/nature_tsp.html` | Visual page for the nature solver: population drawn faint, best tour bold, second panel shows the exact optimum (n ≤ 22) or a proven bound (23–30). |
| `bench/merge_bench.js` | "Mix the wave, then contract": edge-vote assembly vs picking the best tour. |
| `bench/bench_dataset.js` | CSV dataset bench: greedy vs beam+tunnel vs nature, with 1-tree bound and optional Held–Karp check. |
| `bench/knob_bench.js` | Synthetic bench: greedy vs nature vs beam+tunnel across n-based knob presets; CSV output. |
| `tuning/tune_knobs.js` | Knob sweeps against greedy/nature/random-start/merge heuristics; source of `--preset=tuned`. |
| `src/hybrid/hybrid_tsp.js` | Beam-Guided Memetic Annealing: beam islands + ERX + nature anneal/kicks + elite base polish, with its own bench. |
| `src/hybrid/bgma.js` | Parameterised BGMA core: `hybrid(inst, seed, opts)`, `effortPreset(level, n)`, `runEffort(inst, seed, level)`. |
| `src/hybrid/effort_profiles.js` | Shared effort ladder (`low|mid|high|xhigh|max`) for the CLI and the browser demo. |
| `docs/gerdal.md` | Archival algorithm note: design, pseudocode, effort ladder, validation, limitations. |
| `src/hybrid/hybrid_effort.js` | Tuned BGMA CLI: `--effort=low|mid|high|xhigh|max`, optional 1-tree bound, tour/JSON output. |
| `tuning/tune_effort.js` | Effort/knob sweep: gap vs best-of-all, gap vs 1-tree bound, median time. |
| `tuning/validate_effort.js` | Held–Karp check of every effort level at n ≤ 22. |
| `docs/hybrid_tsp.html` | Animated hybrid demo: beam depth, island screening, ERX, kicks/anneal, selective polish; Held–Karp optimum for n≤20 and 1-tree bound for n=21..30. |
| `src/hybrid/hybrid_vis.js` | Isolated demo logic for `docs/hybrid_tsp.html`: `makeInstance`, `buildSnapshots`, `effortOptions`, `heldKarp`, `hkBound` (browser global + CommonJS). |
| `bench/runtime_bench.js` | Wall-clock runtime and quality of every algorithm (greedy, beam, tuned beam+tunnel, nature, BGMA levels, 1-tree, Held–Karp) at n=20..400; writes `docs/runtime.json` and `docs/runtime_data.js`. Results: `docs/gerdal.md`, "Measured runtime". |
| `docs/runtime_table.js` | Renders the measured-runtime table in both pages. |
| `bench/att48_bench.js` | TSPLIB att48 (ATT distances). |
| `bench/dantzig42_bench.js` | TSPLIB dantzig42 (explicit lower-diagonal matrix). |
| `bench/fri26_bench.js` | TSPLIB fri26 (explicit lower-diagonal matrix). |
| `bench/n22_bench.js` | greedy vs beam+tunnel vs Held–Karp at n=22. Written but **never executed** (user asked not to run it). |

All later benches load the solver code out of the page/file (string slice + `eval`) so they
measure the exact same implementation, not a copy.

---

## 3. Measurements that shaped the design

### 3.1 Where the time goes (original algorithm, n=200, K=16)

| component | time | share |
|---|---|---|
| beam | 12.4 ms | 11% |
| tunnel (6–9 finals) | 102.6 ms | 89% |

Tunnel complexity: **moves × n²**, and moves grow with n → measured **n^2.84** (n=50…400).
Beam alone: ~n^1.6.

### 3.2 Fast rewrite (`src/beam/beam_fast.js`)

Paired runs (same instances, baseline → fast):

| n | baseline total | fast total | speedup | quality cost |
|---|---|---|---|---|
| 200 | 115.0 ms (beam 12.4 + tunnel 102.6) | 11.3 ms (2.8 + 8.5) | **10.2×** | +1.56 pp (worst +3.94) |
| 400 | 780.9 ms (38.2 + 742.7) | 18.9 ms (6.0 + 13.0) | **41.2×** | +3.66 pp (worst +6.05) |

Fast-path-only scaling (no baseline, K=16), for complexity fitting:

| n | beam | tunnel | total |
|---|---|---|---|
| 100 | 1.39 | 3.93 | 5.32 ms |
| 200 | 3.01 | 8.14 | 11.16 ms |
| 400 | 6.18 | 13.02 | 19.20 ms |

`--parity=1` (adds full O(n²) sweeps): 6.9× at n=200 / 15.8× at n=400, quality within
+0.91 / +1.69 pp.

The fast **beam alone** is bit-identical to the baseline on all 32 test instances
(n=30…200, 4 seeds, uniform + cluster) — verified by direct comparison.

Fast complexity: beam O(M·n²) (M = population); tunnel O(A·n + n·k) where A = accepted moves;
measured slopes over n=100…800: beam 1.11, tunnel 0.65, total 0.82 (constants dominate at
these sizes).

### 3.3 The readable version (`src/beam/beam_simple.js`)

| n | total | vs fast | quality |
|---|---|---|---|
| 100 | 16.8 ms | 3.2× slower | ≈ equal |
| 200 | 84.1 ms | 7.4× slower | 1.3% worse |
| 400 | 515.9 ms | 27× slower | ~2–3% worse |

### 3.4 Scoring against unvisited cities

Replacing `f = len + d(home)` with `f = len + MST(unvisited ∪ {last, start})`:

| n | old score | MST score |
|---|---|---|
| 12 | +7.40%, optimal 2/20 | **+0.83%, optimal 12/20** |
| 15 | +9.34%, optimal 1/20 | **+1.60%, optimal 11/20** |
| 200 | beam 1337.5 → 1009.0 after tunnel | beam **1006.9** → **985.9** after tunnel |

A cheap adaptive bound (2 nearest unvisited neighbours) improves the beam by 8–18% but buys
nothing after tunnelling. The true MST bound is the only one that helps end-to-end.

### 3.5 Diversity beats the beam at scale

| n | beam + tunnel | 16 random starts + tunnel | relative |
|---|---|---|---|
| 100 | 713.1 | **694.5** | −1.17% median |
| 200 | 1009.0 | **991.9** | −1.85% median |
| 400 | — (not paired in that run) | — | −2.36% median |

### 3.6 Mixing the wave and contracting (`bench/merge_bench.js`, n=200)

| pipeline | median | vs best | time |
|---|---|---|---|
| beam + tunnel | 1009.0 | +2.02% | 11.7 ms |
| beam, mix **raw** finals | 1010.8 | +2.20% | 4.6 ms |
| beam, mix **tunnelled** finals | 996.1 | +0.71% | 12.5 ms |
| 16 random + tunnel | 991.9 | +0.29% | 19.8 ms |
| 16 random, mix tunnelled | **989.0** | +0.00% | 20.9 ms |

Mixing raw finals is useless (+0.18%): they are too correlated, the consensus reproduces the
best parent. Mixing *local optima* helps (−1.28%). Proper AB-cycle/EAX recombination is still
unimplemented.

### 3.7 Held–Karp limits

- n=20: 0.30 s / 86 MiB; n=21: 0.60 s / 180 MiB; n=22: 1.34 s / 378 MiB; n=23: 2.9 s / 792 MiB.
- n=30 needs 2^29 states (~100 GB) — impossible. n=200 needs ~10^63 bytes.
- Practical browser cap: **22** (n=23 is 800 MB, risky).
- For 23–30 the page shows a **1-tree + subgradient lower bound** instead, and marks the tour
  "proven optimal" when it meets the bound.

### 3.8 n-based knob sweep (`bench/knob_bench.js`)

12 synthetic instances (n=50/100/200, 2 seeds × uniform/cluster), gap vs the best method on
each instance, all presets tunnel every final:

| method | median gap | median time |
|---|---|---|
| greedy | +28.08% | 13 µs |
| nature (M=48, auto iters) | **+0.50%** | 92 ms |
| beam base (K=16, near=10) | +0.97% | 3.5 ms |
| K=n/2, near=10 | +2.34% | 7.4 ms |
| K=n/2, near=n/10, score=all | +0.99% | 164 ms |
| K=n/2, near=n/10, score=all @ n=200 | **+0.43%** | 2.35 s |

At n=200 the wider beam + MST score is the only beam variant that beats nature on the median
(nature +2.24%, base beam +4.43%), but it costs ~12× nature and ~3000× greedy. At n≤100 the
plain K=16 beam is already competitive and ~25× faster than nature. Very narrow tunnel lists
(`near=n/10` at n=50 → 5) lose 1–2%, and `K=n` is not automatically better than K=16 — the
hard top-K cut plus the visited-only score is not monotone in width.

### 3.9 Tuned all-n rule (`tuning/tune_knobs.js`)

28 instances, n = 40/75/100/150/200/300/400, 2 seeds × uniform/cluster. Reference is the
best any method produced on each instance. The winning rule:

```bash
node src/beam/beam_fast.js --n=200 --preset=tuned
# equivalent explicit flags:
# --K='max(16,n/3)' --near='max(10,n/10)' --refineF=n --oroptMaxL=5
# --restarts=4 --tunnelMode=base
```

| method | median gap | mean | worst | wins | median time |
|---|---|---|---|---|---|
| **tuned beam+tunnel** | **+0.00%** | **+0.13%** | **+0.98%** | 17/28 | 318 ms |
| fast-tunnel variant (K=n/3, 8 restarts, parity) | +0.34% | +0.50% | +2.27% | 6/28 | 192 ms |
| 16 random starts + tunnel | +0.37% | +0.75% | +3.62% | 6/28 | 9.7 ms |
| 16 random starts, mix + tunnel | +0.35% | +0.64% | +3.21% | 8/28 | 10.4 ms |
| nature (M=48) | +0.66% | +7.47% | +54.71% | 6/28 | 126 ms |
| greedy, best of all starts | +15.57% | +15.19% | +22.18% | 0/28 | 0.47 ms |
| greedy | +24.40% | +26.06% | +42.53% | 0/28 | 0.01 ms |

Median gap of the tuned rule by n: **0.00 / 0.12 / 0.28 / 0.14 / 0.01 / 0.00 / 0.00 %**
(n = 40 … 400). It is the best method at every size in this set. Nature collapses beyond
n=200 in this configuration (+19.9% at n=300, +51.0% at n=400) because the iteration cap
(120k) and M=48 are too small.

Quality costs time: ~68 ms at n=200 and ~5–7 s at n=400 per instance, because the base tunnel
fully restarts after every accepted move and every final of 4 restarts is tunnelled. Drop to
`--tunnelMode=fast --restarts=8 --parity=1` (the +0.34% row) for ~3× less time. `--parity` and
`--passes` only affect `tunnelMode=fast`.

Detailed observations, things that did not help, and future hypotheses are in
**[TUNING_NOTES.md](TUNING_NOTES.md)**.

---

## 4. The nature model (`src/nature/nature_tsp.js`, `docs/nature_tsp.html`)

| quantum step | nature step | implementation |
|---|---|---|
| superposition | population of M foragers, flow-weighted | `states[]` with `w` |
| branching | short edges from the last 3 cities | same 4-branch rule |
| interference | identical configurations merge, flows add | dedupe + weight sum |
| measurement | **soft** resample ∝ flow·exp(−(f−fₘᵢₙ)/T); T = 0.25·spread | systematic resampling |
| tunnelling | **Metropolis annealing + double-bridge avulsion** (uphill allowed) | 85% informed proposals |
| — | **recombination** | ordered crossover + re-anneal |

Results:

| n | population only | + anneal | + recombination |
|---|---|---|---|
| 15 | 29.1% above opt | optimal 10/16 | **optimal 16/16** |
| 200 | +32.3% | 996.7 (+0.48% vs best known) | 996.7 |

Cost: 27 ms at n=20, 95 ms at n=50, 136 ms at n=100, 281 ms at n=200 (median).
Complexity: **O(M·n² + R·I·n)** time, **O(n² + M·n)** memory, with
`I = min(120000, 1500 + 45n²)`, `R ≤ 14`.

### 4.1 Every nature knob (`src/nature/nature_core.js`)

`nature_core.js` is the parameterised extraction of the page solver: `nature(inst, seed, opts)`
runs the pipeline, `runEffort(inst, seed, level)` applies an effort preset. Defaults reproduce
the page and the old bench bit-for-bit. The visual page (`docs/nature_tsp.html`) keeps those
page defaults; the effort dial lives in the CLI.

| knob | default | meaning |
|---|---|---|
| `M` | 48 | foragers / flow units in the population wave |
| `branchLag` | 3 | trailing cities allowed to nominate (rank = lag+1) |
| `extraRank` | 2 | extra candidate rank from the current city (0 = off) |
| `maxBranch` | 4 | children per state after candidate dedupe (0 = unlimited) |
| `selMode` | `soft` | `soft` = flow·exp(−(f−fmin)/T); `hard` = top-M cut; `flow` = flow only |
| `selT` | 0.25 | soft-selection temperature as a fraction of the colony spread |
| `poles`, `startCount`, `startSeed` | farthest, 2, 0 | starting cities (restart 0 uses the farthest pair) |
| `iters` | 0 | proposals per tour; 0 → `min(120000, 1500+45n²)` |
| `T0` | 0 | initial temperature; 0 → `0.03n` |
| `coolRate`, `Tmin` | 0.99998, 1e-7 | geometric cooling |
| `pLocal` | 0.85 | fraction of informed (candidate-list) proposals |
| `stallK` | 50 | avulsion after `stallK·n` non-improving proposals (0 = never) |
| `reheat` | 0.4 | temperature is raised to at least `reheat·T0` on avulsion |
| `nearK` | 0 | proposal candidate-list width; 0 → `min(10, n−1)` |
| `survivors` | 8 | distinct population survivors annealed |
| `children` | 8 | ordered-crossover children annealed |
| `parents` | 4 | top parents used for crossover |
| `restarts` | 1 | independent runs; best tour wins |
| `polish`, `polishTop`, `polishOrOptMaxL` | 0, 3, 3 | optional final 2-opt/Or-opt on the top tours (`0|fast|base`) |

### 4.2 What the knobs actually do

Measured on n=50/100/150, 2 seeds × uniform/cluster, gap vs best-of-all. Full detail is in
[TUNING_NOTES.md](TUNING_NOTES.md) §8.

- **The population collapses; `M` is not diversity.** At n=100 the default wave ends with
  **6 distinct tours** out of M=48; M=192 still ends with 6, M=16 with 2. `survivors` above
  the distinct-tour count (4–6) changes nothing on the median unless `selT` is raised;
  individual instances can still flip by luck of the lineage draw. `selT` sets lineage
  count: 0.05/0.1 → 1, 0.25 → 6, 0.5 → 8, 1 → 12, flow-only → 24. Too little selection
  kills quality (+2.0–2.2%).
- **Iterations are the dominant lever.** Quartering the budget costs ~9%, halving costs ~2%;
  doubling/quadrupling moves the median by <0.2%. The default `120k` cap stops scaling above
  n≈51 — the historical collapse at n=300–400. The effort ladder uses `c·n²` instead.
- **Restarts are the second lever.** 4 restarts moved the 12-instance median from +0.48% to
  +0.03%. At a fixed total proposal budget, 2–4 restarts beat one long run; 8–12 have
  diminishing returns.
- **Polish is the best quality per millisecond.** A final fast 2-opt/Or-opt on the top 3 tours
  moved the median from +0.48% to about zero for a fraction of a millisecond at n=100 (a few
  ms at n=300). It is present at every effort level.
- **Branch shape, proposal mix, and temperature are already tuned.** `branchLag=1/3/4` and
  `maxBranch=2/3/6` are within noise; `extraRank=0` costs ~0.5%. `pLocal<0.85`, `stallK<50`,
  `coolRate=0.999995`, and `T0=0.1n` are all clearly worse. `reheat` 0.2–1 stays within
  ~0.6% of the default; keep 0.4.
- **`nearK` is secondary.** 5–10 is fine; 15–20 is slower without a gain.

### 4.3 Nature effort ladder (`src/nature/nature_effort.js`)

| effort | M | iters | survivors | children | restarts | polish |
|---|---:|---|---:|---:|---:|---|
| `low` | 24 | `max(8k, 4n²)` | 3 | 2 | 1 | fast ×2 |
| `mid` | 32 | `max(10k, 7.5n²)` | 5 | 6 | 1 | fast ×2 |
| `high` | 48 | `max(12k, 6.5n²)` | 8 | 10 | 2 | fast ×3 |
| `xhigh` | 64 | `max(15k, 10n²)` | 10 | 14 | 3 | fast ×5 |
| `max` | 96 | `max(20k, 12n²)` | 12 | 16 | 4 | base ×8 (+ `xhigh` portfolio) |

All levels use `selT=0.5`; `nearK` runs from 6 at `low` up to `min(20, n/10)` at `max`. `max` runs the `xhigh` configuration
and the heavier `max` configuration independently and keeps the shorter tour, so it cannot be
worse than `xhigh` on the same instance.

16 instances (n=50/100/200/300; 2 seeds × uniform/cluster), reference = best tour of any method,
second reference = 1-tree bound (400 subgradient iterations):

| effort | med vs ref | mean vs ref | worst vs ref | med vs bound | wins | med time |
|---|---:|---:|---:|---:|---:|---:|
| `low` | +0.57% | +0.58% | +1.32% | +1.55% | 1/16 | 127 ms |
| `mid` | +0.26% | +0.38% | +1.13% | +1.49% | 4/16 | 353 ms |
| `high` | +0.17% | +0.20% | +1.14% | +1.35% | 5/16 | 1.03 s |
| `xhigh` | +0.00% | +0.11% | +0.78% | +1.08% | 11/16 | 2.80 s |
| `max` | +0.00% | +0.01% | +0.14% | +1.02% | 15/16 | 8.36 s |
| tuned beam | +0.94% | +0.76% | +1.41% | +1.89% | 3/16 | 818 ms |

Median time by n: **9 / 35 / 142 / 309 ms** for `low`, **22 / 86 / 361 / 896 ms** for `mid`,
**68 / 263 / 1.06 / 2.83 s** for `high`, **180 / 681 / 3.07 / 7.42 s** for `xhigh`, and
**499 / 2.05 / 8.79 / 22.5 s** for `max` (n=50/100/200/300). At n ≤ 22 all five levels matched
Held–Karp on **18/18 instances**.

Caveat: below n=300 the ordering is stable and well sampled; above it the ordering frays —
see §4.4.

### 4.4 Large n: n=400 and n=500

Same ladder, 2 seeds × uniform/cluster per size, gap to the 1-tree bound:

| effort | med gap n=400 | med gap n=500 | med time n=400 | n=500 |
|---|---:|---:|---:|---:|
| `low` | +4.24% | +7.86% | 0.55 s | 0.91 s |
| `mid` | +3.67% | +6.41% | 1.6 s | 3.0 s |
| `high` | +3.15% | +6.35% | 4.6 s | 8.0 s |
| `xhigh` | +5.46% | +5.70% | 13 s | 23 s |
| `max` | +3.31% | +3.90% | 40 s | 72 s |

- **`max` is the only level that holds.** Over the eight instances it was best or within
  0.11% on seven, won five outright, and never lost by more than 1.04%. Mean gap to the
  per-instance best of the five levels: `max` +0.14%, `high` +2.08%, `xhigh` +2.05%,
  `mid` +2.62%, `low` +2.86%.
- **`high` can still win.** On n=400/cluster it beat `max` by 1.04% at 4.6 s instead of 40 s.
  If a large-n run matters and 40–70 s is too much, run `high` and `max` and keep the shorter.
- **The middle levels drift.** `xhigh` lost to `high` on the median at n=400 (5.5% vs 3.2%)
  and won at n=500 (5.7% vs 6.4%): basin luck, not a trend. `low` and `mid` fall behind as n
  grows (4.2→7.9% and 3.7→6.4% vs bound) because they keep one restart and 4n²/7.5n² proposals.
- **Wider candidate lists do not help.** Raising `nearK` at n=400/500 made every level worse:
  `low` goes 5.2% (at 10) → 7.7% (16) → 10.2% (50), `mid` 4.1% → 5.1% → 9.4%. A second
  restart helps `low` by ~1% but does not close the gap; the missing ingredient is budget and
  restarts, not a longer list.
- **Against the old cap.** The fixed 120k-proposal default is +15 to +59% above the bound at
  these sizes (median +47.6%) for ~0.75 s; `low` is +4.2/+7.9% for 0.55/0.91 s.

Cluster instances sit higher than uniform for every level (at n=500 the medians are 8.5–11.8%
vs 3.8–5.7% for `low`–`high`; `max` narrows it to +4.2% vs +3.8%), partly because the 1-tree
bound is weaker on clustered geometry. Compare levels within an instance, not across families.


```bash
node src/nature/nature_effort.js --n=200 --effort=mid
node src/nature/nature_effort.js --n=200 --effort=max --bound=1 --tour=tour.txt
node src/nature/nature_effort.js --ns=50,100,200 --efforts=low,mid,high,xhigh,max --seeds=2 --kind=both --bound=1
node src/nature/nature_effort.js --ns=400,500 --seeds=2 --kind=both --efforts=low,mid,high,xhigh,max --bound=1
node tuning/tune_nature.js --ns=50,100,150 --seeds=2
node tuning/validate_nature_effort.js --ns=18,20,22 --seeds=3
```

---

## 5. Dataset bench (`~/Downloads/tsp_dataset.csv`)

Facts about the file (verified, not assumed):

- 216 MB, 2,783 rows, **n = 20…100** (81 distinct sizes), CRLF.
- Columns: `instance_id, num_cities, city_coordinates, distance_matrix, best_route, total_distance`.
- `best_route` is a **categorical label** (`Route_0`, `Route_1`, …), not a permutation.
- `total_distance` is **not an optimum**: for id 0 (n=55) it is 2,966, while the all-pairs sum
  is 82,433 and the identity-order tour is 2,893. It is the cost of a stored route that
  behaves like a random tour. Held–Karp check at n=20: reference matched exact on **0/8**.

Sample of 243 instances (3 per size), 24 s total:

| method | vs stored route | vs 1-tree bound | median time |
|---|---|---|---|
| greedy | −75.3% | +24.2% | 0.0 ms |
| beam + tunnel | −80.0% | +1.75% | 1.8 ms |
| nature | −80.0% | **+0.94%** | 96 ms |

At n=20 with exact optima: greedy 0/8 optimal, beam+tunnel 7/8, nature **8/8**.

---

## 6. TSPLIB results

| instance | optimum | greedy (best start) | beam + tunnel | nature |
|---|---|---|---|---|
| fri26 | 937 | 965 (+3.0%) | **937**, 4.9 ms | **937**, 10/10 seeds, 28 ms |
| dantzig42 | 699 | 864 (+23.6%) | **699**, 10.1 ms | 699, 8/10 seeds, 68 ms |
| att48 | 10628 | 12012 (+13.0%) | **10628**, 13 ms | 10638 best (+0.09%), 100 ms |

Notes:

- fri26: 1-tree bound = 937, so the tour is **provably optimal** without trusting TSPLIB.
- dantzig42: 2,522 triangle-inequality violations → non-metric, which is why greedy is so bad.
- att48: ATT pseudo-Euclidean rounding; nature needs `--iters=400000 --M=96` to reach 10628.

**Conclusion:** on small structured TSPLIB instances the classical beam + tunnel wins outright.
The nature model's edge appears only on larger/rugged instances (n ≥ 100 in the synthetic set).

---

## 7. Bugs found and fixed (worth remembering)

1. **Beam dedupe re-pricing bug.** Updating `len` on an existing node without rebuilding its
   parent chain produced tours whose recorded length did not match their path. Fix: create a
   new node when a shorter duplicate arrives.
2. **Off-by-one in beam depth.** Used `depth = step + 1`, giving one fewer voter than the page,
   silently degrading the beam 10–20%. Fix: `depth = step`.
3. **TDZ in `docs/nature_tsp.html`.** `addEventListener('change', debounced)` read `debounced`
   before its `const` initialisation. Fix: declare `debounced` at the top of the wiring block.
4. **`src/beam/beam_fast.js` CLI parsing swallowed bench flags** when the file was eval'd into another
   script. Fix: strip `process.argv.slice(2)` before eval (see `bench/bench_dataset.js`).
5. **`rand` is a closure variable** in the page, not a property. Benches need
   `setRand: fn => { rand = fn; }` in the exported object to seed it.

---

## 8. Commands

```bash
# fast solver + comparison bench
node src/beam/beam_fast.js --n=200 --seeds=6
node src/beam/beam_fast.js --n=200 --seeds=6 --preset=tuned    # best all-n rule
node src/beam/beam_fast.js --n=200 --seeds=6 --parity=1
node src/beam/beam_fast.js --n=40 --seeds=2 --score=all          # MST scoring over unvisited cities
node src/beam/beam_fast.js --n=200 --starts=random --startCount=8
node src/beam/beam_fast.js --n=200 --dedupe=last --lag=4 --oroptMaxL=2

# readable version (quality/time trade)
node src/beam/beam_simple.js 200 6 16

# nature model
node src/nature/nature_tsp.js --n=200 --seeds=4
node src/nature/nature_tsp.js --n=15 --seeds=8 --exact=1

# visual pages (open in browser)
open docs/nature_tsp.html
open docs/hybrid_tsp.html

# n-based knob sweep vs greedy / nature
node bench/knob_bench.js --ns=50,100,200 --seeds=2
node bench/knob_bench.js --ns=200 --seeds=4 --out=knob_results.csv

# full tuning sweep (greedy/nature/random-start/merge + knob configs)
node tuning/tune_knobs.js --ns=40,75,100,150,200,300,400 --seeds=2
node tuning/tune_knobs.js --ns=40,75,100,150,200,300,400 --seeds=2 --out=tune.csv

# hybrid annealer (includes its own greedy/nature/tuned-beam bench)
node src/hybrid/hybrid_tsp.js --ns=50,100,200,300 --seeds=2
node src/hybrid/hybrid_tsp.js --ns=400 --seeds=2 --gens=8 --polish=6

# effort dial (tuned hybrid): low/mid/high/xhigh/max
node src/hybrid/hybrid_effort.js --n=200 --effort=high
node src/hybrid/hybrid_effort.js --n=200 --effort=max --bound=1 --tour=tour.txt
node src/hybrid/hybrid_effort.js --ns=50,100,200 --efforts=low,mid,high,xhigh,max --seeds=2
node tuning/tune_effort.js --ns=40,80,150 --seeds=2
node tuning/validate_effort.js --ns=18,20,22 --seeds=3

# mixing study
node bench/merge_bench.js --n=200 --seeds=6

# dataset (243 sampled instances, ~25 s)
node bench/bench_dataset.js --per-n=3
node bench/bench_dataset.js --min-n=20 --max-n=22 --per-n=8 --exact=1
node bench/bench_dataset.js --per-n=0 --out=results.csv

# TSPLIB
node bench/fri26_bench.js
node bench/dantzig42_bench.js
node bench/att48_bench.js
node bench/att48_bench.js --iters=400000 --M=96 --seeds=5
```

### 8.1 Every beam + tunnel knob (`src/beam/beam_fast.js`)

| knob | default | meaning |
|---|---|---|
| `--K` | 16 | beam width |
| `--starts` | `farthest` | poles: `farthest` \| `random` \| `all` \| `first` |
| `--startCount`, `--startSeed` | 2, 1 | number / RNG seed for `--starts=random` |
| `--score` | `visited` | `visited` = `len + d(last, home)`; `all` = `len + MST(unvisited ∪ {last, start})` (O(n²) per candidate, much slower) |
| `--lag` | 3 | how many trailing cities nominate a neighbour (rank = lag+1) |
| `--extraRank` | 2 | rank of the extra candidate from the current city (0 = off) |
| `--maxBranch` | 4 | children per state after candidate dedupe (0 = unlimited) |
| `--dedupe` | `full` | interference key: `full` (visited+last+start) \| `last` \| `off` |
| `--refineF`, `--refineB` | 16, 16 | finals tunnelled on the fast / baseline path (0 = beam only) |
| `--near` | 10 | candidate-neighbour list width for 2-opt / Or-opt |
| `--oropt`, `--oroptMaxL` | 1, 3 | enable Or-opt; max segment length |
| `--passes` | 2 | 2-opt rounds (0 = no 2-opt; 2 reproduces 2opt→oropt→2opt) |
| `--twoOptGuard`, `--oroptGuard`, `--sweepGuard` | 200, 20, 80 | iteration caps (2-opt × n; Or-opt passes; sweeps) |
| `--epsilon` | 1e-9 | minimum improving delta |
| `--parity` | 0 | add full O(n²) sweeps (baseline-equivalent local optimum; fast mode only) |
| `--tunnelMode` | `fast` | `fast` = candidate-list 2-opt/Or-opt; `base` = full-restart 2-opt + Or-opt on every final |
| `--restarts` | 1 | independent beam runs; run 0 uses `--starts`, later runs use random pole pairs |
| `--preset` | — | `--preset=tuned` applies the all-n rule below; explicit flags override it |

**n-based values.** Every numeric knob also accepts an expression in `n`:
`--K=n/2`, `--K=n/3`, `--K=n`, `--K=2n`, `--near=n/10`, `--refineF=n/4`,
`--startCount=n/10`, `--lag=n`, `--oroptMaxL=n/20`, `--passes=n/20`,
`--twoOptGuard=n`, `--epsilon=1/n`, `--K='max(16,n/3)'`, `--near='max(10,n/10)'`.
Expressions are resolved after `--n` is known (so flag order does not matter), support
`+ - * / ( )`, `max(a,b)`, `min(a,b)`, decimals and `2n` shorthand.
Integer knobs are rounded to nearest; `--K` and `--startCount` have a floor of 1.
`--epsilon` keeps its fractional value. Runtime caps still apply (`refineF` can never
tunnel more than `K` finals, `near` is clamped to `n-1`).

Every default reproduces the previous output bit-for-bit. `src/beam/beam_simple.js` stays the fixed
readable reference; the knobs live on the optimised solver.

---

## 9. Beam-Guided Memetic Annealing (`src/hybrid/hybrid_tsp.js`)

The new algorithm mixes all three lines of work:

| stage | source | what it does |
|---|---|---|
| beam islands | `src/beam/beam_fast.js` | 4 independent beams (`K=max(16,n/3)`) from the farthest pair and random pole pairs |
| fast screen | `src/beam/beam_fast.js` | candidate-list tunnel on every final (cheap) |
| elite pool | — | canonical-cycle dedupe, keep the best 16 |
| recombination | new | **edge recombination (ERX)** between elite tours |
| mutation | `src/nature/nature_tsp.js` | double-bridge avulsions + short simulated-annealing runs |
| expensive polish | `src/beam/beam_fast.js` | full-restart 2-opt + Or-opt only on the top few children per generation |
| stagnation | `src/beam/beam_fast.js` | inject a fresh random-start beam island after 2 flat generations |

The key move is to stop base-tunnelling *every* final: the fast tunnel screens everything,
the base tunnel polishes only contenders. That is the hybrid-tunnel idea from
`docs/TUNING_NOTES.md`, plus recombination and nature-style escapes.

### Results (gap vs best-of-all methods on each instance)

| n | hybrid | tuned beam | nature | greedy | hybrid ms | tuned ms |
|---|---|---|---|---|---|---|
| 40 | **+0.00%** | +0.00% | +0.00% | +26.1% | 20 | 14 |
| 75 | **+0.07%** | +0.12% | +0.13% | +24.4% | 49 | 32 |
| 100 | **+0.00%** | +0.87% | +0.72% | +34.6% | 64 | 78 |
| 150 | **+0.00%** | +1.11% | +1.37% | +24.6% | 139 | 277 |
| 200 | **+0.00%** | +0.44% | +2.43% | +34.6% | 251 | 656 |
| 300 | **+0.00%** | +1.08% | +19.9% | +24.4% | 716 | 2398 |
| 400 | **+0.00%** | +0.36% | +52.7% | +25.3% | 1223 | 6519 |
| 500 | **+0.00%** | +1.41% | +50.8% | +30.0% | 2561 | 14798 |

Across the n=40–400 runs: median +0.00%, mean +0.08%, worst +0.97%, 12/16 wins, and
roughly 3–5× faster than the quality-first tuned beam at n≥300. The n=500 row is one seed
per family, so treat it as a scaling signal, not a statistical result.

Ablations at n=100/200 (2 seeds): removing the nature mutation (`--anneal=0`) gave mean
+0.09% and worst +0.76%; 6 islands with 4 generations was worse (+0.11% mean); a cheaper
polish budget (`--polish=4`) was nearly identical (+0.01% worst) at slightly lower cost.
So the recombination + anneal + selective polish combination is doing real work, while the
exact island/generation split is not critical.

Caveat: the reference is still best-of-all, not the optimum; TSPLIB/CSV validation of the
hybrid is not done yet.

`docs/hybrid_tsp.html` animates the pipeline step by step (beam depth → island finals → initial
polish → each ERX/kick/anneal child → selective polish), with the current pool, parents and
child colour-coded. The right panel runs Held–Karp for n ≤ 20 (exact optimum); for n = 21..30
Held–Karp is infeasible, so it shows a proven 1-tree lower bound instead and marks a tour
“proven optimal” when the heuristic meets the bound.

The demo logic is isolated in `src/hybrid/hybrid_vis.js` (no DOM): it exposes
`makeInstance(n, seed, kind)`, `buildSnapshots(inst, opts)`, `heldKarp(D)`,
`hkBound(D, ub, iters)`, `tourLen`, `checkTour` and `greedy`. The HTML only owns
drawing, playback and controls, so the same core can be required from Node (it exports
CommonJS as well as `window.HybridTSP`).

---

## 10. Effort dial (`src/hybrid/hybrid_effort.js`)

The pipeline is unchanged; `--effort` chooses how much search budget to spend. The levels
were tuned on synthetic uniform/cluster instances and then checked against Held–Karp at
n ≤ 22. `max` is a portfolio: it runs the `xhigh` configuration and a heavier `max`
configuration independently and keeps the shorter tour, so it cannot be worse than `xhigh`
on the same instance.

| effort | shape at n=200 | ~time n=200 | ~time n=400 |
|---|---|---|---|
| `low` | 2 islands, K=50, 10 elites, 4 gens, 4 children, polish 2 | 0.1 s | 0.6–0.8 s |
| `mid` | 4 islands, K=67, 20 elites, 8 gens, 10 children, polish 6 | 0.3 s | 2.5 s |
| `high` | 5 islands, K=80, 33 elites, 13 gens, 14 children, polish 13 | 0.8 s | 8.5 s |
| `xhigh` | 6 islands, K=100, 67 elites, 25 gens, 18 children, polish 20 | 2.3 s | 20 s |
| `max` | `xhigh` + 8 islands, K=100, 100 elites, 25 gens, polish 17, 2 restarts | 7 s | 63 s |

The visualizer (`docs/hybrid_tsp.html`) now exposes the same selector. It loads
`src/hybrid/effort_profiles.js` and calls `HybridTSP.effortOptions(level, n)`, which takes the real
preset and applies playback caps (1/2/3/4/6 islands, 1/3/4/5/8 generations,
2/3/4/5/6 children for low→max). The "demo budget" line under the controls shows the
capped values; a `max` run produces ~240 snapshots instead of thousands. The CLI uses the
full budgets above.

### Measured quality

12 instances (n=80,150,200; 2 seeds × uniform/cluster), reference = best tour found by
any tested level or the tuned beam:

| effort | median vs ref | mean vs ref | worst vs ref | median vs 1-tree bound | median time |
|---|---|---|---|---|---|
| `low` | +0.99% | +1.07% | +2.50% | +1.89% | 47 ms |
| `mid` | +0.19% | +0.31% | +0.99% | +1.09% | 161 ms |
| `high` | +0.01% | +0.13% | +0.50% | +0.87% | 363 ms |
| `xhigh` | +0.00% | +0.02% | +0.23% | +0.71% | 941 ms |
| `max` | +0.00% | +0.00% | +0.00% | +0.71% | 2.87 s |

At n=300/400 (4 instances, one seed per family) the same ordering holds and the spread gets
larger: mean vs best-of-all is +2.25% / +0.97% / +0.62% / +0.16% / +0.00% for
low→max, and the gap to the 1-tree bound is +3.28% / +2.06% / +1.78% / +1.25% / +1.13%.
The bound is not tight, so these are upper bounds on the true optimality gap.

### Exact check

Held–Karp at n=18 and n=20: **20/20 instances optimal for every level**, including `low`.
At n=22: **6/6 optimal for every level** (the exact solve costs ~1.3–1.6 s per instance;
the solver itself takes 2–60 ms). Effort only starts to matter above n≈40.

### What the sweeps showed

- **Generations are the dominant lever.** Raising `gens` from 6 to `n/5` cut mean gap vs
  best-of-all from +0.31% to +0.03% at n=80/150, at ~2.4× time. Beyond `n/5` the curve
  flattens.
- **Children are the cheapest lever.** Going from 8 to 24 children improved mean gap from
  +0.21% to +0.06% for ~1.5× time. Only the top `polish` children get the expensive base
  tunnel, so extra children mostly buy cheap diversity.
- **Polish saturates around 6.** `polish=6` was the best single cheap change
  (mean +0.05%, worst +0.42%, 10/12 wins); 8, 10, `n/10`, and `n/5` did not improve on it.
- **Elites alone do nothing.** `elites` = 8, 16, n/10, n/5, n/2, and n all landed within noise
  (mean +0.16–0.24%) with a fixed generation budget. The user-observed
  `elites=n/2 + gens=n/10` profile is good (+0.05% mean, +0.19% worst at n=80/150, 62 ms),
  but it is dominated by adding children/polish at the same spend.
- **Beam width and island count are secondary.** `K=n`, `K=n/2`, and 2–12 islands changed
  less than the generation/children knobs once every final was screened. `K=n` was slower
  and sometimes worse.
- **Annealing is a small effect.** `anneal=0` cost ~0.1% mean and made the worst case
  worse; a 3× larger cap or `annealRate=.6` gained little. Keep it, but do not scale it
  as the main quality knob.
- **Restarts are linear cost for sublinear gain.** 2–4 restarts improved the mean but never
  beat spending the same time on generations/children. `max` still uses two restarts as
  insurance, and the extra `xhigh` portfolio run is what makes it robust.
- **Or-opt length is not the bottleneck.** `oroptMaxL` 5→8→10 was flat. The base tunnel is
  already near its local optimum.
- **A final polish of the pool is flat.** `finalPolish=10` alone did nothing; the pool was
  already polished. It only earns its cost inside the heavy profiles.
- **Remaining gap is probably bound looseness.** At n=80 every config, including very heavy
  ones, converged to the same best tour; at n=150 the best-of-all plateaued around +0.9%
  over the 1-tree bound. `max` matched the best-of-all tour on all 12 final instances.

Reproduce:

```bash
node tuning/tune_effort.js --ns=40,80,150 --seeds=2
node tuning/tune_effort.js --ns=150,200 --seeds=2 --only='L[1-7]|combo'
node tuning/validate_effort.js --ns=18,20,22 --seeds=3
node src/hybrid/hybrid_effort.js --ns=80,150,200 --seeds=2 --kind=both \
  --efforts=low,mid,high,xhigh,max --bound=1
```

---

## 11. Open threads

- **EAX / AB-cycle recombination** instead of ERX in `src/hybrid/hybrid_tsp.js` — the natural next
  step after ERX; edge voting on raw finals already scored ~0.
- **Hybrid tuning and validation**: the effort ladder in section 10 is tuned in-sample on
  synthetic instances. Re-run it on held-out seeds, TSPLIB, and the CSV dataset before
  treating the level boundaries as universal.
- **Tighter bound for n=60–120**: the 1-tree bound plateaus ~0.7–1.2% above the best tour,
  which is larger than the differences between `high`, `xhigh`, and `max`. A tighter
  Lagrangian/assignment bound, or exact branch-and-bound, is needed to tell whether the
  remaining gap is search error or bound looseness.
- **Parallel hybrid**: islands, children, and polishes are independent — workers should
  make the 1.2 s at n=400 close to interactive.
- **Nature solver cost**: 14 annealed tours is the whole budget at large n; dropping to 3–4
  and using a fast representation (bitsets / arena) would cut it 5–10×.
- **Exact up to n≈30** via branch-and-bound with 1-tree bounds (Held–Karp cannot go past 22 in
  a browser).
- **Workers**: the finals are independent; one worker per final is a clean cores× win.
- **Page story**: with the MST score the beam is near-optimal at n ≤ 15, which removes the
  visible contribution of "tunnelling" — a presentational trade-off not yet decided.
- `bench/n22_bench.js` has never been executed; it is the smallest reproducible greedy vs beam+tunnel
  vs exact comparison.
