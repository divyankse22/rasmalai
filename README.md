# Rasmalai — Multiplayer Couple Mini-Game Platform

Rasmalai is a private, browser-first, two-player gaming platform for permanently paired partners.

## Current product goal

Build a cute, mobile-responsive web experience where two paired people can:
- authenticate with Google
- permanently pair using a private code and explicit acceptance
- see a private couple dashboard
- invite each other to mini-games
- play synchronized two-player games in real time
- use ephemeral reactions during games
- play individual games and multi-game tournaments
- see seven-day match history plus lifetime aggregate statistics

V1 is private and supports only two players per couple. It is designed so future versions can add individual games, inter-couple games, relationship-level unlocking, sound/music, chat, and additional game types.

## Important operating rule

Do NOT begin implementation until Claude has:
1. read all files in `docs/`
2. read `CLAUDE.md`
3. read all skills in `skills/`
4. asked clarification questions for every unresolved or contradictory requirement
5. received explicit confirmation that the architecture and V1 scope are agreed

The goal is a weekend-first vertical slice, not eight games at once.

## Recommended first vertical slice

Google login → onboarding → pairing → couple dashboard → game invitation → acceptance → lobby → synchronized game → results → rematch.

Implement one simple game end-to-end before adding the rest.

## Development

Requires Node 22+ (see `.nvmrc`). Decisions and the full design live in
`docs/13_ARCHITECTURE_PROPOSAL.md`.

```bash
npm install
cp .env.example .env      # slice 1 runs on the defaults; fill in the rest as slices land
npm run dev               # web on :3000, server on :4000
```

| Command | Does |
|---|---|
| `npm run dev` | Runs the web app and the backend together |
| `npm run verify` | typecheck → lint → test → build, i.e. the whole gate |
| `npm test` | Unit tests (vitest) |
| `npm run typecheck` | `tsc --noEmit` across every workspace |
| `npm run lint` | ESLint across every workspace |
| `npm run docker:server:build` | Builds the backend container from the repo root |

### Layout

```text
apps/web        Next.js client. Design tokens live in src/design-system/theme.css
apps/server     Authoritative HTTP + WebSocket backend
packages/shared Protocol envelope, event names, error codes
supabase        SQL migrations
```

Testing pairing and multiplayer locally needs **two Google accounts and two browser profiles**
(one normal window plus one incognito window is enough).
