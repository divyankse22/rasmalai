---
name: Rasmalai
description: A tiny world for two — a pastel sweet-shop counter sized for a thumb.
colors:
  cream: "#fff8f2"
  shell: "#fffdfb"
  blush: "#ffd6e0"
  berry: "#c93a64"
  berry-deep: "#a82a4b"
  mint: "#c8f0e0"
  sky: "#cfe6ff"
  sky-deep: "#a5d0f7"
  blueberry: "#3a88ee"
  blueberry-deep: "#2b70ca"
  butter: "#ffeec2"
  lilac: "#e5dbff"
  ink: "#3d2b3a"
  muted: "#7e6b78"
  line: "#f1e3ea"
  name-male: "#2f6fd0"
  name-female: "#c33a86"
  status-online: "#34c759"
  status-offline: "#ff3b30"
typography:
  hero:
    fontFamily: "Poppins, ui-rounded, SF Pro Rounded, Nunito, system-ui, sans-serif"
    fontSize: "2.5rem"
    fontWeight: 800
    lineHeight: 1.1
    letterSpacing: "-0.025em"
  title:
    fontFamily: "Poppins, ui-rounded, SF Pro Rounded, Nunito, system-ui, sans-serif"
    fontSize: "2rem"
    fontWeight: 700
    lineHeight: 1.15
    letterSpacing: "-0.02em"
  heading:
    fontFamily: "Poppins, ui-rounded, SF Pro Rounded, Nunito, system-ui, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "-0.015em"
  subhead:
    fontFamily: "Poppins, ui-rounded, SF Pro Rounded, Nunito, system-ui, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 600
    lineHeight: 1.35
  lede:
    fontFamily: "Inter, system-ui, -apple-system, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 400
    lineHeight: 1.625
  body:
    fontFamily: "Inter, system-ui, -apple-system, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.5
  small:
    fontFamily: "Inter, system-ui, -apple-system, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.43
  caption:
    fontFamily: "Inter, system-ui, -apple-system, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 400
    lineHeight: 1.35
    letterSpacing: "0.04em"
rounded:
  tight: "0.375rem"
  soft: "0.625rem"
  card: "1rem"
  sheet: "1.5rem"
  pill: "999px"
spacing:
  block: "1.25rem"
  gutter: "1.5rem"
  section: "2rem"
  hero: "3rem"
components:
  button-primary:
    backgroundColor: "{colors.berry}"
    textColor: "{colors.shell}"
    typography: "{typography.subhead}"
    rounded: "{rounded.pill}"
    padding: "0 1.5rem"
    height: "2.75rem"
  button-primary-active:
    backgroundColor: "{colors.berry-deep}"
    textColor: "{colors.shell}"
  button-soft:
    backgroundColor: "{colors.sky}"
    textColor: "{colors.ink}"
    typography: "{typography.subhead}"
    rounded: "{rounded.pill}"
    padding: "0 1.5rem"
    height: "2.75rem"
  button-soft-active:
    backgroundColor: "{colors.sky-deep}"
    textColor: "{colors.ink}"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.muted}"
    typography: "{typography.subhead}"
    rounded: "{rounded.pill}"
    padding: "0 1.5rem"
    height: "2.75rem"
  card:
    backgroundColor: "{colors.shell}"
    textColor: "{colors.ink}"
    rounded: "{rounded.card}"
    padding: "1.5rem"
  field-control:
    backgroundColor: "{colors.cream}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.soft}"
    padding: "0 1rem"
    height: "2.75rem"
  chip-soon:
    backgroundColor: "{colors.butter}"
    textColor: "{colors.muted}"
    typography: "{typography.caption}"
    rounded: "{rounded.pill}"
    padding: "0.125rem 0.5rem"
  avatar:
    backgroundColor: "{colors.cream}"
    rounded: "{rounded.pill}"
    size: "2.25rem"
  nav-drawer:
    backgroundColor: "{colors.shell}"
    textColor: "{colors.ink}"
    padding: "1.5rem 1.25rem"
    width: "18rem"
