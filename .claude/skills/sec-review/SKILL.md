---
name: sec-review
description: Security review of one PR with scanners and a read of the diff
---
# Security review
1. Your worktree starts at the PR head; `git rev-parse HEAD` must match the head commit in the spec. Do not commit or push.
2. Run: trivy fs --scanners vuln,secret,misconfig --severity CRITICAL,HIGH,MEDIUM .  and  semgrep scan --config p/default --metrics=off
3. Read the diff (`gh pr diff <number>`) for: missing authorization, injection (SQL, command, template), unsafe deserialization, path traversal, secrets or personal data in logs, weak crypto, new public endpoints, overly permissive CORS.
4. Drop false positives with a one-line reason. Assign severity critical / high / medium / low.
5. One PR comment: write a table of severity, file:line, issue, fix and tool versions to `.agent-out/security.md` and post it with `gh pr comment <number> --body-file .agent-out/security.md`.
6. worker_done: outcome failed if there is a critical or high finding (list the required fixes), otherwise succeeded.
