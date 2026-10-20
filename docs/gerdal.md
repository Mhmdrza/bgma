# Beam-Guided Memetic Annealing (BGMA)

*An archival algorithm note for the polynomialTSP repository*

**Mohammadreza Aala** · [mrala@ut.ac.ir](mailto:mrala@ut.ac.ir) · 2026-10-20

Tags: `tsp` · `heuristic` · `bgma`

> **The short version.** Exact Held–Karp optima reproduced on 26 of 26 checkable instances, 215×
> faster than the exact solver at n=20, and within 1.25% of a proven lower bound at n=300–400 — a
> size where the exact method no longer fits in memory. This note is the evidence behind those three
> numbers: what the method does, what it costs, and what is and is not proven. The demo that makes
> the same claims interactively is `web/hybrid_tsp.html`.

> This document describes the algorithm implemented in this repository at commit
> `0f8f69d1cdb0e93aec26281017cabd4cf6ec84e8` (2026-10-20). It is intended as a
> stable, self-contained reference for the method, its parameters, its measured
> behaviour, and the claims that are and are not supported by the experiments.

## Abstract

Beam-Guided Memetic Annealing (BGMA) is a hybrid heuristic for the symmetric
Euclidean Travelling Salesman Problem. It combines four ideas:

1. a beam search that constructs diverse partial tours from several poles;
2. a fast candidate-list local search that screens every beam final;
3. an elite pool recombined with edge recombination (ERX), perturbed by
   double-bridge moves or short simulated annealing, and screened again; and
4. a full-restart 2-opt + Or-opt polish applied only to the few tours that can
   plausibly win.

The design is deliberately asymmetric: cheap operators run on every candidate,
while the expensive local search is reserved for the elite frontier. An
`--effort` dial maps five levels (`low`, `mid`, `high`, `xhigh`, `max`) onto
increasing search budgets. At small sizes every level reaches the Held–Karp
optimum — 26 of 26 checkable instances at n = 18, 20 and 22, in milliseconds. At
larger sizes the levels trade runtime for a progressively smaller gap to the best
tour found, with `max` matching the best-of-all tested tour on all reported
n=80–200 instances and `xhigh` staying within 1.25% of a proven 1-tree bound at
n=300–400, where Held–Karp is out of reach.

## Problem and notation

### The problem

Given $n$ points $p_0,\ldots,p_{n-1}$ in the plane, find a cyclic permutation
$\pi$ of the points that minimises

$$
L(\pi) = \sum_{i=0}^{n-1} d(p_{\pi(i)}, p_{\pi((i+1) \bmod n)}),
$$

where $d$ is Euclidean distance. The distance matrix is written $D$, with
$D_{ij}=d(p_i,p_j)$.

### Notation used below

| symbol | meaning |
| --- | --- |
| $n$ | number of cities |
| $K$ | beam width (number of partial tours kept per depth) |
| $m$ | candidate-list size for the fast local search |
| $P$ | elite pool |
| $g$ | number of generations |
| $c$ | number of children per generation |
| $e$ | elite-pool capacity |
| $q$ | number of children polished per generation |
| $R$ | number of independent hybrid restarts |

A tour is stored as an array of city indices. Two arrays that are rotations or
reversals of each other represent the same cyclic tour; the canonical form used
for deduplication starts at city 0 and takes the lexicographically smaller of
the forward and reverse representations.

## Algorithm

### High-level pipeline

```text
build instance and distance matrix
repeat R times:
    beam islands          -> beam finals
    fast screen           -> locally optimal candidates
    elite pool            -> dedupe, sort, truncate
    initial polish        -> base-tunnel the top q elites
    repeat g generations:
        select two parents from the pool
        ERX                   -> child
        double-bridge and/or short anneal
        fast screen
        base-polish the top q children
        merge into the pool
        if stagnant for 2 generations: inject a fresh beam island
    final polish          -> base-tunnel the top finalPolish pool entries
return the shortest tour seen
```