---

# Design System: Rasmalai

## Overview

**Creative North Star: "The Sweet Shop Counter"**

Rasmalai is named after a dessert, and the palette is the dessert: cream is the paper it is served on, blush is the icing, berry is the syrup, butter is the sponge, mint is the pistachio. Every surface in the product is something you could eat. This is not a decorative flourish laid over a neutral system — it *is* the system. There are no greys in the palette, no true white, no true black; even the darkest text colour is a warm plum rather than an ink black.

Underneath the confection the structure is disciplined. Corners follow a strict five-step ladder, edges are defined by a single hairline, numbers are tabular, and the type scale makes one hard jump from 400-weight body to 700/800-weight display with nothing in between. The softness is the finish, not the substance — which is what stops the app from reading as cloying and what lets it hold a real-time competitive match without feeling like a toy that broke.

Two anti-references are binding. This is **not esports**: no dark chrome, no neon-on-black, no angular framing, no leaderboard density — the product spec's own words are "avoid making V1 games feel like serious esports." And despite being full of statistics, this is **not a productivity dashboard**: no data grid, no dense KPI tiles, no chart-first layout. The numbers on the dashboard are affection, not reporting.

**Key Characteristics:**
- One centred 28rem column on every route, phone and desktop alike
- Pastel-only palette, warm plum ink, no greys and no pure white
- Hairline borders define edges; shadows are atmosphere
- Everything is a pill or a rounded card — no sharp corners anywhere
- Springy 120ms press feedback on `:active`, never on `:hover`
- Emoji glyphs instead of an icon set

## Colors

A sweets counter: warm creams and pastel fills, one saturated pink that does all the work, and a blue that exists mostly to be the other half of the wordmark.

### Primary
- **Rasmalai Pink** (`#c93a64`): every primary action, the "malai" half of the wordmark, error text, and the focus ring on every focusable element. The one saturated colour in the resting palette, and the hardest-working token in it — it is a fill under light text, a text colour on cream, and a non-text indicator, so it has to clear the bar in all three roles at once (4.84 / 4.67 / 4.67).
- **Syrup Deep** (`#a82a4b`): the pressed state of a primary action, carrying Shell text at 6.68:1. Never a resting fill.

### Secondary
- **Cardamom Blue** (`#2b70ca`): the "Ras" half of the wordmark, and the pressed state of a soft button. Chosen over the lighter blueberry because it clears roughly 4.7:1 on cream, where the pale sky fill sits at about 1.3:1.
- **Morning Sky** (`#cfe6ff`): the resting fill of a soft (secondary) button, and the active tint on a ghost button.
- **Overcast Sky** (`#a5d0f7`): the pressed state of a soft button. The same hue one step darker — about 21% less luminance, enough to read as a press, while keeping Plum Ink on it at 8.1:1.

### Tertiary
- **Icing Blush** (`#ffd6e0`): the pressed tint on drawer rows and icon buttons, and the marker for the currently active nav section.
- **Sponge Butter** (`#ffeec2`): reserved almost entirely for the "soon" chip on an unbuilt game.
- **Pistachio Mint** (`#c8f0e0`) and **Lilac** (`#e5dbff`): the remaining counter colours, available for game surfaces and future accents.

### Neutral
- **Counter Cream** (`#fff8f2`): the page ground, and the fill of any surface that sits *inside* a card — form controls, drawer rows, catalogue rows.
- **Shell** (`#fffdfb`): the card itself. A half-step lighter than cream, which is the entire difference between a card and the page behind it.
- **Plum Ink** (`#3d2b3a`): all body and heading text. Warm, never black. Also the drawer scrim at 30% opacity.
- **Muted Plum** (`#7e6b78`): secondary text — labels under statistics, blurbs, captions, ghost button text.
- **Hairline** (`#f1e3ea`): every border in the product, and the "checking" presence dot.

