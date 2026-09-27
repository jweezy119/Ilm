# Web image. Build from the repository root:
#   docker build -f apps/web/Dockerfile -t ilm-web .

FROM node:20-alpine AS base
RUN apk add --no-cache libc6-compat
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
ARG NEXT_INTERNAL_API_URL=http://api:4000
ENV NEXT_INTERNAL_API_URL=$NEXT_INTERNAL_API_URL
COPY packages/shared packages/shared
COPY apps/web apps/web
RUN npm run build:shared && npm run build:web

# ------------------------------------------------------------------ runtime
FROM base AS runner
ENV NODE_ENV=production
WORKDIR /app

RUN addgroup --system --gid 1001 nodejs \
 && adduser --system --uid 1001 ilm

COPY --from=builder --chown=ilm:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=ilm:nodejs /app/package.json ./package.json
COPY --from=builder --chown=ilm:nodejs /app/packages ./packages
COPY --from=builder --chown=ilm:nodejs /app/apps/web ./apps/web

USER ilm
EXPOSE 3000
ENV PORT=3000 HOSTNAME=0.0.0.0

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:3000/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["npm", "run", "start", "-w", "@ilm/web"]
