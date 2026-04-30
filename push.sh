#!/bin/bash
set -e

echo ""
echo "╔══════════════════════════════════════════╗"
echo "║        Push to GitHub                    ║"
echo "╚══════════════════════════════════════════╝"
echo ""

command -v git >/dev/null 2>&1 || { echo "❌ Git is required. Download from https://git-scm.com"; exit 1; }

# ── Init repo if needed ───────────────────────────────────────────────────────
if [ ! -d ".git" ]; then
  echo "🔧 Initializing git repository..."
  git init

  echo ""
  echo "📝 Enter your GitHub repository URL"
  echo "   (e.g. https://github.com/username/daily-task-manager.git)"
  read -rp "   URL: " REPO_URL
  git remote add origin "$REPO_URL"
  echo ""
fi

# ── Ensure .gitignore exists ──────────────────────────────────────────────────
if [ ! -f ".gitignore" ]; then
  cat > .gitignore << 'EOF'
node_modules/
dist/
.env
*.log
.local/
attached_assets/
EOF
  echo "📝 Created .gitignore"
fi

# ── Commit message ────────────────────────────────────────────────────────────
COMMIT_MSG="${1:-Update: $(date '+%Y-%m-%d %H:%M')}"

echo "📋 Staging all changes..."
git add .

if git diff --cached --quiet; then
  echo "ℹ️  Nothing new to commit — already up to date."
else
  echo "💾 Committing: \"$COMMIT_MSG\""
  git commit -m "$COMMIT_MSG"
fi

# ── Push ──────────────────────────────────────────────────────────────────────
BRANCH=$(git symbolic-ref --short HEAD 2>/dev/null || echo "main")

echo "⬆️  Pushing to origin/$BRANCH..."
git push -u origin "$BRANCH"

echo ""
echo "✅ Done! Code pushed to GitHub."
echo ""
