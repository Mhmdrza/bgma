#!/bin/sh
# verify.sh -- regenerate every number the paper reports, from code, into paper/data/.
# usage: TSPLIB=/path/to/tsplib/dir sh paper/verify.sh [steps]   (steps: any of A B C D E F; default all)
# TSPLIB instances are not redistributed; get them from TSPLIB95 or github.com/mastqe/tsplib.
cd "$(dirname "$0")/.." || exit 1
OUT=paper/data; T=${TSPLIB:?set TSPLIB to the directory holding the .tsp files}
STEPS=${1:-ABCDEF}
log() { echo "[$(date '+%H:%M:%S')] $*"; }
run() { log "$*"; "$@" || log "FAILED ($?): $*"; }
small="eil51:426 berlin52:7542 st70:675 kroA100:21282 pr124:59030 bier127:118282 ch130:6110 tsp225:3916 fl417:11861 pcb442:50778"
large="u574:36905 rat783:8806 pr1002:259045 u1060:224094"

case $STEPS in *A*)  # Held-Karp ground truth, the 26 instances behind the 26/26 claim
  run sh -c "node tuning/validate_effort.js --ns=18,20 --seeds=5 > $OUT/validate_18_20.txt"
  run sh -c "node tuning/validate_effort.js --ns=22 --seeds=3 > $OUT/validate_22.txt" ;; esac
case $STEPS in *B*)  # runtime + quality of every method, single thread, nothing else running
  run sh -c "node bench/runtime_bench.js --json=$OUT/runtime.json --md=1 > $OUT/runtime.md" ;; esac
case $STEPS in *C*)  # TSPLIB n<=442: ten seeds each of LK-style and BGMA max
  for s in 1 2 3 4 5 6 7 8 9 10; do for p in $small; do f=${p%%:*}; o=${p##*:}
    run sh -c "node tuning/tsplib_bench.js --file=$T/$f.tsp --opt=$o --levels=lk,max --seed=$s --jobs=3 --json=$OUT/tsplib/${f}_s$s.json > $OUT/tsplib/${f}_s$s.txt"
  done; done ;; esac
case $STEPS in *D*)  # TSPLIB n=574-1060: seed 1 (plus seeds 2-3 on the two cheaper ones)
  for p in $large; do f=${p%%:*}; o=${p##*:}
    run sh -c "node tuning/tsplib_bench.js --file=$T/$f.tsp --opt=$o --levels=lk,max --seed=1 --jobs=3 --json=$OUT/tsplib/${f}_s1.json > $OUT/tsplib/${f}_s1.txt"
  done
  for s in 2 3; do for p in u574:36905 rat783:8806; do f=${p%%:*}; o=${p##*:}
    run sh -c "node tuning/tsplib_bench.js --file=$T/$f.tsp --opt=$o --levels=lk,max --seed=$s --jobs=3 --json=$OUT/tsplib/${f}_s$s.json > $OUT/tsplib/${f}_s$s.txt"
  done; done ;; esac
case $STEPS in *E*)  # robustness: degenerate and known-optimum families, determinism repeats
  run sh -c "node tuning/stress_parallel.js --ns=20,100,400 --families=convex,line,grid,dup,same,fine,coarse --levels=low,max --jobs=3 --json=$OUT/stress.json > $OUT/stress.txt"
  run sh -c "node tuning/stress_parallel.js --ns=100 --families=uniform,cluster --levels=low,mid,high,xhigh,max --repeat=3 --jobs=3 --json=$OUT/repeat.json > $OUT/repeat.txt"
  run sh -c "node tuning/stress_parallel.js --ns=1000 --families=convex --levels=low,max --jobs=3 --json=$OUT/convex1000.json > $OUT/convex1000.txt" ;; esac
case $STEPS in *F*)  # equal time: LK-style restarts until they spend the median serial cost of one max run
  mkdir -p $OUT/lk_budget
  for p in $large $small; do f=${p%%:*}; o=${p##*:}
    b=$(node -e 'const fs=require("fs"),[d,f]=process.argv.slice(1);
      const a=fs.readdirSync(d).filter(x=>x.startsWith(f+"_s")&&x.endsWith(".json"))
        .map(x=>JSON.parse(fs.readFileSync(d+"/"+x,"utf8")).rows.find(r=>r.level==="max").units.reduce((s,u)=>s+u.ms,0))
        .sort((x,y)=>x-y), h=a.length>>1;
      console.log(Math.round(a.length%2?a[h]:(a[h-1]+a[h])/2))' $OUT/tsplib $f)
    echo "$f $o $b"
  done | xargs -P 3 -n 3 sh -c 'echo "[lk_budget] $0 budget=$2ms"; node tuning/tsplib_bench.js --file='"$T"'/$0.tsp --opt=$1 --levels=lk --lkBudget=$2 --json='"$OUT"'/lk_budget/$0.json > '"$OUT"'/lk_budget/$0.txt || echo "FAILED $0"' ;; esac
log done
