#!/bin/sh
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# CheCaldo! — verifica che `schema.sql` + `seed-organizzazione.sql`
# vengano applicati puliti su un cluster PostgreSQL VUOTO.
#
# Motivazione (§12bbbbb): la suite `packages/db` gira contro il
# volume dev esistente, che è stato inizializzato mesi fa e da lì
# sopravvive ai restart. Un forward reference nello schema (come
# quello di §12aaaaa: `riservato.segnale.chiuso_da → utente(id)`
# con `utente` creata dopo) NON si vede lì: il volume dev "risolve"
# storicamente l'ordine e la suite non applica mai `psql -f
# schema.sql` da zero.
#
# Questo script è la difesa strutturale: parte da un cluster vuoto,
# lascia che `docker-entrypoint-initdb.d` applichi lo schema+seed
# esattamente come farebbe chi clona il progetto e fa
# `docker compose up -d postgis`, poi:
#   - verifica ZERO ERROR nei log di initdb;
#   - verifica che tutte le tabelle attese esistano in entrambi gli
#     schemi (pubblico + riservato);
#   - verifica che tutte le chiavi esterne dichiarate siano in piedi
#     (information_schema.table_constraints);
#   - verifica che tutti i CREATE INDEX (non-PK, non-UNIQUE auto)
#     siano applicati;
#   - **applica il seed una SECONDA volta** e verifica che non ci
#     siano duplicati (idempotenza — §12aaaaa post-seed count=4
#     invece di 2, corretto in §12bbbbb con UNIQUE (nome,
#     comune_istat)).
#
# Il test non modifica il volume dev: usa un container effimero
# `checaldo_verify_schema` con `--rm` e volume tmpfs. `set -e` +
# trap ferma tutto al primo errore e assicura il cleanup.
#
# Uso:
#   sh packages/db/scripts/verifica-schema-vuoto.sh
#
# Anche integrato in `scripts/test.sh` come terza suite, per fallire
# la CI su qualunque regressione strutturale.

set -e

# Su Git Bash / MSYS (Windows) i path Unix-style `/c/Users/...` vengono
# convertiti automaticamente in path Windows temp quando passati a
# `docker -v`, e il file finisce mount vuoto. `MSYS_NO_PATHCONV=1`
# disabilita la conversione; su Linux la variabile è ignorata.
export MSYS_NO_PATHCONV=1

CONTAINER=checaldo_verify_schema
IMG=postgis/postgis:16-3.4

# Assoluto: lo script sta in packages/db/scripts/, la root del repo è 3 su.
ROOT=$(cd "$(dirname "$0")/../../.." && pwd)
SCHEMA=$ROOT/packages/db/schema.sql
SEED=$ROOT/packages/db/seed-organizzazione.sql

if [ ! -f "$SCHEMA" ]; then
  echo "verifica-schema-vuoto: schema.sql non trovato in $SCHEMA" >&2
  exit 2
fi
if [ ! -f "$SEED" ]; then
  echo "verifica-schema-vuoto: seed-organizzazione.sql non trovato in $SEED" >&2
  exit 2
fi

