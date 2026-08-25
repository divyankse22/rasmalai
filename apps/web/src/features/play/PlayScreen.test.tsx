import {
  EVENTS,
  type Envelope,
  type GameSnapshot,
  type MatchResultView,
  type SessionView,
  type TournamentView,
} from '@rasmalai/shared';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { player, sessionView } from '@/test/sessionFixture';
import { PlayScreen } from './PlayScreen';

/**
 * `PlayScreen` receives its session over the socket rather than as a prop, so a test drives it by
 * holding the listener the component registers and calling it with a frame.
 *
 * `useRealtimeEvent` keeps only the latest listener: the component re-registers on every render,
 * and calling a stale closure would assert against a render that is no longer on screen.
 */
const mocks = vi.hoisted(() => ({
  send: vi.fn(),
  routerPush: vi.fn(),
  status: 'connected' as 'connecting' | 'connected' | 'offline',
  listener: null as ((envelope: Envelope) => void) | null,
}));

vi.mock('@/realtime/RealtimeProvider', () => ({
  useRealtime: () => ({ status: mocks.status, send: mocks.send, subscribe: () => () => {} }),
  useRealtimeEvent: (listener: (envelope: Envelope) => void) => {
    mocks.listener = listener;
  },
  useResyncOnReconnect: () => {},
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mocks.routerPush }),
}));

// The real one resolves a renderer through a dynamic import. Here it only has to be identifiable.
vi.mock('@/games/GameMount', () => ({
  GameMount: ({ snapshot }: { snapshot: { slug: string } }) => (
    <div data-testid="game-mount">{snapshot.slug}</div>
  ),
}));

/** Hands the screen a session frame, exactly as `lobby.joined` does. */
function push(session: SessionView): void {
  act(() => {
    mocks.listener?.({ type: EVENTS.lobby.joined, ts: Date.now(), payload: { session } });
  });
}

const tournament = (over: Partial<TournamentView> = {}): TournamentView => ({
  id: 'tour-1',
  name: 'Sunday series',
  status: 'active',
  direction: 'outgoing',
  games: [],
  currentPosition: 1,
  yourTotalPoints: 3,
  partnerTotalPoints: 1,
  winner: null,
  pausedUntil: null,
  expiresAt: null,
  ...over,
});

const result = (over: Partial<MatchResultView> = {}): MatchResultView => ({
  outcome: 'won',
  yourScore: 3,
  theirScore: 2,
  competitive: true,
  byForfeit: false,
  byGiveUp: false,
  ...over,
});

/** A live game of `slug`. The state is opaque here — `GameMount` is stubbed. */
const snapshot = (slug: string): GameSnapshot => ({ slug, state: {} });

/** Gets past the rules screen, which now opens every session before its first match. */
async function dismissRules(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.click(screen.getByRole('button', { name: 'Got it ✨' }));
}

beforeEach(() => {
  mocks.send.mockClear();
  mocks.routerPush.mockClear();
  mocks.status = 'connected';
  mocks.listener = null;
});

describe('PlayScreen before a session arrives', () => {
  it('says it is looking, as a live region', () => {
    render(<PlayScreen sessionId="session-1" />);

    expect(screen.getByRole('status')).toHaveTextContent('Finding your game…');
  });

  it('asks the server where things stand as soon as it is connected', () => {
    render(<PlayScreen sessionId="session-1" />);

    expect(mocks.send).toHaveBeenCalledWith(EVENTS.lobby.join, { sessionId: 'session-1' });
  });

  it('ignores a frame for a different session', () => {
    render(<PlayScreen sessionId="session-1" />);
    push(sessionView({ id: 'someone-elses' }));

    expect(screen.getByRole('status')).toHaveTextContent('Finding your game…');
  });
});

