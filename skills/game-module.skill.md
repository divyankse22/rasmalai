# Game Module Skill

When adding a game:

1. Define the game metadata.
2. Define player actions.
3. Define server state.
4. Define authoritative rules.
5. Define score/result rules.
6. Define timing.
7. Define random seed requirements.
8. Define reconnect policy.
9. Define mobile input.
10. Implement client presentation in Phaser.
11. Implement server validation.
12. Add tests.
13. Integrate through the common game registry.

Never duplicate:
- authentication
- invitation
- lobby
- WebSocket connection setup
- database access

A new game should be additive rather than a platform rewrite.
