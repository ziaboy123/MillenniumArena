#!/bin/sh
# Downloads (or updates) Project Ignis's card database, card scripts and EDOPro's system strings into
# engine/data/, at their latest commits. The scripts must not be newer than the engine: rebuild the
# engine first (npm run engine) when updating.
set -e
cd "$(dirname "$0")"
mkdir -p data
for repo in BabelCDB CardScripts; do
  if [ -d "data/$repo/.git" ]; then
    git -C "data/$repo" fetch --quiet --depth 1 origin master && git -C "data/$repo" checkout --quiet FETCH_HEAD
  else git clone --quiet --depth 1 "https://github.com/ProjectIgnis/$repo.git" "data/$repo"; fi
  echo "$repo at $(git -C data/$repo log -1 --format='%h %cs')"
done
# prompt and effect texts the engine refers to by number ("Select the card(s) to Tribute", "Activate"...)
curl -fsSL https://raw.githubusercontent.com/ProjectIgnis/Distribution/master/config/strings.conf -o data/strings.conf
echo "strings.conf: $(grep -c '^!system' data/strings.conf) system strings"
