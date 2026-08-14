# Architecture Review Skill

Before approving a significant architectural change, answer:

1. What requirement does this solve?
2. Why cannot the current architecture solve it?
3. Does it add infrastructure?
4. Does it add operational complexity?
5. Does it improve modularity?
6. Does it create a new source of truth?
7. Does it affect WebSocket protocol?
8. Does it affect database schema?
9. Does it affect security/authorization?
10. Does it make V2 easier or V1 harder?

Prefer the smallest change that solves the real requirement.

For Rasmalai V1, reject unnecessary:
- microservices
- queues
- Redis
- Kubernetes
- complex event buses
- elaborate analytics pipelines
unless actual requirements justify them.
