import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';
import nextTypescript from 'eslint-config-next/typescript';

const config = [
  { ignores: ['.next/**', 'node_modules/**', 'next-env.d.ts'] },
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    rules: {
      /*
       * The browser may never import a game's authoritative rules.
       *
       * `docs/13_ARCHITECTURE_PROPOSAL.md` section 1 asks for exactly this rule. A rulebook in the
       * bundle is a rulebook a player can read, and for a game decided on server timing, reading it
       * is most of the way to beating it. `@rasmalai/games` and `@rasmalai/games/client` are the two
       * halves the web app is allowed: metadata, protocol types, and renderers.
       */
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@rasmalai/games/server', '@rasmalai/games/*/server', '@rasmalai/games/*/deck'],
              message:
                'Authoritative game rules are server-only. Import @rasmalai/games (metadata and protocol) or @rasmalai/games/client (renderers).',
            },
          ],
        },
      ],
    },
  },
];

export default config;