### Named Rules

**The Six-Digit Rule.** Every palette token is a six-digit hex string, and this is load-bearing rather than stylistic. `packages/games/src/reflex/client.tsx` and `basketball/client.tsx` read these tokens at runtime with `getComputedStyle` and parse them with `/^#([0-9a-f]{6})$/i`. An `oklch()`, `rgb()`, three-digit, or eight-digit value drops both Phaser games to hardcoded fallbacks silently, with no error anywhere. `apps/web/src/design-system/theme.test.ts` enforces it.

**The Two Voices Rule.** A person's name, and any number that belongs to them, carries their colour — Cardamom Blue (`#2f6fd0`) or Orchid (`#c33a86`), from their real gender rather than from which side of a row they sit on, since the viewer is not always the same one of the two. This always goes through `PersonName` / `nameTone`; the mapping exists in exactly one file. Unknown gender falls back to Plum Ink rather than guessing. The two are held level on purpose — 4.64:1 and 4.67:1 on cream — so neither person's name reads as the louder one, and hers is a magenta at 350.6° rather than the rose it started as, because reaching that contrast walked it toward Rasmalai Pink at 7.5°. A name that looks like the Play button is worse than the contrast problem that started it.

**The Three Jobs Rule.** Rasmalai Pink is a fill beneath light text, a text colour on cream, and the focus ring. A value is only allowed into that token if it clears every one of those readings — 4.5:1 both ways, and the 3:1 the ring owes as a non-text indicator. It was `#f2678f` for exactly as long as nobody checked: a lovely pink that failed all three at 2.91 / 2.81 / 2.81. The fix was to darken the one token rather than split it, because a second pink a few degrees away would read as a bug, not as a system.

**The Alarm Colours Rule.** `status-online` (`#34c759`) and `status-offline` (`#ff3b30`) are the only saturated non-pastel colours in the system, and they are reserved for partner presence. A status dot must read unambiguously at a glance, and a soft mint or blush tint cannot do that. Presence is also never colour alone — the drawer row spells the word beside the dot.

## Typography

**Display Font:** Poppins (self-hosted, weights 600/700/800, falling back to `ui-rounded`, `SF Pro Rounded`, `Nunito`, `system-ui`)
**Body Font:** Inter (self-hosted variable, 100–900, falling back to `system-ui`, `-apple-system`)

**Character:** A rounded geometric display face doing all the emphasis, against a neutral workhorse doing all the reading. Poppins carries the cuteness — its circular bowls are why headings and buttons feel soft without any extra styling — while Inter stays out of the way in blurbs, statistics and body copy. Both are committed as `.woff2` under `apps/web/src/app/fonts/` so the build never touches the network.

### Hierarchy
- **Hero** (800, 2.5rem, 1.1, −0.025em): the landing wordmark and the largest headings. The only place weight 800 appears.
- **Title** (700, 2rem, 1.15, −0.02em): page-level headings.
- **Heading** (700, 1.5rem, 1.2, −0.015em): section headings inside a card.
- **Subhead** (600, 1.125rem, 1.35): card titles, button labels, names.
- **Lede** (400, 1.125rem, 1.625): the opening line under a heading. Body face, display size.
- **Body** (400, 1rem, 1.5): default reading text.
- **Small** (400, 0.875rem, 1.43): descriptions, secondary lines, error text.
- **Caption** (400, 0.75rem, 1.35, +0.04em): stat labels, blurbs, chips. The only step with positive tracking.

### Named Rules

**The Two Weights Rule.** Display type is 700 or 800; body type is 400. There is deliberately nothing in between — no 500 headings, no semibold body. The hierarchy is carried by the jump, so filling the gap flattens it. The one sanctioned exception is 600 at Subhead, where a card title has to sit close to the text it introduces.