For `--effort=max`, the CLI runs the `xhigh` configuration and the `max`
configuration independently and returns the shorter tour. This portfolio step
makes `max` monotone over `xhigh` on the same instance.

### Beam islands

Each island runs the beam search in `src/beam/beam_fast.js`. A beam state is a partial
tour with a visited set, a current city, a start city, and a partial length.
At each depth the beam:

- proposes candidates from the last three cities, using ranks 1, 2, and 3 of
  each city's nearest-neighbour order;
- adds rank 2 of the current city;
- deduplicates equal states and keeps the $K$ states with the smallest
  $f = \text{length} + D_{\text{last},\text{start}}$.

The first island uses the farthest pair of cities as poles. Later islands use
deterministic random pole pairs derived from the seed. Every beam final is
immediately passed to the fast screen.

The beam is a constructor, not the main quality mechanism. In the tuning
experiments, increasing $K$ without also screening every final was not a
reliable improvement.

### Fast screen: candidate-list 2-opt + Or-opt

The fast screen is `refineFast` in `src/beam/beam_fast.js`. It performs:

- 2-opt with a neighbour list of size $m$;
- a don't-look-bit queue so a city is revisited only after an incident edge
  changes;
- delta evaluation and an in-place position index;
- one Or-opt pass over segments of length at most `fastOrOptMaxL` (default 3).

Its purpose is to turn a raw beam final into a decent local optimum at low cost.
It is used on every beam final and every child.

### Elite pool

Candidates are deduplicated by canonical cycle, sorted by length, and truncated
to the best $e$ tours. The pool is the memetic memory of the search: it supplies
parents for ERX and survives across generations.

### Edge recombination (ERX)

ERX treats a tour as a cycle of edges. For two parents $A$ and $B$:

1. Build an adjacency list for each city from the edges of $A$ and $B$.
2. Start at a random city.
3. At each step, among the unused neighbours of the current city, choose the
   one with the fewest unused neighbours; break ties by the shorter edge.
4. If the adjacency list is exhausted, jump to the nearest unvisited city.

ERX preserves edges that both parents agree on and repairs the rest. It is
cheaper and simpler than EAX; the repository notes flag EAX/AB-cycle
recombination as future work.

### Mutation: double bridge and short annealing

Each child may be perturbed by two independent operators:

- **Double bridge.** Split the tour into four segments and reorder them as
  $A \to D \to C \to B$. This is a 4-opt-like kick that usually jumps to a
  different basin.
- **Short anneal.** Run the nature-model annealer with 2-opt moves and
  Metropolis acceptance. The temperature starts at
  $T_0 = \max(1, 0.02n)$ and cools by $T \leftarrow 0.99998T$ per iteration.
  After $50n$ consecutive non-improving iterations, a double-bridge reheat sets
  $T \leftarrow \max(T, 0.4T_0)$. The iteration cap is
  $\min(\text{anneal}, \max(1000, 200n))$.

The two events are checked independently with probabilities `kickRate` and
`annealRate`, so a child may receive a kick, an anneal, or both. They are modest
by design: the operators are escape mechanisms, not the main search.

### Selective full-restart polish

The base tunnel is `refineBase` in `src/beam/beam_fast.js`: first-improvement 2-opt over
the full distance matrix, followed by Or-opt segment relocation of lengths
$1,\ldots,\text{oroptMaxL}$, restarting the scan after every accepted move.
It reaches a stronger local optimum than the fast screen but costs much more.

BGMA applies it only to:

- the top `polish` elites after the islands;
- the top `polish` children of each generation; and
- the top `finalPolish` pool entries at the end.

This is the central cost-control idea: use the fast screen as a filter, then
spend the full-restart search on contenders only.

### Stagnation injection

If the best tour has not improved for two consecutive generations, the search
runs a fresh beam island from a new random pole pair, fast-screens its finals,
and merges them into the pool. The stagnation counter resets. This prevents the
population from collapsing onto one basin without paying for a full restart.

### Restarts and the effort portfolio

