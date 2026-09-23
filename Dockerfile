# syntax=docker/dockerfile:1
# One image for the API and the worker (different commands); a second target serves the SPA.

FROM node:26-slim AS server-deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY client/package.json client/
RUN npm ci --omit=dev --workspace server --include-workspace-root=false

FROM node:26-slim AS client-build
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY client/package.json client/
RUN npm ci --workspace client --include-workspace-root=false
COPY client client
COPY deploy/security-headers.conf deploy/
RUN npm run build --workspace client

FROM node:26-slim AS server
ENV NODE_ENV=production
WORKDIR /app
COPY --from=server-deps /app/node_modules node_modules
COPY --from=client-build /app/client/dist /app/client/dist
COPY server server
RUN mkdir -p server/storage/uploads && chown -R node:node server/storage
USER node
WORKDIR /app/server
CMD ["node", "src/index.js"]

FROM nginx:1.29-alpine AS web
# rendered to /etc/nginx/conf.d/default.conf at startup with API_UPSTREAM filled in
COPY deploy/nginx.conf.template /etc/nginx/templates/default.conf.template
ENV API_UPSTREAM=http://api:4000 NGINX_PORT=80
COPY deploy/security-headers.conf /etc/nginx/snippets/security-headers.conf
COPY --from=client-build /app/client/dist /usr/share/nginx/html

# ---- all-in-one: nginx + API + worker in one container, for hosts that run a single service (e.g. Render).
# The last stage, so it is what a plain `docker build` produces; docker compose picks its own targets.
FROM node:26-slim AS all-in-one
RUN apt-get update \
 && apt-get install -y --no-install-recommends nginx gettext-base \
 && rm -rf /var/lib/apt/lists/* /etc/nginx/sites-enabled/default
# client -> host load balancer -> nginx -> API: two proxies in front of the API
ENV NODE_ENV=production TRUST_PROXY=2
WORKDIR /app
COPY --from=server-deps /app/node_modules node_modules
COPY server server
RUN mkdir -p server/storage/uploads
COPY deploy/nginx.conf.template /etc/nginx/templates/default.conf.template
COPY deploy/security-headers.conf /etc/nginx/snippets/security-headers.conf
COPY --from=client-build /app/client/dist /usr/share/nginx/html
COPY --from=client-build /app/client/dist /app/client/dist
COPY --chmod=755 deploy/start-all-in-one.sh /usr/local/bin/start-all-in-one
EXPOSE 80
CMD ["start-all-in-one"]
