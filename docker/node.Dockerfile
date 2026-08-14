# Contenitore Node per sviluppo, test e build.
# Il codice arriva per bind mount: qui dentro non si copia nulla.
FROM node:22-alpine

RUN apk add --no-cache libc6-compat git tzdata
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate

ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
ENV CI=true

WORKDIR /app
