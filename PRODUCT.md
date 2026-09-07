# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Two permanently paired partners, and only them. V1's real users are the creator and their partner;
the near-future audience is other couples (friends and their partners), at roughly 200 registered
users and 70–80 concurrent.

There is no third role. No spectators, no matchmaking, no cross-couple visibility, no admin surface.
Every screen a user sees is either their own account or the couple they belong to.

The job: two people who want to spend a few minutes together doing something playful — a break, a
wind-down, a small ritual — reach for Rasmalai instead of a chat window that has run out of things
to say.

**Usage scene:** partners may be in the same room or in different cities (onboarding records which:
same city / different city / live-in). Both phone and desktop are first-class — at least one partner
regularly plays on a laptop, so desktop is a real layout, not a responsive fallback. Games must also
work with touch input (tap, swipe, gesture) and adapt between portrait and landscape where practical.

## Product Purpose

A private two-player browser game platform for permanently paired partners. Quick, cute, chaotic,
synchronized games plus a couple dashboard that keeps score of the relationship, not just the match.

Success is the couple playing together reliably: both partners connected, in sync, and finishing a
match without the platform getting in the way. Multiplayer correctness outranks visual polish.

## Positioning

Most party games are built for a room full of people and then scaled down. Rasmalai is built for
exactly two, permanently bound to each other, and nothing about it generalizes past that: pairing is
permanent, all resources are couple-scoped, and the statistics are relationship statistics — days
together from the exact first-met date, wins by each partner, current streak, most competitive game,
closest match.

The permanence is the mechanism. Because there is only ever one partner, the platform can keep a
lifetime shared record and treat the couple, not the account, as the unit that plays.

## Operating Context

**First run:** Google sign-in → onboarding (actual name, nickname, birth year, partner's actual name
and nickname, exact first-met date, relationship location type) → unique pairing code → share it or
enter the partner's → the receiver accepts or rejects → permanent pairing.

**Every session after:** couple dashboard → browse the game catalogue → select a game → partner gets
an invitation (❤️ PLAY / 🙈 NOT NOW) → lobby → both ready → server-run synchronized countdown →
play → results → rematch or pick another game.

**Tournaments:** either partner creates one, picks the games up front, and the list locks when it
starts. Games run sequentially; win 3 / draw 1 / loss 0 decides the winner.

**Disconnects:** the partner sees a friendly reconnect state, the session is held 120 seconds, and
in a tournament a failed reconnect restarts that game rather than awarding a win.

Surfaces in `apps/web/src/app`: landing (`/`), onboarding, pairing, dashboard, games catalogue,
play session, tournament.

## Capabilities and Constraints

- **Two players only.** V1 has no single-player mode; if the partner is absent, there is nothing to play.
- **One active game session per couple**, and **one active invitation** — a new invitation immediately
  invalidates the previous one. Invitations expire after 5 minutes.
- **Pairing requests never expire** and pairing is permanent once accepted.
- **The server is authoritative** for competitive timing, scoring, randomness, and match completion.
  The client is never trusted for an outcome.
- **Realtime is WebSocket-based**, including partner presence — no polling.
- **Games are isolated modules** behind a platform session contract. A game module knows nothing about
  auth, the database, couple records, or account management. Implemented so far: basketball,
  four-in-a-row, reaction-speed, reflex, bomb-defusal, guess-my-answer, memory, word-game,
  would-you-rather.
- **Reactions** (😂 ❤️ 😭 😡 👀) are realtime and ephemeral — they disappear immediately and are
  never stored.
- **No voice, no text chat, no sound, no music** in V1. Extension points only.
- **No public discoverability, no cross-couple access, no global matchmaking.** Everything is private
  to the couple.
- **Retention:** raw match history for 7 days only; lifetime aggregate statistics forever. Days
  together is always computed from the first-met date, never stored as a count.
- **Nicknames are not globally unique.**
- Everything is unlocked in V1 — no progression gates.

Deliberately undecided / out of scope until asked: individual games for a waiting partner,
inter-couple competition, relationship-level unlocking, achievements and cosmetics, chat, voice,
sound.

## Brand Commitments

- The name is **Rasmalai**.
- Visual direction is **cute / cartoon**: rounded cards, soft pastel language, cute abstract avatars,
  small animations. Not esports, not serious.
- Games should feel cute, playful, chaotic, unpredictable, quick, and socially engaging.
- The visual identity must stay **replaceable**: tokens live centralized in
  `apps/web/src/design-system/theme.css`, and components reference tokens rather than hardcoding a
  colour, radius, shadow, or duration.
- Copy carries warmth over efficiency — the product's own examples are "❤️ PLAY", "🙈 NOT NOW", and
  "Divyank wants to pair with you ❤️".

## Evidence on Hand

- `docs/01_PRODUCT_SPEC.md` — product truth, game catalogue, retention, visual direction.
- `docs/06_UX_AND_STATE_FLOWS.md` — the state flows above, verbatim.
- `docs/03_DATABASE_SCHEMA.md`, `docs/04_REALTIME_AND_WEBSOCKET_PROTOCOL.md`, `docs/05_GAME_SDK.md` —
  data model, realtime lifecycle, and the game module contract.
- `apps/web/src/design-system/theme.css` — the incumbent visual system: pastel palette, radius ladder,
  soft shadows, springy motion, self-hosted Poppins/Inter under `apps/web/src/app/fonts/`.
  Its structural half was derived from corgilabs.ai; measurements in `ui-clone-workspace/site-dna.md`.
- Palette values are **frozen as six-digit hex**: two Phaser games read them at runtime via
  `getComputedStyle` and parse `/^#([0-9a-f]{6})$/i`. An `oklch()`, `rgb()`, 3- or 8-digit value
  silently drops both games to hardcoded fallbacks. `theme.test.ts` enforces this.

No testimonials, customers, press, benchmarks, pricing, or usage data exist. Nothing of that kind may
be fabricated for any surface.

## Product Principles

1. **The couple must be able to play together reliably.** Synchronization and correctness outrank
   every visual consideration.
2. **Private by construction.** No public surface, no cross-couple leak, no discoverability — this is
   an architectural property, not a setting.
3. **Cute, fast, simple.** V1 earns affection through small warm details, not through depth or scale.
4. **Games stay isolated.** Adding a game must never require touching auth, the database, or account
   management.
5. **The skin is replaceable.** Any visual decision must survive a full retheme, which means it lives
   in tokens.

## Accessibility & Inclusion

No product-specific user need established. Ordinary hygiene applies — contrast, visible focus, honest
touch-target sizes, and respect for reduced-motion — but no standard is committed to as binding.
