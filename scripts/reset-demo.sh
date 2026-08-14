#!/bin/sh
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# CheCaldo! — reset dei dati sintetici della demo su VPS.
#
# Riporta la demo pubblica a uno stato pulito e recente:
#   1. TRUNCATE dello stato riservato prodotto dall'uso (contatti, esiti,
#      assegnazioni, ranghi, soglie, pause) + `pubblico.riassunto_cache`.
#   2. Rigenerazione fixture Parma + Bologna con DATA_BASE = oggi
#      (concatenato seed + carica nello stesso container, perché
#      `docker-compose.prod.yml` non monta volumi sul servizio `node`).
#   3. Verifica finale: persone per organizzazione, segnali attivi per
#      tipo nelle due città, righe in `rango_giorno` e `assegnazione`
#      per oggi.
#
# COSA NON TOCCA (verificato mano su packages/db/schema.sql e
# packages/db/src/query.ts prima di ogni TRUNCATE):
#   - `riservato.persona`: DELETE la lascerebbe senza coordinatori;
#     il carica sotto la aggiorna via ON CONFLICT (org, id_esterno).
#   - `riservato.utente`: coordinatori e volontari restano.
#   - `pubblico.consiglio_cache`, `pubblico.allerta_citta_cache`: dipendono da
#     punti freschi e meteo, non dalle persone; rigenerarle consuma
#     credito API per niente.
#   - `pubblico.sezione`, `pubblico.punto_fresco`: dati ISTAT/OSM
#     caricati una tantum dall'ingest Python, non toccati dal reset.
#   - `pubblico.allerta`, `pubblico.uso_modello`: telemetria e ramo di
#     allerta, storia indipendente dalle persone.
#
# SICUREZZA — guardia flag obbligatoria. Su un'installazione comunale
# reale questo script distruggerebbe dati operativi. La guardia impone
# un flag esplicito perché nessuno lo lanci per abitudine.
#
# ATOMICITÀ — questo script NON è atomico end-to-end. La strada che
# tiene il rischio più basso è:
#   (a) generare i CSV/JSON PRIMA del TRUNCATE (se il generatore
#       fallisce, il DB è ancora intatto);
#   (b) fare un dump di `riservato` PRIMA del TRUNCATE, tenerlo in
#       /var/backups/checaldo/ con timestamp; se poi il carica
#       fallisce, la strada di recupero è documentata a schermo:
#       `psql < /var/backups/checaldo/pre-reset-*.sql`.
#   (c) TRUNCATE e carica dentro lo stesso `docker compose run --rm`
#       via `sh -c`: se il carica fallisce a metà, il carica è
#       idempotente (ON CONFLICT DO UPDATE) e si rilancia dopo aver
#       risolto la causa. Se invece il container muore prima di
#       arrivare al carica, il messaggio finale di errore indica il
#       backup e il comando di restore.
# Non esiste "una transazione unica" che copra TRUNCATE + due processi
# di seed/carica in container: sono connessioni separate. Il backup +
# istruzione di restore è il compromesso pragmatico.
#
# USO:
#   sh scripts/reset-demo.sh --conferma-dati-sintetici
#
# Requisiti sul VPS:
#   - docker + docker compose plugin attivi;
#   - `.env` presente con POSTGRES_USER, POSTGRES_PASSWORD, POSTGRES_DB,
#     FAKER_SEED (opzionale, default 42), TZ (Europe/Rome);
#   - i servizi `web`, `postgis`, `tts`, `caddy` up (l'istanza pubblica
#     resta accessibile durante il reset — la finestra "vuota" tra
#     TRUNCATE e fine carica è di ~15-30s);
#   - `pubblico.sezione` e `pubblico.punto_fresco` già popolate per
#     entrambi i comuni (una tantum, via ingest Python — se mancano
#     il carica muore con `pubblico.sezione vuota per COMUNE`).

set -eu

# `COMPOSE_FILE` overridabile via env così lo stesso script si prova in
# locale con `COMPOSE_FILE=docker-compose.yml sh scripts/reset-demo.sh …`
# senza aprirlo per modificarlo. Default: produzione.
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"
ENV_FILE=".env"

# --- Guardia flag obbligatoria ----------------------------------------
if [ "${1:-}" != "--conferma-dati-sintetici" ]; then
  cat >&2 <<EOF
reset-demo.sh — rifiutato senza flag esplicito.

