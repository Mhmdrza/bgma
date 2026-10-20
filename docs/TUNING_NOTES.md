# Knob tuning — observations and future work

Last run: 2026-10-19. Harness: `tuning/tune_knobs.js` (built on `src/beam/beam_fast.js` + `docs/nature_tsp.html`).
This file records what the sweeps actually showed, why `--preset=tuned` looks the way it
does, and which directions are worth trying next.

---

## 1. Method and caveats

- **Instances:** synthetic `uniform` / `cluster`, n = 40, 75, 100, 150, 200, 300, 400,
  2 seeds per family. 28 instances in the final run.
- **Reference:** best result produced by *any* method on that instance (greedy, greedy best
  start, nature-pop, nature, 16 random starts + tunnel, 16 random starts + merge, and all
  beam configs). The winner is therefore 0%, not "optimal".
- **Metrics:** median / mean / worst percentage gap, win count, median wall time.
- **Caveat 1:** this is not a true optimality gap. Held–Karp is only practical to n≈22, and
  the 1-tree bound was not used in the sweep.
- **Caveat 2:** the preset was selected on the same n/seeds that were then measured
  (in-sample). A held-out seed set (e.g. seeds 3–4) is still needed before treating
  `--preset=tuned` as a general default.
- **Caveat 3:** two synthetic point families only. TSPLIB/CSV instances were used as sanity
  checks (fri26 / dantzig42 / att48 remain optimal), not as tuning data.

---

## 2. The final rule

```bash
node src/beam/beam_fast.js --n=200 --preset=tuned
```

Expanded:

```bash
--K='max(16,n/3)' --near='max(10,n/10)' --refineF=n \
--oroptMaxL=5 --restarts=4 --tunnelMode=base
```

| knob | value | why it survived |
|---|---|---|
| beam width `K` | `max(16,n/3)` | `n/2` and `n` were worse at n=100; `n/3` was the best single growth rule across 40–400 |
| tunnel candidates `near` | `max(10,n/10)` | `n/10` alone gives 5–6 at small n and loses 1–2%; floor 10 fixes it |
| finals tunnelled `refineF` | `n` (= all) | with K≈n/3, refining only 16 wastes most of the beam |
| Or-opt length | 5 | small gain over 3; clearest at n=200 in base mode (1.40% vs 2.04%) |
| restarts | 4 | diversity gain larger than any beam-width increase at similar cost |
| tunnel mode | `base` | full-restart 2-opt+Or-opt dominates the candidate-list tunnel on final quality |

Final 28-instance result: **median +0.00%, mean +0.13%, worst +0.98%, 17/28 wins**.
Per-n medians: 0.00 / 0.12 / 0.28 / 0.14 / 0.01 / 0.00 / 0.00 %.

For comparison, the best non-beam heuristics were 16 random starts + merge (+0.35%
median) and nature (+0.66%). Nature degraded to +19.9% at n=300 and +51.0% at n=400 with
its fixed `M=48` / 120k-iteration budget.

---

## 3. What the sweeps showed

### 3.1 Beam width is not monotone

At n=100, `K=16` beat `K=n/3`, `K=n/2`, and `K=n` (median +1.33% vs +2.56 / +3.54 /
+3.47). At n=200 the ordering flipped: `K=n/2 + score=all` was the best beam config
(+0.94) while `K=16` was +4.93. Reasons:

- the beam score is a hard top-K cut over `len + d(last, start)`; a wider beam keeps more
  low-`f` states that are not actually good completions;
- with `refineF=16` a wider beam just spends more beam time and leaves most finals
  unrefined;
- wider beams also change the dedupe/selection dynamics, so the K=16 survivor set is not a
  subset of the K=n set at the next step.

**Implication:** `K` should grow with n, but slower than linearly, and must be paired with
`refineF=all`. `n/3` is a robust compromise; per-instance adaptive K could do better.

### 3.2 The tunnel, not the beam, was the main quality lever

Changing `tunnelMode` from `fast` to `base` (full restart after every accepted move,
full scan) reduced the overall median from ~1.3–1.5% to ~0.8% on the 50/100/200 set, and
from ~2.2% to ~1.4% at n=200. The biggest single jump came from **base tunnel + restarts**
together, not from K.

