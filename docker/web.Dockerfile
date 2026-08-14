# CheCaldo! — immagine di produzione autoconsistente per apps/web.
#
# OBIETTIVO. Chi clona il repository deve poter fare
#   docker compose -f docker-compose.prod.yml --env-file .env up -d --build
# e ottenere un sistema che parte senza montare la sorgente da disco. Prima
# di §12xxxx `docker/node.Dockerfile` costruiva un runtime Node vuoto e
# `docker-compose.prod.yml` montava solo named volumes per node_modules: il
# codice non arrivava mai a /app e `pnpm --filter @checaldo/web build`
# falliva alla partenza del container. Vedi CHECALDO-PROGETTO §12xxxx.
#
# STRUCTURA MULTI-STAGE.
#
#   base       node:22-alpine + libc6-compat + pnpm@9.12.0 — riusata da
#              tutti gli stage successivi.
#   deps       pnpm install --frozen-lockfile SUI SOLI package.json copiati,
#              così il layer si rigenera solo al cambio dei manifest o del
#              lockfile. Riusato dal builder e (indirettamente) dal cron.
#   builder    copia il resto della sorgente + `pnpm --filter @checaldo/web
#              build`. Il prebuild hook di apps/web (`apps/web/package.json`
#              scripts.prebuild) invoca la codegen dei prompt agenti che
#              produce packages/agents/src/*.generated.ts (in .gitignore,
#              rigenerati QUI dentro il build). Next produce l'output
#              standalone in apps/web/.next/standalone/.
#   runner     immagine finale per il servizio `web` in prod: base + soli
#              artefatti standalone + .next/static + public. NIENTE
#              devDependencies, NIENTE pnpm, NIENTE tsx a runtime. Comando
#              `node apps/web/server.js` (server standalone Next).
#   cron       immagine per il servizio `node` (cron del giro, §12wwww):
#              reuse dello stage builder, che ha tsx + tutti i workspace
#              già installati per eseguire packages/db/scripts/genera-giri.ts.
#              Più grossa del runner (contiene devDeps) ma vive solo su
#              invocazione `run --rm` — nessun container acceso in permanenza.
#
# VINCOLI SPECIFICI RISPETTATI.
#
#   - Codegen prompt gira in builder via prebuild hook (predev/prebuild/
#     pretypecheck in apps/web/package.json e packages/agents/package.json).
#     Nessuna lettura di .md a runtime: le costanti sono inlineate nel
#     bundle (vedi packages/agents/scripts/genera-prompt.ts:9-27).
#   - Workspace pnpm: `deps` copia i package.json PRIMA di `pnpm install`
#     per beneficiare del layer cache. `pnpm install --frozen-lockfile`
#     rifiuta se il lock non è allineato (drift @fontsource/archivo risolto
#     in §12wwww).
#   - Font locali `apps/web/public/fonts/` (Google Sans woff2/ttf + IBM
#     Plex Mono via @fontsource): il runner copia esplicitamente
#     `/app/apps/web/public/` per garantire l'inclusione. Il tracer di
#     Next standalone traccia solo le import statiche dai bundle server;
#     asset in public/ vanno sempre copiati a mano (documentato in
#     Next docs "Automatically Copying Traced Files").
#   - MapLibre GL JS pinnato a v4 (vedi apps/web/package.json:6): nessuna
#     modifica alla versione qui.
#
# SPDX-License-Identifier: AGPL-3.0-or-later

# --- STAGE base --------------------------------------------------------
FROM node:22-alpine AS base
# tzdata: senza, `TZ=Europe/Rome` viene ignorato da Alpine (ripiega su
# UTC) — l'opzione A di §12vvvv (§12yyyy) richiede la timezone data
# per l'orologio di sistema. libc6-compat: richiesto da alcune dep
# native (@swc/core ecc.).
RUN apk add --no-cache libc6-compat tzdata
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
ENV CI=true
WORKDIR /app

