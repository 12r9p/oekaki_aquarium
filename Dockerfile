FROM --platform=linux/amd64 oven/bun:1.3.5

WORKDIR /app

COPY . .
RUN bun install --frozen-lockfile \
    && bun run build \
    && mkdir -p /app/data/fish /app/packages/server/public/images/scene

ENV PORT=3000
EXPOSE 3000

CMD ["bun", "run", "--cwd", "packages/server", "start"]
