---
name: architect-design
description: ADR and API contract for an architecturally significant story
---
# Architecture design
1. Read the story, AGENTS.md and docs/adr. Do not change application code.
2. Write an ADR (context, decision, alternatives, consequences) at docs/adr/<KEY>.md; an API contract (OpenAPI) if the change spans layers.
3. Define data changes, migration order, error format and auth rules.
4. worker_done with the ADR and contract paths. Story too large: outcome failed with a proposed split.
