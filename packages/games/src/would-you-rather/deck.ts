/**
 * The dilemma deck. **Server-only** — this module is reachable from `server.ts` and from nowhere
 * the browser can import, which is what keeps the two dilemmas the Asker did not choose off the
 * Answerer's machine. See the note at the top of `protocol.ts`.
 *
 * Sixty dilemmas, written for Rasmalai rather than collected. `docs/15_WOULD_YOU_RATHER_CONTENT.md`
 * records what was researched, what was rejected, and the two rubrics every entry had to pass.
 *
 * **Difficulty is load-bearing, not decoration.** `docs/01_PRODUCT_SPEC.md` section 8 asks for games
 * that feel cute and playful; this game was specified to be psychologically uncomfortable. Both are
 * satisfied by making the match warm up: rounds 1–2 draw from 1–2, rounds 3–4 from 2–4, rounds 5–6
 * from 3–5. Nobody opens with mortality, and nobody finishes on whether they like being early.
 *
 * **The bar every entry had to clear**: both options genuinely defensible, neither a joke, neither
 * obviously correct, concise enough to read on a phone, and impossible to answer without revealing
 * something. Anything that was really one option dressed as two was cut.
 */

/**
 * The value each dilemma pulls against itself. Used only to keep the Asker's three candidates from
 * all being the same question in different clothes — it never reaches the client, and it is
 * emphatically not a personality classification.
 */
export type Axis =
  | 'truth'
  | 'memory'
  | 'loyalty'
  | 'control'
  | 'mortality'
  | 'freedom'
  | 'justice'
  | 'intimacy'
  | 'identity'
  | 'sacrifice';

export type Difficulty = 1 | 2 | 3 | 4 | 5;

export interface Dilemma {
  prompt: string;
  optionA: string;
  optionB: string;
  axis: Axis;
  difficulty: Difficulty;
}

