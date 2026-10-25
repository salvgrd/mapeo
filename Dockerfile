# Same release layout as .gitea/workflows/deploy.yml: the standalone server,
# its static files, the migrations and the bundled scripts.

FROM docker.io/library/node:22-bookworm-slim AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

# Debian in both stages: @node-rs/argon2 ships a glibc binary, built for this libc.
FROM docker.io/library/node:22-bookworm-slim
WORKDIR /app
# HOSTNAME: the standalone server binds to it, and Docker sets it to the container id.
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
COPY --from=build /app/drizzle ./drizzle
COPY --from=build /app/dist/scripts ./scripts
USER node
EXPOSE 3000
CMD ["sh", "-c", "node scripts/migrate.mjs && exec node server.js"]
