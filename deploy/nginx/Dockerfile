# ORIGINX web — builds the React app (web/) and serves it from nginx, which also proxies /api to the API.
# Build context is the repository root:  docker compose -f docker-compose.prod.yml build web
FROM node:22-alpine AS build
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

FROM nginx:1.27-alpine
COPY deploy/nginx/originx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /web/dist /usr/share/nginx/html
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- --no-check-certificate https://127.0.0.1/nginx-health >/dev/null || exit 1
