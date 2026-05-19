FROM oven/bun:alpine AS build
WORKDIR /src

COPY package.json bun.lock ./
# bun.lock may not exist on first build — use --no-frozen-lockfile so
# `bun install` resolves fresh. Once a lockfile is checked in, swap
# back to --frozen-lockfile for reproducible builds.
RUN bun install --no-frozen-lockfile

COPY . .

ARG VERSION=dev
ARG BASE_PATH=
ENV BASE_PATH=${BASE_PATH}
ENV APP_VERSION=${VERSION}

RUN bun run build

# Runtime image — svelte-adapter-bun produces a self-contained server
# under build/. Bun runs it directly; no Node required.
FROM oven/bun:alpine
WORKDIR /app
COPY --from=build /src/build /app
EXPOSE 3000
ENV NODE_ENV=production
CMD ["bun", "/app/index.js"]
