# syntax=docker/dockerfile:1.7

FROM node:24-alpine AS dependencies

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

RUN corepack enable && corepack prepare pnpm@11.16.0 --activate

WORKDIR /app

COPY package.json pnpm-lock.yaml ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --prod --frozen-lockfile

FROM node:24-alpine AS runtime

ENV NODE_ENV=production
ENV PORT=80

# Allow the non-root Node process to bind port 80 when the runtime permits this capability.
RUN apk add --no-cache --virtual .port-capability libcap \
    && setcap 'cap_net_bind_service=+ep' /usr/local/bin/node \
    && apk del .port-capability

WORKDIR /app

COPY --from=dependencies --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node package.json pnpm-lock.yaml ./
COPY --chown=node:node server ./server
COPY --chown=node:node migrations ./migrations
COPY --chown=node:node seeds ./seeds
COPY --chown=node:node assets ./assets
COPY --chown=node:node index.html input.html query.html ./

USER node

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=240s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 80) + '/healthz').then((response) => { if (!response.ok) process.exit(1) }).catch(() => process.exit(1))"

CMD ["node", "server/index.js"]
