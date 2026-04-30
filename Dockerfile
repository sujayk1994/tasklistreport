# ─── Stage 1: Build ──────────────────────────────────────────────────────────
# Uses node:22-slim (glibc) so esbuild native binaries work correctly.
FROM node:22-slim AS builder

RUN corepack enable && corepack prepare pnpm@10.26.1 --activate

WORKDIR /app

# Copy workspace manifests (maximise layer cache hits)
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY tsconfig.base.json tsconfig.json ./

# Copy all source packages
COPY lib/ ./lib/
COPY artifacts/api-server/ ./artifacts/api-server/
COPY artifacts/task-manager/ ./artifacts/task-manager/

# Install all workspace dependencies
RUN pnpm install --frozen-lockfile

# ── Build frontend ────────────────────────────────────────────────────────────
# Clerk keys are loaded at runtime from /api/config — no build args needed.
ENV BASE_PATH=/ \
    PORT=3000 \
    NODE_ENV=production

RUN pnpm --filter @workspace/task-manager run build
# Output → artifacts/task-manager/dist/public/

# ── Build API server ──────────────────────────────────────────────────────────
RUN pnpm --filter @workspace/api-server run build
# Output → artifacts/api-server/dist/

# ─── Stage 2: Production ─────────────────────────────────────────────────────
FROM node:22-slim AS production

WORKDIR /app

# nodemailer is externalized from the esbuild bundle — install it at runtime
RUN npm install --no-save nodemailer pg

# Bundled API server (esbuild output — self-contained except for externals above)
COPY --from=builder /app/artifacts/api-server/dist/ ./dist/

# Built frontend static files
COPY --from=builder /app/artifacts/task-manager/dist/public/ ./public/

# DB migration script
COPY scripts/migrate.mjs ./scripts/

# Container startup script
COPY docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh

EXPOSE 3000

ENV PORT=3000 \
    NODE_ENV=production \
    STATIC_DIR=/app/public

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:'+process.env.PORT+'/api/healthz', r => process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

CMD ["./docker-entrypoint.sh"]
