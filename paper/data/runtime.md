| method | n=20 | n=50 | n=100 | n=200 | n=400 | scaling ~ n^k |
|---|---:|---:|---:|---:|---:|---:|
| greedy nearest-neighbour | 3 us | 6 us | 13 us | 24 us | 50 us | 0.91 |
| beam only (K=n/3) | 204 us | 496 us | 2.1 ms | 9.4 ms | 43 ms | 1.78 |
| beam + tunnel (tuned) | 1.1 ms | 5.9 ms | 43 ms | 441 ms | 4.10 s | 2.75 |
| nature (population + anneal) | 11 ms | 64 ms | 85 ms | 178 ms | 553 ms | 1.30 |
| Christofides (1.5-approx) | 220 us | 613 us | 1.1 ms | 11 ms | 27 ms | 1.61 |
| LK-style (5-opt, iterated) | 13 ms | 50 ms | 97 ms | 672 ms | 1.40 s | 1.56 |
| BGMA low | 1.3 ms | 4.1 ms | 12 ms | 83 ms | 622 ms | 2.06 |
| BGMA mid | 5.0 ms | 14 ms | 37 ms | 222 ms | 1.95 s | 1.99 |
| BGMA high | 9.6 ms | 31 ms | 84 ms | 625 ms | 6.37 s | 2.17 |
| BGMA xhigh | 16 ms | 52 ms | 212 ms | 1.81 s | 15.0 s | 2.28 |
| BGMA max | 65 ms | 203 ms | 676 ms | 5.46 s | 48.6 s | 2.21 |
| 1-tree lower bound | 96 us | 3.5 ms | 15 ms | 66 ms | 263 ms | 2.64 |
| Held-Karp exact | 299 ms | — | — | — | — | — |

| method | n=20 | n=50 | n=100 | n=200 | n=400 |
|---|---:|---:|---:|---:|---:|
| greedy nearest-neighbour | +14.03% | +27.72% | +31.90% | +31.05% | +26.46% |
| beam only (K=n/3) | +14.94% | +32.13% | +32.43% | +37.64% | +38.88% |
| beam + tunnel (tuned) | +0.00% | +0.04% | +0.69% | +1.54% | +2.22% |
| nature (population + anneal) | +0.00% | +0.07% | +0.69% | +3.40% | +35.39% |
| Christofides (1.5-approx) | +10.50% | +10.07% | +13.07% | +13.49% | +13.03% |
| LK-style (5-opt, iterated) | +0.00% | +0.00% | +0.00% | +0.11% | +0.37% |
| BGMA low | +0.00% | +0.12% | +0.52% | +1.70% | +2.22% |
| BGMA mid | +0.00% | +0.00% | +0.03% | +0.69% | +1.13% |
| BGMA high | +0.00% | +0.00% | +0.02% | +0.31% | +0.60% |
| BGMA xhigh | +0.00% | +0.00% | +0.00% | +0.02% | +0.12% |
| BGMA max | +0.00% | +0.00% | +0.00% | +0.01% | +0.00% |