**The Tabular Rule.** Every number that can change — scores, streaks, days together, win counts — renders with `tabular-nums`. Statistics sit in fixed-width columns and side-by-side comparisons, and proportional digits make them jitter between renders.

**The Additive Scale Rule.** These named steps sit alongside Tailwind's `text-xs … text-9xl`, which all still resolve. `packages/games` renders with `text-sm` / `text-xl` / `text-3xl` and must not be edited, so the named scale extends the numeric one rather than replacing it.

## Layout

One centred column, `--container-app` at 28rem, on every route — signed-out landing, onboarding, pairing, dashboard, games, play, tournament. The app shell is `mx-auto flex min-h-dvh w-full max-w-app flex-col gap-5 px-5 py-8`; the signed-out landing uses the same column with more generous padding (`px-6 py-12`) and centres its content vertically.

Desktop is the same object with more air around it, never a wider layout. There is no two-column state, no sidebar, and no breakpoint at which the column grows: a partner on a laptop and a partner on a phone are looking at the same shape, which is what keeps a shared match legible to both.

Vertical rhythm runs on four named steps — `block` (1.25rem) between related rows, `gutter` (1.5rem) as the standard card padding and inter-card gap, `section` (2rem) between major regions, `hero` (3rem) around a landing composition. Inside a card, gaps of `0.5rem`–`0.75rem` group a label to its value.

The column is a token, `--container-app`, applied as `max-w-app`; no surface in `apps/web` carries the width as a literal. `packages/games` is the one deliberate exception — its renderers use Tailwind's own `max-w-md`, which is the same 28rem today but does not follow `--container-app`, because the games are not editable from the web app's side. Widening the column is therefore a two-part decision, and the games keep their own width until someone changes them.

The header strip is fixed at 44px so the hamburger, the wordmark and the partner's presence badge all clear the tap-target minimum in a single row.

### Named Rules

**The One Column Rule.** Every surface lives in the 28rem column. A design that needs more width is a design that has stopped being Rasmalai.

**The Bare Spacing Rule.** Never set the bare `--spacing` token. In Tailwind v4 it is the multiplier behind the entire numeric scale, so changing it moves `min-h-11` off the documented 44px tap-target minimum and resizes every glyph inside `packages/games`, which cannot be edited to compensate. Add named `--spacing-*` keys instead.

## Elevation & Depth

Hairline-first. A card is defined by its 1px `--color-line` border, not by its shadow — that single decision is what stops surfaces from reading as stickers pasted onto the page. Depth beyond that comes from a half-step tonal shift: Shell (`#fffdfb`) for a card, Counter Cream (`#fff8f2`) for both the page behind it and the rows nested inside it, so a card reads as a lighter plane floating on cream while its contents recede back to the ground colour.

Shadows are atmosphere. They are wide, very light, and carry no negative spread; removing every shadow in the product would leave the hierarchy intact.

### Shadow Vocabulary
- **Soft** (`box-shadow: 0 8px 30px rgb(61 43 58 / 0.08)`): the resting shadow on cards and on the header's icon buttons. Ambient only.
- **Lift** (`box-shadow: 0 12px 40px rgb(61 43 58 / 0.12)`): reserved for things that genuinely float above the page — currently only the navigation drawer.

### Named Rules

**The Hairline Rule.** The border defines the edge; the shadow only suggests air. If a surface needs more separation, reach for the tonal step (cream → shell) before reaching for a heavier shadow, and never for both at once.

## Shapes

No sharp corners exist anywhere in Rasmalai. The radius ladder has five rungs and everything lands on one of them: **tight** (0.375rem) for the smallest inline marks, **soft** (0.625rem) for nested rows, form controls and drawer items, **card** (1rem) for cards and panels, **sheet** (1.5rem) for full-bleed surfaces, and **pill** (999px) for anything that reads as an object rather than a container.

