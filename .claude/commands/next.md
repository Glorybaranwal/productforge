---
description: Pick up the next ProductForge AI task and start building it
argument-hint: "[optional task ID, e.g. PF-024]"
---

Follow the **Start-of-session protocol** in `CLAUDE.md` §1.

1. Read `docs/STATUS.md`.
2. Choose the task: if `$ARGUMENTS` names a task ID, use it. Otherwise the first `[~]` task in `docs/BACKLOG.md`,
   else the first `[ ]` task whose dependencies are all `[x]`.
3. If the task is marked **(ask first)** or is blocked by an OPEN decision in `docs/DECISIONS.md`, ask the user the
   specific question and stop.
4. Read only the doc sections the task needs.
5. Reply with: task ID + title, plan (3–5 bullets), files you expect to create/change, how you'll verify "Done when".
6. Mark the task `[~]` in `docs/BACKLOG.md` and start implementing. Follow CLAUDE.md §7 rules and §9 definition of done.
