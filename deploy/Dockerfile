FROM node:22-bookworm-slim AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM dependencies AS build
COPY . .
ARG NEXT_PUBLIC_APP_URL
ARG NEXT_PUBLIC_PHOTON_NUMBER=""
ENV NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL \
    NEXT_PUBLIC_PHOTON_NUMBER=$NEXT_PUBLIC_PHOTON_NUMBER \
    NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:22-bookworm-slim AS production-dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
RUN mkdir -p /app/.data/storage && chown -R node:node /app
USER node

FROM runtime AS web
COPY --from=production-dependencies --chown=node:node /app/node_modules ./node_modules
# Next loads next.config.ts at startup; bundle its compiler instead of installing it at runtime.
COPY --from=dependencies --chown=node:node /app/node_modules/typescript ./node_modules/typescript
COPY --from=build --chown=node:node /app/.next ./.next
COPY --from=build --chown=node:node /app/public ./public
COPY --from=build --chown=node:node /app/package.json /app/next.config.ts ./
EXPOSE 3000
CMD ["node", "node_modules/next/dist/bin/next", "start", "--hostname", "0.0.0.0"]

FROM runtime AS worker
# The worker executes TypeScript directly, so it also needs tsx from devDependencies.
COPY --from=dependencies --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node package.json tsconfig.json ./
COPY --chown=node:node lib ./lib
COPY --chown=node:node worker ./worker
CMD ["node", "node_modules/tsx/dist/cli.mjs", "worker/index.ts"]
