# Word Game — rules, dictionary, and the seams left open

Answers the eight things the brief's section 31 asks to see before implementation. Written after the
fact for the record; every decision in it was agreed before code was written.

## A. The rules

Twelve letters face up. On your turn you either claim a word from them or pass. That is the whole
game, and everything below is a consequence.

- **Claim.** Tap tiles to build a word of three letters or more and play it. The tiles leave the
  table, the pool refills from the bag, and the word is yours. It scores **length squared** — `cat`
  is 9, `coast` is 25, `coaster` is 49. Long words are worth disproportionately more, which is what
  makes hunting for one worth the time.
- **Golden tile.** Exactly one tile in the pool is golden at any moment. A word using it scores
  **double**. When it is played, the server picks a new one from what is left on the table. It is
  the only randomness in the game beyond the shuffle, and it is server-seeded so both screens agree.
- **Raid.** A word of **six letters or more** also lets you **break one of your partner's words**.
  It is destroyed, everything it was worth goes with it, its letters come back to the pool, and you
  bank a flat **15**. The bonus is flat on purpose: breaking a long word is not worth more than
  breaking a short one, because the damage is the point rather than the loot.
- **Comeback.** Whoever is **behind** raids at **five** letters instead of six. Being behind makes
  you more dangerous, and the moment you take the lead you lose the discount. It is the existing
  rule with one number changed rather than a new mechanic, so there is one thing to learn.
- **A wrong word costs nothing but the attempt.** If the dictionary says no, you are told and the
  turn stays yours. The pool is public and the dictionary is not, so a player genuinely cannot know
  whether `snarf` is in it — losing your turn to a guess would make this a game about memorising a
  word list, which is what it is trying not to be.
- **No word twice**, by either of you, in one match.
- **A pass also refreshes a stale table.** It grows the pool by three letters (toward a ceiling of
  eighteen); once the pool is already at that ceiling, a pass instead swaps three of it for fresh
  ones from the bag. One rule either way, so two people staring at a dead pool are never stuck
  passing at each other for nothing.
- **The end.** When the bag is empty and both of you pass in a row. A hard cap of forty turns each
  is the backstop.
- **The winner** is whoever holds the most: the words they still own, plus their raid bonuses, minus
  what they spent on hints. A word taken off you takes its points with it, so the last thirty
  seconds matter.

**The game keeps its own clock — the platform's never applies.** `turnOf` still returns null, so the
platform's 120-second move window never puts a thinking player on notice — since slice 11 a present
player who runs *that* out forfeits, and finding a word in twelve letters legitimately takes longer
than two minutes. Instead each turn carries its own thirty-second allowance, which grows by five
seconds, permanently, every time that seat finds a word — the better you are doing, the more room you
get. Running it out is not a forfeit: it counts as an automatic pass, logged as a timeout rather than
a choice, and the match's own end conditions (two passes with an empty bag, or the forty-turn cap)
are what actually end things. The platform's 120 seconds still applies to an actual disconnect,
through `reconnectPolicy` — a different mechanism, and the only one of the two clocks the game
declines.

**Hints.** Each player gets three per match. Spending one highlights a tile that can genuinely start
a word makeable from the current pool, and costs five points — taken off the final score the same way
a raid adds to it, never off the turn: a hint does not stop the clock or end the turn, because
charging points for a look at the table should not also charge time for it. Refused rather than
silently withheld when none are left or nothing at all is makeable, the same softness a wrong word
gets. Visible only to whoever paid for it; the partner only ever sees how many hints each of you has
left, the same way the score is public but not how it was arrived at.

## B. Dictionary strategy

```
SCOWL 2020.12.07, size 50   →   a-z only, length 3–12, lowercased
                            →   proper names / abbreviations / contractions excluded structurally
                            →   blocklist subtracted
                            →   58,252 words   →   gzip + base64   →   words.ts
```

`scripts/dictionary/build-dictionary.sh` is the reproducible build and carries the full reasoning.

**Licence.** SCOWL is permissive: *"Permission to use, copy, modify, distribute and sell these word
lists… for any purpose is hereby granted without fee, provided that the above copyright notice
appears in all copies."* The notice is vendored as
`packages/games/src/word-game/dictionary/SCOWL-COPYRIGHT.txt` and must stay there — several
component lists carry their own terms, and UKACD's requires the documentation verbatim.

**What was rejected, and why it matters.** The obvious frequency sources — `google-10000-english`
and its many forks — derive from the LDC-distributed Google Web Trillion Word Corpus and claim only
*"educational and personal/research use… and US fair use doctrine."* That is not a licence to
redistribute in a product, so none of them is in this repository. SCOWL avoided the question
entirely: **its size bands are already a commonness ranking**, so no second dataset was needed.
Collins/SOWPODS/TWL are proprietary and were never candidates.

**Why size 50.** SCOWL's own documentation says size 80 is *"all the strange and unusual words
people like to use in word games such as Scrabble"* — `qat`, `zax`, `cwm`, `phpht`. That is exactly
what makes a casual word game feel broken. Size 50 is ~101k words of ordinary English before
filtering.

**Rules settled by the filter**, so they are structural rather than remembered: no hyphens, no
apostrophes, no accents, no proper nouns, no abbreviations, no contractions. Plurals and
conjugations are kept — `running` and `happier` are words people reach for. Minimum three letters,
maximum twelve, because the pool never holds more than twelve.

**Blocklist.** SCOWL size 50 is mainstream English and therefore contains slurs, because a spell
checker has to know them. 21 entries are subtracted at build time and never reach the repository.
Mild profanity is deliberately kept: `damn`, `hell` and `crap` stay, because refusing them in a
private game between two adults would be prissy rather than safe.

## C. State machine

