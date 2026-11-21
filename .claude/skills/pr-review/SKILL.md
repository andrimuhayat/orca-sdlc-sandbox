---
name: pr-review
description: Review an agent PR against the story, the tests and team conventions
---
# PR review
1. Your worktree starts at the PR head. Record `git rev-parse HEAD` and `git status --porcelain`. HEAD must match the head commit in the spec and `gh pr view <number> --json headRefOid`; if they differ, report worker_done failed with both values and stop.
2. gh pr diff <number>; read every changed file in full, plus the plan from the spec.
3. Check: every criterion is met; new behaviour has tests; no test was deleted, skipped or weakened; error handling; input validation; no secrets or personal data; the PR template is filled in; under ~400 lines.
4. Run the test commands from AGENTS.md. Worktree setup already created `.env` and the database.
5. Write blocking / should-fix / nit findings with file:line to `.agent-out/review.md` and post them with `gh pr comment <number> --body-file .agent-out/review.md`.
6. Confirm `git status --porcelain` matches step 1. Do not commit or push.
7. worker_done: outcome failed if there are blocking findings (list them), succeeded if clean.