Questo script distrugge dati operativi. Su un'installazione comunale
reale i campi che sto per azzerare (riservato.contatto, assegnazione,
pausa_volontario, segnali degli operatori) contengono lavoro vero
delle persone.

Se sei sulla demo pubblica e sai cosa stai facendo:
  sh scripts/reset-demo.sh --conferma-dati-sintetici
EOF
  exit 2
fi

cd "$(dirname "$0")/.."

# --- Sanity check: file compose e .env presenti -----------------------
if [ ! -f "$COMPOSE_FILE" ]; then
  echo "ERRORE: $COMPOSE_FILE non trovato nella dir corrente." >&2
  exit 1
fi
if [ ! -f "$ENV_FILE" ]; then
  echo "ERRORE: $ENV_FILE non trovato nella dir corrente." >&2
  exit 1
fi

# Legge POSTGRES_USER e POSTGRES_DB da .env (senza esportare tutto
# l'env — il file .env contiene segreti che non servono a questo
# script). `set -a`/`+a` esporta solo per il tempo del source.
set -a
# shellcheck disable=SC1090
. "./$ENV_FILE"
set +a
: "${POSTGRES_USER:?POSTGRES_USER non impostato in .env}"
: "${POSTGRES_DB:?POSTGRES_DB non impostato in .env}"

# --- Backup pre-TRUNCATE ---------------------------------------------
# `BACKUP_DIR` overridabile via env come `COMPOSE_FILE`: la produzione usa
# /var/backups/checaldo (path richiede utente con permessi su /var/backups),
# ambienti di sviluppo (Windows/WSL) passano un path in home.
BACKUP_DIR="${BACKUP_DIR:-/var/backups/checaldo}"
TS="$(date -u +%Y%m%dT%H%M%SZ)"
BACKUP_FILE="$BACKUP_DIR/pre-reset-$TS.sql"
mkdir -p "$BACKUP_DIR"

# --- Trap di uscita: se lo script fallisce, ristampa il blocco di
#     RESTORE come ultima cosa a schermo. Il blocco stampato in [1/5]
#     ormai è scorso via sotto l'output di seed/carica, e a occhio nudo
#     serve avere il path del backup + il TRUNCATE + il psql -f in
#     coda, pronti da copiare.
#
#     `trap ... EXIT` invece di `trap ... ERR`: sh POSIX non garantisce
#     trap ERR; EXIT è portabile e con `set -e` scatta con l'exit code
#     del comando che ha fatto fallire lo script.
STEP="init"

on_exit() {
  ec=$?
  if [ "$ec" -eq 0 ]; then
    return 0
  fi
  {
    printf '\n'
    printf '========================================================\n'
    printf 'RESET FALLITO al passo: %s (exit=%s)\n' "$STEP" "$ec"
    printf '========================================================\n'
    if [ -s "$BACKUP_FILE" ]; then
      printf '\n'
      printf 'Backup pre-reset disponibile:\n'
      printf '  %s\n' "$BACKUP_FILE"
      printf '\n'
      printf 'RESTORE (le tabelle vanno svuotate prima: il dump e\n'
      # `--` come primo argomento dice al printf builtin "fine opzioni":
      # senza, un format string che inizia con `--` (qui `--data-only`)
      # viene interpretato come opzione sconosciuta e fa fallire il trap
      # proprio quando serve stampare le istruzioni di restore.
      printf -- '--data-only e psql -f fa COPY sopra righe esistenti,\n'
      printf 'che fallisce sui vincoli):\n'
      printf '\n'
      printf '  docker compose -f %s --env-file %s exec -T postgis \\\n' "$COMPOSE_FILE" "$ENV_FILE"
      printf '    psql -U %s -d %s -v ON_ERROR_STOP=1 <<SQL\n' "$POSTGRES_USER" "$POSTGRES_DB"
      printf '      BEGIN;\n'
      printf '      TRUNCATE\n'
      printf '        riservato.accesso_scheda, riservato.contatto,\n'
      printf '        riservato.segnale, riservato.assegnazione,\n'
      printf '        riservato.rango_giorno, riservato.soglia_giorno,\n'
      printf '        riservato.pausa_volontario, pubblico.riassunto_cache\n'
      printf '      RESTART IDENTITY CASCADE;\n'
      printf '      COMMIT;\n'
      printf '  SQL\n'
      printf '  docker compose -f %s --env-file %s exec -T postgis \\\n' "$COMPOSE_FILE" "$ENV_FILE"
      printf '    psql -U %s -d %s -v ON_ERROR_STOP=1 < %s\n' "$POSTGRES_USER" "$POSTGRES_DB" "$BACKUP_FILE"
      printf '\n'
      printf 'Presupposti: riservato.persona e riservato.utente non\n'
      printf 'sono nel dump (non li tocchiamo mai): devono esistere\n'
      printf 'ancora con gli stessi id, altrimenti le FK saltano.\n'
      printf 'pubblico.consiglio_cache e pubblico.allerta_citta_cache non sono\n'
      printf 'nel dump e non vengono ripristinate.\n'
    else
      printf '\n'
      printf 'NESSUN BACKUP disponibile (fallito prima o durante il\n'
      printf 'passo di backup). Il database non e stato modificato.\n'
    fi
    printf '\n'
  } >&2
}
trap on_exit EXIT