The pill is where most of the app's character actually lives: buttons, avatars, chips, status dots, the drawer's hamburger bars, and the icon buttons are all fully rounded. The rest of the ladder is deliberately tighter than a soft pastel product would suggest — at a 28rem column a 12px card looks mean and a 24px card looks inflated, so 16px keeps a trace of softness without bloating.

Borders are always 1px in `--color-line`, with one exception: the presence dot takes a 2px border in the *background* colour behind it, so the dot punches a hole in the avatar rather than sitting on top of it.

### Named Rules

**The Pill Rule.** If it is an object — pressed, worn, or read as a single token — it is a pill. If it is a container — something else lives inside it — it is on the radius ladder. Nothing is square.

## Components

Soft, springy and thumb-sized. Every control is at least 44px on its short axis, squashes to 95% on press, and reacts to `:active` rather than `:hover`.

### Buttons
- **Shape:** fully rounded pill (`999px`), `min-height: 2.75rem` (44px), horizontal padding 1.5rem, Poppins semibold at 1rem.
- **Primary:** Rasmalai Pink fill, Shell text, soft ambient shadow. Pressed: Syrup Deep.
- **Soft:** Morning Sky fill, Plum Ink text. Pressed: Overcast Sky — the label stays Plum Ink through the press, so the pressed fill has to carry it.
- **Ghost:** transparent, Muted Plum text. Pressed: Morning Sky tint.
- **Press:** `transform: scale(0.95)` over 120ms on `cubic-bezier(0.34, 1.56, 0.64, 1)`.
- **Focus:** 2px Rasmalai Pink outline with a 2px offset. The same ring is used on every focusable element in the product, including links and drawer rows.
- **Disabled:** 50% opacity, `not-allowed` cursor, and the press transform suppressed.
- A control that navigates uses `ButtonLink` and is a real `<a>`, styled from the same function as `Button` — never a `<button>` nested in a link.

### Cards / Containers
- **Corner Style:** 1rem (`card`).
- **Background:** Shell, on the Counter Cream page ground.
- **Border:** 1px Hairline.
- **Shadow Strategy:** Soft, ambient only — see Elevation & Depth.
- **Internal Padding:** 1.5rem (`gutter`).
- Rows nested inside a card drop back to Counter Cream at `soft` radius, so nesting reads by tone rather than by another border.

### Inputs / Fields
- **Style:** Counter Cream fill, 1px Hairline border, `soft` radius, 44px minimum height, 1rem horizontal padding, full width.
- **Label:** Poppins semibold at 0.875rem in Plum Ink, sitting 0.375rem above the control. Always a real `<label>` wrapping both.
- **Focus:** the standard 2px Rasmalai Pink outline at 2px offset.
- **Error:** message in Rasmalai Pink at 0.875rem with `role="alert"`, and `aria-invalid` on the control. Errors appear below, never as a replaced label.

### Chips
- **Style:** pill, Sponge Butter fill, Muted Plum caption text, 0.5rem × 0.125rem padding.
- **Use:** currently only the "soon" marker on an unbuilt game. A decorative 🔒 may sit beside it, always `aria-hidden`, because the word already says the same thing.

### Navigation
- **Trigger:** a 44px pill icon button in Shell with a soft shadow, holding three 2px rounded bars drawn in markup rather than an icon font.
- **Drawer:** 18rem wide (capped at 85vw), Shell fill, slides in from the left over 240ms on the bounce easing, above a Plum Ink scrim at 30%.
- **Rows:** `soft` radius, Counter Cream at rest, Icing Blush when active or pressed; an emoji glyph, a Poppins semibold label, and a caption blurb beneath it.
- **Always mounted** so the slide has something to animate, with `inert` and `aria-hidden` while closed. Dismisses on backdrop, on Escape, and on choosing a section.

### Avatar & Presence Badge
The signature pairing. A 2.25rem Counter Cream pill holding an emoji avatar glyph, with a 0.75rem status dot notched into its bottom-right corner behind a 2px border in the surrounding background colour. Three states, never two: online (green), offline (red), and unknown (Hairline, labelled "checking") — a grey dot that says "offline" about somebody sitting there waiting is worse than admitting we cannot see. Colour transitions run 240ms.