The fast tunnel is a candidate-list first-improvement search with don't-look bits; it
reaches a weaker local optimum, especially when the candidate list is narrow. That is the
intended speed trade, but it means beam quality tuning cannot compensate for it.

### 3.3 More finals refined > wider beam

`refineF=n` (all finals) is effectively free quality once K is modest, and it makes
`K=n/3` worthwhile. With `refineF=16`, `K=n` and `K=n/2` looked artificially bad at n=200
because most of the extra finals were never tunnelled.

### 3.4 Diversity via independent restarts beats widening one wave

- `--starts=random --startCount=4` (four random poles inside one beam wave): bad (+2.56
  median). The beam wave cuts across starts and each start gets a small share of K.
- `--restarts=4` (four independent beam runs, best tour wins): large gain. At n=200,
  `K=n/3 + restarts=4 + base tunnel` reached +0.01%, versus +0.68% for the same beam with
  the fast tunnel, and +4.93% for the plain K=16 fast tunnel.
- More restarts keep helping, but sub-linearly: 4 → 8 improved some sizes and hurt others;
  16 was not consistently better than 8, and all restarts are a linear time multiplier.

**Implication:** keep the beam as a per-start search; add diversity at the restart level.

### 3.5 Full-restart tunnel vs candidate-list tunnel

`tunnelMode=base` is roughly 2–4× slower than the fast-tunnel/8-restart variant at n≥150
but clearly better on final tour length. The cost comes from restarting the full scan
after *every* accepted move and doing that for every final of every restart. At n=400 the
tuned rule takes ~5–7 s per instance versus ~1.4–1.9 s for the fast variant.

If the whole final set is tunnelled with base mode, most of that time is spent on finals
that cannot win. A hybrid — fast-tunnel everything, then base-tunnel only the top few —
is the obvious next optimization (see §5).

### 3.6 `score=all` (MST bound) is a beam prior, not a final-quality fix

- It dramatically improves the raw beam at small/medium n (n=40: +38% → +3.4% beam-only).
- With tunnelling, its advantage mostly disappears.
- It costs O(n²) per candidate. At n=200 with K=n/2 it was ~2.4 s per instance.
- Interaction with K is strong: `score=all` at K=16 was worse than `score=visited` at
  n=100 (+2.80 vs +1.33), but at K=n/2 it was the best beam at n=200 (+0.94).

**Implication:** the MST score is a useful research knob and a good prior for small n, but
it is not part of the practical all-n preset unless the MST can be evaluated incrementally.

### 3.7 `near` has a floor

`near=n/10` gives 4–6 candidates at n=40–75 and loses 1–2%. `near=10` is a safe floor.
`near=n` (full candidate list) never paid for itself; it makes the fast tunnel approach
full 2-opt but is much slower and still weaker than `tunnelMode=base` with a modest list.

### 3.8 Branch shape and pass count are already fine

- `lag=4`, `extraRank=3`, `maxBranch=6`: worse (+2.17 median). The 3-city / rank-1-2-3
  vote plus rank-2 of the current city is a strong default.
- `passes=3`: no change over `passes=2` in fast mode; the local search is already at a
  local optimum after two rounds.
- `parity=1`: modest gain in fast mode, irrelevant in base mode (`refineBase` always does
  the full sweeps).
- `oroptMaxL=5`: small, consistent gain; larger values were not swept systematically.

### 3.9 Merging tours is a small effect

Edge-vote assembly of tunnelled finals ("merge") gave little on top of taking the best
tour: 16-random merge vs 16-random best was +0.35 vs +0.37 median overall, and beam+merge
was nearly identical to beam+best. It sometimes helps on a single instance, but it is not
a reliable lever. This matches the earlier merge study: raw finals are too correlated, and
edge voting on tunnelled finals only buys ~1%.

### 3.10 Nature is budget-limited, not universally best

