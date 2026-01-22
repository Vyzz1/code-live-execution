# Development stage
FROM node:20-alpine AS development
WORKDIR /usr/src/app

# Enable pnpm via corepack
RUN corepack enable && corepack prepare pnpm@latest --activate

COPY package.json pnpm-lock.yaml ./
RUN pnpm install

COPY . .
USER node


# Build stage
FROM node:20-alpine AS build
WORKDIR /usr/src/app

RUN corepack enable && corepack prepare pnpm@latest --activate

COPY package.json pnpm-lock.yaml ./
COPY --from=development /usr/src/app/node_modules ./node_modules
COPY . .

RUN pnpm run build
RUN pnpm prune --prod

USER node


# Production stage
FROM node:20-alpine AS production
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@latest --activate

COPY --from=build /usr/src/app/node_modules ./node_modules
COPY --from=build /usr/src/app/dist ./dist

#  Install Docker CLI
RUN apk add --no-cache docker-cli bash

COPY wait-for-it.sh ./wait-for-it.sh
RUN apk add --no-cache dos2unix bash \
    && dos2unix /app/wait-for-it.sh \
    && chmod +x /app/wait-for-it.sh \
    && apk del dos2unix

ENV NODE_ENV=production
COPY .env ./.env


CMD ["node", "dist/main.js"]