STEP="[1/5] backup pre-reset"
printf '\n==> [1/5] backup schema riservato pre-reset in %s\n' "$BACKUP_FILE"
# pg_dump gira dentro il container postgis; la redirezione `>` è dell'host
# (`docker compose exec` collega stdout del container a stdout dell'host,
# `>` la reindirizza sul filesystem dell'host prima ancora che il container
# apra il file). Quindi `$BACKUP_FILE` atterra su **/var/backups/checaldo
# dell'HOST**, non nel container — sopravvive alla ricreazione del
# container postgis.
#
# Restringiamo il dump a cio' che questo script distrugge davvero:
# tutto lo schema `riservato` (via `-t 'riservato.*'`, pattern che
# matcha ogni tabella dello schema) + la singola `pubblico.riassunto_cache`
# (via un secondo `-t`). NON dumpiamo `pubblico.consiglio_cache` ne'
# `pubblico.allerta_citta_cache` (dipendono da meteo/punti freschi, non
# dalle persone, e le loro MP3 in bytea pesano) ne' il resto di
# `pubblico` (sezioni ISTAT stabili, allerta come storia indipendente).
# `--data-only`: lo schema e' gia' in schema.sql.
#
# NON usare `--schema=riservato` e `--table=pubblico.riassunto_cache`
# INSIEME: pg_dump li combina in AND (docs: "objects which are in one
# of the schemas listed in -n options AND have names matching one of
# the tables listed in -t options"), quindi nessuna tabella di
# `riservato` finirebbe nel dump. Bug osservato pre-2026-08-14: i
# backup contenevano solo `pubblico.riassunto_cache` (spesso vuota
# dopo un TRUNCATE precedente), i primi 533 KB del primo run erano
# solo blob audio in cache; nessun dato di `riservato` mai salvato.
# `-t 'riservato.*'` con `-t pubblico.riassunto_cache` (due `-t`
# separati) usa la logica OR fra i pattern e include entrambe.
docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" exec -T postgis \
  pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --data-only \
  -t 'riservato.*' -t pubblico.riassunto_cache \
  > "$BACKUP_FILE"
BACKUP_SIZE=$(wc -c < "$BACKUP_FILE")
printf '     backup fatto (%s byte).\n' "$BACKUP_SIZE"
printf '     RESTORE in caso di errore (le tabelle vanno svuotate prima:\n'
printf '     il dump è --data-only e psql -f fa COPY sopra righe esistenti,\n'
printf '     che fallisce sui vincoli UNIQUE e FK):\n'
printf '\n'
printf '       docker compose -f %s --env-file %s exec -T postgis \\\n' "$COMPOSE_FILE" "$ENV_FILE"
printf '         psql -U %s -d %s -v ON_ERROR_STOP=1 <<SQL\n' "$POSTGRES_USER" "$POSTGRES_DB"
printf '           BEGIN;\n'
printf '           TRUNCATE\n'
printf '             riservato.accesso_scheda, riservato.contatto,\n'
printf '             riservato.segnale, riservato.assegnazione,\n'
printf '             riservato.rango_giorno, riservato.soglia_giorno,\n'
printf '             riservato.pausa_volontario, pubblico.riassunto_cache\n'
printf '           RESTART IDENTITY CASCADE;\n'
printf '           COMMIT;\n'
printf '       SQL\n'
printf '       docker compose -f %s --env-file %s exec -T postgis \\\n' "$COMPOSE_FILE" "$ENV_FILE"
printf '         psql -U %s -d %s -v ON_ERROR_STOP=1 < %s\n' "$POSTGRES_USER" "$POSTGRES_DB" "$BACKUP_FILE"
printf '\n'
printf '     Presupposti del restore:\n'
printf '     - riservato.persona e riservato.utente NON sono nel dump\n'
printf '       (non li tocchiamo mai): devono esistere ancora con gli\n'
printf '       stessi id, altrimenti le FK di segnale/contatto/etc\n'
printf '       falliscono. Se hai cancellato persone o utenti nel\n'
printf '       frattempo, il restore non basta.\n'
printf '     - pubblico.consiglio_cache e pubblico.allerta_citta_cache non sono\n'
printf '       toccate né dallo script né dal restore: la cache resta\n'
printf '       quella corrente al momento del reset.\n'

