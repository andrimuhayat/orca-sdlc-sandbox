---
name: pr-review
description: Review an agent PR against the story, the tests and team conventions
---
# PR review
1. Your worktree starts at the PR head. Record `git rev-parse HEAD` and `git status --porcelain`. HEAD must match the head commit in the spec and `gh pr view <number> --json headRefOid`; if they differ, report worker_done failed with both values and stop.
2. gh pr diff <number>; read every changed file in full, plus the plan from the spec.
3. Check: every criterion is met; new behaviour has tests; no test was deleted, skipped or weakened; error handling; input validation; no secrets or personal data; the PR template is filled in; under ~400 lines.
4. Wait for CI with `gh pr checks <number> --watch`; it runs lint, the test suites, the test-integrity check and the security scan. A failed check is a blocking finding. A check that did not run is not a pass: say so in the review.
5. Write blocking / should-fix / nit findings with file:line to `.agent-out/review.md` and post them with `gh pr comment <number> --body-file .agent-out/review.md`.
6. Confirm `git status --porcelain` matches step 1. Do not commit or push.
7. worker_done: outcome failed if there are blocking findings (list them), succeeded if clean.

## Combined review
When the spec asks for a combined review (small track or a small bug fix), this worker also covers security and QA:
- First confirm the diff fits the small track in `.claude/skills/sdlc-coordinator/SKILL.md`. If it does not, report worker_done failed with "track: <reason>" and stop.
- Before step 2, write 1-3 acceptance checks in qa/<KEY>/ from the criteria, or from the bug report's steps, and run them after step 4. For a bug, follow "Bug report" in `.claude/skills/qa-accept/SKILL.md`.
- For a UI change, check the changed pages as "UI criteria" in `.claude/skills/qa-accept/SKILL.md` says, and compare them with the implementer's screenshot report.
- At step 3, also do steps 3-4 of `.claude/skills/sec-review/SKILL.md`. CI's security-scan check runs its scanners.
- Put the acceptance and security results in the same comment. A failed acceptance check, or a critical or high security finding, is blocking.