```
createMatch — shuffle the bag, deal twelve, gild one, coin-flip who starts
     │
     ▼
  YOUR TURN ──── claim (invalid word) ──▶ told why, turn stays yours
     │
     ├── claim (valid) ──▶ word is yours, pool refills, golden may move, turn passes
     │                     └── with 6+ letters (5 if behind): break one of theirs
     │
     └── pass ──▶ turn passes, pass count +1
                  └── bag empty AND two passes in a row ──▶ FINISHED
                  └── forty turns each ──────────────────▶ FINISHED
```

## D. The protocol

`{ type: 'claim', tiles: number[], steal: number | null }`, `{ type: 'pass' }`, and
`{ type: 'hint' }`.

**The word is not on the action.** The client sends tile **ids** and the server derives the letters.
That is what makes "do you actually possess these letters" structural rather than a check somebody
could forget — a client cannot name a letter it does not hold, because it names tiles, not letters.
Tile ids also settle the two-`E`s problem: identical letters are different tiles, and a submission
that named letters could not say which one it meant.

## E. Server/client boundary

Authoritative on the server, without exception: the shuffle, the deal, which tile is golden, whether
a word is a word, whether it has been played, whether the tiles are on the table, whose turn it is,
what anything scores, whether a raid is allowed, what it destroys, and when the match ends.

The client holds one thing the server does not: which tiles the player has tapped so far. It is
local, it is never sent until they press Play, and nothing depends on it.

## F. Database impact

None beyond `0013_word_game.sql`, which enables the slug and moves `scoring_kind` to `competitive`.
The generic match and statistics pipeline needed no extension. Per-game metrics — best word, longest
word, most raids — are **not** implemented: the brief lists them as optional, and the platform has
no per-game result metadata, so adding them means a schema change for a nice-to-have.

## G. Mobile UX

Tap a tile to add it, tap it again to take it back — or swipe a finger across a run of tiles to add
them in one stroke, Boggle-style. Clear, Play, Pass and Hint are pill buttons in a row; the rack
wraps rather than scrolls. The golden tile is ringed and labelled for screen readers rather than only
coloured, and so is a hinted tile. The raid picker appears **only** once the word in hand is actually
long enough to earn one, so the mechanic teaches itself at the moment it becomes relevant.

The swipe path exists because touch input implicitly captures to whichever tile a finger went down
on — the Pointer Events spec's default for touch, unlike mouse — so the other tiles' own pointer
events never fire while dragging across them. `client.tsx` releases that capture on `pointerdown`
and instead asks `document.elementFromPoint` what is actually under the finger on every `pointermove`,
which is the one piece of it that is not ordinary React event handling.

Desktop typing is deliberately not implemented. The brief lists it as optional, and mapping typed
letters onto specific tile ids when the pool holds two `E`s is fiddly with no payoff on the device
this is actually played on.

## H. Tests

56 unit checks — 44 on the rulebook, 12 on the dictionary — and 5 through the real registry against
real Postgres. The integration suite proves what the unit tests structurally cannot: that the
dictionary is enforced **on the server** across a real submission, that whose-turn-it-is survives
the registry's user-id-to-seat resolution, and that a game the catalogue files as `casual` records a
real `winner_user_id` and increments `competitive_games`.

## The two seams left open

Both were asked for explicitly, and both are **named functions with a documented contract** rather
than plugin machinery. That is the cheapest form of "open to extension" that is actually true.

- **`mayAct(state, player)`** is the entire turn rule and the only place it is decided. Alternating
  is `state.turn === player`; real-time claiming is `() => true` with a `turn` field nobody reads.
  Nothing else in the rulebook consults `state.turn`.
- **`raidThreshold` and `applyRaid`** are the entire stealing rule. A Snatch-style steal — extend a
  word your partner owns using all of its letters plus one from the pool — replaces those two and
  touches nothing else. `ClaimAction.steal` already names a **word** rather than a letter, which is
  the shape Snatch needs.

## Known limitations

- **Nobody has played it.** It joins every other game in the two-account browser run that has never
  happened (limitations 29–31) — the turn clock and hints included, since both arrived after the
  rest of the game and are exercised only by the rulebook tests, never by an actual pair of screens.
- **Hints were silently dropped by the platform, not by the rulebook.** `applyAction`'s hint branch
  (and, it turns out, the word-rejection branches it copied the pattern from) returned `still()` —
  the helper for a transition with `events: []`, meant for a genuine no-op tick or resume. The
  platform only pushes a fresh view over the websocket when `transition.events` is non-empty
  (`matchRunner.ts` → `sessionRegistry.ts`), so the server picked a real hint tile every time and
  neither screen was ever told. Rulebook unit tests read `state`/`getView` directly and could not
  have caught it; the fix (`rejected`, replacing `still(withRejection(...))`) is covered by a
  rulebook test asserting `transition.events` and by a real-registry integration test asserting a
  frame actually reaches the acting player's socket.
- **A raid cannot be tested through the real registry.** Finding a six-letter word in a random
  pool of `POOL_SIZE` letters is not guaranteed, so the integration suite does not attempt one. The
  rulebook tests cover raiding thoroughly against hand-built pools.
- **The bag distribution is a guess.** Sixty tiles, vowel-heavy because face-up letters with no
  blanks lock into consonant sludge otherwise. Whether it produces good pools is a playtesting
  question, and the array is at the top of `server.ts` for that reason.
- **`POOL_SIZE`/`POOL_MAX` were raised from 12/18 to 14/20 as a first easier-mode pass** — more
  letters visible at once means more words are actually makeable from any given deal, at no cost to
  the vowel-heavy bag ratio or any scoring number. Untested by an actual playthrough, per the first
  bullet above; if it turns out to be too easy or too crowded a rack, the two constants in
  `protocol.ts` are the whole knob.
