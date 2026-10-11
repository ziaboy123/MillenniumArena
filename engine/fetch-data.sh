#!/bin/sh
# Downloads (or updates) Project Ignis's card database and card scripts into data/, at their latest commits.
# The scripts must not be newer than the engine: rebuild the engine first (./build-core.sh) when updating.
set -e
mkdir -p data
for repo in BabelCDB CardScripts; do
  if [ -d "data/$repo/.git" ]; then
    git -C "data/$repo" fetch --quiet --depth 1 origin master && git -C "data/$repo" checkout --quiet FETCH_HEAD
  else git clone --quiet --depth 1 "https://github.com/ProjectIgnis/$repo.git" "data/$repo"; fi
  echo "$repo at $(git -C data/$repo log -1 --format='%h %cs')"
done
