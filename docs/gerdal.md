# Beam-Guided Memetic Annealing (BGMA)

*An archival algorithm note for the tsp-lab repository*

**Mohammadreza Aala** · [mrala@ut.ac.ir](mailto:mrala@ut.ac.ir) · 2026-10-20

Tags: `tsp` · `heuristic` · `bgma`

> **The short version.**
> BGMA is a heuristic with an effort dial. It matched the known optimum on **35 of 40** instances where
> one exists: 26 of 26 Held–Karp instances at $n=18\text{–}22$ on every effort level, and at `max`
> all **9 of 9 TSPLIB instances up to $n=417$**. On the five TSPLIB instances from $n=442$ to 1060 it
> was **+0.33% to +2.10%** above the published optimum (+0.71% at 442, +0.33% at 574, +1.05% at 783,
> +2.10% at 1002, +1.45% at 1060). The 2.16% figure at $n=1000$ is a *ceiling* from the 1-tree bound,
> which was pessimistic (on `fl417` it claims 5.64% for an optimal tour). Mature solvers (Concorde,
> Helsgaun's LKH) solve all of these instances to optimality; BGMA was not compared against them.
> This note is the evidence: what the method does, what it costs, and what is and is not proven.

> This document describes the algorithm implemented in this repository at commit
> `4f316ac3cf4a9ac54fc37274ff49c56fea3109ab` (2026-10-20), the commit that added
> the stress harness and the n=400–1000 measurements reported in "Validation and
> measured behaviour". It is intended as a stable, self-contained reference for
> the method, its parameters, its measured behaviour, and the claims that are and
> are not supported by the experiments.

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
increasing polynomial search budgets. The central empirical finding: BGMA
reaches the Held–Karp optimum on 26 of 26 checkable instances at $n = 18, 20, 22$
in milliseconds, matches the published optimum on all 9 of 9 TSPLIB instances
through $n = 417$ at `max`, and is **+0.33% to +2.10%** above the published
optimum on the five instances from $n=442$ to $n=1060$. Past 400 the
gap *to the 1-tree bound* also grows with $n$ (+1.59% at 800, +2.16% at 1000; a
ceiling, not the true gap) and the top of the ladder stops paying: at $n=1000$
`max` and `xhigh` return the same tour for 4.5× the runtime.

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

### Stress validation at n=400–1000

Two questions the earlier tables could not answer: does the gap stay flat as n
grows, and does the top of the ladder keep paying? A stress sweep
(`tuning/stress_max.js`) ran `low`…`max` at 400 and the full ladder at 1000, and
`max` at 500/600/800. Every gap below is against a **converged** 1-tree bound
(600 subgradient iterations; re-checked at 6000, which moved the bound by
≤0.002 pp, so these are not iteration-starved).

| n | family | `max` gap ≤ | `max` time | `low` gap ≤ | `low` time |
| --- | --- | --- | --- | --- | --- |
| 400 | uniform | +1.11% | 64 s | +3.70% | 1.3 s |
| 400 | cluster | +0.73% | 91 s* | +3.70% | 1.3 s* |
| 500 | uniform | +1.14% | 147 s | — | — |
| 600 | uniform | +1.33% | 341 s | — | — |
| 800 | uniform | +1.59% | 27 min* | — | — |
| 800 | cluster | +1.48% | 24 min* | — | — |
| 1000 | uniform | +2.16% | 72 min* | +3.72% | 24 s* |
| 1000 | cluster | +2.21% | 79 min* | — | — |

*wall clock with 2–4 runs in flight; upper bounds. The clean sequential points
are n=400 64 s, n=500 147 s, n=600 341 s.

The full ladder at n=1000 (uniform, seed 1) is the decisive row:

| level | tour | gap ≤ bound | time | return on the previous step |
| --- | --- | --- | --- | --- |
| `low` | 2209.889 | +3.724% | 24 s | — |
| `mid` | 2195.879 | +3.056% | 123 s | 0.658 pp for 99 s |
| `high` | 2185.421 | +2.567% | 429 s | 0.491 pp for 307 s |
| `xhigh` | 2176.903 | +2.164% | 948 s | 0.400 pp for 519 s |
| `max` | 2176.903 | +2.164% | 72 min | **0.000 pp for 56 min** |

`xhigh` and `max` returned the identical tour. This is structural rather than
unlucky: for n ≥ 80 the two presets share the same beam width (`n/2`) and the
same generation count (`n/8`); what `max` adds is islands (8 vs 6), elite
capacity (`n/2` vs `n/3`), final polish (8 vs 6) and a second restart. At n=1000
none of that improved on the first arm, and the portfolio must cost at least the
sum of its two arms.

The gap also does not stay flat: 1.11% at 400, 1.33% at 600, 1.59% at 800,
2.16% at 1000. The certificate is converged at every one of those sizes, so the
1-tree bound alone cannot separate genuine tour excess from duality gap. TSPLIB
instances with known optima settle it for those sizes: the true gap is +0.33% at
574, +1.05% at 783 and +2.10% at 1002, i.e. the growth is real tour quality, not
an artefact of the bound.

### Robustness and provable cases

The stress harness also checks correctness, not only quality. Across ~160 runs
at n = 4–1000 over seven families (uniform, clustered, convex position,
collinear, integer grid, duplicated cities, coincident cities), at every effort
level:

- **0 invalid tours, 0 length mismatches, 0 bound violations** (a tour shorter
  than a proven bound would be a bug in one of the two).
- **Deterministic**: three repeats of one seed returned the same length and the
  same tour.
- **Scale-invariant**: coordinates scaled by 10⁻³ and 10⁶ give identical
  relative gaps.
- **Degenerate input survives**: coincident cities (length 0), duplicate points,
  exact ties on an integer grid.
- **Memory**: 367 MB at n = 1000.
- **Provably optimal where a proof exists**: convex position at n = 20, 100,
  200, 400 and 1000 (the hull cycle is optimal for points in convex position); a
  20×20 grid at n = 400 (400 against a bound of 400, so the CLI prints
  `PROVEN OPTIMAL`); collinear sets at every size tested.

The counterpart is that the *bound* is not uniformly tight. On a collinear
instance at n=400 the tour is provably optimal while the 1-tree bound is 69.2%
below it (28–37% at n=100), because the relaxation cannot express the degree
structure of a line. A reported gap is therefore an upper bound on the true gap,
and its tightness depends on the instance geometry — not only on how good the
tour is.

**What the certificate is, and is not.** The 1-tree is a *relaxation*, not a
candidate tour: the minimum spanning tree on V \ {root} plus the two cheapest
edges at the root. Every Hamiltonian cycle contains such an object (cut one edge
at the root), so its length is at most the length of every tour. A bound shorter
than the best tour is therefore a theorem, not a bug; the degree violations
marked in the demo are the relaxation leaking, and no tour can have them.
Equality is the exceptional case: it proves optimality, which is why the CLI
prints `PROVEN OPTIMAL` when it happens (a 20x20 grid at n=400, convex position
at n=1000).

The number is deterministic given its budget. There is no randomness in the
ascent: it starts from pi = 0, uses a fixed step rule, and only keeps a 1-tree
when it is longer than the previous best, so it is monotone in the iteration
count. The budget matters, though. At n=100, 50 iterations give 602.2 against a
converged 687.5, which would report a 36% gap instead of 19%; the stress harness
uses 600, and a 6000-iteration re-check moves the n=1000 bound by 0.002 pp. The
demo uses 400 iterations, which is converged at n=30 (404.57 against 404.64 at
800). The step size also takes an upper bound as input, so passing each level's
own tour made one instance report bounds differing by up to ~0.02 pp; the
parallel harness now computes one certificate per instance from the shortest
tour across all levels, so every level is measured against the same number.

The bound is valid but not uniformly tight, and the tightness depends on
geometry, not on the solver: at n<=22 it is 0-0.6% below the exact Held-Karp
optimum and never above it in 18/18 checks; on a collinear instance at n=400 it
is 69% below a provably optimal tour. A reported gap is a ceiling on the true
gap, not a measurement of it.

### The true gap: TSPLIB optima

A ceiling is only as useful as its slack, so the same `max` run was scored against
published TSPLIB optima instead. `tuning/tsplib_bench.js` parses `NODE_COORD_SECTION`,
rounds each distance the way `EUC_2D` defines it ($\mathrm{nint}(\sqrt{\Delta x^2+\Delta y^2})$),
builds the instance from those integers, runs the requested levels through the worker
pool, and rejects any tour that is not a permutation or whose length does not
recompute from the matrix. All runs below are `max`, seed 1, 600-iteration
certificate.

| instance | n | optimum | `max` tour | true gap | bound ceiling | bound below OPT |
|---|---:|---:|---:|---:|---:|---:|
| eil51 | 51 | 426 | 426 | 0.000% | +0.829% | 0.823% |
| berlin52 | 52 | 7542 | 7542 | 0.000% | +0.000% | 0.000% |
| st70 | 70 | 675 | 675 | 0.000% | +0.596% | 0.593% |
| kroA100 | 100 | 21282 | 21282 | 0.000% | +1.650% | 1.624% |
| pr124 | 124 | 59030 | 59030 | 0.000% | +1.658% | 1.631% |
| bier127 | 127 | 118282 | 118282 | 0.000% | +0.725% | 0.720% |
| ch130 | 130 | 6110 | 6110 | 0.000% | +0.568% | 0.565% |
| tsp225 | 225 | 3916 | 3916 | 0.000% | +0.982% | 0.973% |
| fl417 | 417 | 11861 | 11861 | 0.000% | +5.639% | 5.338% |
| pcb442 | 442 | 50778 | 51136 | +0.705% | +1.282% | 0.570% |
| u574 | 574 | 36905 | 37028 | +0.333% | +0.864% | 0.526% |
| rat783 | 783 | 8806 | 8898 | +1.045% | +1.430% | 0.380% |
| pr1002 | 1002 | 259045 | 264473 | +2.095% | +3.018% | 0.896% |
| u1060 | 1060 | 224094 | 227345 | +1.451% | +2.327% | 0.856% |

What this changes:

1. **The certificate cannot rank instances or algorithms.** `fl417` is optimal
   while its bound claims 5.64%; `berlin52`'s bound is exact. The ceiling
   overstates the true gap by 0.00–5.34 pp across this set, and that slack is a
   property of the geometry. A bound gap is only comparable within one instance.
2. **The large-n excess over the optimum is real.** Everything through n=417 is
   solved exactly; then +0.71% at 442, +0.33% at 574, +1.05% at 783, +2.10% at
   1002 and +1.45% at 1060. Structure matters as much as size: `fl417` is exact
   at a size where `pcb442` is 0.71% long.
3. **The old "+2.16% at n=1000" was a ceiling that happened to land near the
   `pr1002` truth (+2.10%)** — on that instance the ceiling was +3.02%, and on
   `u1060` +2.33% against a true +1.45%. Any future claim about tour quality
   should quote the true gap, not the bound gap.

The arms also show the portfolio doing its job: on `pr1002` the three units
returned +2.165% (`xhigh`), +2.095% and +2.263%, and `max` takes the best; on
`u1060` they returned +1.955%, +1.901% and +1.451%.

### Measured runtime

All numbers below come from `bench/runtime_bench.js`, which loads every solver from
the project files and times only the solve (wall clock, `process.hrtime`). Each cell
is the median over 4 instances (2 seeds x uniform/cluster) on Apple M3 Pro,
Node v22.23.2, measured 2026-10-19. The raw results are in `docs/runtime.json`.

*Median wall time per instance. The last column is the empirical exponent $k$ in the growth $t \propto n^k$ between n=20 and n=400.*

The exponent is not stable in $n$. Clean sequential runs at n=400, 500 and 600
give 64.1 s, 147.2 s and 341.1 s, i.e. $k = 3.73$ then $4.61$; the fitted
2.0–2.3 above is dominated by the cheap small-n cells. This is expected from the
ladder: `gens` grows like $n/8$ and `polish` is at least `children`, so every
child is base-polished every generation — $\Theta(n^3)$ to $\Theta(n^4)$. At
n=1000 the measured wall clock is 72 min (uniform) and 79 min (cluster) under
concurrency; `low` at the same size takes 24 s.

### Parallel execution

`runEffort('max')` is a portfolio of three **independent, deterministic**
hybrid runs — the `xhigh` arm and the two `max` restarts — and it returns the
shortest. Because each unit is exactly the call `hybridOnce` would have made
with the same seed, distributing them over threads cannot change the result;
it only changes the wall clock. `tuning/stress_parallel.js` does this with
`worker_threads`, and also spreads independent levels, seeds and families over
the pool. Workers rebuild the instance from its point list, so the only data
crossing a thread boundary is the points and the finished tour.

| workload | serial | parallel | speedup |
| --- | --- | --- | --- |
| n=100, 3 families x 5 levels x 2 seeds (30 rows) | 12.1 s | 2.2 s (6 jobs) | 5.5x |
| n=400, uniform+cluster, `max` (2 rows) | 131.9 s | 23.3 s (6 jobs) | 5.7x |
| n=1000, uniform, `max` (1 row) | 3445 s | 19.5 min (3 jobs) | 2.94x |

The single-row case is bounded by its longest unit (one `max` restart). End to
end, the n=1000 row went from 72 minutes to 19.5 minutes (3.7x) and returned
the identical tour, 2176.903, gap +2.164%. A five-level, two-family sweep at
n=1000 is 14 units with very different costs (`low` 24 s, one `max` restart
about 20 min); the pool balances them as workers free up, so 10 rows cost about
half an hour instead of 2.8 hours, roughly 6x. Correctness is checked against
the serial harness: 30/30 rows matched to the last digit, on both synthetic and
explicit-point families.

Profiling also removed two allocation hot spots. `refineBase` and `orOptFast`
allocated an O(n) array per scan position (and per segment length) inside an
O(n^2) loop; both now use reused typed-array scratch with the same scan order
and the same first-improvement rule, so the output is bit-identical. The local
search is 1.37x faster, verified on 60 A/B cases from n=20 to 1000.

GPU acceleration is not applicable to this kernel: 2-opt is sequential (each
accepted move rewrites the tour in place and invalidates the positions the next
comparison reads), its memory access is irregular and pointer-chasing, and Node
has no native WebGPU compute. The parallel dimension that does exist is
independent runs, which is what the pool uses. The remaining lever is
algorithmic: a stronger local search (3-opt / Lin-Kernighan) that reaches the
same quality in fewer generations.

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

Reproduce with `node bench/runtime_bench.js --json=docs/runtime.json --web=docs/runtime_data.js`
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
  Returns per second diminish quickly past `high`, and at n=1000 the final step returns
  nothing at all (`xhigh` and `max` return the same tour; see "Stress validation").
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
  The tuned ladder in [TSP_NOTES.md](TSP_NOTES.md) §4.3 replaces that cap with `c*n^2`
  budgets and independent restarts: its median gap to the 1-tree bound at n=50–300 is
  +1.55% / +1.49% / +1.35% / +1.08% / +1.02% for `low`→`max`, whereas the fixed cap is
  +23.95% at n=300 and +35% against the best tour at n=400.
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

The visual page (`docs/hybrid_tsp.html`) is written as a pitch: a claim, three numbers that back it,
then the demo. Every sentence on it maps to a table in this note. If a claim is not in this table,
the project does not claim it.

| claim on the page | evidence | reproduce |
| --- | --- | --- |
| “9 / 9 TSPLIB ≤ 417” (`35 / 40` known optima overall) | exact checks: 10 + 10 + 6 instances at n = 18, 20, 22, at every effort level; plus 9 of 9 TSPLIB instances up to n = 417 (`eil51` through `fl417`) against published optima, `max` only, one run each | `tuning/validate_effort.js --ns=18,20,22`; `tuning/tsplib_bench.js --file=fl417.tsp --opt=11861 --levels=max` |
| “+0.33–2.10%” at n = 442–1060 | TSPLIB published optima above n = 400: +0.71% (`pcb442`), +0.33% (`u574`), +1.05% (`rat783`), +1.45% (`u1060`), +2.10% (`pr1002`) | `tuning/tsplib_bench.js --file=rat783.tsp --opt=8806 --levels=max` |
| “1.4 ms at n = 20” | 1.4 ms (`low`) against 302 ms for the Held–Karp dynamic program, same tour on these instances | runtime table, n=20 row |
| “+1.13% of the proven bound at 400 cities, +2.16% at 1000” | large-n check: `max` +1.13% at 400; stress sweep `max` +2.16% at 1000 against a bound converged to 6000 iterations. These are **ceilings**: on `pr1002` the same bound was +3.02% against a true +2.10% | `--n=400 --effort=max --bound=1`; `tuning/stress_max.js --ns=1000 --families=uniform --levels=max` |
| “Provably optimal at 1000 cities on instances with a known optimum” | convex-position family: hull cycle is optimal by construction; `max` returns it at n=20, 100, 200, 400, 1000 | `tuning/stress_max.js --ns=1000 --families=convex` |
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
- The 1-tree bound is proven but loose, and how loose depends on the geometry.
  At n=80–200 the best tours plateau roughly 0.5–1.2% above it; at n=1000 the gap
  to it is 2.16%. On a collinear instance at n=400 the tour is provably optimal
  while the bound is 69% below it, and on `fl417` the tour is optimal while the
  bound claims 5.64%. Published optima show the large-n residual is real:
  +2.10% on `pr1002` and +1.45% on `u1060`. So on synthetic families the bound
  gap is an upper bound, and on TSPLIB the true gap is measured directly.
- **"Effort max is optimal" is not a provable claim in the strong sense.** The
  ladder is polynomial-time by construction, so a theorem that it always
  returns an optimal tour would imply P = NP. The demonstrable statement is
  weaker: `max` is never worse than `xhigh` on the same instance, because the
  CLI runs `xhigh` and keeps the shorter of the two (`runEffort`). Every other
  step of the ladder is empirical, and the stress sweep found a case where a
  cheaper level beat a more expensive one (at n=200, `high` +0.010% against
  `xhigh` +0.062%), so monotonicity in effort does not hold in general.
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

# stress: validity, known-optimum families, and the 1-tree bound at scale
node tuning/stress_max.js --ns=400 --families=convex,line,grid,dup --levels=low,max
node tuning/stress_max.js --ns=1000 --families=uniform,cluster --levels=max --boundIters=600
node tuning/stress_max.js --ns=1000 --families=uniform --levels=low,mid,high,xhigh

# the same, spread over worker threads (result-identical, ~2.6x on one max row,
# ~12x on a ten-row 1000-city sweep)
node tuning/stress_parallel.js --ns=1000 --families=uniform,cluster \
  --levels=low,mid,high,xhigh,max --jobs=6

# true gap: score a run against a published TSPLIB optimum instead of a bound.
# EUC_2D distances are rounded, and every tour is validated before it is scored.
node tuning/tsplib_bench.js --file=pr1002.tsp --opt=259045 --levels=max --jobs=3
node tuning/tsplib_bench.js --file=eil51.tsp  --opt=426    --levels=low,mid,high,xhigh,max
node tuning/tsplib_bench.js --file=pr1002.tsp --opt=259045 --check   # certificate only

# open the interactive demo (claim, evidence, effort dial, Held–Karp comparison)
python3 -m http.server 8000
# then open http://127.0.0.1:8000/docs/hybrid_tsp.html
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
| `docs/hybrid_tsp.html` | interactive demo and pitch page: claim + evidence, exact optimum vs BGMA, effort dial, timeline |
| `tuning/tune_effort.js` | knob sweep and quality/runtime harness |
| `tuning/validate_effort.js` | Held–Karp validation at n≤22 |
| `tuning/tsplib_bench.js` | true-gap bench: parses TSPLIB `EUC_2D`, rounds distances, validates tours, scores against published optima |
| `tuning/families.js` | synthetic instance families shared by `stress_max.js` and `stress_parallel.js` |
| `src/hybrid/instance.js`, `src/hybrid/pool.js`, `src/hybrid/unit_runner.js` | instance rebuilding, worker pool, worker entry point |
| `TSP_NOTES.md` | full project notes and earlier benchmarks |
| `TUNING_NOTES.md` | tuning observations and future work |
| `bench/runtime_bench.js` | runtime and quality of every algorithm; source of `docs/runtime.json` |
| `docs/runtime_table.js` | renders the measured-runtime table in both visualizer pages |
| `docs/js/` | generated mirror of `src/hybrid/{effort_profiles,hybrid_vis}.js`, so Pages (which serves only `docs/`) can load the demo |
| `bench/sync_docs.js` | writes that mirror; `--check` fails when it is stale |

The Node core loads `src/beam/beam_fast.js` and `src/nature/nature_tsp.js` by slicing the source and
evaluating the algorithm portion. This keeps the browser page and the CLI on the
same implementation while avoiding a build step. The browser core
(`src/hybrid/hybrid_vis.js`) mirrors the pipeline for animation and uses demo-capped
budgets so a `max` run stays watchable; it is not the exact Node code path.

## Limitations and future work

- **Tighter bounds.** The 1-tree certificate is loose in a geometry-dependent way
  (0.00–5.34 pp on the TSPLIB set below; 69% on a collinear instance), so it
  cannot rank instances. Published optima settle the true gap wherever they
  exist (9/14 exact, +2.10% at n=1002), but the synthetic families still have no
  tight reference. A stronger Lagrangian (degree constraints), an assignment
  bound, DFJ cuts, or exact branch-and-bound would close that hole — and the
  TSPLIB runs show the residual is real search quality, not only certificate
  slack.
- **Early exit on a certificate.** When the tour length equals the bound the
  search can stop. On the 20×20 grid at n=400 that saves 51 s of the 51 s it
  spends; on the convex n=1000 instance it saves the full 23 minutes. This is a
  pure win and needs no quality trade-off.
- **Make effort mean restarts.** `max` is a two-arm portfolio; the arms
  collapse to the same beam width and generation count for n ≥ 80, and at
  n=1000 they returned the same tour for 4.5× the cost. Defining effort as
  independent restarts (or as a portfolio over presets) gives a provable
  non-regression property, which the current ladder does not have: at n=200 a
  cheaper level (`high`) beat a more expensive one (`xhigh`) by 0.052 pp.
- **EAX / AB-cycle recombination.** ERX is simple; EAX is the natural next
  recombination operator with a demonstrated literature upside.
- **Parallelism.** Islands, children, and polish calls are independent. The
  worker pool in `src/hybrid/pool.js` already turns the `max` portfolio into a
  cores× speedup without changing the result (2.9–3.0× on three units), but the
  remaining serial cost inside each unit is still the wall-clock floor at n≈1000.
  Parallelising generations or the polish pass would be the next step.
- **Held-out and real-instance validation.** Re-run the ladder on unseen seeds,
  TSPLIB, and the CSV dataset. The stress sweep covers seven synthetic
  families; real road networks are not among them, and the bound's tightness is
  geometry-dependent (69% loose on collinear points).
- **Adaptive budgets.** The current ladder is one Pareto curve. A small model of
  quality vs (K, gens, children, polish, n) could choose a budget from a wall
  clock or a target gap — and the n=1000 ladder says the curve flattens after
  `xhigh`, so the model has an interior optimum to find.
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
| snapshot commit | `4f316ac3cf4a9ac54fc37274ff49c56fea3109ab` (stress harness + n=400–1000 data) |
| snapshot date | 2026-10-20 |
| document date | 2026-10-20 |
| scope | algorithm description, parameters, validation (n=4–1000), demo-claim audit, reproduction |
| language | Markdown |
| license | MIT (see `LICENSE`) |

<!-- End of archival note. If this document is exported, keep the commit hash and the
"what is proven" section with the export; they are part of the provenance. -->
