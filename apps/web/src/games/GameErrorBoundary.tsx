'use client';

import { Component, type ReactNode } from 'react';

/**
 * Catches whatever a game module throws and shows cute copy instead of a stack trace.
 *
 * A game is somebody else's code as far as the platform is concerned — `GameMount` cannot vet what
 * seventeen independent renderers do on a bad frame, and a broken one should not take the other
 * player's screen down with it (or, worse, hand either of them a raw component stack). React only
 * offers this as a class component; there is no hook equivalent.
 *
 * `GameMount` remounts this with `key={snapshot.slug}`, so switching games — or a fresh session on
 * the same game — starts from a clean boundary rather than staying stuck on a previous crash.
 */
interface Props {
  children: ReactNode;
  gameName: string;
}

interface State {
  broken: boolean;
}

export class GameErrorBoundary extends Component<Props, State> {
  override state: State = { broken: false };

  static getDerivedStateFromError(): State {
    return { broken: true };
  }

  override componentDidCatch(error: unknown) {
    // Developers still get the real error in the console; players get the sentence below.
    console.error('Game render crashed:', error);
  }

  override render() {
    if (this.state.broken) {
      return (
        <div className="flex flex-col items-center gap-2 py-10 text-center">
          <p className="font-display text-lg font-semibold text-ink">
            {this.props.gameName} tripped over itself 😵‍💫
          </p>
          <p className="text-sm text-muted">Nothing you did — try reloading in a moment.</p>
        </div>
      );
    }

    return this.props.children;
  }
}
