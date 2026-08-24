# Site DNA: corgilabs.ai

Extracted 2026-08-24 via `ui-cloner` Phase 1 (Chrome console protocol), viewport 1470x757, page height 7588px.

**Scope note:** only the measurable design system is recorded here — scale, rhythm, radii, easing.
No imagery, mascot, logo, or copy is taken. Rasmalai keeps its own palette and its own content.

## 1. Identity & Vibe

Clean B2B fintech. White ground, generous whitespace, hairline borders doing more work than
shadows, heavy geometric headings with tight negative tracking. Friendly rather than austere —
the display face has circular bowls and the accent is a warm orange alongside the blue.

Build: Tailwind + shadcn/ui (radius/shadow custom properties, accordion + tw-animate keyframes).

## 2. Design System Tokens

### Colors — NOT ADOPTED
Recorded for completeness only. Rasmalai's pastel palette is frozen and unchanged.
Their scheme is HSL triplets: `--primary: 222 88% 58%` (blue), `--secondary: 33 100% 51%`
(orange), `--foreground: 226 27% 28%`, `--background: 0 0% 100%`, `--border: 214 32% 91%`.

### Typography — ADOPTED (structure)
| Role | Family | Size | Weight | Line-height | Tracking |
|---|---|---|---|---|---|
| h1 | Poppins | 60px | 800 | 66px (1.10) | -1.5px (-0.025em) |
| h2 | Poppins | 36px | 700 | 40px (1.11) | -0.9px (-0.025em) |
| h3 | Poppins | 24–30px | 700 | 32–36px (1.20) | -0.75px / normal |
| h4 | Poppins | 15px | 600 | 22.5px (1.50) | normal |
| body | Inter | 14–16px | 400 | 1.625 | normal |
| list | Inter | 18px | 400 | 29.25px (1.625) | normal |
| button | Inter | 14px | 600 | — | normal |

Usage tally: Inter 137 nodes, Poppins 47. **Two-face system: Poppins display, Inter body.**

The load-bearing rules: **-0.025em tracking on every heading**, **line-height ~1.1 on large
headings tightening to 1.2 at h3**, **1.625 on body copy**, and a hard weight jump (800/700
headings vs 400 body) with no mid-weights in between.

### Spacing — ADOPTED (rhythm)
- Flex/grid gaps, by frequency: 12px (17), 16px (14), 8px (7), 32px (4), 48px (4), 24px, 64px, 80px
- Section padding: 80/48, 96/48, 112/48, 72/0, 48/48, 32/48 (vertical / horizontal)
- Container max-width: **1200px** (11 uses), with 340px / 550px / 768px / 800px inner measures

Scale is a clean 4px base: 4, 8, 12, 16, 24, 32, 48, 64, 80, 96, 112.

### Visual Effects — ADOPTED
```
--radius:        .375rem   (6px)
--radius-button: .625rem   (10px)
--radius-card:   .75rem    (12px)
--radius-lg:     1.5rem    (24px)
--radius-full:   9999px

--shadow-card:        0 8px 30px hsla(225, 27%, 29%, .08)
--shadow-card-hover:  0 12px 40px hsla(225, 27%, 29%, .12)
--shadow-primary:     0 4px 14px hsla(222, 88%, 58%, .35)
```
Computed radius tally: 9999px (25), 24px (13), 12px (12), 16px (9), 10px (7).
Border: `1px solid rgb(225, 231, 239)` — a hairline, used on every card.

**The defining move: shadows are very low-alpha (.08–.12) and wide-blurred; definition comes
from the hairline border, not the shadow.**

## 3. Animation System

### Libraries Detected
**None.** GSAP ✗, ScrollTrigger ✗, Lenis ✗, Locomotive ✗, Lottie ✗, Three.js ✗, Framer ✗,
AOS ✗, Barba ✗, SplitText ✗, Swiper ✗.

Scroll-animated elements: **0**. → **Animation Tier 1** (CSS + IntersectionObserver only).

This is the best possible outcome for Rasmalai: nothing to port, no new runtime dependency,
and no conflict with the existing `prefers-reduced-motion` kill-switch.

### Global Animation Defaults
- Easing: `cubic-bezier(0.4, 0, 0.2, 1)` — **67 of 67 transitions**, unanimous. Tailwind's
  default ease-in-out. Smooth and symmetric; **no spring, no overshoot.**
