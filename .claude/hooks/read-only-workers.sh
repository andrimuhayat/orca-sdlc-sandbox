#!/usr/bin/env bash
# PreToolUse hook for Bash. Review, security, QA, plan and architecture workers report
# through worker_done and PR comments; only the implement worker (agent-<KEY>) commits and pushes.
set -euo pipefail
name=$(basename "${CLAUDE_PROJECT_DIR:-$PWD}")
case "$name" in
  review-*|sec-*|qa-*|plan-*|arch-*) ;;
  *) exit 0 ;;
esac
cmd=$(jq -r '.tool_input.command // ""')
if printf '%s' "$cmd" | grep -Eq '(^|[^[:alnum:]_-])git([[:space:]]+[^[:space:]]+)*[[:space:]]+(commit|push)([^[:alnum:]_-]|$)'; then
  printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"Worktree %s is read-only: only the implement worker (agent-<KEY>) commits and pushes. Report through worker_done and PR comments."}}\n' "$name"
fi