The public `hybrid()` entry point runs $R$ independent copies of the pipeline
with seed offsets and keeps the shortest tour. For `max` effort, the CLI also
runs the `xhigh` profile and keeps the better of the two results. The portfolio
is the only place where the levels are deliberately nested; the other levels are
single configurations.

## Pseudocode

```text
function BGMA(instance, seed, options):
    P = empty elite pool
    best = null

    for each island i in 1..islands:
        poles = (i == 1) ? farthest_pair() : random_pair(seed, i)
        finals = beam_search(poles, K)
        for each final in finals:
            candidate = fast_screen(final)
            insert candidate into P
        P = dedupe_sort_truncate(P, elites)
        best = min(best, P[0])

    for i in 1..min(polish, |P|):
        candidate = base_polish(P[i])
        insert candidate into P
    P = dedupe_sort_truncate(P, elites)

    stagnant = 0
    for generation in 1..gens:
        children = []
        for child in 1..children:
            parentA = P[random index in 1..min(4, |P|)]
            parentB = P[random index in 1..|P|]
            while parentB == parentA and |P| > 1:
                parentB = P[random index in 1..|P|]

            tour = ERX(parentA, parentB)

            if random() < kickRate:
                repeat 1..kicks:
                    tour = double_bridge(tour)
            else if anneal > 0 and random() < annealRate:
                tour = anneal(tour,
                              iters = min(anneal, max(1000, 200n)),
                              T0 = max(1, 0.02n))

            candidate = fast_screen(tour)
            children.append(candidate)

        sort children by length
        for i in 1..min(polish, |children|):
            children[i] = base_polish(children[i])

        before = best
        insert children into P
        P = dedupe_sort_truncate(P, elites)
        best = P[0]

        if best improved:
            stagnant = 0
        else:
            stagnant += 1

        if inject and stagnant >= 2:
            finals = beam_search(random_poles(), K)
            for each final in finals:
                candidate = fast_screen(final)
                insert candidate into P
            P = dedupe_sort_truncate(P, elites)
            best = P[0]
            stagnant = 0

    for i in 1..min(finalPolish, |P|):
        candidate = base_polish(P[i])
        insert candidate into P
    P = dedupe_sort_truncate(P, elites)
    return P[0]
```

## Parameters and effort levels

### Defaults in the core

| parameter | default | role |
| --- | --- | --- |
| `islands` | 4 | number of independent beam islands |
| `K` | 0 (default max(16, n/3)) | beam width |
| `near` | 0 (default max(10, n/10)) | fast-screen candidate-list size |
| `elites` | 16 | elite-pool capacity |
| `polish` | 6 | initial and per-generation base-tunnel count |
| `gens` | 6 | generations |
| `children` | 8 | children per generation |
| `kicks` | 1 | maximum double-bridge kicks per child |
| `kickRate` | 0.35 | probability of choosing kicks |
| `anneal` | 20000 | annealing iteration cap; 0 disables |
| `annealRate` | 0.35 | probability of choosing annealing |
| `inject` | 1 | enable stagnation injection |
| `fastOrOptMaxL` | 3 | Or-opt segment cap in the fast screen |
| `polishOrOptMaxL` | 5 | Or-opt segment cap in the base tunnel |
| `finalPolish` | 0 | final base-tunnel count |
| `restarts` | 1 | independent hybrid restarts |

### The tuned ladder

The values below are in `src/hybrid/effort_profiles.js` and are shared by the Node CLI and
the browser visualizer. Here $r(x)$ means `max(1, round(x))`.

| level | islands | K | elites | gens | children | polish | finalPolish | restarts |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `low` | 2 | max(12, r(n/4)) | max(8, r(n/20)) | max(2, r(n/50)) | 4 | 2 | 0 | 1 |
| `mid` | 4 | max(16, r(n/3)) | max(16, r(n/10)) | max(4, r(n/25)) | 10 | 6 | 2 | 1 |
| `high` | 5 | max(20, r(n/2.5)) | max(24, r(n/6)) | max(6, r(n/15)) | 14 | max(6, r(n/15)) | 3 | 1 |
| `xhigh` | 6 | max(24, r(n/2)) | max(32, r(n/3)) | max(8, r(n/8)) | 18 | max(10, r(n/10)) | 6 | 1 |
| `max` | 8 | max(32, r(n/2)) | max(48, r(n/2)) | max(10, r(n/8)) | 18 | max(10, r(n/12)) | 8 | 2 |

