# Would You Rather — content provenance

How the sixty dilemmas in `packages/games/src/would-you-rather/deck.ts` were arrived at, what they
had to pass to get in, and how to add more without lowering the bar.

## Why this document exists

The deck is the game. The rulebook is three hundred lines that could be swapped for another game's
in an afternoon; the questions are the thing two people actually sit with. A deck that drifts into
shock value, or into questions with one obviously correct answer, breaks the product in a way no
test will catch — so the rubrics are written down rather than held in somebody's head.

## Sources researched

These were **research inputs, not a source of copy.** No dilemma in the deck is lifted from any of
them. What was taken is the shape of the problem: which value conflicts produce a real hesitation,
and which produce a shrug.

- [Psychological Would You Rather Questions — Neurolaunch](https://neurolaunch.com/psychological-would-you-rather-questions/)
- [320 Would-You-Rather Questions — Science of People](https://www.scienceofpeople.com/would-you-rather-questions/)
- [17 Would You Rather Questions That Go Deep — Wondermind](https://www.wondermind.com/article/would-you-rather-questions-for-adults/)
- [172 Deep Would You Rather Questions — GripRoom](https://www.griproom.com/fun/172-deep-would-you-rather-questions)
- [The Trolley Problem — Wikipedia](https://en.wikipedia.org/wiki/Trolley_problem)
- [Is It Right to Sacrifice One Life to Save Many? — The Collector](https://www.thecollector.com/trolley-problem/)
- [Thought Experiments and Philosophical Problems — Glendale CC library guide](https://guides.gccaz.edu/philosophy-guide/experiments)

The single most useful finding, and the one the whole rubric rests on: a dilemma reveals something
only when **both options carry a real cost**, forcing an actual ranking of two values the person
holds at once. "Lose everything or gain a million" is not a dilemma; it is a quiz with one answer.

## The ten axes

Every dilemma is tagged with the value it pulls against itself. The axis exists for one mechanical
reason — the three candidates an Asker is dealt must not all be the same question in different
clothes — and it **never reaches the client**. It is not a personality classification and the game
never tells anybody what theirs was.

`truth` · `memory` · `loyalty` · `control` · `mortality` · `freedom` · `justice` · `intimacy` ·
`identity` · `sacrifice`

## The difficulty rubric

| | |
|---|---|
| **1** | A real choice, but nobody is going to lie awake. Early, playful, slightly odd. |
| **2** | You will hesitate. Low stakes, genuine preference. |
| **3** | Uncomfortable. The first band where an answer costs something to say out loud. |
| **4** | Genuinely difficult. No comfortable answer exists. |
| **5** | Brutal. Both options are a loss and the choice is which loss. |

Difficulty is **load-bearing, not decoration.** `bandForRound` in `deck.ts` draws rounds 1–2 from
difficulty 1–2, rounds 3–4 from 2–4, and rounds 5–6 from 3–5, so a match warms up. That resolves a
real conflict between two governing documents: `docs/01_PRODUCT_SPEC.md` section 8 asks for games
that feel "cute, playful, chaotic", and this game was specified to be psychologically
uncomfortable. Banding satisfies both — nobody opens with mortality, and nobody finishes on whether
they like being early.

Current distribution: **10 / 14 / 14 / 12 / 10** across difficulties 1–5.

## The quality bar

A dilemma had to clear all of these to get in:

1. **Both options genuinely defensible.** If a reasonable person would pick the same side every
   time, it is a quiz question.
2. **Neither option is a joke**, unless both are.
3. **The choice reveals a value**, not a piece of trivia or a taste.
4. **The answer could plausibly surprise a partner** — otherwise there is nothing to predict.
5. **Concise.** It has to be readable on a phone without scrolling.
6. **No loophole**, and no "both" or "neither" that defeats the premise.
7. **No obscure knowledge required.**
8. **Distinct** from everything already in the deck.

Rejected, with the reason, so the same mistakes are not re-made:

- anything resolvable by picking the obviously smaller loss
- variants of a dilemma already in the deck with the nouns changed
- questions that are really about taste — favourite food, ideal holiday — which belong in Guess My
  Answer, not here
- anything needing a paragraph of setup before the choice makes sense

## The safety rubric

Dark does not mean unsafe. Nothing in the deck may:

- encourage or romanticise self-harm or suicide
- glorify or normalise abuse
- encourage real-world violence
- target a protected group
- exploit a specific personal trauma
- pressure somebody into disclosing sensitive personal information

Hypothetical mortality, loss, identity, sacrifice and moral failure are all in scope — that is the
game. What is out of scope is anything whose point is the distress rather than the choice.

**The game never diagnoses.** No screen in this module interprets an answer as evidence about
anybody's psychology, attachment style, or relationship. The reveal copy is playful on purpose:
"You called it 🎯", "Nowhere near 🙈". A line like "your answer proves you don't trust your partner"
would be both wrong and unkind, and it is explicitly out of bounds.

## Adding more

The deck is a plain `readonly` array. Topping it up needs no code change at all — append entries
with a `prompt`, `optionA`, `optionB`, `axis` and `difficulty`, and the dealer picks them up.

Two constraints the tests enforce, so a top-up cannot quietly break the game:

- **every difficulty band must hold more cards than one match can consume** (`ROUNDS × CANDIDATES`,
  currently 18). This is what keeps the widening fallback in `nextCard` a safety net rather than the
  mechanism;
- **every band must contain at least three distinct axes**, or three different candidates cannot be
  dealt.

Run `npx vitest run packages/games/src/would-you-rather` after editing. The five tests under
`describe('the deck')` are the ones that check deck shape.

The hardest cell to fill is a **playful entry on a heavy axis at difficulty 1–2** — a light question
about memory or mortality that is genuinely light. Aim there when expanding; the 3–5 bands fill
themselves.
