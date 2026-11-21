#!/usr/bin/env bash
set -euo pipefail
# Worker names carry Jira keys (plan-PROJ1-1); Docker Compose accepts only lowercase project names.
name=$(basename "$PWD" | tr '[:upper:]' '[:lower:]')
slug=${name//[^a-z0-9]/_}
off=$(( $(printf '%s' "$name" | cksum | cut -d' ' -f1) % 500 ))
cp "$ORCA_ROOT_PATH/.env.example" .env          # env dev dengan data sintetis
cat >> .env <<ENV
COMPOSE_PROJECT_NAME=$slug
APP_PORT=$((3000 + off))
DB_PORT=$((15432 + off))
DB_NAME=app_$slug
ENV
npm ci
docker compose up -d --wait db