- Durations: 0.15s (39), 0.3s (21), 0.2s (7)
- Transition properties: `all` (30), `color` (22), `transform` (9), `box-shadow` (6)

### Extracted @keyframes (19 total, 12 sampled)
Framework-supplied (shadcn/tw-animate): `enter`, `exit`, `accordion-up/down`,
`collapsible-up/down`, `pulse`, `spin`.

Authored:
```css
@keyframes float      { 0%,100% { transform: translateY(0px); }
                        50%     { transform: translateY(-12px); } }
@keyframes float-slow { 0%,100% { transform: translateY(0px) rotate(0deg); }
                        50%     { transform: translateY(-8px) rotate(5deg); } }
@keyframes fade-in-up { 0%   { opacity: 0; transform: translateY(30px); }
                        100% { opacity: 1; transform: translateY(0px); } }
@keyframes shimmer    { 0%   { background-position: -200% 0px; }
                        100% { background-position: 200% 0px; } }
```

### Hover Rules — RECORDED, NOT ADOPTED AS-IS
The site is hover-driven (`--shadow-card-hover`, `--shadow-primary-hover`, 0.3s `all`).
`docs/06_UX_AND_STATE_FLOWS.md` forbids hover-only interaction on a phone-first product, so
these translate to `:active` or are dropped. Do not import them literally.

## 4. Component Measurements

### Buttons
| Variant | Height | Padding | Radius | Font | Border | Shadow |
|---|---|---|---|---|---|---|
| Outline (Sign In) | 40px | 0 24px | 10px | 14px/600 | 2px solid accent | none |
| Solid primary | 48px | 12px 32px | 10px | 14px/600 | none | tinted, low alpha |
| Solid large CTA | 48px | 24px 32px | 10px | 18px/600 | none | tinted, low alpha |

Transition 0.3s `cubic-bezier(0.4,0,0.2,1)`. Note **48px height** — comfortably above
Rasmalai's 44px floor, so `min-h-11` is safe to keep.

### Cards
| Kind | Padding | Radius | Border | Transition |
|---|---|---|---|---|
| Feature panel | 24px 64px | 24px | none | none |
| Testimonial | 32px | 12px | 1px hairline | 0.3s |
| Compact/list | 16px | 12px | none | 0.15s |

Consistent pattern: **generous padding relative to radius**. 32px padding on a 12px radius is
what makes it read crisp rather than bubbly.

## 5. Translation to Rasmalai

Rasmalai is a `max-w-md` (448px) phone-first app; corgi is a 1200px desktop marketing page.
Multi-column grids, the 1200px container, hero carousels and 112px section padding do not
transfer. What transfers:

| Corgi measurement | Rasmalai token | From | To |
|---|---|---|---|
| `--radius-button: .625rem` | `--radius-soft` | 1rem | 0.625rem |
| `--radius-card: .75rem` / `--radius-lg: 1.5rem` | `--radius-card` | 1.75rem | 1rem |
| `--radius-full` | `--radius-pill` | 999px | unchanged |
| `--shadow-card` (.08 alpha, 30px blur) | `--shadow-soft` | `0 8px 24px -12px / .25` | `0 8px 30px / .08` |
| `--shadow-card-hover` (.12, 40px) | `--shadow-lift` | `0 16px 40px -16px / .32` | `0 12px 40px / .12` |
| Heading tracking -0.025em | new `--tracking-tight` | — | -0.025em |
| Heading line-height 1.1–1.2 | new type-scale tokens | — | 1.1 / 1.2 |
| Body line-height 1.625 | new `--leading-body` | — | 1.625 |
| `cubic-bezier(0.4, 0, 0.2, 1)` | `--ease-bounce` | spring (0.34,1.56,0.64,1) | **open question** |
| 0.15s / 0.2s / 0.3s | `--transition-duration-*` | 120ms / 240ms | 150ms / 300ms |
| Poppins display + Inter body | `--font-display` / `--font-body` | system rounded stack | **open question** |

### Frozen — do not touch
All 18 colour tokens. They stay 6-digit hex (`reflex` and `basketball` parse them at runtime
with `/^#([0-9a-f]{6})$/i`; any other notation silently breaks both Phaser games).
