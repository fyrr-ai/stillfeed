FROM oven/bun:1.4 AS base
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production
COPY . .
ENV RADAR_HOME=/data RADAR_HOSTNAME=0.0.0.0 RADAR_PORT=3200 NODE_ENV=production
VOLUME /data
EXPOSE 3200
USER bun
CMD ["bun", "src/server.ts"]