# --- TRUNCATE ---------------------------------------------------------
STEP="[2/5] TRUNCATE stato riservato + riassunto_cache"
printf '\n==> [2/5] TRUNCATE stato riservato usabile + riassunto_cache\n'
docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" exec -T postgis \
  psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 <<'SQL'
BEGIN;
TRUNCATE
  riservato.accesso_scheda,
  riservato.contatto,
  riservato.segnale,
  riservato.assegnazione,
  riservato.rango_giorno,
  riservato.soglia_giorno,
  riservato.pausa_volontario,
  pubblico.riassunto_cache
RESTART IDENTITY CASCADE;
-- riservato.persona e riservato.utente NON toccati: i coordinatori
-- (dal seed) e il grafo di utenza restano. Il carica sotto popola le
-- persone via ON CONFLICT (org, id_esterno) DO UPDATE.
-- pubblico.consiglio_cache e pubblico.allerta_citta_cache NON toccati:
-- dipendono da punti freschi e meteo, non dalle persone.
COMMIT;
SQL
printf '     TRUNCATE completato.\n'

# --- Rigenerazione fixture Parma --------------------------------------
STEP="[3/5] seed + carica Parma (034027)"
printf '\n==> [3/5] seed + carica Parma (comune ISTAT 034027)\n'
docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" --profile oneshot \
  run --rm node sh -c \
  "pnpm --filter @checaldo/fixtures seed -- --comune-istat 034027 && \
   pnpm --filter @checaldo/fixtures carica -- --org 1"

# --- Rigenerazione fixture Bologna ------------------------------------
STEP="[4/5] seed + carica Bologna (037006)"
printf '\n==> [4/5] seed + carica Bologna (comune ISTAT 037006)\n'
docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" --profile oneshot \
  run --rm node sh -c \
  "pnpm --filter @checaldo/fixtures seed -- --comune-istat 037006 && \
   pnpm --filter @checaldo/fixtures carica -- --org 2"

# --- Verifica finale --------------------------------------------------
STEP="[5/5] verifica finale"
printf '\n==> [5/5] verifica stato post-reset\n'
docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" exec -T postgis \
  psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 <<'SQL'
\echo '--- persone per organizzazione ---'
SELECT organizzazione_id, count(*) AS persone
  FROM riservato.persona
 GROUP BY organizzazione_id
 ORDER BY organizzazione_id;

\echo '--- segnali attivi per tipo, per città (validi oggi) ---'
SELECT o.comune_istat, s.tipo, count(*) AS n
  FROM riservato.segnale s
  JOIN riservato.persona p ON p.id = s.persona_id
  JOIN pubblico.organizzazione o ON o.id = p.organizzazione_id
 WHERE s.chiuso_il IS NULL
   AND (s.valido_fino IS NULL OR s.valido_fino >= CURRENT_DATE)
 GROUP BY o.comune_istat, s.tipo
 ORDER BY o.comune_istat, s.tipo;

\echo '--- rango_giorno e assegnazione per oggi ---'
SELECT o.id AS organizzazione_id,
       (SELECT count(*) FROM riservato.rango_giorno rg
         WHERE rg.organizzazione_id = o.id AND rg.data = CURRENT_DATE) AS rango_giorno,
       (SELECT count(*) FROM riservato.assegnazione a
         WHERE a.organizzazione_id = o.id AND a.data = CURRENT_DATE) AS assegnazione,
       (SELECT valore FROM riservato.soglia_giorno sg
         WHERE sg.organizzazione_id = o.id AND sg.data = CURRENT_DATE) AS soglia
  FROM pubblico.organizzazione o
 ORDER BY o.id;
SQL

printf '\nOK — reset completato. Backup pre-reset: %s\n' "$BACKUP_FILE"