The annealing cap and probability also scale: 8k/0.25 for `low`, 20k/0.35 for
`mid`, 30k/0.40 for `high`, 50k/0.45 for `xhigh`, and 60k/0.50 for `max`.
`polishOrOptMaxL` is 5 for `low`/`mid`, 6 for `high`, and 8 for `xhigh`/`max`.

`--effort=max` additionally runs the `xhigh` profile and keeps the shorter
tour, so it costs the sum of the two runs.

### What the tuning showed

- **Generations dominate.** Raising `gens` from 6 to `n/5` cut the mean gap to the
  best-of-all reference from +0.31% to +0.03% at n=80/150, at about 2.4x the
  time. Beyond `n/5` the curve flattens.
- **Children are the cheapest diversity.** 8 to 24 children moved the mean gap
  from +0.21% to +0.06% for about 1.5x the time, because only the top `polish`
  children receive the expensive base tunnel.
- **Polish saturates around 6.** `--polish=6` gave a mean gap of +0.05% and a worst
  case of +0.42% at roughly the same cost as `--polish=2`. Values 8, 10, n/10,
  and n/5 did not improve on it.
- **Elites alone are noise.** Elite sizes from 8 to n landed within +0.16–0.24%
  mean with a fixed generation budget. Elites are capacity for the generation
  loop, not a standalone quality lever.
- **Beam width and island count are secondary.** K=n was slower and not better.
  Island counts from 2 to 12 changed less than generations or children once
  every final was screened.
- **Annealing, restarts, Or-opt length, and final polish are minor.** They help
  the worst case slightly but are not where the quality comes from.

## Validation and measured behaviour

### Exact checks

Held–Karp was run on synthetic instances with n=18, 20, and 22.

| n | instances | result |
| --- | --- | --- |
| 18 | 10 | every effort level reached the optimum |
| 20 | 10 | every effort level reached the optimum |
| 22 | 6 | every effort level reached the optimum |

At these sizes the exact solve costs about 0.06–0.4 s for n=18/20 and 1.3–1.6 s
for n=22; the heuristic itself takes milliseconds. Effort levels only begin to
separate above roughly n=40.

### Relative quality, n=80/150/200

12 instances (2 seeds x uniform/cluster). The reference is the best tour found
by any tested effort level or the tuned beam on that instance, not the optimum.

| effort | median vs ref | mean vs ref | worst vs ref | median vs 1-tree bound | median time |
| --- | --- | --- | --- | --- | --- |
| `low` | +0.99% | +1.07% | +2.50% | +1.89% | 47 ms |
| `mid` | +0.19% | +0.31% | +0.99% | +1.09% | 161 ms |
| `high` | +0.01% | +0.13% | +0.50% | +0.87% | 363 ms |
| `xhigh` | +0.00% | +0.02% | +0.23% | +0.71% | 941 ms |
| `max` | +0.00% | +0.00% | +0.00% | +0.71% | 2.87 s |

### Large-n check, n=300/400

4 instances (one seed x uniform/cluster). Mean gap vs the best-of-all reference:
+2.25% / +0.97% / +0.62% / +0.16% / +0.00% for low→max. Gap to the 1-tree
bound: +3.28% / +2.06% / +1.78% / +1.25% / +1.13%.

### Measured runtime

All numbers below come from `bench/runtime_bench.js`, which loads every solver from
the project files and times only the solve (wall clock, `process.hrtime`). Each cell
is the median over 4 instances (2 seeds x uniform/cluster) on Apple M3 Pro,
Node v22.23.2, measured 2026-10-19. The raw results are in `docs/runtime.json`.