### Statistic
A number over a label: Poppins bold 1.5rem tabular in Plum Ink, above a 0.75rem caption in Muted Plum, centred. The versus form puts both partners' figures at the ends of a row with the label between them, each figure tinted by The Two Voices Rule.

### Wordmark
"Ras" in Cardamom Blue, "malai" in Rasmalai Pink, Poppins bold, rendered from a single component so the three placements cannot drift. The two halves are adjacent spans with no whitespace between them, so the accessible name stays the single word "Rasmalai".

### Named Rules

**The Active-Not-Hover Rule.** No interaction may be hover-only. Every state a control can express must be reachable by touch, so styling responds to `:active` and `:focus-visible`; hover is a bonus a phone never receives.

**The Pressed-Label Rule.** A control that keeps its label colour through a press must have its *pressed* fill carry that label at 4.5:1, not just its resting fill. A pressed state is on screen only while a finger is down, so it is invisible to screenshots and reviews and shows up only for the person who cannot read the thing they are pressing. `theme.test.ts` computes this from the hex rather than trusting the eye.

**The Glyph Rule.** Iconography is emoji, chosen per game and per section, always `aria-hidden` with the meaning carried in adjacent text. No icon font, no icon package, no SVG icon set — the emoji are part of the confection, and they are why the product needs no icon system at all.

## Do's and Don'ts

### Do:
- **Do** put every new surface in the 28rem centred column, and make desktop the same object with more air.
- **Do** reference tokens — `bg-berry`, `rounded-card`, `shadow-soft`, `duration-quick` — and never hardcode a colour, radius, shadow, or duration. The whole identity has to be swappable by editing `theme.css` alone.
- **Do** keep every palette value a six-digit hex string (The Six-Digit Rule).
- **Do** set the column with `max-w-app`, never a literal `max-w-md`. Both are 28rem, so a stray literal only reveals itself the day the column changes width.
- **Do** check the *pressed* fill of any control that keeps its label colour through the press. A resting state that passes says nothing about the state a finger is holding.
- **Do** check a colour in every role it plays before changing it. Berry is a fill, a text colour and an indicator; passing as one of those says nothing about the other two.
- **Do** give every control a 44px minimum on its short axis and a `:active` press, not a `:hover`.
- **Do** use the standard focus ring — 2px Rasmalai Pink at 2px offset — on everything focusable, including links.
- **Do** route every person's name through `PersonName` and every owned number through `nameTone`.
- **Do** pair any colour-carried state with a word: the presence row says "online" beside the dot, the "soon" chip says "soon" beside the 🔒.
- **Do** use `tabular-nums` on any number that changes.
- **Do** keep new animation inside the two named durations (120ms quick, 240ms soft) on the bounce easing, and let the global `prefers-reduced-motion` rule cancel it.

### Don't:
- **Don't** introduce a grey, a pure white, or a true black. The neutrals are warm and already exist.
- **Don't** convert the palette to `oklch()` or any other format — it silently breaks two Phaser games.
- **Don't** set the bare `--spacing` token (The Bare Spacing Rule).
- **Don't** add a sharp corner, or a radius that is not one of the five rungs.
- **Don't** add a heavier shadow to create separation; use the cream → shell tonal step and the hairline border.
- **Don't** add a weight between 400 and 700 to the type scale beyond the sanctioned 600 subhead.
- **Don't** bring in an icon library. Reach for an emoji glyph.
- **Don't** let the dashboard drift toward analytics — no data grids, no KPI tiles, no charts as the primary form.
- **Don't** let a game drift toward esports chrome — no dark backgrounds, no neon, no angular competitive framing.
- **Don't** edit `packages/games` styling to accommodate a web-app change; the named scales exist so the games keep rendering untouched.
