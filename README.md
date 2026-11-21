# orca-sdlc-sandbox

Sandbox for testing an agentic SDLC pipeline on Orca: a small todo API (Node 22, Postgres 16) with synthetic data. Agent rules live in `AGENTS.md`; skills in `.claude/skills/`.

```
cp .env.example .env
docker compose up -d --wait
npm ci && npm test && npm run test:e2e
```

CI smoke test for the required checks.
