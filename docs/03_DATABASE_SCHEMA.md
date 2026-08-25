# Rasmalai PostgreSQL Data Model

This is a logical schema, not a command to blindly create every table immediately. Claude must validate the schema against the chosen auth implementation and retention strategy before migration.

## users

- id: UUID / application user ID
- google_subject: unique external Google identifier
- email: optional/verified identity field as appropriate
- actual_name
- nickname
- birth_year
- avatar_type
- avatar_value
- created_at
- updated_at

Nickname is NOT globally unique.

## couples

- id
- user_a_id
- user_b_id
- first_met_date
- location_type
- created_at
- updated_at

Enforce that a V1 user belongs to at most one active couple.

## pairing_requests

- id
- requester_user_id
- target_user_id
- status: pending / accepted / rejected
- created_at
- responded_at

Pending requests remain indefinitely.
Rejected requests are not accepted.
Pairing is permanent once accepted.

## games

- id
- slug
- name
- category
- description
- enabled
- created_at

Game catalogue data should not be hardcoded in the UI.

## matches

Raw match records retained for 7 days.

- id
- couple_id
- game_id
- mode: individual / tournament
- tournament_id nullable
- status
- winner_user_id nullable
- player_a_score
- player_b_score
- started_at
- ended_at
- expires_at

The retention system deletes/archives raw match records after 7 days.

## tournaments

- id
- couple_id
- name
- status
- created_by_user_id
- created_at
- started_at
- ended_at
- total_points_a
- total_points_b
- winner_user_id

## tournament_games

- id
- tournament_id
- game_id
- position
- match_id nullable
- locked configuration

Once tournament starts, selected games are immutable.

## lifetime_statistics

One aggregate row per couple, with carefully defined fields, or normalized statistic rows if that becomes cleaner.

Possible fields:
- total_games
- user_a_wins
- user_b_wins
- draws
- user_a_current_streak
- user_b_current_streak
- user_a_longest_streak
- user_b_longest_streak
- total_time_played
- favourite_game
- best_score
- most_competitive_game
- closest_match
- tournament_wins_a
- tournament_wins_b

Validate exact formulas before migration.

## weekly_statistics

Because only the last 7 days are needed, this can be implemented as:
- daily/rolling aggregate data with expiry, or
- raw match queries over the 7-day window.

For V1, prefer the simplest correct implementation. Do not create unnecessary aggregate complexity if 70–80 concurrent users makes direct querying safe.

## Important data rules

- Couple data is private.
- Every couple-scoped query must derive couple_id from authenticated user membership.
- Never trust a couple_id supplied by the browser.
- First-met date drives “days together.”
- Raw matches expire after 7 days.
- Lifetime stats remain.
