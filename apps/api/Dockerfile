# API image. Build from the repository root:
#   docker build -f apps/api/Dockerfile -t ilm-api .
# The workspace must be visible because the API runs from source via tsx and
# imports the built output of @ilm/shared.

FROM node:20-alpine AS base
RUN apk add --no-cache libc6-compat openssl
WORKDIR /app

# ---------------------------------------------------------------- dependencies
FROM base AS deps
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci

# --------------------------------------------------------------------- build
FROM deps AS builder
COPY packages/shared packages/shared
COPY apps/api apps/api
# Generates the Prisma client. @prisma/client's postinstall runs during `npm ci`
# above, but at that point only package.json files are present, so it finds no
# schema and skips generation — without this the image boots and then fails on
# its first query.
RUN npm run build:shared && npm run db:generate

# ------------------------------------------------------------------ runtime
FROM base AS runner
ENV NODE_ENV=production
WORKDIR /app

RUN addgroup --system --gid 1001 nodejs \
 && adduser --system --uid 1001 ilm

COPY --from=builder --chown=ilm:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=ilm:nodejs /app/package.json ./package.json
COPY --from=builder --chown=ilm:nodejs /app/packages ./packages
COPY --from=builder --chown=ilm:nodejs /app/apps/api ./apps/api

# Writable so the search index can be cached between restarts.
RUN mkdir -p /app/apps/api/data && chown -R ilm:nodejs /app/apps/api/data

USER ilm
EXPOSE 4000
ENV PORT=4000 HOST=0.0.0.0

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s \
  CMD node -e "fetch('http://127.0.0.1:4000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["npm", "run", "start", "-w", "@ilm/api"]
