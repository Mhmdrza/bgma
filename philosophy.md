# What BGMA actually is

Notes on the shape of the hybrid solver (`src/hybrid/bgma.js`, `src/hybrid/hybrid_tsp.js`) and
on which natural / algorithmic phenomena it resembles.

## The naive model, and why it is only half right

Stated plainly: *the algorithm expands and opens the possibilities, then collapses them into the
answer.* Both verbs are present, but they are **nested and front-loaded**, not two sequential
phases.

| expand | collapse |
|---|---|
| beam branching (`lag<=3` ranks + `extraRank=2`, `maxBranch=4`) — `src/beam/beam_fast.js:666-700` | beam top-K cut (`created.sort(AF)` then `slice(0,K)`), same loop, **per step** |
| `doubleBridge` kick (`kickRate`) | `rebuild()`: cycle-dedupe, sort by length, `slice(elites)` — `bgma.js:188-196` |
| `NAT.anneal` uphill acceptance + avulsion reheat | `refineBase` polish (2-opt + Or-opt to local optimum) |
| inject a fresh island on stagnation | `best = pool[0]` — the answer *is* the truncation survivor |
| `restarts`, `finalPolish` | the elite cut is hard: a dropped cycle never returns except via `inject` |

Inside the beam, expand then collapse happens *n times per island*, not once per run.

## Measured (n=200, uniform, seed 2)

Edge-universe instrumentation (every tour that passes `refineFast` / `refineBase` contributes its
undirected edges to a global set):

```
stage      calls   new-edge additions   avg new/call
beamFinal     83                  472            5.7
child         40                   24            0.6
polish        42                    0            0.0

distinct undirected edges ever seen: 496
edges in answer: 200, of which never seen before final polish: 0
```

