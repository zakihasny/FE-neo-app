VERSION 0.8

deps:
    FROM node:22-bookworm-slim@sha256:c3de60bf2f9dd0ac6370e6117950ff62d6e339527e7472301c9c78a017978392
    WORKDIR /app
    RUN npm install --global pnpm@11.16.0
    COPY package.json pnpm-lock.yaml ./
    RUN pnpm install --prod --frozen-lockfile

test:
    FROM +deps
    COPY . .
    RUN pnpm check && pnpm test

image:
    FROM +deps
    ARG IMAGE=fe-neo-app:earthly
    COPY --chown=node:node server ./server
    COPY --chown=node:node migrations ./migrations
    COPY --chown=node:node seeds ./seeds
    COPY --chown=node:node assets ./assets
    COPY --chown=node:node index.html input.html query.html ./
    ENV NODE_ENV=production
    ENV PORT=8080
    USER node
    EXPOSE 8080
    CMD ["node", "server/index.js"]
    SAVE IMAGE $IMAGE