*Median wall time per instance. The last column is the empirical exponent $k$ in the growth $t \propto n^k$ between n=20 and n=400.*

| algorithm | n=20 | n=50 | n=100 | n=200 | n=400 | `n^k` |
| --- | --- | --- | --- | --- | --- | --- |
| greedy nearest-neighbour | 3 µs | 6 µs | 12 µs | 24 µs | 52 µs | 0.94 |
| beam only (K=n/3) | 194 µs | 517 µs | 2.1 ms | 9.5 ms | 43 ms | 1.81 |
| beam + tunnel (tuned) | 1.7 ms | 9.2 ms | 66 ms | 664 ms | 6.41 s | 2.75 |
| nature (population + anneal) | 11 ms | 68 ms | 87 ms | 179 ms | 561 ms | 1.32 |
| Christofides (1.5-approx) | 195 µs | 628 µs | 1.1 ms | 11 ms | 30 ms | 1.68 |
| `BGMA low` | 1.4 ms | 4.9 ms | 16 ms | 115 ms | 732 ms | 2.10 |
| `BGMA mid` | 5.1 ms | 17 ms | 51 ms | 281 ms | 2.46 s | 2.06 |
| `BGMA high` | 10 ms | 36 ms | 113 ms | 776 ms | 8.38 s | 2.24 |
| `BGMA xhigh` | 18 ms | 64 ms | 276 ms | 2.21 s | 19.5 s | 2.33 |
| `BGMA max` | 71 ms | 232 ms | 864 ms | 6.79 s | 64.1 s | 2.27 |
| 1-tree lower bound | 98 µs | 3.5 ms | 14 ms | 64 ms | 267 ms | 2.64 |
| Held-Karp exact | 302 ms | — | — | — | — | — |

*Mean excess over the best tour any method found on the same instance (`BGMA max` reads 0.00% at every size because it found the best tour on every instance).*

| algorithm | n=20 | n=50 | n=100 | n=200 | n=400 |
| --- | --- | --- | --- | --- | --- |
| greedy nearest-neighbour | +14.03% | +27.72% | +31.90% | +31.04% | +26.46% |
| beam only (K=n/3) | +14.94% | +32.13% | +32.43% | +37.63% | +38.88% |
| beam + tunnel (tuned) | +0.00% | +0.04% | +0.69% | +1.53% | +2.22% |
| nature (population + anneal) | +0.00% | +0.07% | +0.69% | +3.39% | +35.39% |
| Christofides (1.5-approx) | +10.50% | +10.07% | +13.07% | +13.48% | +13.02% |
| `BGMA low` | +0.00% | +0.12% | +0.52% | +1.69% | +2.21% |
| `BGMA mid` | +0.00% | +0.00% | +0.03% | +0.69% | +1.13% |
| `BGMA high` | +0.00% | +0.00% | +0.02% | +0.31% | +0.59% |
| `BGMA xhigh` | +0.00% | +0.00% | +0.00% | +0.02% | +0.12% |
| `BGMA max` | +0.00% | +0.00% | +0.00% | +0.00% | +0.00% |

Reproduce with `node bench/runtime_bench.js --json=docs/runtime.json --web=web/runtime_data.js`
(about ten minutes; `--ns`, `--seeds`, `--levels` and `--maxN` shorten it). The same
data feeds the "Measured runtime" table in both visualizer pages.

#### Where the time goes