- **95% of the possibility space is opened by the initial beam islands.** ERX cannot add an edge
  at all (it is a union of the two parents' edge sets); only double-bridge and `inject` create new
  ones, and together they contribute 5%.
- **Polish adds zero new edges.** Local search only rearranges inside the sampled universe.
- Union timeline: 200 -> 458 during the beam phase, 464 -> 496 across all six generations. Flat tail.

Cost, same instance (311 ms total): `beamFast` 24%, `refineFast` 34%, `refineBase` 33% — the
collapse machinery dominates runtime.

Value, 18 instances (n = 100/200/300, uniform + cluster, 3 seeds):

| variant | mean length | delta vs beam-only |
|---|---|---|
| beam islands + fast screen only | 796.89 | — |
| `gens:0` (adds initial polish) | 791.22 | -0.71% |
| full (gens 6) | 780.39 | -2.07% |
| gens 12 | 778.14 | -2.35% |

Generations 6 -> 12 buy 0.29%. Ablation at n=60 (`experiments/bgma_ablate.js mid 60`): `no-kick`
+0.08%, `no-anneal` +0.005%, `no-inject` -0.05%, `no-polish` -0.03% — all noise at that size.

**Correct statement:** one wide expansion, then repeated contraction with ~5% local re-expansion,
on a fixed candidate edge universe — i.e. *iterated beam search with a hard elitist truncation
operator and a short anneal kernel*. "Collapse" is selection, not resolution: nothing is certified,
nothing is narrowed by deduction, discarded alternatives are lost permanently. That is why
`no-inject` costs nothing — the expansion that mattered already happened in step 1.

## Two kinds of expand, two kinds of collapse

"Expand/collapse" conflates two mechanisms each:

| | expands by | collapses by |
|---|---|---|
| **search-expand** | enumerating discrete alternatives (branch, mutate, recombine) | **selection**: irreversible cut, information destroyed |
| **entropy-expand** | raising temperature / entropy / noise | **energy**: funnel descent, structure forms itself |

BGMA = **search-expand -> selection-collapse -> energy-collapse**. The selection cuts first; the
energy descent only runs on survivors.

## Analogues, ranked by how much transfers

| phenomenon | expands | collapses | fidelity to BGMA |
|---|---|---|---|
| **Simulated annealing** (metallurgy; Kirkpatrick) | high T, atoms roam | cooling to a low-energy lattice | high — `T *= 0.99998` is literally this; avulsion = reheat |
| **Clonal selection / affinity maturation** | somatic hypermutation | selection of high-affinity B cells | high — mutate, select, expand winners is the `gens` loop |
| **Genetic algorithm** | crossover + mutation | truncation selection | trivially high — memetic = GA + local search |
| **Crystallization / nucleation** | supersaturated solution explores | nucleus forms, then growth | medium — the nucleus is the few beam finals that seed everything |
| **Protein folding funnel** | denatured chain explores conformations | funnel narrows to native state | medium — `polish` is funnel descent, with no re-expansion |
| **Ant colony optimization** | ants explore | pheromone concentration | medium — but ACO's memory is per edge, BGMA's per tour |
| **MCTS / PUCT** | tree expansion | UCT selection + backup | medium-high algorithm sibling; interleaved per node, not phased |

### Big Bang — holds for the annealer, not the algorithm

Expansion plus cooling is real (inflation, then adiabatic cooling), and structure formation
genuinely *is* gravitational collapse, so "expand then collapse" describes the universe correctly.

Where it breaks:

- No objective. The universe does not select the shortest tour; it has no `best`.
- Cosmological expansion **accelerates** (dark energy); BGMA's exploration decays monotonically —
  `T` only falls and `annealRate` never rises. Opposite sign.
- No elitist truncation: nothing is irreversibly discarded at each step, structures persist.
- The universe produces many structures; BGMA's answer is `pool[0]`, one tour. `restarts` is closer
  to **replica symmetry breaking** in spin glasses than to cosmology.
- The honest mapping is local only: beam islands ~ primordial fluctuations, avulsion ~ late
  reheating, `T` schedule ~ cooling.

### AI token inference — shares the collapse operator, lacks the re-expansion

| decoding | BGMA |
|---|---|
| logits over the vocabulary | `cand` from `lag` / `extraRank` ranks (`maxBranch=4` ~ top-4 logits) |
| per-step top-K cut | `created.sort(AF).slice(0,K)` — same operator, same place in the loop |
| length-normalized score | `AF = len + D[city][start]` (tour cost + return home) |
| temperature T | `NAT.anneal` T — **inverted role**: sampling T flattens (expands), anneal T cools (collapses) |
| top-p / nucleus | `elites` cut — but BGMA cuts on count, not probability mass |
| — | `rebuild()` cycle-dedupe: no decoding analogue, tours are unordered cycles |
| — | `inject` on stagnation: decoding never restarts from a random prefix |
| — | elitist pool across generations: decoding keeps no archive |

LLM inference is BGMA's beam step **frozen at one sweep**: no generations, no polish, no archive.
It expands once per token and collapses once, then commits and never looks back. BGMA re-expands
six times on a pool it never abandons.

Closer AI siblings than plain autoregressive inference:

- **MCTS / PUCT** — expand/select/backup per node; same interleaving, plus a hard budget.
- **Speculative decoding** — draft-expand, then verify-collapse with rejection; the only common
  decoding scheme with a genuine two-phase split.
- **Diffusion / score-based sampling** — entropy-expand (forward noising), then anneal-collapse
  (reverse denoising). The cleanest "expand then collapse" in modern ML, but it optimizes nothing:
  it samples.
- **Quantum annealing / QAOA** — superposition explore, measurement collapse. True to the phrase,
  but BGMA has no amplitudes, no interference, and its collapse is deterministic.

## What the analogy predicts

BGMA opens 95% of its possibility space in step 1 and only re-opens through `inject`; the elite cut
throws cycles away permanently. Phenomena whose expand/collapse rounds alternate productively keep
memory between rounds:

- **ACO** — store credit per *edge*, not per tour, so dropped tours still contribute.
- **Clonal selection** — keep diversity explicitly, instead of length-only truncation.
- **Diffusion** — allow the schedule to reverse: on a stalled generation, re-raise `T` rather than
  only injecting a fresh island.

## Caveats

Edge numbers are one instance, one seed. Beam's 95% share is partly volume (83 screened tours vs 40
children), but per-call yield survives normalization: 5.7 vs 0.6 vs 0.0 new edges per call.
