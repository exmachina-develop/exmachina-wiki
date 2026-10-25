#!/usr/bin/env bash
# Run on the server (as root): ./deploy/deploy.sh
# First run clones the repo, generates /opt/apps/exmachina-wiki/.env and starts the stack.
set -euo pipefail
APP_DIR=/opt/apps/exmachina-wiki
REPO=git@github-develop:exmachina-develop/exmachina-wiki.git

if [ ! -d "$APP_DIR/.git" ]; then
  git clone "$REPO" "$APP_DIR"
fi
cd "$APP_DIR"
git pull --ff-only

if [ ! -f .env ]; then
  rnd() { head -c 48 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c "$1"; }
  cat > .env <<ENV
DB_NAME=wiki
DB_USER=wiki
DB_PASSWORD=$(rnd 32)
JWT_SECRET=$(rnd 64)
MINIO_ACCESS_KEY=wiki$(rnd 8)
MINIO_SECRET_KEY=$(rnd 32)
MINIO_BUCKET=wiki
WEB_PORT=3102
SEED_PASSWORD_SAMUEL=$(rnd 16)
SEED_PASSWORD_ALBERT=$(rnd 16)
SEED_PASSWORD_GABRIEL=$(rnd 16)
SEED_PASSWORD_EMANUEL=$(rnd 16)
ENV
  chmod 600 .env
  echo ">> .env generado (chmod 600)"
fi

docker compose up -d --build
docker compose ps
