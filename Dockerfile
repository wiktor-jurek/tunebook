# Builds the web app (apps/web) from the monorepo root, so Coolify keeps using ./Dockerfile.
FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/package.json
COPY packages/tokens/package.json packages/tokens/package.json
RUN npm ci

FROM node:24-alpine AS production-deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/package.json
COPY packages/tokens/package.json packages/tokens/package.json
RUN npm ci --omit=dev -w apps/web

FROM node:24-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build -w apps/web

FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
RUN addgroup -S nextjs && adduser -S nextjs -G nextjs
# The standalone output mirrors the monorepo: the server lives at apps/web/server.js.
COPY --from=builder --chown=nextjs:nextjs /app/apps/web/.next/standalone ./
COPY --from=builder --chown=nextjs:nextjs /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder --chown=nextjs:nextjs /app/apps/web/public ./apps/web/public
COPY --from=builder --chown=nextjs:nextjs /app/apps/web/drizzle ./apps/web/drizzle
COPY --from=builder --chown=nextjs:nextjs /app/apps/web/scripts/migrate.mjs ./apps/web/scripts/migrate.mjs
COPY --from=production-deps --chown=nextjs:nextjs /app/node_modules ./node_modules
USER nextjs
WORKDIR /app/apps/web
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["sh", "-c", "node scripts/migrate.mjs && node server.js"]
