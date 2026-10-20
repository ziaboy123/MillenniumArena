#!/bin/sh
# Downloads Project Ignis's card database, card scripts, banlists and EDOPro's system strings into engine/data/,
# at the commits in engine/DATA_COMMITS (the ones tested with this engine build), so every server runs the same cards.
# The scripts must not be newer than the engine. To update: rebuild the engine (npm run engine), run
# `npm run data -- latest`, test, then copy the commits it prints into DATA_COMMITS.
set -e
cd "$(dirname "$0")"
mkdir -p data
latest=; [ "$1" = latest ] && latest=1
pin() { awk -v r="$1" '$1 == r { print $2 }' DATA_COMMITS; }
for repo in BabelCDB CardScripts LFLists; do
  want=$(pin $repo); [ -n "$latest" ] && want=master
  [ -d "data/$repo/.git" ] || { git init --quiet "data/$repo" && git -C "data/$repo" remote add origin "https://github.com/ProjectIgnis/$repo.git"; }
  git -C "data/$repo" fetch --quiet --depth 1 origin "$want" && git -C "data/$repo" checkout --quiet --detach FETCH_HEAD ||
    { echo "Couldn't get $repo at $want" >&2; exit 1; }
  have=$(git -C "data/$repo" rev-parse HEAD)
  [ -n "$latest" ] || [ "$have" = "$want" ] || { echo "$repo is at $have, not $want" >&2; exit 1; }
  echo "$repo  $have  ($(git -C data/$repo log -1 --format=%cs))"
done
# prompt and effect texts the engine refers to by number ("Select the card(s) to Tribute", "Activate"...)
dist=$(pin Distribution); [ -n "$latest" ] && dist=$(git ls-remote https://github.com/ProjectIgnis/Distribution.git refs/heads/master | cut -f1)
curl -fsSL "https://raw.githubusercontent.com/ProjectIgnis/Distribution/$dist/config/strings.conf" -o data/strings.conf
echo "Distribution  $dist  (strings.conf: $(grep -c '^!system' data/strings.conf) system strings)"
# where Project Ignis lags behind real releases: official numbers of brand-new cards, and real release dates (optional: needs the internet)
node --disable-warning=ExperimentalWarning card-fixes.mjs || echo "card-fixes.json not updated (YGOPRODeck unreachable?)"
