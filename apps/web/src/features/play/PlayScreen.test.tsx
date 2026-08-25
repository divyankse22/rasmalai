import { EVENTS, type Envelope, type SessionView } from '@rasmalai/shared';
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

  it('offers to mark you ready, and says so when they already are', () => {
    render(<PlayScreen sessionId="session-1" />);
    push(sessionView({ partner: player({ userId: 'them', nickname: 'Sam', ready: true }) }));

    expect(screen.getByText('They are ready and waiting for you.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: "I'm ready ✨" })).toBeInTheDocument();
  });

  it('asks you to tell them when the partner is not ready yet', () => {
    render(<PlayScreen sessionId="session-1" />);
    push(sessionView());

    expect(screen.getByText('Tell them when you are ready.')).toBeInTheDocument();
  });

  it('sends ready, and offers to take it back once you are', async () => {
    const user = userEvent.setup();
    render(<PlayScreen sessionId="session-1" />);
    push(sessionView());

    await user.click(screen.getByRole('button', { name: "I'm ready ✨" }));
    expect(mocks.send).toHaveBeenCalledWith(EVENTS.lobby.playerReady, { sessionId: 'session-1' });

    push(sessionView({ you: player({ userId: 'you', ready: true }) }));
    expect(screen.getByRole('button', { name: 'Not ready after all' })).toBeInTheDocument();
  });

  it('shows both people while nothing is being played', () => {
    render(<PlayScreen sessionId="session-1" />);
    push(sessionView());

    expect(screen.getByText('Divs')).toBeInTheDocument();
    expect(screen.getByText('Sam')).toBeInTheDocument();
  });

  it('offers the reactions', () => {
    render(<PlayScreen sessionId="session-1" />);
    push(sessionView());

    expect(screen.getByRole('button', { name: 'React with ❤️' })).toBeInTheDocument();
  });
});