Per level the cost is roughly (#islands x beam) + (#screens x fast tunnel) + (#polishes x
base tunnel) + (#anneals x annealing run) + (#children x ERX). The components scale
differently:

- **Beam island.** K states x at most four candidates per depth, n depths, with a
  bitset copy and a hash per candidate: about O(n K log K). With K = max(16, n/3)
  the measured exponent for the beam alone is 1.75 (44 ms at n=400).
- **Fast screen.** Candidate-list 2-opt with don't-look bits plus Or-opt up to length 3.
  Cheap per tour, but it is run on every beam final and every child.
- **Base polish.** Full-restart 2-opt + Or-opt (segment length up to 5, 6 or 8) over all
  O(n^2) pairs, repeated until no move helps. This is the expensive pass, which is why
  only the best few children get it. It is the reason the tuned beam + tunnel
  baseline, which tunnels every beam final (up to n of them) over 4 restarts, scales as n^2.7.
- **Short anneal.** Capped at min(level cap, max(1000, 200 n)) proposals of cost O(n) each (the
  2-opt reversal), so it grows with n but is bounded by the level's cap.
- **ERX.** O(n) per child; never visible in the profile.

Because islands, K, elites, generations and polish count all grow with n inside a level
(see the ladder above), BGMA does not stay near-linear: the measured exponent is
2.0 for `low` and `mid` and 2.2–2.3 for `high`, `xhigh` and `max`. The worst case is
cubic (about n polishes of O(n^2) each), but polishing an already good tour ends after
a few passes, so the practical growth is close to quadratic.

#### What the measurements show

- **Each effort level costs about 3x the previous one, and about halves the gap.** At n=200
  the ladder runs 115 ms, 281 ms, 776 ms, 2.21 s, 6.79 s (ratios 2.4, 2.8, 2.8, 3.1); at
  n=400 it is 0.73 s, 2.46 s, 8.38 s, 19.5 s, 64.1 s (3.4, 3.4, 2.3, 3.3). The gap to
  the best-known tour at n=400 falls +2.21%, +1.13%, +0.59%, +0.12%, 0.00%.
  Returns per second diminish quickly past `high`.
- **`low` replaces the tuned beam + tunnel at large n.** At n=400 the two reach the same
  quality (+2.21% vs +2.22%) but `low` takes 0.73 s against 6.41 s, 8.8x faster. At
  n=100 `mid` (51 ms, +0.03%) is both faster and better than beam + tunnel (66 ms, +0.69%).
  Below n=50 everything finds the optimum in a few milliseconds and the levels are
  indistinguishable.
- **Christofides is the guarantee.** MST, a minimum-weight perfect matching on the odd-degree
  vertices (Edmonds' blossom algorithm, the O(k^3) formulation with dual variables), an Euler
  tour and shortcutting. It guarantees a tour at most 1.5 times the optimum on any metric
  instance, and it runs in 30 ms at n=400. Its measured excess is 10–13% at every n. On the
  n ≤ 20 instances checked against Held–Karp it averaged 1.07 times the optimum, worst 1.18.
  From n=50 up, BGMA's `low` level has a 6 to 80 times smaller excess, at 8 to 24 times the runtime.
  The matching was checked against brute force on 28 random sets (error below 1e-15).
- **Greedy and beam-only are fast and poor.** Microseconds to tens of milliseconds, but
  26–39% above the best tour at every n >= 50. Greedy's time is a scan of precomputed
  neighbour lists (setup excluded), so its n^0.88 is not the O(n^2) of building them.
- **Nature is cheap at large n only because it is under-budgeted.** Its annealing budget is
  capped at 120 000 proposals per tour, so its time grows slowly (n^1.3, 0.56 s at
  n=400) while quality collapses (+35% at n=400). At n=20–50 it costs 12–72 ms, more than
  `BGMA low` or `BGMA mid` (1.6–19 ms), because its budget 1500 + 45 n^2 proposals is large for small n.
- **The reference computations.** The 1-tree bound (400 subgradient steps, each a dense
  O(n^2) Prim) costs 64 ms at n=200 and 267 ms at n=400, about 35–55% of a
  `low` run, and much less than `max`. Held–Karp is exact but exponential: 302 ms at
  n=20, and the notes record 1.3–1.6 s at n=22; it needs (n-1) 2^(n-1) table entries
  and is not run beyond n=22 (this benchmark stops at n=20).

#### Caveats

- Four instances per cell is enough for the order of magnitude and the ratios between
  levels, not for tight confidence intervals; microsecond cells (greedy, 1-tree at
  n=20) are dominated by timer and JIT noise.
- The exponents use only the first and last size, so they are indicative, not fitted.
- One machine, one Node version, single thread. The animated pages run a
  scaled-down version of the same pipeline in the browser (see "Parameters and effort
  levels"), so their live timings are not comparable to this table.

## Claims made on the demo page, and their evidence

The visual page (`web/hybrid_tsp.html`) is written as a pitch: a claim, three numbers that back it,
then the demo. Every sentence on it maps to a table in this note. If a claim is not in this table,
the project does not claim it.

| claim on the page | evidence | reproduce |
| --- | --- | --- |
| “Routes that exact solvers can’t reach” | n = 50–400 runs, where Held–Karp is infeasible, each measured against a 1-tree bound | runtime table; `--bound=1` |
| “26 / 26” exact optima reproduced | exact checks: 10 + 10 + 6 instances at n = 18, 20, 22, at every effort level | `tuning/validate_effort.js --ns=18,20,22` |
| “215× faster” at 20 cities | 1.4 ms (`low`) against 302 ms for the same provably shortest tour | runtime table, n=20 row |
| “+1.25% of the proven bound at 300–400 cities” | large-n check: `xhigh` +1.25%, `max` +1.13% gap to the 1-tree bound | `--n=400 --effort=xhigh --bound=1` |
| “Christofides lands about 13% above the best tour” | +10.07% to +13.48% mean excess across n = 20–400 | quality table below |
| “No theorem attached” (the fine print) | BGMA has no approximation guarantee; only the measured evidence above | next section |

The demo scales budgets down so playback stays watchable, so its on-screen timings are illustrative,
not the CLI numbers in the runtime table.

## What is proven and what is not

- **Proven optimal** is used only when the returned tour length equals a proven
  lower bound (Held–Karp for n≤22, or a 1-tree subgradient bound), or when
  Held–Karp is run directly. The CLI prints `PROVEN OPTIMAL` in that case.
- The larger-n tables use the best tour found by any tested method as the
  reference. They are **relative** comparisons, not optimality gaps.
- The 1-tree bound is proven but loose. At n=80–200 the best tours plateau
  roughly 0.5–1.2% above it, and adding much more search does not close that
  plateau. The evidence is consistent with bound looseness, but it is not a
  proof that the tours are optimal.
- The tuning is in-sample on synthetic uniform/cluster instances. Held-out
  seeds, TSPLIB, and the CSV dataset are still needed before treating the level
  boundaries as universal.

## Reproduction

```sh
# exact check of every effort level
node tuning/validate_effort.js --ns=18,20,22 --seeds=3

# one run, with a proven lower bound and a tour file
node src/hybrid/hybrid_effort.js --n=200 --effort=max --bound=1 --tour=tour.txt

# compare the full ladder
node src/hybrid/hybrid_effort.js --ns=80,150,200 --seeds=2 --kind=both \
  --efforts=low,mid,high,xhigh,max --bound=1

# one-factor knob sweeps
node tuning/tune_effort.js --ns=40,80,150 --seeds=2
node tuning/tune_effort.js --ns=80,150 --seeds=2 --only='elite|gen|children|polish'

# open the interactive demo (claim, evidence, effort dial, Held–Karp comparison)
python3 -m http.server 8000
# then open http://127.0.0.1:8000/web/hybrid_tsp.html
```

## Implementation map

| file | role |
| --- | --- |
| `src/beam/beam_fast.js` | beam search, fast screen, base tunnel, instance builder |
| `src/nature/nature_tsp.js` | simulated annealer and population operators used by the hybrid |
| `src/hybrid/bgma.js` | parameterised BGMA core; `hybrid()`, `runEffort()` |
| `src/hybrid/effort_profiles.js` | shared low/mid/high/xhigh/max budgets |
| `src/hybrid/hybrid_effort.js` | tuned CLI with `--effort`, `--bound`, `--exact`, `--tour`, `--json` |
| `src/hybrid/hybrid_vis.js` | browser/Node core for the animated demo |
| `web/hybrid_tsp.html` | interactive demo and pitch page: claim + evidence, exact optimum vs BGMA, effort dial, timeline |
| `tuning/tune_effort.js` | knob sweep and quality/runtime harness |
| `tuning/validate_effort.js` | Held–Karp validation at n≤22 |
| `TSP_NOTES.md` | full project notes and earlier benchmarks |
| `TUNING_NOTES.md` | tuning observations and future work |
| `bench/runtime_bench.js` | runtime and quality of every algorithm; source of `docs/runtime.json` |
| `web/runtime_table.js` | renders the measured-runtime table in both visualizer pages |

The Node core loads `src/beam/beam_fast.js` and `src/nature/nature_tsp.js` by slicing the source and
evaluating the algorithm portion. This keeps the browser page and the CLI on the
same implementation while avoiding a build step. The browser core
(`src/hybrid/hybrid_vis.js`) mirrors the pipeline for animation and uses demo-capped
budgets so a `max` run stays watchable; it is not the exact Node code path.

## Limitations and future work

- **Tighter bounds.** The 1-tree bound is the main obstacle to knowing the true
  gap at n=60–120. A tighter Lagrangian or assignment bound, or exact
  branch-and-bound, would settle it.
- **EAX / AB-cycle recombination.** ERX is simple; EAX is the natural next
  recombination operator with a demonstrated literature upside.
- **Parallelism.** Islands, children, and polish calls are independent. A worker
  pool would turn the `max` runtime into a cores× speedup without changing
  quality.
- **Held-out and real-instance validation.** Re-run the ladder on unseen seeds,
  TSPLIB, and the CSV dataset.
- **Adaptive budgets.** The current ladder is one Pareto curve. A small model of
  quality vs (K, gens, children, polish, n) could choose a budget from a wall
  clock or a target gap.
- **Stronger local search.** 3-opt or Lin–Kernighan-style moves may beat adding
  more generations, but the current base tunnel is already a strong 2-opt +
  Or-opt local optimum.

## References

- Held, M., and Karp, R. M. (1962). A dynamic programming approach to sequencing
  problems. *Journal of the Society for Industrial and Applied Mathematics*.
- Held, M., and Karp, R. M. (1971). The traveling-salesman problem and minimum
  spanning trees: Part II. *Mathematical Programming*.
- Lin, S., and Kernighan, B. W. (1973). An effective heuristic algorithm for the
  traveling-salesman problem. *Operations Research*.
- Whitley, D., Starkweather, T., and Fuquay, D. (1989). Scheduling problems and
  traveling salesmen: The genetic edge recombination operator. *ICGA*.
- Martin, O., Otto, S. W., and Felten, E. W. (1991). Large-step Markov chains
  for the traveling salesman problem. *Complex Systems*.
- Johnson, D. S., and McGeoch, L. A. (1997). The traveling salesman problem:
  A case study in local optimization. In *Local Search in Combinatorial
  Optimization*.
- Applegate, D., Bixby, R., Chvátal, V., and Cook, W. (2006). *The Traveling
  Salesman Problem: A Computational Study*. Princeton University Press.

## Archive metadata

| field | value |
| --- | --- |
| title | Beam-Guided Memetic Annealing (BGMA) |
| author | Mohammadreza Aala |
| contact | [mrala@ut.ac.ir](mailto:mrala@ut.ac.ir) |
| repository | <https://github.com/Mhmdrza/polynomialTSP> |
| snapshot commit | `0f8f69d1cdb0e93aec26281017cabd4cf6ec84e8` |
| snapshot date | 2026-10-20 |
| document date | 2026-10-20 |
| scope | algorithm description, parameters, validation, demo-claim audit, reproduction |
| language | Markdown |
| license | The repository does not currently include a LICENSE file. |

<!-- End of archival note. If this document is exported, keep the commit hash and the
"what is proven" section with the export; they are part of the provenance. -->
