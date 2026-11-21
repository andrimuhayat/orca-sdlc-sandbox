#!/usr/bin/env bash
set -euo pipefail
name=$(basename "$PWD")
off=$(( $(printf '%s' "$name" | cksum | cut -d' ' -f1) % 500 ))
cp "$ORCA_ROOT_PATH/.env.example" .env          # env dev dengan data sintetis
cat >> .env <<EOF
COMPOSE_PROJECT_NAME=$name
APP_PORT=$((3000 + off))
DB_PORT=$((15432 + off))
DB_NAME=app_${name//[^a-zA-Z0-9]/_}
EOF
npm ci
docker compose up -d db