The earlier note "nature is best at n≥100" holds only for small/medium n with the default
budget. With `M=48` and `min(120k, 1500+45n²)` iterations, nature is excellent at n≤200
and collapses at n=300–400 (+19.9% / +51.0% median). A fair comparison at large n needs
scaled M/iterations, which would make it far slower. Any "beat nature" claim should state
the budget.

### 3.11 Greedy is not competitive

Best-of-all-starts greedy is still +15.6% median and +22.2% worst. Greedy is useful only as
a fast starting tour for tunnel/anneal, not as a quality baseline.

### 3.12 Time scaling

The tuned rule's median time is ~68 ms at n=200 and ~5–7 s at n=400 per instance. The
dominant term is the tunnel (`moves × n²`, measured near n^2.8 historically), multiplied by
the number of finals and restarts. Beam time is secondary at these sizes. At n≥400 the
quality-first preset is a batch tool, not an interactive one.

---

## 4. Things that did not help

- Widening the beam without also refining all finals and adding diversity.
- Random starts merged into a single beam wave.
- Near-full candidate lists (`near=n`).
- More branching (`lag/extraRank/maxBranch` increases).
- A third 2-opt pass in fast mode.
- `score=all` as a drop-in replacement at small K.
- Edge-vote merging as a primary quality mechanism.
- `K=n` "just in case": at n≤200 it was worse than `K=n/3` more often than not.

---

## 5. Future work / hypotheses

Ranked by expected value:

1. **Hybrid tunnel (cheap screen, expensive polish).** Fast-tunnel all finals, then run the
   base tunnel only on the top 3–8 by fast length. **Implemented in `src/hybrid/hybrid_tsp.js`**: it
   reaches the best-of-all tour in the synthetic sweep while cutting n=400 time from
   ~6.5 s to ~1.2 s. The remaining work is TSPLIB/CSV validation and parameter tuning.
2. **Parallel restarts/finals.** Restarts and finals are independent. One worker per
   restart (or per final) turns the 4× cost into a cores× speedup with no quality change.
   This is the cleanest way to keep the quality-first preset practical.
3. **Incremental or tighter beam bound.** The MST score helps the beam but is O(n²) per
   candidate. An incrementally maintained MST, a 1-tree/assignment bound, or a cheaper
   "two nearest unvisited" prior could make `score=all` affordable at large n. A tighter
   bound could also make wide beams unnecessary.
4. **Diversity-preserving selection.** The hard top-K cut destroys per-start diversity.
   Stratified top-K (keep the best `K/R` per restart), soft/weighted selection like the
   nature model, or a distance-based dedupe could make a single wide beam behave like the
   restart portfolio at lower cost.
5. **EAX / AB-cycle recombination.** Edge-vote merging is weak. Recombining tunnelled local
   optima with EAX (or an AB-cycle repair) is the one mixing operator with a demonstrated
   literature upside, and the earlier notes already flag it as the main open thread.
6. **Adaptive K and restart count by n and budget.** The current rule is a single Pareto
   point. A small model of quality-vs-(K, restarts, n) could choose K and R from a time
   budget. Also worth checking whether `K=n/2` + more restarts dominates `K=n/3` for
   n≥300.
7. **Held-out and real-instance validation.** Re-run the final rule on unseen seeds,
   TSPLIB, and the CSV dataset. Measure true optimality gaps for n≤22 with Held–Karp and
   1-tree bounds for n≤60. The current +0.13% mean is relative to the best method in the
   pool, not to the optimum.
8. **Full local-search upgrade.** Or-opt length >5, 3-opt/LK-style moves, or a proper
   neighbor-list 2-opt with segment insertion. The base tunnel is deliberately simple;
   a stronger local search may beat the restart multiplier.
9. **Early stopping across restarts.** If two restarts converge to the same tour, stop or
   skip duplicate finals. Cheap and directly attacks the runtime cost.
10. **Scale study.** Add n=600/800 with the fast tunnel and a capped number of finals to
    see where the quality-first rule stops being viable.

---

## 6. Reproduction

