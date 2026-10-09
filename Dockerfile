# ORIGINX API — production image (multi-stage, non-root, no dev dependencies).
FROM node:22-alpine AS build
WORKDIR /app
RUN apk add --no-cache openssl
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
COPY contracts ./contracts
RUN npx prisma generate && npm run build && npm prune --omit=dev

FROM node:22-alpine AS runtime
ENV NODE_ENV=production \
    NPM_CONFIG_UPDATE_NOTIFIER=false \
    CHECKPOINT_DISABLE=1
WORKDIR /app
RUN apk add --no-cache openssl tini
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/prisma ./prisma
COPY --from=build --chown=node:node /app/contracts/artifacts ./contracts/artifacts
COPY --chown=node:node package.json ./
USER node
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD wget -qO- http://127.0.0.1:4000/health >/dev/null || exit 1
ENTRYPOINT ["/sbin/tini", "--"]
# Apply pending migrations (Supabase DIRECT_URL), then start the API.
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/server.js"]
