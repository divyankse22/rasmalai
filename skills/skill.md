# Rasmalai Master Implementation Skill

## Purpose

Implement and evolve Rasmalai as a modular multiplayer web game platform while preserving product intent and architectural boundaries.

## Required behavior

Before implementation:
1. Read repository documentation.
2. Inspect the existing repository rather than assuming it is empty.
3. Ask clarification questions until product and technical interpretation match the user's intent.
4. Identify contradictions explicitly.
5. Produce a short implementation proposal before making major changes.

During implementation:
- preserve modular boundaries
- prefer small vertical slices
- keep game logic isolated
- keep server authoritative
- validate all client actions
- use shared typed contracts
- avoid duplicated protocol logic
- avoid premature infrastructure

After implementation:
- test
- typecheck
- lint
- build
- manually verify the affected flow
- document meaningful decisions

## Definition of done

A feature is not done merely because it compiles.

It must have:
- intended UX
- authorization
- error handling
- realtime behavior where applicable
- reconnect behavior where applicable
- mobile behavior where applicable
- tests for important state transitions
- no obvious security hole
