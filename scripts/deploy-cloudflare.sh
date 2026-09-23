#!/usr/bin/env bash
# Publishes Roomie to your own Cloudflare account: build, update database tables, deploy.
# Requires `npx wrangler login` once. Settings live in wrangler.cloudflare.json.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
export WRANGLER_LOG_PATH=.wrangler/logs

echo "[roomie] building for Cloudflare"
ROOMIE_DEPLOY_TARGET=cloudflare npx vinext build

echo "[roomie] applying database migrations"
npx wrangler d1 migrations apply roomie --remote --config wrangler.cloudflare.json

echo "[roomie] deploying"
npx wrangler deploy
