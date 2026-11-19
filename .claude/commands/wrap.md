---
description: Close the session — verify, update backlog, status and decisions
---

Follow the **End-of-session protocol** in `CLAUDE.md` §2.

1. Run `pnpm lint && pnpm typecheck && pnpm test`. Fix what you can; record the rest as blockers.
2. Update `docs/BACKLOG.md`: `[x]` for tasks meeting their "Done when"; `[~]` + one-line note for partial ones;
   add any newly discovered tasks with the next free ID in the right week.
3. Update `docs/STATUS.md`: Current, Next up, Blockers, Open decisions, milestone status, and a new top row in the
   session log (date, tasks touched, outcome, notes for next session).
4. Add ADR entries to `docs/DECISIONS.md` for any design choice made this session.
5. Suggest a commit message in the form `PF-<id>: <summary>`.
6. Reply with a 3-line summary: done, next, blockers.
