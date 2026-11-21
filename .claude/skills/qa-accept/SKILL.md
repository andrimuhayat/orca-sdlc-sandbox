---
name: qa-accept
description: Held-out acceptance tests from the story criteria or a bug report, run against the PR branch
---
# QA acceptance
The spec names a phase. Without one, do both phases in one worker at the PR head.

## Write phase
Your worktree starts at the base commit; the PR does not exist yet.
1. From the criteria in the spec only, write acceptance tests in qa/<KEY>/acceptance.test.js. Read the base code only to learn how to start the app. Do not read the plan, the design or any branch.
2. Setup already created `.env` and the database. Run the tests on the base commit: tests of new behaviour must fail, tests of unchanged behaviour must pass. Fix a test that does neither.
3. worker_done with the absolute path of the test file and the result of step 2.

## Run phase
Your worktree starts at the PR head, and setup already created `.env` and the database.
1. Copy the tests from the path in the spec into qa/<KEY>/. No path: write them now from the criteria only, before reading the diff.
2. Wait for CI with `gh pr checks <number> --watch` and list any failed check. Then run your acceptance tests.
3. For each criterion: pass / fail / not testable, with evidence.
4. Write the results to qa/<KEY>/report.md with the acceptance tests as a code block and post them with `gh pr comment <number> --body-file qa/<KEY>/report.md`. Do not push.
5. worker_done: outcome failed if any criterion fails.

## UI criteria
Test a criterion about what users see in Orca's built-in browser. Load `orca skills get orca-cli --reference references/browser.md` first.
1. Start the app with the run command from AGENTS.md and open the address it prints with `orca tab create --url <address> --json`.
2. Follow the criterion as a user would: `snapshot --interactive`, then `click`, `fill` or `type`, then check the text on the page.
3. Repeat on a phone screen with `orca viewport --mobile`; run it again after each page load.
4. After each flow, read `orca console` and `orca network`. An error or failed request in a criterion's flow fails that criterion.
5. Screenshot each checked page into qa/<KEY>/ and list the files in the report. Note any control the snapshot shows without a name.

## Bug report
The expected result is the criterion, and the steps to reproduce become the tests. Run them against the code on main (copy it with `git show main:src/<file>` into a temporary folder) and against the PR head. They must fail on main and pass on the head.
