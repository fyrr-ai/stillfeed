FROM oven/bun:1.4 AS base
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production
COPY . .
ENV STILLFEED_HOME=/data STILLFEED_HOSTNAME=0.0.0.0 STILLFEED_PORT=3200 NODE_ENV=production
# The app runs as the unprivileged bun user, which owns its data directory (a named volume inherits this).
RUN mkdir -p /data && chown bun:bun /data
VOLUME /data
EXPOSE 3200
USER bun
CMD ["bun", "src/server.ts"]