cleanup() {
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

# Cleanup preventivo (se un run precedente è cascato senza trap).
cleanup

printf '\n=== 1. avvio postgis effimero con schema+seed montati ===\n'
docker run --rm -d \
  --name "$CONTAINER" \
  -e POSTGRES_USER=checaldo \
  -e POSTGRES_PASSWORD=verify \
  -e POSTGRES_DB=checaldo \
  -e TZ=Europe/Rome \
  -v "$SCHEMA:/docker-entrypoint-initdb.d/01-schema.sql:ro" \
  -v "$SEED:/docker-entrypoint-initdb.d/02-seed.sql:ro" \
  "$IMG" \
  postgres -c timezone=Europe/Rome -c log_timezone=Europe/Rome \
  >/dev/null

# Attendi la fine di initdb E il ripristino del processo postgres
# principale. L'immagine postgres funziona così: (1) initdb avvia
# un postgres temporaneo che applica `/docker-entrypoint-initdb.d/*`;
# (2) al termine fa `fast shutdown`; (3) riavvia postgres come
# processo principale del container. Fra (2) e (3) `pg_isready` cade
# per qualche secondo — se lo script fa query durante la finestra
# rischia timeout intermittenti. Aspettiamo il log "PostgreSQL init
# process complete" (marker fine di 2) seguito da "database system
# is ready to accept connections" del processo main (marker fine 3).
printf 'attendo fine initdb + restart processo principale...\n'
TIMEOUT=90
for _ in $(seq 1 $TIMEOUT); do
  LOG=$(docker logs "$CONTAINER" 2>&1)
  # "PostgreSQL init process complete" appare DOPO l'applicazione
  # di 01-schema.sql + 02-seed.sql, e prima del restart. Serve come
  # marker che le nostre initdb.d sono state processate.
  if printf '%s\n' "$LOG" | grep -q "PostgreSQL init process complete"; then
    # Ora contiamo le occorrenze di "ready to accept connections":
    # la PRIMA è quella del postgres temporaneo di initdb, la
    # SECONDA (che vogliamo) è del processo principale post-restart.
    READY=$(printf '%s\n' "$LOG" | grep -c "ready to accept connections" || true)
    if [ "$READY" -ge 2 ]; then
      # Il socket potrebbe essere aperto ma pg_isready fa un check
      # più aggressivo. Piccolo grace period per assorbire il jitter.
      sleep 1
      if docker exec "$CONTAINER" pg_isready -U checaldo -d checaldo >/dev/null 2>&1; then
        break
      fi
    fi
  fi
  sleep 1
done

# Sanity finale: se lo schema non arrivò in fondo (initdb caduto a
# metà come in §12aaaaa), la tabella ULTIMA dello schema.sql
# (`allerta_citta_cache`) manca. Falliamo con contesto.
if ! docker exec "$CONTAINER" psql -U checaldo -d checaldo -tAc \
    "SELECT to_regclass('pubblico.allerta_citta_cache') IS NOT NULL" \
    2>/dev/null | grep -q '^t$'; then
  echo "verifica-schema-vuoto: initdb NON ha applicato lo schema fino in fondo" >&2
  echo "--- log postgis (ultimi 50) ---" >&2
  docker logs "$CONTAINER" 2>&1 | tail -50 >&2
  exit 1
fi

printf '\n=== 2. zero ERROR nei log di initdb ===\n'
LOG=$(docker logs "$CONTAINER" 2>&1)
ERRORS=$(printf '%s\n' "$LOG" | grep -cE ' ERROR: |^psql:.*: ERROR:' || true)
if [ "$ERRORS" -ne 0 ]; then
  echo "verifica-schema-vuoto: trovati $ERRORS ERROR nei log initdb" >&2
  printf '%s\n' "$LOG" | grep -E ' ERROR: |^psql:.*: ERROR:' >&2
  exit 1
fi
printf 'OK — zero ERROR nei log\n'

printf '\n=== 3. oggetti relazionali attesi in entrambi gli schemi ===\n'
# 17 tabelle + 1 vista. `to_regclass` restituisce non-NULL per
# qualunque relation catalogata (table, view, materialized view,
# index, sequence): funziona per entrambi. `pubblico.v_mappa`
# (VIEW dichiarata a schema.sql:557) è esplicitamente inclusa —
# se in futuro venisse cancellata dallo schema, questo test cade.
# §12jjjjj — aggiunta `riservato.pausa_volontario` all'elenco.
OGGETTI_ATTESI="pubblico.organizzazione pubblico.sezione pubblico.allerta \
pubblico.punteggio_sezione pubblico.punto_fresco pubblico.uso_modello \
pubblico.consiglio_cache pubblico.allerta_citta_cache pubblico.riassunto_cache \
pubblico.v_mappa \
riservato.utente riservato.persona riservato.segnale riservato.contatto \
riservato.soglia_giorno riservato.assegnazione riservato.rango_giorno \
riservato.pausa_volontario riservato.accesso_scheda"
for t in $OGGETTI_ATTESI; do
  presente=$(docker exec "$CONTAINER" psql -U checaldo -d checaldo -tAc \
    "SELECT to_regclass('$t') IS NOT NULL" 2>/dev/null | tr -d ' ')
  if [ "$presente" != "t" ]; then
    echo "verifica-schema-vuoto: oggetto $t MANCA" >&2
    exit 1
  fi
done
printf 'OK — 19 oggetti presenti (18 tabelle + 1 vista)\n'

printf '\n=== 4. FK attese in piedi ===\n'
# Le due FK riparate in §12aaaaa devono esistere. Se il forward
# reference si ripresentasse (chiunque riordini le CREATE senza
# controllare), queste sparirebbero e il test cade qui.
FK_ATTESE="riservato.segnale.chiuso_da riservato.soglia_giorno.impostata_da \
riservato.persona.organizzazione_id riservato.assegnazione.organizzazione_id \
riservato.rango_giorno.organizzazione_id riservato.accesso_scheda.utente_id \
pubblico.punto_fresco.sezione_id pubblico.punteggio_sezione.sezione_id"
for spec in $FK_ATTESE; do
  # Split "schema.tabella.colonna" via awk (bash-agnostic, funziona in sh).
  schema=$(printf '%s' "$spec" | awk -F. '{print $1}')
  tabella=$(printf '%s' "$spec" | awk -F. '{print $2}')
  colonna=$(printf '%s' "$spec" | awk -F. '{print $3}')
  presente=$(docker exec "$CONTAINER" psql -U checaldo -d checaldo -tAc "
    SELECT EXISTS (
      SELECT 1 FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu USING (constraint_schema, constraint_name)
      WHERE tc.constraint_type = 'FOREIGN KEY'
        AND tc.table_schema = '$schema'
        AND tc.table_name = '$tabella'
        AND kcu.column_name = '$colonna'
    )" 2>/dev/null | tr -d ' ')
  if [ "$presente" != "t" ]; then
    echo "verifica-schema-vuoto: FK su $spec MANCA" >&2
    exit 1
  fi
done
printf 'OK — FK critiche in piedi (incluse quelle riparate in §12aaaaa)\n'

printf '\n=== 5. tutti i CREATE INDEX dichiarati sono applicati ===\n'
ATTESI=$(grep -cE "^CREATE (UNIQUE )?INDEX" "$SCHEMA")
PRESENTI=$(docker exec "$CONTAINER" psql -U checaldo -d checaldo -tAc "
  SELECT count(*) FROM pg_indexes
   WHERE schemaname IN ('pubblico','riservato')
     AND indexname NOT LIKE '%_pkey'
     AND indexname NOT LIKE '%_key'" 2>/dev/null | tr -d ' ')
if [ "$ATTESI" -ne "$PRESENTI" ]; then
  echo "verifica-schema-vuoto: indici attesi=$ATTESI, trovati=$PRESENTI" >&2
  exit 1
fi
printf 'OK — %s CREATE INDEX applicati\n' "$ATTESI"

printf '\n=== 5b. colonne audio (§12ggggg) sulle 3 tabelle di cache ===\n'
# §12ggggg — la cache audio vive nelle stesse 3 tabelle del testo
# (colonne `audio bytea` + `audio_generato_il timestamptz`). Non
# aggiunge oggetti (nessuna tabella nuova), ma cambia il contratto:
# se qualcuno riordina lo schema e le colonne spariscono, /api/tts/*
# fallisce a runtime. Questa check garantisce che le colonne ci
# siano dopo qualunque re-apply di schema.sql.
COLONNE_AUDIO="pubblico.consiglio_cache.audio pubblico.consiglio_cache.audio_generato_il \
pubblico.allerta_citta_cache.audio pubblico.allerta_citta_cache.audio_generato_il \
pubblico.riassunto_cache.audio pubblico.riassunto_cache.audio_generato_il"
for spec in $COLONNE_AUDIO; do
  schema=$(printf '%s' "$spec" | awk -F. '{print $1}')
  tabella=$(printf '%s' "$spec" | awk -F. '{print $2}')
  colonna=$(printf '%s' "$spec" | awk -F. '{print $3}')
  presente=$(docker exec "$CONTAINER" psql -U checaldo -d checaldo -tAc "
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema = '$schema'
         AND table_name = '$tabella'
         AND column_name = '$colonna'
    )" 2>/dev/null | tr -d ' ')
  if [ "$presente" != "t" ]; then
    echo "verifica-schema-vuoto: colonna $spec MANCA" >&2
    exit 1
  fi
done
printf 'OK — 6 colonne audio (%s) presenti su 3 tabelle cache\n' \
  "bytea + timestamptz × 3"

printf '\n=== 6. idempotenza del seed: rilancio SECONDA volta ===\n'
# Il seed è già stato applicato una volta da `/docker-entrypoint-initdb.d`.
# Post-first-run: 2 org, 2 utenti. Se rilanciando raddoppia = idempotenza rotta.
COUNT_ORG_PRE=$(docker exec "$CONTAINER" psql -U checaldo -d checaldo -tAc \
  "SELECT count(*) FROM pubblico.organizzazione" | tr -d ' ')
COUNT_UTE_PRE=$(docker exec "$CONTAINER" psql -U checaldo -d checaldo -tAc \
  "SELECT count(*) FROM riservato.utente" | tr -d ' ')
if [ "$COUNT_ORG_PRE" != "2" ] || [ "$COUNT_UTE_PRE" != "2" ]; then
  echo "verifica-schema-vuoto: seed iniziale non ha prodotto (2,2): trovato ($COUNT_ORG_PRE,$COUNT_UTE_PRE)" >&2
  exit 1
fi
printf 'pre-secondo-seed: org=%s, utente=%s\n' "$COUNT_ORG_PRE" "$COUNT_UTE_PRE"

# Rilancio del seed via psql (docker exec).
docker exec -i "$CONTAINER" psql -U checaldo -d checaldo -q < "$SEED" >/dev/null

COUNT_ORG_POST=$(docker exec "$CONTAINER" psql -U checaldo -d checaldo -tAc \
  "SELECT count(*) FROM pubblico.organizzazione" | tr -d ' ')
COUNT_UTE_POST=$(docker exec "$CONTAINER" psql -U checaldo -d checaldo -tAc \
  "SELECT count(*) FROM riservato.utente" | tr -d ' ')

if [ "$COUNT_ORG_POST" != "2" ] || [ "$COUNT_UTE_POST" != "2" ]; then
  echo "verifica-schema-vuoto: seed NON idempotente" >&2
  echo "  atteso: (org=2, utente=2)" >&2
  echo "  trovato dopo secondo seed: (org=$COUNT_ORG_POST, utente=$COUNT_UTE_POST)" >&2
  echo "  → INSERT senza ON CONFLICT target adeguato" >&2
  exit 1
fi
printf 'OK — post-secondo-seed: org=%s, utente=%s (idempotente)\n' \
  "$COUNT_ORG_POST" "$COUNT_UTE_POST"

printf '\nverifica-schema-vuoto: tutti i controlli OK — schema deployabile da zero.\n'
