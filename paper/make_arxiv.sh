#!/bin/sh
# make_arxiv.sh -- build paper/arxiv.tar.gz, the source bundle to upload to arXiv.
# arXiv compiles with pdflatex and does not run BibTeX, so the bundle ships main.bbl.
set -e
cd "$(dirname "$0")"
node gen_tables.js
tectonic -X compile --keep-intermediates main.tex
rm -rf arxiv && mkdir -p arxiv
cp -R main.tex main.bbl refs.bib sections generated arxiv/
tar -czf arxiv.tar.gz -C arxiv .
echo "arxiv.tar.gz: $(tar -tzf arxiv.tar.gz | wc -l | tr -d ' ') files"
