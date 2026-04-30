#!/bin/sh
set -e

echo "──────────────────────────────────────────"
echo " Daily Task Manager"
echo "──────────────────────────────────────────"

echo "▶ Running database migration..."
node /app/scripts/migrate.mjs

echo "▶ Starting server on port ${PORT:-3000}..."
exec node --enable-source-maps /app/dist/index.mjs
