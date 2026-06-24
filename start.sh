#!/bin/bash
set -e

echo ""
echo "╔══════════════════════════════════════════╗"
echo "║       Daily Task Manager — Start         ║"
echo "╚══════════════════════════════════════════╝"
echo ""

# ── Prerequisite checks ───────────────────────────────────────────────────────
command -v node >/dev/null 2>&1 || {
  echo "❌ Node.js is required. Download from https://nodejs.org"
  exit 1
}

command -v pnpm >/dev/null 2>&1 || {
  echo "❌ pnpm is required. Install it with:  npm install -g pnpm"
  exit 1
}

# ── Load environment ──────────────────────────────────────────────────────────
if [ ! -f .env ]; then
  if [ -f .env.example ]; then
    echo "📋 No .env found — copying from .env.example..."
    cp .env.example .env
    echo ""
    echo "  ⚠️  Please open .env and fill in your values, then run ./start.sh again."
    echo ""
    exit 1
  else
    echo "❌ No .env or .env.example file found."
    exit 1
  fi
fi

echo "📋 Loading .env..."
set -a
# shellcheck disable=SC1091
source .env
set +a

# ── Required variable check ───────────────────────────────────────────────────
MISSING=""
for var in DATABASE_URL CLERK_SECRET_KEY VITE_CLERK_PUBLISHABLE_KEY SUPER_ADMIN_EMAIL; do
  if [ -z "${!var}" ]; then
    MISSING="$MISSING\n   • $var"
  fi
done

if [ -n "$MISSING" ]; then
  echo ""
  echo "❌ Missing required variables in .env:$MISSING"
  echo ""
  echo "   Edit your .env file and try again."
  exit 1
fi

# ── Install dependencies ──────────────────────────────────────────────────────
echo ""
echo "📦 Installing dependencies..."
pnpm install

# ── Database migration ────────────────────────────────────────────────────────
echo ""
echo "🗄️  Running database migration..."
node scripts/migrate.mjs

# ── Build ─────────────────────────────────────────────────────────────────────
echo ""
echo "🔨 Building frontend..."
export NODE_ENV=production BASE_PATH=/
pnpm --filter @workspace/task-manager run build

echo ""
echo "🔨 Building API server..."
pnpm --filter @workspace/api-server run build

# ── Start ─────────────────────────────────────────────────────────────────────
export NODE_ENV=production
export STATIC_DIR="$(pwd)/artifacts/task-manager/dist/public"
export PORT="${PORT:-3000}"

echo ""
echo "🚀 Server running at http://localhost:${PORT}"
echo "   Press Ctrl+C to stop."
echo ""
node --enable-source-maps artifacts/api-server/dist/index.mjs
