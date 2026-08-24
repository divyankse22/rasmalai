# Restyle Progress Log

Running record of the corgilabs.ai restyle, written so a fresh Claude session can resume
without re-deriving anything. **Append an entry after every step.**

- Plan: `/Users/divya/.claude-work/plans/search-for-clone-website-melodic-dongarra.md`
- Extracted design DNA: `ui-clone-workspace/site-dna.md`
- Branch: `slice-11-integration-coverage`
- Baseline commit: `e2a96d5`

---

## Locked decisions

| Question | Decision | When |
|---|---|---|
| Style depth | Structure + typography + spacing from corgilabs.ai; **pastel palette frozen** | pre-plan |
| Scope | All app screens under `apps/web` | pre-plan |
| Games | Token inheritance only — **no file under `packages/games` is edited** | pre-plan |
| Safety net | jsdom + Testing Library; characterization tests **before** any visual edit | pre-plan |
| Illustrations | Deferred to a later pass | pre-plan |
| Reference assets | Design system measurements only — no corgi imagery, mascot, logo or copy | pre-plan |
| `--ease-bounce` | **KEEP the spring** `cubic-bezier(0.34, 1.56, 0.64, 1)` — buttons stay springy | Phase 1 |
| Durations | **KEEP 120ms / 240ms** — snappier than corgi's 150/300, suits a game app | Phase 1 |
| Fonts | **STILL OPEN** — Poppins+Inter vs Poppins-only vs Outfit | — |

## Non-negotiable constraints (verified in code)

1. **Colour tokens stay 6-digit hex.** `packages/games/src/reflex/client.tsx` and
   `basketball/client.tsx` read the palette at runtime via `getComputedStyle` and parse with
   `/^#([0-9a-f]{6})$/i`. `oklch()`, `rgb()`, 3-digit or 8-digit hex silently drops both Phaser
   games to hardcoded fallbacks with **no error**.
2. **`--transition-duration-*`, never `--duration-*`.** This regression already happened once;
   `theme.css` documents it.
3. `apps/web/src/app/layout.tsx:17` hardcodes `themeColor: '#fff8f2'` outside the theme.
4. **`:active`, not `:hover`** — `docs/06` forbids hover-only on a phone-first product.
5. `min-h-11` (44px) tap targets stay.
6. Colour is never the only signal (bomb-defusal, four-in-a-row, memory).
7. `prefers-reduced-motion` kill-switch in `globals.css` stays.
8. Do not touch copy in `apps/web/src/features/play/sessionEnding.ts` — asserted verbatim.

---

## Step 0 — Commit baseline ✅ DONE

Committed 23 modified + 3 untracked files as `e2a96d5`
("feat: tournament screen, game error boundary, and session hardening").

**Test baseline recorded: 38 test files, 780 tests, all passing.**
This count is the reference for "nothing broke."

## Phase 1 — Extract design DNA ✅ DONE

Registered `ui-cloner` for this repo: added `"skills": ["~/.claude/skills/ui-cloner"]` to
`.claude/settings.local.json`. Skill lives at `~/.claude/skills/ui-cloner/` (it is NOT in
`Documents/agri-tech` — that folder only holds a past output workspace).

Ran the Phase 1 Chrome-console protocol against corgilabs.ai. Full results in `site-dna.md`.

Headline findings:
- **Animation Tier 1.** No GSAP, Lenis, Lottie, Three.js, Framer, AOS. Zero scroll-animated
  elements. Nothing to port, no new runtime dependency.
- **Radii are the big lever:** button 10px, card 12px, large card 24px, pill 9999px.
  Rasmalai is currently 16px / 28px — visibly bubblier.
- **Shadows are very low-alpha** (.08–.12) and wide-blurred; definition comes from a 1px
  hairline border, not the shadow.
- **Headings: -0.025em tracking, line-height 1.1→1.2, weight 700–800**, against 400 body at
  line-height 1.625. Hard weight jump, no mid-weights.