export const DECK: readonly Dilemma[] = [
  // ── Difficulty 1 — a real choice, but nobody is going to lie awake ──────────────────────────
  { prompt: 'Would you rather…', optionA: 'Always be ten minutes early', optionB: 'Always be ten minutes late', axis: 'identity', difficulty: 1 },
  { prompt: 'Would you rather…', optionA: 'Hear only music you love, but never choose it', optionB: 'Choose every song, but only ones you already know', axis: 'freedom', difficulty: 1 },
  { prompt: 'Would you rather…', optionA: 'Never need to sleep again', optionB: 'Never need to eat again', axis: 'control', difficulty: 1 },
  { prompt: 'Would you rather…', optionA: 'Always know how long the queue will take', optionB: 'Always know whether it is worth queuing', axis: 'truth', difficulty: 1 },
  { prompt: 'Would you rather…', optionA: 'Talk to animals, and bore them', optionB: 'Never understand them, and be adored', axis: 'intimacy', difficulty: 1 },
  { prompt: 'Would you rather…', optionA: 'Perfect weather on every day off', optionB: 'Nobody ever cancels on you', axis: 'control', difficulty: 1 },
  { prompt: 'Would you rather…', optionA: 'Remember every dream you have', optionB: 'Never dream again', axis: 'memory', difficulty: 1 },
  { prompt: 'Would you rather…', optionA: 'Be slightly too warm, always', optionB: 'Be slightly too cold, always', axis: 'identity', difficulty: 1 },
  { prompt: 'Would you rather…', optionA: 'Unsay one thing a year', optionB: 'Unhear one thing a year', axis: 'truth', difficulty: 1 },
  { prompt: 'Would you rather…', optionA: 'Always get the window seat, never pick the trip', optionB: 'Pick every trip, always sit in the middle', axis: 'freedom', difficulty: 1 },

  // ── Difficulty 2 — you will hesitate ────────────────────────────────────────────────────────
  { prompt: 'Would you rather…', optionA: 'Know exactly what everyone earns', optionB: 'Have everyone know exactly what you earn', axis: 'truth', difficulty: 2 },
  { prompt: 'Would you rather your partner…', optionA: 'Read every message you have ever sent', optionB: 'Watch everything you have ever watched', axis: 'intimacy', difficulty: 2 },
  { prompt: 'Would you rather be told…', optionA: 'A compliment that is not true', optionB: 'A criticism that is', axis: 'truth', difficulty: 2 },
  { prompt: 'Would you rather have…', optionA: 'One friend who knows everything', optionB: 'Twenty who each know a little', axis: 'intimacy', difficulty: 2 },
  { prompt: 'Would you rather lose…', optionA: 'Every photograph you have', optionB: 'Every message you kept', axis: 'memory', difficulty: 2 },
  { prompt: 'Would you rather be…', optionA: 'Famous for something you did badly', optionB: 'Unknown for something you did brilliantly', axis: 'identity', difficulty: 2 },
  { prompt: 'Would you rather always be…', optionA: 'The one who apologises first', optionB: 'The one who is apologised to', axis: 'loyalty', difficulty: 2 },
  { prompt: 'Would you rather…', optionA: 'Pause an hour a day', optionB: 'Rewind an hour once a month', axis: 'control', difficulty: 2 },
  { prompt: 'Would you rather live…', optionA: 'Somewhere you love, with people you tolerate', optionB: 'Somewhere you tolerate, with people you love', axis: 'intimacy', difficulty: 2 },
  { prompt: 'Would you rather be…', optionA: 'The funniest person in a room nobody likes', optionB: 'The quietest in a room that adores you', axis: 'identity', difficulty: 2 },
  { prompt: 'Would you rather…', optionA: 'Forget one year of your life', optionB: 'Relive it, exactly as it was', axis: 'memory', difficulty: 2 },
  { prompt: 'Would you rather…', optionA: 'Always know when you are being lied to', optionB: 'Always be believed when you lie', axis: 'truth', difficulty: 2 },
  { prompt: 'Would you rather never be…', optionA: 'Embarrassed again', optionB: 'Bored again', axis: 'freedom', difficulty: 2 },
  { prompt: 'Would you rather work…', optionA: 'A job you love that nobody respects', optionB: 'A job you dislike that everybody admires', axis: 'identity', difficulty: 2 },

  // ── Difficulty 3 — genuinely uncomfortable ──────────────────────────────────────────────────
  { prompt: 'Would you rather know…', optionA: 'The date you die', optionB: 'The date everyone you love does', axis: 'mortality', difficulty: 3 },
  { prompt: 'Would you rather be…', optionA: 'Forgotten completely', optionB: 'Remembered for your worst day', axis: 'identity', difficulty: 3 },
  { prompt: 'Would you rather your partner be…', optionA: 'Honest, and often cruel', optionB: 'Kind, and sometimes lying', axis: 'truth', difficulty: 3 },
  { prompt: 'Would you rather…', optionA: 'Save a life and nobody ever knows', optionB: 'Be thanked forever for one you did not', axis: 'justice', difficulty: 3 },
  { prompt: 'Would you rather lose…', optionA: 'The ability to make new memories', optionB: 'Every memory before today', axis: 'memory', difficulty: 3 },
  { prompt: 'Would you rather someone you raised be…', optionA: 'Safe and unremarkable', optionB: 'Extraordinary and in danger', axis: 'sacrifice', difficulty: 3 },
  { prompt: 'Would you rather be…', optionA: 'Free and alone', optionB: 'Loved and always watched', axis: 'freedom', difficulty: 3 },
  { prompt: 'Would you rather find out…', optionA: 'You were adopted', optionB: 'You have a sibling nobody mentioned', axis: 'identity', difficulty: 3 },
  { prompt: 'Would you rather…', optionA: 'Never be forgiven for what you did', optionB: 'Never manage to forgive what was done to you', axis: 'justice', difficulty: 3 },
  { prompt: 'Would you rather be…', optionA: 'The reason someone succeeded, and never know', optionB: 'The reason someone failed, and know exactly how', axis: 'justice', difficulty: 3 },
  { prompt: 'Would you rather your last words be…', optionA: 'A lie that comforts', optionB: 'A truth that wounds', axis: 'truth', difficulty: 3 },
  { prompt: 'Would you rather be loved by someone who…', optionA: 'Needs you', optionB: 'Chooses you daily, and could stop', axis: 'intimacy', difficulty: 3 },
  { prompt: 'Would you rather live…', optionA: 'One perfect year', optionB: 'Sixty ordinary ones', axis: 'mortality', difficulty: 3 },
  { prompt: 'Would you rather be…', optionA: 'Certain of something wrong', optionB: 'Unsure of everything true', axis: 'control', difficulty: 3 },

  // ── Difficulty 4 — there is no comfortable answer ───────────────────────────────────────────
  { prompt: 'Would you rather your partner…', optionA: 'Forget you entirely, and be happy', optionB: 'Remember you, and never recover', axis: 'memory', difficulty: 4 },
  { prompt: 'Would you rather…', optionA: 'Halve someone’s suffering by taking half yourself', optionB: 'Leave it whole and stay untouched', axis: 'sacrifice', difficulty: 4 },
  { prompt: 'Would you rather learn…', optionA: 'Your happiest memory never happened', optionB: 'Your worst one did not', axis: 'memory', difficulty: 4 },
  { prompt: 'Would you rather everyone…', optionA: 'Always keep their promises to you', optionB: 'Always tell you what they actually think', axis: 'truth', difficulty: 4 },
  { prompt: 'Would you rather…', optionA: 'Betray one person who trusts you, and save five strangers', optionB: 'Keep faith, and let the five go', axis: 'justice', difficulty: 4 },
  { prompt: 'Would you rather be…', optionA: 'Loved for who you pretend to be', optionB: 'Disliked for who you are', axis: 'identity', difficulty: 4 },
  { prompt: 'Would you rather…', optionA: 'Give up the person you love, and they live longer', optionB: 'Keep them, knowing you cost them years', axis: 'sacrifice', difficulty: 4 },
  { prompt: 'Would you rather…', optionA: 'Know the exact day your relationship ends', optionB: 'Never be certain it will not be today', axis: 'intimacy', difficulty: 4 },
  { prompt: 'Would you rather…', optionA: 'Your worst secret becomes public', optionB: 'Your partner’s proudest moment is erased', axis: 'loyalty', difficulty: 4 },
  { prompt: 'Would you rather be able to…', optionA: 'Make anyone forgive you', optionB: 'Forgive anything at all', axis: 'justice', difficulty: 4 },
  { prompt: 'Would you rather…', optionA: 'Know you could have prevented it', optionB: 'Never find out that you could', axis: 'control', difficulty: 4 },
  { prompt: 'Would you rather cause…', optionA: 'A small harm you have to watch', optionB: 'A large one you never see', axis: 'justice', difficulty: 4 },

  // ── Difficulty 5 — brutal ───────────────────────────────────────────────────────────────────
  { prompt: 'Would you rather…', optionA: 'Everyone you love forgets you', optionB: 'You forget everyone you love', axis: 'memory', difficulty: 5 },
  { prompt: 'Would you rather be…', optionA: 'The one who was left', optionB: 'The one who left', axis: 'loyalty', difficulty: 5 },
  { prompt: 'Would you rather…', optionA: 'Know what your life was for, and never reach it', optionB: 'Live it well, and never know', axis: 'mortality', difficulty: 5 },
  { prompt: 'Would you rather your partner…', optionA: 'Survive believing you never loved them', optionB: 'Not survive, knowing you did', axis: 'sacrifice', difficulty: 5 },
  { prompt: 'Would you rather…', optionA: 'Keep a truth that protects them and ruins you', optionB: 'Tell it, and reverse that exactly', axis: 'truth', difficulty: 5 },
  { prompt: 'Would you rather be…', optionA: 'Forgiven for something you did not do', optionB: 'Blamed for something you did', axis: 'justice', difficulty: 5 },
  { prompt: 'Would you rather…', optionA: 'Have one more hour with them, and grieve twice', optionB: 'Never that hour, and keep the peace you found', axis: 'mortality', difficulty: 5 },
  { prompt: 'Would you rather…', optionA: 'Choose who you love, and never feel it', optionB: 'Feel it completely, and never choose', axis: 'freedom', difficulty: 5 },
  { prompt: 'Would you rather be…', optionA: 'The only one who remembers what you shared', optionB: 'One of two who remember it differently', axis: 'memory', difficulty: 5 },
  { prompt: 'Would you rather anyone you raise inherit…', optionA: 'Your best trait and your worst', optionB: 'Neither of them', axis: 'identity', difficulty: 5 },
];

/** How many difficulty levels there are. */
export const DIFFICULTIES = 5;

/**
 * How hard the match is allowed to get, in thirds.
 *
 * The ranges overlap on purpose. A 2 is a legitimate opener and a legitimate middle, and the overlap
 * is what stops the middle band starving once the opening band has eaten some of the 1s and 2s.
 */
export const DIFFICULTY_BANDS: readonly (readonly [Difficulty, Difficulty])[] = [
  [1, 2],
  [2, 4],
  [3, 5],
];

/**
 * The band a round draws from. Round numbers are 1-based.
 *
 * Expressed per *fraction of the match* rather than per round number, so it survives `ROUNDS`
 * changing. At six rounds it gives 1–2, 1–2, 2–4, 2–4, 3–5, 3–5.
 */
export function bandForRound(round: number, rounds: number): readonly [Difficulty, Difficulty] {
  const perBand = rounds / DIFFICULTY_BANDS.length;
  const index = Math.floor((round - 1) / perBand);
  return DIFFICULTY_BANDS[Math.min(Math.max(index, 0), DIFFICULTY_BANDS.length - 1)]!;
}
