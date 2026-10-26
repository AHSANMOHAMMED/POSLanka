# POSLanka production image (DigitalOcean App Platform, Droplet/Docker, any container host)
#
#   docker build \
#     --build-arg NEXT_PUBLIC_BASE_DOMAIN=poslanka.lk \
#     --build-arg NEXT_PUBLIC_APP_DOMAIN=app.poslanka.lk \
#     --build-arg NEXT_PUBLIC_LANDING_DOMAIN=www.poslanka.lk \
#     -t poslanka .
#
# NEXT_PUBLIC_* values are compiled into the browser bundle, so they are BUILD arguments.
# Everything secret (DATABASE_URL, NEXTAUTH_SECRET, …) is passed at RUNTIME only.
#
# Web:        docker run -p 3000:3000 --env-file .env.production poslanka
# Migrations: docker run --rm --env-file .env.production poslanka node scripts/migrate.mjs

FROM node:20-bookworm-slim AS deps
WORKDIR /app
ENV CI=1
# postinstall runs patch-package + the Next app-route patch, so they must be present
COPY package.json package-lock.json ./
COPY patches ./patches
COPY scripts/patch-next-app-route-context.js ./scripts/patch-next-app-route-context.js
RUN npm ci --no-audit --no-fund

FROM node:20-bookworm-slim AS build
WORKDIR /app
ARG NEXT_PUBLIC_APP_NAME=skyERPOS
ARG NEXT_PUBLIC_BASE_DOMAIN=skyERPOS.com
ARG NEXT_PUBLIC_APP_DOMAIN=app.skyERPOS.com
ARG NEXT_PUBLIC_LANDING_DOMAIN=skyERPOS.com
ARG NEXT_PUBLIC_APP_URL
ARG NEXT_PUBLIC_SUPPORT_EMAIL
ARG NEXT_PUBLIC_GA_MEASUREMENT_ID
ENV NEXT_PUBLIC_APP_NAME=$NEXT_PUBLIC_APP_NAME \
    NEXT_PUBLIC_BASE_DOMAIN=$NEXT_PUBLIC_BASE_DOMAIN \
    NEXT_PUBLIC_APP_DOMAIN=$NEXT_PUBLIC_APP_DOMAIN \
    NEXT_PUBLIC_LANDING_DOMAIN=$NEXT_PUBLIC_LANDING_DOMAIN \
    NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL \
    NEXT_PUBLIC_SUPPORT_EMAIL=$NEXT_PUBLIC_SUPPORT_EMAIL \
    NEXT_PUBLIC_GA_MEASUREMENT_ID=$NEXT_PUBLIC_GA_MEASUREMENT_ID \
    NEXT_TELEMETRY_DISABLED=1 \
    SKIP_MIGRATIONS=true \
    NODE_OPTIONS=--max-old-space-size=6144
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ARG SKIP_BUILD=false
# next build (+ migration-number validation) and the bundled custom server (server.js: Next + WebSockets)
RUN if [ "$SKIP_BUILD" = "true" ]; then \
      node scripts/validate-migration-numbers.js; \
    else \
      npm run build; \
    fi

FROM node:20-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    SKIP_MIGRATIONS=true
# tini forwards SIGTERM so in-flight requests finish during deploys
RUN apt-get update && apt-get install -y --no-install-recommends tini ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*
COPY --from=build --chown=node:node /app /app
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD curl -fsS http://127.0.0.1:${PORT}/api/health || exit 1
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "server.js"]