- Easing unanimous `cubic-bezier(0.4,0,0.2,1)` — **rejected**, we keep the bounce.
- Two-face type system: Poppins display / Inter body.

## Phase 2a — DOM harness ✅ DONE

Installed at repo root: `jsdom@30`, `@testing-library/react@16`, `@testing-library/user-event@14`,
`@testing-library/jest-dom@7`.

**Did NOT install `@vitejs/plugin-react`** — it requires vite ^8 and this repo is on vite 7.3.6,
so npm refused the peer. Not needed: `apps/web/tsconfig.json` sets `"jsx": "preserve"` (correct for
Next, wrong for vitest), and setting `esbuild: { jsx: 'automatic', jsxImportSource: 'react' }` on
the web project fixes the transform with no new dependency.

`vitest.config.ts` rewritten to the Vitest 3.2 `test.projects` idiom:
- project **`node`** — existing config verbatim (same includes, same 20s timeout, same comments).
- project **`web`** — `environment: 'jsdom'`, `include: ['apps/web/src/**/*.test.tsx']`,
  `resolve.alias` for `@/` (vitest does NOT read tsconfig `paths`, and apps/web imports through
  `@/` everywhere), `server.deps.inline` for the two raw-TS workspace packages,
  `setupFiles: ['./apps/web/src/test/setup.ts']`.

Routing signal is the **file extension**: `*.test.ts` → node, `*.test.tsx` → jsdom. The old config
included only `*.test.ts`, so a `.tsx` test would have been collected by no project and silently
never run.

New `apps/web/src/test/setup.ts` stubs the jsdom gaps this app actually hits: `matchMedia`,
`ResizeObserver`, `scrollIntoView`, `navigator.clipboard`, and an **inert `WebSocket`** so no test
can ever open a real socket.

Rewrote the config comment that claimed the web app "has no DOM test harness and does not need
one" — that was true until a restyle needed a regression net, and leaving it would read as an
instruction to delete the harness.

**Verified:** `npm test` → 39 files, 791 tests, all green. Node project still exactly **780**, so
the split did not disturb existing collection. `next/link` renders a real anchor under jsdom with
no mocking required.

## Phase 2b — Characterization tests 🔶 IN PROGRESS

Written so far:
- `apps/web/src/design-system/Button.test.tsx` (11 tests) — role/name for Button and ButtonLink,
  onClick, disabled blocking onClick, all three variants asserted to leave role+name unchanged,
  attribute forwarding, and the load-bearing invariant that **ButtonLink stays an `<a>` and never
  becomes a `<button>`**.

Governing rule for every test in this phase:
> Assert roles, accessible names, text, state and callbacks. **Never** class names, inline styles
> or computed colours. These files must stay byte-identical through the restyle — a test that
> needs editing to go green means behaviour moved.

Still to write: Card, Field, Stat, PersonName, AppNav, PartnerPresence, OnboardingWizard,
PairingPanel, InvitationCentre, TournamentRequestCentre, SessionWatch, PlayScreen (split by state),
TournamentScreen/Scoreboard, CreateTournamentModal, GameCatalogue, InviteButton, CoupleHeader,
PlayTeaser, StatsPanels, TournamentCard, GameMount, GameErrorBoundary.

Plus two cheap, high-value **node** guards (`.test.ts`) that encode the critical constraints:
- `theme.test.ts` — reads `theme.css` as text; asserts every `--color-*` is 6-digit hex, the token
  name set is frozen, `--transition-duration-*` exists with no `--duration-*`, `@keyframes float`
  survives. This is the direct guard for reflex/basketball.
- `themeColor.test.ts` — asserts `layout.tsx`'s hardcoded `themeColor` equals `--color-cream`.
## Phase 3 — Fonts ⬜ BLOCKED on font decision (Poppins+Inter / Poppins-only / Outfit; and local-vs-google)
## Phase 4 — Token diff ⬜ BLOCKED on button-shape decision (pill → 10px rectangle?)
## Phase 5 — Components ⬜ NOT STARTED
