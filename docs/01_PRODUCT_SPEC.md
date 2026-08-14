# Rasmalai Product Specification

## 1. Product statement

Rasmalai is a private two-player browser game platform for permanently paired partners. The core experience is spending time together through quick, cute, chaotic, synchronized games.

## 2. Target

V1: the creator and their partner.
Near future: friends and their partners.
V1 scale target: approximately 200 registered users and 70–80 concurrent users.

## 3. Core experience

New user:
1. Sign in with Google.
2. Complete onboarding.
3. Provide actual name, nickname, birth year, partner's actual name, partner's nickname, exact first-met date, and relationship location type.
4. Receive a unique pairing code.
5. Share the code or enter the partner's code.
6. The receiving partner gets a pairing request.
7. Receiver chooses Accept or Reject.
8. Acceptance permanently pairs the two accounts.

Paired user:
1. Open couple dashboard.
2. Browse unlocked games.
3. Select a game.
4. Partner receives an invitation.
5. Partner chooses ❤️ PLAY or 🙈 NOT NOW.
6. Invitation expires after 5 minutes.
7. Acceptance creates/opens the game lobby.
8. Both players become ready.
9. Server starts a synchronized match.
10. Players play.
11. Results are shown.
12. Players can rematch or choose another game.

## 4. Dashboard

Private to the couple.

Show:
- both profiles/avatars
- actual/nickname presentation as appropriate
- days together, calculated from exact first-met date
- total games played
- wins by each person
- win percentage
- current streak
- longest winning streak
- favourite game
- best score
- total time played
- games played in the last 7 days
- games won in the last 7 days
- most competitive game
- closest match
- tournament wins

## 5. Profiles

Each user:
- Google identity
- actual name
- nickname
- birth year
- profile image
- optional preset abstract avatar

Nicknames do not need to be globally unique.

Profile visibility is private to the couple in V1.

## 6. Relationship metadata

Onboarding asks:
- exact first-met date
- same city / different city / live-in

This metadata is private to the couple and is initially dashboard-only.

Include a “prefer not to say” option for location type if appropriate.

## 7. Game categories

### Competitive
- Basketball
- Four in a Row
- Reaction Speed
- Reflex

### Cooperative
- Bomb Defusal
- Puzzle Solving
- Boat Escape
- Survival

### Social
- Who's More Likely
- Never Have I Ever
- Would You Rather
- Guess My Answer
- Couple Trivia
- Truth/Dare-style games

### Casual
- Drawing
- Word games
- Memory games

V1 should not require every listed game to be implemented immediately. Select the first vertical-slice game based on technical simplicity and value.

## 8. Game philosophy

Games should feel:
- cute
- playful
- chaotic
- unpredictable
- quick
- socially engaging

Avoid making V1 games feel like serious esports.

## 9. Individual games vs tournaments

Individual mode:
Lobby → Game → Results → Rematch / Choose another.

Tournament mode:
- either partner can create a tournament
- creator selects games
- selected game list becomes locked when tournament starts
- games are played sequentially
- each game produces a result
- overall points determine winner
- show cute tournament statistics
- disconnect recovery can restart the affected tournament game

Default scoring:
- Win = 3
- Draw = 1
- Loss = 0

## 10. Invitations

Only one active invitation per couple.
If a second invitation is created, invalidate the first immediately.
Game invitations expire after 5 minutes.
Partner must explicitly accept/reject.

## 11. Active sessions

Only one active game session per couple in V1.

If the partner is absent, V1 does not offer individual games. V2 may add individual games so the waiting partner is not bored.

## 12. Reactions

During games:
- 😂
- ❤️
- 😭
- 😡
- 👀

Reactions are realtime and ephemeral. They disappear immediately and are not stored as match history.

## 13. Visual direction

Initial:
- cute/cartoon
- rounded cards
- soft/pastel visual language
- cute abstract avatars
- small animations

Keep visual tokens/theme configuration centralized so the entire visual identity can be changed later.

## 14. Audio and communication

V1:
- no voice
- no text chat
- no sound
- no music

Keep extension points but do not implement.

## 15. Privacy

No public profile discovery.
No cross-couple access.
No global matchmaking.
No ads if avoidable; prioritize a clean private experience.

## 16. Data retention

Raw matches: retain for 7 days only.
Lifetime aggregate statistics: retain indefinitely.
“Days together” is calculated dynamically from first-met date.

## 17. V2 direction

Potential:
- individual games
- inter-couple competitions
- relationship-level unlocking
- achievements/cosmetics
- chat
- voice
- sound/music
- broader public product
