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
COPY server server
RUN mkdir -p server/storage/uploads && chown -R node:node server/storage
USER node
WORKDIR /app/server
EXPOSE 4000
CMD ["node", "src/index.js"]

FROM nginx:1.29-alpine AS web
# rendered to /etc/nginx/conf.d/default.conf at startup with API_UPSTREAM filled in
COPY deploy/nginx.conf.template /etc/nginx/templates/default.conf.template
ENV API_UPSTREAM=http://api:4000
COPY deploy/security-headers.conf /etc/nginx/snippets/security-headers.conf
COPY --from=client-build /app/client/dist /usr/share/nginx/html
