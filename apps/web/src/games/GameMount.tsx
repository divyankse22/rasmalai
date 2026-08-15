'use client';

import { Suspense, lazy, useMemo, type ComponentType } from 'react';
import type { GameRenderProps } from '@rasmalai/games';
import { findGameRenderer } from '@rasmalai/games/client';
import type { GameSnapshot, SessionPlayer } from '@rasmalai/shared';

/**
 * Where a game is put on screen, and the only place the web app knows one exists.
 *
 * `docs/13_ARCHITECTURE_PROPOSAL.md` section 1 calls this a thin renderer mount, and thin is the
 * point: adding a game means adding a folder under `packages/games`, not editing this file. It
 * resolves the renderer by slug and hands it the view the server sent.
 *
 * The renderer arrives as a dynamic import, so a game's code is downloaded when its session starts
 * rather than sitting in the bundle of somebody who is reading their dashboard.
 */
export function GameMount({
  snapshot,
  you,
  partner,
  act,
}: {
  snapshot: GameSnapshot;
  you: SessionPlayer;
  partner: SessionPlayer;
  act(action: unknown): void;
}) {
  const Renderer = useMemo(() => {
    const loader = findGameRenderer(snapshot.slug);
    if (!loader) return null;

    // The one cast in the whole arrangement. The platform is generic over every game by
    // construction and cannot know which view type it is holding; the game module is typed against
    // its own view on both sides of the wire, which is where it actually matters.
    return lazy(loader) as unknown as ComponentType<GameRenderProps<unknown>>;
  }, [snapshot.slug]);

  if (!Renderer) {
    // Only reachable if the catalogue offers a game whose renderer is not shipped in this build.
    return (
      <p className="py-10 text-center text-sm text-muted" role="status">
        This game is not available on this device yet.
      </p>
    );
  }

  return (
    <Suspense
      fallback={
        <p className="py-10 text-center text-sm text-muted" role="status">
          Loading the game…
        </p>
      }
    >
      <Renderer view={snapshot.state} you={you} partner={partner} act={act} />
    </Suspense>
  );
}