describe('PlayScreen in the lobby', () => {
  it('names the game as the page heading', () => {
    render(<PlayScreen sessionId="session-1" />);
    push(sessionView({ gameName: 'Memory' }));

    expect(screen.getByRole('heading', { level: 1, name: 'Memory' })).toBeInTheDocument();
  });

  it('offers to mark you ready, and says so when they already are', async () => {
    const user = userEvent.setup();
    render(<PlayScreen sessionId="session-1" />);
    push(sessionView({ partner: player({ userId: 'them', nickname: 'Sam', ready: true }) }));
    await dismissRules(user);

    expect(screen.getByText('They are ready and waiting for you.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: "I'm ready ✨" })).toBeInTheDocument();
  });

  it('asks you to tell them when the partner is not ready yet', async () => {
    const user = userEvent.setup();
    render(<PlayScreen sessionId="session-1" />);
    push(sessionView());
    await dismissRules(user);

    expect(screen.getByText('Tell them when you are ready.')).toBeInTheDocument();
  });

  it('sends ready, and offers to take it back once you are', async () => {
    const user = userEvent.setup();
    render(<PlayScreen sessionId="session-1" />);
    push(sessionView());
    await dismissRules(user);

    await user.click(screen.getByRole('button', { name: "I'm ready ✨" }));
    expect(mocks.send).toHaveBeenCalledWith(EVENTS.lobby.playerReady, { sessionId: 'session-1' });

    push(sessionView({ you: player({ userId: 'you', ready: true }) }));
    expect(screen.getByRole('button', { name: 'Not ready after all' })).toBeInTheDocument();
  });

  it('shows both people while nothing is being played', async () => {
    const user = userEvent.setup();
    render(<PlayScreen sessionId="session-1" />);
    push(sessionView());
    await dismissRules(user);

    expect(screen.getByText('Divs')).toBeInTheDocument();
    expect(screen.getByText('Sam')).toBeInTheDocument();
  });

  it('offers the reactions', async () => {
    const user = userEvent.setup();
    render(<PlayScreen sessionId="session-1" />);
    push(sessionView());
    await dismissRules(user);

    expect(screen.getByRole('button', { name: 'React with ❤️' })).toBeInTheDocument();
  });
});

describe('PlayScreen counting down', () => {
  it('renders the countdown as a live timer and says why', () => {
    render(<PlayScreen sessionId="session-1" />);
    push(sessionView({ phase: 'countdown', startsAt: Date.now() + 3_000 }));

    expect(screen.getByRole('timer')).toBeInTheDocument();
    expect(screen.getByText('Both ready — here we go')).toBeInTheDocument();
  });

  it('offers no ready button while it is counting down', () => {
    render(<PlayScreen sessionId="session-1" />);
    push(sessionView({ phase: 'countdown', startsAt: Date.now() + 3_000 }));

    expect(screen.queryByRole('button', { name: "I'm ready ✨" })).not.toBeInTheDocument();
  });
});

describe('PlayScreen while a match is running', () => {
  const active = () => sessionView({ phase: 'active', game: snapshot('memory') });

  it('hands the game to the mount', () => {
    render(<PlayScreen sessionId="session-1" />);
    push(active());

    expect(screen.getByTestId('game-mount')).toHaveTextContent('memory');
  });

  it('puts the two player chips away once the game has the screen', () => {
    render(<PlayScreen sessionId="session-1" />);
    push(active());

    expect(screen.queryByText('Divs')).not.toBeInTheDocument();
  });

  it('names whose move it is, with a timer, when the game has turns', () => {
    render(<PlayScreen sessionId="session-1" />);
    push(
      sessionView({
        phase: 'active',
        game: snapshot('four-in-a-row'),
        turnUserId: 'you',
        turnDeadline: Date.now() + 60_000,
      }),
    );

    expect(screen.getByText('Your move')).toBeInTheDocument();
    expect(screen.getAllByRole('timer').length).toBeGreaterThan(0);
  });

  it('says nothing about a move for a game with no turns', () => {
    render(<PlayScreen sessionId="session-1" />);
    push(active());

    expect(screen.queryByText('Your move')).not.toBeInTheDocument();
  });
});

describe('PlayScreen on the results screen', () => {
  it('offers a rematch when neither of you has asked yet', () => {
    render(<PlayScreen sessionId="session-1" />);
    push(sessionView({ phase: 'finished', result: result() }));

    expect(screen.getByRole('button', { name: 'Rematch ✨' })).toBeInTheDocument();
    expect(screen.getByText('A rematch needs both of you to say so.')).toBeInTheDocument();
  });

  it('turns the offer into an answer when they asked first', () => {
    render(<PlayScreen sessionId="session-1" />);
    push(
      sessionView({
        phase: 'finished',
        result: result(),
        partner: player({ userId: 'them', nickname: 'Sam', gender: 'male', ready: true }),
      }),
    );

    expect(screen.getByRole('button', { name: 'Accept the rematch' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Decline the rematch' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Rematch ✨' })).not.toBeInTheDocument();
  });

  it('declining a rematch leaves the session and says so', async () => {
    const user = userEvent.setup();
    render(<PlayScreen sessionId="session-1" />);
    push(
      sessionView({
        phase: 'finished',
        result: result(),
        partner: player({ userId: 'them', nickname: 'Sam', gender: 'male', ready: true }),
      }),
    );

    await user.click(screen.getByRole('button', { name: 'Decline the rematch' }));

    expect(mocks.send).toHaveBeenCalledWith(EVENTS.lobby.leave, { sessionId: 'session-1' });
    expect(screen.getByText('No rematch — heading back.')).toBeInTheDocument();
  });

  it('keeps the finished game on screen so the round-by-round is still there', () => {
    render(<PlayScreen sessionId="session-1" />);
    push(sessionView({ phase: 'finished', result: result(), game: snapshot('memory') }));

    expect(screen.getByTestId('game-mount')).toBeInTheDocument();
  });

  it('says "next game" rather than "rematch" inside a series', () => {
    render(<PlayScreen sessionId="session-1" />);
    push(sessionView({ phase: 'finished', result: result(), tournament: tournament() }));

    expect(screen.getByRole('button', { name: 'Next game →' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Rematch ✨' })).not.toBeInTheDocument();
  });
});

describe('PlayScreen inside a tournament', () => {
  it('links to the series with the running score', async () => {
    const user = userEvent.setup();
    render(<PlayScreen sessionId="session-1" />);
    push(sessionView({ tournament: tournament({ yourTotalPoints: 3, partnerTotalPoints: 1 }) }));
    await dismissRules(user);

    const link = screen.getByRole('link', { name: /Series/ });
    expect(link).toHaveAttribute('href', '/tournament/tour-1');
    expect(link).toHaveTextContent('3–1');
  });

  it('drops the running link once the series is over', () => {
    render(<PlayScreen sessionId="session-1" />);
    push(sessionView({ tournament: tournament({ status: 'completed' }) }));

    expect(screen.queryByRole('link', { name: /Series/ })).not.toBeInTheDocument();
  });
});

describe('PlayScreen when the partner is away', () => {
  it('stops offering the lobby while they are gone', () => {
    render(<PlayScreen sessionId="session-1" />);
    push(
      sessionView({
        partner: player({
          userId: 'them',
          nickname: 'Sam',
          gender: 'male',
          present: false,
          awayUntil: Date.now() + 120_000,
        }),
      }),
    );

    expect(screen.queryByRole('button', { name: "I'm ready ✨" })).not.toBeInTheDocument();
  });
});

describe('PlayScreen shows the rules before the first match', () => {
  it('opens on the rules rather than the lobby', () => {
    render(<PlayScreen sessionId="session-1" />);
    push(sessionView({ gameSlug: 'memory', gameName: 'Memory' }));

    expect(screen.getByRole('heading', { name: 'How to play' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: "I'm ready ✨" })).not.toBeInTheDocument();
  });

  it('still says which game this is', () => {
    render(<PlayScreen sessionId="session-1" />);
    push(sessionView({ gameSlug: 'memory', gameName: 'Memory' }));

    expect(screen.getByRole('heading', { level: 1, name: 'Memory' })).toBeInTheDocument();
  });

  it('holds back the reactions and the player chips too', () => {
    render(<PlayScreen sessionId="session-1" />);
    push(sessionView({ gameSlug: 'memory' }));

    expect(screen.queryByRole('button', { name: 'React with ❤️' })).not.toBeInTheDocument();
    expect(screen.queryByText('Divs')).not.toBeInTheDocument();
  });

  it('reveals the lobby once they have read it', async () => {
    const user = userEvent.setup();
    render(<PlayScreen sessionId="session-1" />);
    push(sessionView({ gameSlug: 'memory' }));

    await user.click(screen.getByRole('button', { name: 'Got it ✨' }));

    expect(screen.queryByRole('heading', { name: 'How to play' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: "I'm ready ✨" })).toBeInTheDocument();
  });

  it('stays out of the way once dismissed, even as frames keep arriving', async () => {
    const user = userEvent.setup();
    render(<PlayScreen sessionId="session-1" />);
    push(sessionView({ gameSlug: 'memory' }));
    await user.click(screen.getByRole('button', { name: 'Got it ✨' }));

    push(sessionView({ gameSlug: 'memory', partner: player({ userId: 'them', ready: true }) }));

    expect(screen.queryByRole('heading', { name: 'How to play' })).not.toBeInTheDocument();
  });

  it.each(['countdown', 'active', 'finished', 'abandoned'] as const)(
    'is absent in the %s phase',
    (phase) => {
      render(<PlayScreen sessionId="session-1" />);
      push(
        sessionView({
          gameSlug: 'memory',
          phase,
          startsAt: phase === 'countdown' ? Date.now() + 3_000 : null,
          result: phase === 'finished' ? result() : null,
        }),
      );

      expect(screen.queryByRole('heading', { name: 'How to play' })).not.toBeInTheDocument();
    },
  );

  /**
   * The whole reason there is no stored "seen" flag: a rematch counts down from `finished` and
   * never passes back through `lobby`, so the phase alone already means "before the first match".
   */
  it('does not come back for a rematch', () => {
    render(<PlayScreen sessionId="session-1" />);
    push(sessionView({ gameSlug: 'memory', phase: 'finished', result: result() }));
    push(sessionView({ gameSlug: 'memory', phase: 'countdown', startsAt: Date.now() + 3_000 }));

    expect(screen.queryByRole('heading', { name: 'How to play' })).not.toBeInTheDocument();
  });

  it('falls through to the lobby for a game with no module', () => {
    render(<PlayScreen sessionId="session-1" />);
    push(sessionView({ gameSlug: 'boat-escape', gameName: 'Boat Escape' }));

    expect(screen.queryByRole('heading', { name: 'How to play' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: "I'm ready ✨" })).toBeInTheDocument();
  });
});
