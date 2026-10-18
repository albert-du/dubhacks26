FROM node:22-bookworm-slim AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM dependencies AS build
COPY . .
ARG NEXT_PUBLIC_APP_URL
ENV NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL \
    NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:22-bookworm-slim AS production-dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

FROM dependencies AS fetch-model
COPY tsconfig.json ./
COPY lib/stickerModel.ts lib/stickerModel.ts
COPY scripts/bake-sticker-model.ts scripts/bake-sticker-model.ts
RUN mkdir -p /app/.data/models \
  && node node_modules/tsx/dist/cli.mjs scripts/bake-sticker-model.ts /app/.data/models/birefnet-general-lite.onnx

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 \
    STICKER_MODEL_PATH=/app/.data/models/birefnet-general-lite.onnx
RUN mkdir -p /app/.data/storage /app/.data/models
COPY --from=fetch-model --chown=node:node /app/.data/models/birefnet-general-lite.onnx /app/.data/models/birefnet-general-lite.onnx
RUN chown -R node:node /app
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
# Speech search needs a wav of the clip. Speaches rejects a lot of phone video containers.
USER root
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg \
  && rm -rf /var/lib/apt/lists/*
USER node
# The worker executes TypeScript directly, so it also needs tsx from devDependencies.
COPY --from=dependencies --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node package.json tsconfig.json ./
COPY --chown=node:node lib ./lib
COPY --chown=node:node worker ./worker
CMD ["node", "node_modules/tsx/dist/cli.mjs", "worker/index.ts"]
