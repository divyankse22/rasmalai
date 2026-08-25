#!/usr/bin/env bash
#
# Builds the Word Game dictionary from SCOWL, and writes it as a TypeScript module.
#
# Source:  SCOWL (Spell Checker Oriented Word Lists) 2020.12.07, by Kevin Atkinson.
#          https://wordlist.aspell.net/ — https://sourceforge.net/projects/wordlist/
# Licence: permissive. "Permission to use, copy, modify, distribute and sell these word lists,
#          the associated scripts, the output created from the scripts, and its documentation for
#          any purpose is hereby granted without fee, provided that the above copyright notice
#          appears in all copies." The full notice is vendored beside the output as
#          SCOWL-COPYRIGHT.txt and MUST stay there — several component lists carry their own
#          terms, and UKACD's in particular requires the documentation be included verbatim.
#
# Why SCOWL and not a frequency list: SCOWL's size bands ARE a commonness ranking, so no second
# dataset is needed. That matters, because the obvious frequency sources (google-10000-english and
# friends) derive from the LDC-distributed Google corpus and claim only "educational and personal
# research use ... and US fair use doctrine", which is not a licence to redistribute in a product.
#
# Why size 50: SCOWL's own documentation says size 80 is "all the strange and unusual words people
# like to use in word games such as Scrabble" — exactly what makes a casual word game feel broken.
# Size 50 is ~101k cumulative words of ordinary English. After the filters below it is ~58k.
#
# Filters, and the rules they settle:
#   - a-z only            → no hyphens, no apostrophes, no accents (so no contractions/possessives)
#   - length 3..12        → 12 is the pool size, so nothing longer is reachable; 2-letter words are
#                           where the Scrabble exotica lives (`xu`, `oe`, `jo`)
#   - lowercased          → normalisation happens once, here, not per submission
#   - proper names, abbreviations, upper-case and contraction lists are NOT included at all: SCOWL
#     ships them as separate files, so excluding proper nouns and abbreviations is structural
#   - blocklist.txt       → subtracted (see that file for what and why)
#   - plurals and conjugations ARE kept: `running` and `happier` are words people reach for
#
set -euo pipefail

VERSION="2020.12.07"
URL="https://downloads.sourceforge.net/wordlist/scowl-${VERSION}.tar.gz"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OUT_DIR="$ROOT/packages/games/src/word-game/dictionary"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

echo "→ fetching SCOWL $VERSION"
curl -sSL -m 300 -o "$WORK/scowl.tar.gz" "$URL"
tar xzf "$WORK/scowl.tar.gz" -C "$WORK"
SRC="$WORK/scowl-$VERSION"

echo "→ filtering (english + american, sizes 10..50)"
cat "$SRC"/final/english-words.{10,20,35,40,50} "$SRC"/final/american-words.{10,20,35,40,50} \
  | LC_ALL=C tr 'A-Z' 'a-z' \
  | LC_ALL=C grep -E '^[a-z]{3,12}$' \
  | LC_ALL=C sort -u > "$WORK/all.txt"

grep -v '^#' "$ROOT/scripts/dictionary/blocklist.txt" | grep -v '^$' \
  | LC_ALL=C tr 'A-Z' 'a-z' | LC_ALL=C sort -u > "$WORK/blocked.txt"

LC_ALL=C comm -23 "$WORK/all.txt" "$WORK/blocked.txt" > "$WORK/words.txt"

BEFORE=$(wc -l < "$WORK/all.txt" | tr -d ' ')
AFTER=$(wc -l < "$WORK/words.txt" | tr -d ' ')
echo "→ $BEFORE words, $((BEFORE - AFTER)) removed by the blocklist, $AFTER kept"

mkdir -p "$OUT_DIR"
cp "$SRC/Copyright" "$OUT_DIR/SCOWL-COPYRIGHT.txt"

PAYLOAD=$(gzip -9 -c "$WORK/words.txt" | base64 | tr -d '\n')

cat > "$OUT_DIR/words.ts" <<TSEOF
/**
 * The Word Game dictionary — $AFTER words, generated. **Do not edit by hand.**
 *
 * Built by \`scripts/dictionary/build-dictionary.sh\` from SCOWL $VERSION size 50. That script is
 * the documentation: source, licence, every filter, and why each one is there. The licence notice
 * that must travel with this data is beside this file as \`SCOWL-COPYRIGHT.txt\`.
 *
 * Stored gzipped and base64-encoded in a TypeScript module rather than as a \`.txt\` beside it,
 * because tsup bundles \`@rasmalai/games\` into \`apps/server/dist\` — a loose data file would not
 * survive the bundle, and reading one at runtime would need a path that differs between the tests,
 * the dev server and the container. A string constant has none of those problems. 525KB of words
 * becomes 204KB of source, decompressed once on first use.
 *
 * Server-only, like every rulebook: the web app is forbidden from importing
 * \`@rasmalai/games/<game>/server\` and \`@rasmalai/games/<game>/dictionary\` by the web app's
 * eslint config. (Written with <game> rather than a glob because a star-slash inside a block
 * comment closes it.)
 * A browser that held the dictionary could tell a player whether a word was valid before the server
 * did, which is the whole thing the server is here to decide.
 */

/** gzip, then base64. Decoded lazily by \`dictionary.ts\`. */
export const WORDS_GZ_BASE64 =
  '$PAYLOAD';

/** How many words the payload holds, asserted on load so a truncated build fails loudly. */
export const WORD_COUNT = $AFTER;

/** The SCOWL release this was built from, so a stale dictionary is identifiable. */
export const DICTIONARY_VERSION = 'scowl-$VERSION-size50';
TSEOF

echo "→ wrote $OUT_DIR/words.ts ($(wc -c < "$OUT_DIR/words.ts" | tr -d ' ') bytes)"
echo "→ wrote $OUT_DIR/SCOWL-COPYRIGHT.txt"
