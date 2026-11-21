---
name: qa-accept
description: Held-out acceptance tests from the story criteria, run against the PR branch
---
# QA acceptance
1. From the criteria in the spec only, write acceptance tests in your own folder (qa/<KEY>/) before reading the diff.
2. Your worktree starts at the PR head, and setup already created `.env` and the database. Run the full test suite from AGENTS.md, then your acceptance tests.
3. For each criterion: pass / fail / not testable, with evidence.
4. Write the results to qa/<KEY>/report.md with the acceptance tests as a code block and post them with `gh pr comment <number> --body-file qa/<KEY>/report.md`. Do not push.
5. worker_done: outcome failed if any criterion fails.