```bash
# the swept engine
node tuning/tune_knobs.js --ns=40,75,100,150,200,300,400 --seeds=2

# final head-to-head (writes per-instance CSV)
node tuning/tune_knobs.js --ns=40,75,100,150,200,300,400 --seeds=2 --only=FINAL --out=tune.csv

# the tuned solver
node src/beam/beam_fast.js --n=200 --preset=tuned
node src/beam/beam_fast.js --n=400 --preset=tuned

# faster, slightly weaker alternative
node src/beam/beam_fast.js --n=200 --K='max(16,n/3)' --near='max(10,n/10)' --refineF=n \
  --oroptMaxL=5 --restarts=8 --parity=1 --tunnelMode=fast
```

---

## 7. Effort levels for the hybrid (`src/hybrid/hybrid_effort.js`)

Last run: 2026-10-20. Harness: `tuning/tune_effort.js` / `src/hybrid/hybrid_effort.js`, built on `src/hybrid/bgma.js`.

### 7.1 Method

- **Sweep instances:** n = 40, 80, 150, 200; 2 seeds × uniform/cluster (16 instances for the
  ladder, 12 for the final n=80/150/200 table). Large-n check: n = 300, 400; 1 seed ×
  uniform/cluster.
- **Reference:** best tour produced by any tested configuration or the tuned beam on that
  instance. This is a relative-quality reference, not the optimum.
- **Second reference:** a 1-tree lower bound from `src/hybrid/hybrid_vis.js` (`hkBound`, 600
  subgradient iterations; 400 at n=300/400). The bound is proven but loose, so
  `len/bound - 1` is an *upper bound* on the true optimality gap.
- **Exact check:** `tuning/validate_effort.js` runs Held–Karp at n=18, 20, 22.
- **One-factor sweep:** 33 configurations changing one knob at a time from a base
  (`islands=4, K=n/3, elites=16, gens=6, children=8, polish=4`), plus combined profiles.
- **Caveat:** synthetic instances only; in-sample tuning. Treat the exact n and the ordering
  of levels as robust, and the last 0.1% as noise.

### 7.2 The final ladder

| effort | islands | K | elites | gens | children | polish | final polish | restarts |
|---|---|---|---|---|---|---|---|---|
| low | 2 | max(12,n/4) | max(8,n/20) | max(2,n/50) | 4 | 2 | 0 | 1 |
| mid | 4 | max(16,n/3) | max(16,n/10) | max(4,n/25) | 10 | 6 | 2 | 1 |
| high | 5 | max(20,n/2.5) | max(24,n/6) | max(6,n/15) | 14 | max(6,n/15) | 3 | 1 |
| xhigh | 6 | max(24,n/2) | max(32,n/3) | max(8,n/8) | 18 | max(10,n/10) | 6 | 1 |
| max | 8 (+ xhigh run) | max(32,n/2) | max(48,n/2) | max(10,n/8) | 18 | max(10,n/12) | 8 | 2 |

`max` is deliberately a portfolio: the `xhigh` result and the heavier `max` result are
independent, and the shorter tour wins. That makes `max` monotone over `xhigh` by
construction. It costs the sum of the two runs.

All levels keep the kick / anneal / stagnation-injection machinery; the anneal cap scales
from 8k to 60k iterations and `polishOrOptMaxL` is 5 for low/mid, 6 for high, and 8 for
xhigh/max. Those were not the levers that mattered (see 7.4).

### 7.3 Results

12 instances, n=80/150/200:

| effort | med vs ref | mean vs ref | worst vs ref | med vs bound | med time |
|---|---|---|---|---|---|
| low | +0.99% | +1.07% | +2.50% | +1.89% | 47 ms |
| mid | +0.19% | +0.31% | +0.99% | +1.09% | 161 ms |
| high | +0.01% | +0.13% | +0.50% | +0.87% | 363 ms |
| xhigh | +0.00% | +0.02% | +0.23% | +0.71% | 941 ms |
| max | +0.00% | +0.00% | +0.00% | +0.71% | 2.87 s |

Per-size times at n=200 are roughly 0.1 / 0.3 / 0.8 / 2.3 / 7 s. At n=400 they are
0.6–0.8 / 2.5 / 8.5 / 20 / 63 s. The solver is roughly `n^2.5`–`n^3` in this range once
the pool and polish counts start scaling with n.