# --- STAGE deps --------------------------------------------------------
# Copia SOLO i file manifest, così `pnpm install` riusa il layer finché
# non cambia un package.json o il lockfile. Include tutti i workspace
# (apps/web più i quattro packages/*) — pnpm install è workspace-aware
# e installa il grafo completo.
FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/web/package.json apps/web/
COPY packages/agents/package.json packages/agents/
COPY packages/db/package.json packages/db/
COPY packages/scoring/package.json packages/scoring/
COPY packages/fixtures/package.json packages/fixtures/
# --frozen-lockfile: se pnpm-lock.yaml non riflette esattamente i package.json,
# il build fallisce qui invece di silenziosamente aggiornare il lockfile
# dentro l'immagine — così il lockfile del repo resta l'unica fonte.
RUN pnpm install --frozen-lockfile

# --- STAGE builder -----------------------------------------------------
# Copia tutto il resto (sorgente + prompts + config), poi lancia il build
# del web. Il prebuild hook di @checaldo/web fa scattare
# `pnpm --filter @checaldo/agents codegen-prompt` che scrive
# packages/agents/src/{consulente,citta}-prompt.generated.ts. Poi
# `next build` produce apps/web/.next/ e, grazie a `output: standalone`
# in next.config.js, apps/web/.next/standalone/.
#
# DATABASE_URL placeholder. `apps/web/lib/db.ts:10-11` fa throw a
# module load se DATABASE_URL è vuota. Durante `next build` la fase
# "Collecting page data" importa i route handler (es.
# /[comune]/entra-coordinatore/[id]) che a loro volta importano `sql`
# da db.ts — cade lì. Il pool postgres.js è lazy: valore fittizio qui
# soddisfa il check senza aprire connessioni (nessuna query gira a
# build-time). A runtime il compose sovrascrive con la vera URL.
FROM deps AS builder
ENV DATABASE_URL=postgresql://build:build@build:5432/build
COPY . .
RUN pnpm --filter @checaldo/web build

# --- STAGE runner (per web in prod) ------------------------------------
# Immagine finale minimale: solo Node runtime + artefatti standalone.
# Niente pnpm, niente tsx, niente sorgente TS: tutto è già compilato.
FROM base AS runner
ENV NODE_ENV=production
# public/ (skyline PNG, SVG cartina, font Google Sans, OFL.txt) — copiati
# esplicitamente perché il tracer standalone di Next NON include gli asset
# statici (li serve Next stesso da public/ ma non li mette in standalone/).
COPY --from=builder /app/apps/web/public ./apps/web/public
# standalone/ contiene server.js + node_modules tracciato + una copia
# ridotta di .next/. Sostituisce completamente `next start`.
COPY --from=builder /app/apps/web/.next/standalone ./
# .next/static/ (chunks JS/CSS + media woff2 dei @fontsource) — analogo a
# public/: standalone non lo include, va copiato accanto in .next/static/.
COPY --from=builder /app/apps/web/.next/static ./apps/web/.next/static
EXPOSE 3000
# server.js è il server minimale generato da Next standalone. Ascolta su
# 0.0.0.0:3000 se HOSTNAME=0.0.0.0 e PORT=3000 (compose imposta HOSTNAME).
CMD ["node", "apps/web/server.js"]

# --- STAGE cron (per node in prod, §12wwww) ----------------------------
# Immagine per il servizio `node` (cron del giro): reuse dello stage
# builder che ha tsx + tutti i workspace deps installati.
# NON è minimale (contiene devDependencies), ma vive solo su invocazione
# `run --rm` dal cron — nessun container permanente. In cambio: zero bind,
# zero `pnpm install` sull'host, il servizio parte con /app pronto all'uso.
FROM builder AS cron
ENV NODE_ENV=production
WORKDIR /app
# Comando di default interattivo (`node`); il cron lo sovrascrive con
# `sh -c "cd /app/packages/db && npx tsx scripts/genera-giri.ts"`.
CMD ["node"]
