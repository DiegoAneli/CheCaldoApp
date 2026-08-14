#!/bin/sh
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# Suite completa di test del monorepo. Un solo comando per capire se
# tutto è verde.
#
# Attraversa due container perché le suite vivono in due runtime diversi:
#
#   - Node/TypeScript: @checaldo/scoring (20) + @checaldo/db (57) via
#     `pnpm -r test` dentro il container `node`
#   - Python: packages/ingest/test/test_allerta.py (14) via
#     `python -m unittest` dentro il container `ingest`
#   - Bash: packages/db/scripts/verifica-schema-vuoto.sh (§12bbbbb)
#     avvia un container postgis effimero, applica schema+seed su
#     cluster vuoto, verifica tabelle/FK/indici/idempotenza-seed —
#     l'unico test che difende contro forward references dello schema
#
# Non esiste un container che abbia sia pnpm sia python: da qui la
# necessità di uno script che gira sull'host e chiama entrambi.
#
# Uso: sh scripts/test.sh
#
# Il container postgis viene tirato su automaticamente se serve
# (depends_on di `node` e `ingest`). Se non è già up, il primo
# `docker compose run` blocca 5-10s in più per l'healthcheck.
#
# Fallisce al primo errore: `set -e` interrompe subito, così il
# ritorno non-zero è affidabile per CI o hook pre-push.

set -e

printf '\n=== @checaldo/scoring + @checaldo/db (Node/TypeScript) ===\n'
docker compose run --rm node pnpm -r test

printf '\n=== packages/ingest/test_allerta.py (Python) ===\n'
docker compose run --rm ingest python -m unittest discover -s packages/ingest/test -v

# §12bbbbb — verifica che schema.sql + seed applichino puliti su un
# cluster PostgreSQL VUOTO. La suite `packages/db` sopra gira sul
# volume dev esistente e NON rileverebbe forward references (come
# il bug §12aaaaa: `segnale.chiuso_da → utente(id)` risolto
# spostando la CREATE di `utente`) né rotture di idempotenza del
# seed. Questo test lancia un container postgis effimero con
# volume tmpfs, applica schema+seed da `docker-entrypoint-initdb.d`,
# verifica tabelle + FK + indici, e rilancia il seed una seconda
# volta per far cadere la suite se qualcuno riapre il buco §12aaaaa.
printf '\n=== verifica-schema-vuoto (cluster PostgreSQL fresco, §12bbbbb) ===\n'
sh "$(dirname "$0")/../packages/db/scripts/verifica-schema-vuoto.sh"

printf '\nOK — tutte le suite di test verdi.\n'