### 7.4 Knob findings

**Generations dominate.** `gens=6 → n/5` moved mean gap vs best-of-all from +0.31% to
+0.03% at n=80/150 (2.4× time, worst +1.96% → +0.19%). `gens=n/3` was similar (+0.02%
mean) but a little slower. Beyond `n/5` the curve is flat. This is the knob to spend first.

**Children are the cheapest diversity.** 8 → 24 children: mean +0.21% → +0.06%, worst
+1.96% → +0.30%, time 123 → 189 ms (n=80/150). The reason is structural: every child gets
the fast screen, but only the top `polish` get the full base tunnel, so extra children are
cheap until `children > polish`.

**Polish saturates at ~6.** `polish=6` gave mean +0.05%, worst +0.42%, 10/12 wins, at
almost the same time as `polish=2` (50 vs 47 ms). `polish=8`, `n/10`, and `n/5` were not
better. Once the elite pool is locally optimal, more full restarts do not buy much.

**Elites alone are noise.** With `gens=6, children=8, polish=4`, every elite size from 8
to n landed at mean +0.16–0.24%. `elites=n/3` was the only mild positive (+0.11%). The
`elites=n/2 + gens=n/10` combination is good (mean +0.05%, worst +0.19%, 62 ms), but
`children=24` or `polish=6` gets the same gain more cheaply. Elites matter as *capacity*
for the generation loop, not as a standalone lever.

**Islands and K are secondary.** 2 islands: mean +0.14%; 6: +0.20%; 8: +0.20%; 12: +0.17%
at n=80/150. `K=n/2` and `K=n/2.5` were within noise of `K=n/3`; `K=n` was slower and not
better. Beam width only pays when finals are screened, and screening already fixes most of
the beam's mistakes.

**Annealing is a small, cheap escape.** `anneal=0` gave mean +0.31% / worst +2.12% versus
+0.21% / +1.96% for the base. A 3× larger iteration cap or `annealRate=.6` was within
noise. Keep a short anneal, but do not make it the main scaling knob.

**Restarts are linear cost for sublinear gain.** 2 restarts: mean +0.12%; 4: +0.13% (at
n=80/150), while time doubled and tripled. `gens=n/5` beat both per unit time. The max
portfolio uses a restart plus a different configuration as insurance, not as the main
quality mechanism.

**Or-opt length and final polish are flat.** `oroptMaxL=8/10` and `finalPolish=10` did not
move the median; the base tunnel is already at a strong local optimum. The heavy profiles
spend a little there, but it is not where the gain comes from.

### 7.5 How close is "max" to optimal?

- n=18/20: **20/20 instances optimal for every effort level**, including `low`.
- n=22: **6/6 optimal for every level** (Held–Karp ~1.3–1.6 s; the solver 2–60 ms).
- n=80: every config, including 12× heavier ones, converged to the same best tour per
  instance, but the 1-tree bound stayed ~0.77% below it.
- n=150: the best-of-all plateaued ~0.9–1.2% above the bound; piling on generations,
  children, elites, restarts, and Or-opt length did not break it.
- n=200: `max` matched the best-of-all tour on all 12 final instances (worst vs ref
  +0.00%).

That pattern is consistent with the 1-tree bound being loose, not with a large hidden
heuristic gap. To settle it, the next step is a tighter bound (or exact branch-and-bound)
at n=60–120, not more hybrid knobs.

### 7.6 Reproduction

```bash
# one-factor sweeps
node tuning/tune_effort.js --ns=40,80,150 --seeds=2
node tuning/tune_effort.js --ns=80,150 --seeds=2 --only='elite|gen|children|polish'
node tuning/tune_effort.js --ns=150,200 --seeds=2 --only='L[1-7]|combo'

# exact check
node tuning/validate_effort.js --ns=18,20,22 --seeds=3

# final ladder
node src/hybrid/hybrid_effort.js --ns=80,150,200 --seeds=2 --kind=both \
  --efforts=low,mid,high,xhigh,max --bound=1

# one run
node src/hybrid/hybrid_effort.js --n=200 --effort=max --bound=1 --tour=tour.txt
```
