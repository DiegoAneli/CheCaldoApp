#!/bin/sh
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# CheCaldo! — installatore del crontab per il VPS di produzione.
#
# Configura in un comando le tre righe di cron di cui l'applicazione
# ha bisogno per funzionare oltre il primo giorno:
#   - due giri del poller bollettino (packages/ingest/allerta.py --tutti)
#     alle 11:30 e 15:15 ora italiana;
#   - un giro di generazione del giro del giorno
#     (packages/db/scripts/genera-giri.ts) alle 06:00 ora italiana,
#     così il coordinatore trova la lista pronta all'apertura della
#     dashboard.
#
# Motivi degli orari: MOD07-checklist-deploy.md §21.
#
# PROPRIETÀ CHE LO SCRIPT GARANTISCE.
#
# **Nessun percorso codificato.** La cartella del progetto è
# ricavata dalla posizione dello script stesso, non serve editarlo.
# Se il repo è clonato in `/home/qualcuno/checaldo` o
# `/opt/checaldo`, funziona identico.
#
# **Idempotente.** Il blocco è delimitato da due marker riconoscibili
# (`# BEGIN checaldo cron` / `# END checaldo cron`). Rilanciare lo
# script rimuove il blocco esistente fra i marker e lo sostituisce
# col nuovo — mai duplica.
#
# **Non distruttivo.** Le righe del crontab fuori dai marker
# vengono preservate byte-per-byte. Se lo script trova righe che
# assomigliano a un'installazione manuale precedente di CheCaldo
# (senza marker), NON prova a indovinare: esce con exit-code
# non-zero, elenca le righe sospette e chiede all'utente di
# rimuoverle a mano prima di rilanciare.
#
# **Fuso.** Rileva il fuso dell'host (`/etc/timezone` o
# `timedatectl`). Se non è `Europe/Rome`, aggiunge `TZ=Europe/Rome`
# in cima al blocco: il cron di sistema Linux rispetta la variabile
# e interpreta le righe in ora italiana indipendentemente dal fuso
# del server. Chi installa vede in output quale è stato rilevato.
#
# **Verifica post-scrittura.** Rilegge il crontab e mostra il blocco
# effettivamente installato + dove finiranno i log.
#
# **Modalità di prova (`--dry-run`).** Mostra cosa scriverebbe senza
# toccare il crontab. Consigliata come primo lancio.
#
# **Pre-check ambientali.** Se `crontab` non è disponibile o
# l'ambiente non è Linux, esce con exit-code 2 e messaggio chiaro
# invece di fallire in modo oscuro dopo aver toccato mezzo crontab.
#
# Uso:
#   sh scripts/install-cron.sh --dry-run    # anteprima
#   sh scripts/install-cron.sh              # installa

set -e

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$SCRIPT_DIR/.." && pwd)
BEGIN_MARKER='# BEGIN checaldo cron — installato da scripts/install-cron.sh (§12ccccc)'
END_MARKER='# END checaldo cron'
LOG_DIR=/var/log/checaldo

# ---------- parsing argomenti ----------
DRY_RUN=0
for a in "$@"; do
  case "$a" in
    --dry-run|-n) DRY_RUN=1 ;;
    --help|-h)
      sed -n '2,/^$/p' "$0" | sed 's/^# \?//'
      exit 0
      ;;
    *)
      echo "install-cron: argomento non riconosciuto: $a" >&2
      echo "uso: sh scripts/install-cron.sh [--dry-run]" >&2
      exit 2
      ;;
  esac
done

# ---------- pre-check ambiente ----------
if [ "$(uname -s)" != "Linux" ]; then
  echo "install-cron: sistema '$(uname -s)', questo script è pensato per il" >&2
  echo "  VPS di produzione (Linux). Su macOS/Windows il crontab si" >&2
  echo "  comporta diversamente e le righe scritte qui potrebbero non" >&2
  echo "  girare come atteso. Rilancia sul VPS." >&2
  exit 2
fi

if ! command -v crontab >/dev/null 2>&1; then
  echo "install-cron: comando 'crontab' non trovato in PATH. Installa il" >&2
  echo "  pacchetto cron (Debian/Ubuntu: 'sudo apt install cron'; RHEL:" >&2
  echo "  'sudo dnf install cronie') e assicurati che il servizio sia" >&2
  echo "  attivo ('systemctl status cron' oppure 'crond')." >&2
  exit 2
fi

# ---------- rilevamento fuso ----------
HOST_TZ=""
if [ -r /etc/timezone ]; then
  HOST_TZ=$(cat /etc/timezone 2>/dev/null | tr -d '[:space:]')
fi
if [ -z "$HOST_TZ" ] && command -v timedatectl >/dev/null 2>&1; then
  HOST_TZ=$(timedatectl show -p Timezone --value 2>/dev/null || true)
fi
if [ -z "$HOST_TZ" ] && [ -L /etc/localtime ]; then
  HOST_TZ=$(readlink /etc/localtime | sed 's|.*/zoneinfo/||')
fi
if [ -z "$HOST_TZ" ]; then
  HOST_TZ="(non rilevato)"
fi

if [ "$HOST_TZ" = "Europe/Rome" ]; then
  TZ_HEADER=""
  TZ_NOTE="fuso host = Europe/Rome → gli orari sono già interpretati come ora italiana"
else
  TZ_HEADER='TZ=Europe/Rome'
  TZ_NOTE="fuso host = '$HOST_TZ' (≠ Europe/Rome) → aggiunto 'TZ=Europe/Rome' in cima al blocco"
fi

# ---------- costruzione del blocco ----------
# `printf` invece di here-doc: heredoc dentro $() perde newline
# finali in modo shell-dipendente. printf %s\n è portabile.
BLOCK=$(printf '%s\n' \
  "$BEGIN_MARKER" \
  "# Righe generate da scripts/install-cron.sh. Rilanciare lo script" \
  "# per aggiornarle; NON modificarle a mano (verrebbero sovrascritte" \
  "# al prossimo lancio). Log in $LOG_DIR/." \
  ${TZ_HEADER:+"$TZ_HEADER"} \
  "" \
  "# Poller allerta ondate di calore per tutti i comuni serviti (--tutti" \
  "# legge da pubblico.organizzazione). 11:30 cattura la pubblicazione" \
  "# ministeriale delle 11:00 (bollettino lun-ven); 15:15 raccoglie gli" \
  "# aggiornamenti pomeridiani + fa da difesa a un ritardo di" \
  "# pubblicazione onData. Motivi in MOD07 §21." \
  "30 11 * * * cd $ROOT && docker compose -f docker-compose.prod.yml --env-file .env --profile oneshot run --rm ingest python packages/ingest/allerta.py --tutti >> $LOG_DIR/poller.log 2>&1" \
  "15 15 * * * cd $ROOT && docker compose -f docker-compose.prod.yml --env-file .env --profile oneshot run --rm ingest python packages/ingest/allerta.py --tutti >> $LOG_DIR/poller.log 2>&1" \
  "" \
  "# Generazione del giro di oggi per tutte le organizzazioni servite." \
  "# 06:00 Rome così il coordinatore trova la lista pronta all'apertura" \
  "# della dashboard (07:30-08:00). Il livello usato è la previsione a" \
  "# +24h scritta dal poller di ieri; se alle 11:30 il bollettino di" \
  "# oggi cambia il livello, la banda di divergenza in dashboard lo" \
  "# dichiara e la rigenerazione manuale resta al coordinatore." \
  "0 6 * * * cd $ROOT && docker compose -f docker-compose.prod.yml --env-file .env --profile oneshot run --rm node sh -c 'cd /app/packages/db && npx tsx scripts/genera-giri.ts' >> $LOG_DIR/genera-giri.log 2>&1" \
  "$END_MARKER" \
)

# ---------- carica crontab attuale, verifica ambiguità ----------
CURRENT=$(crontab -l 2>/dev/null || true)

# Righe fuori dal blocco marker che sembrano appartenere a checaldo:
# usato come euristica per rilevare installazioni manuali precedenti
# (utente che copiò le righe da MOD07 §21 prima che questo script
# esistesse). Se ne trovo, mi fermo — non so se sostituirle o meno.
CHECALDO_FUORI_BLOCCO=$(printf '%s\n' "$CURRENT" | awk -v begin="$BEGIN_MARKER" -v end="$END_MARKER" '
  $0 == begin { dentro=1; next }
  $0 == end   { dentro=0; next }
  !dentro && /checaldo|packages\/ingest\/allerta\.py|packages\/db\/scripts\/genera-giri\.ts/ { print }
')

if [ -n "$CHECALDO_FUORI_BLOCCO" ]; then
  echo "install-cron: FERMATO — trovate righe che sembrano appartenere a" >&2
  echo "  CheCaldo fuori dal blocco marker (installazione manuale" >&2
  echo "  precedente?). Non le sovrascrivo di iniziativa: rimuovile a" >&2
  echo "  mano con 'crontab -e' e rilancia lo script." >&2
  echo >&2
  echo "  Righe trovate:" >&2
  printf '%s\n' "$CHECALDO_FUORI_BLOCCO" | sed 's/^/    /' >&2
  exit 1
fi

# ---------- rimuove blocco esistente, aggiunge nuovo ----------
CLEANED=$(printf '%s\n' "$CURRENT" | awk -v begin="$BEGIN_MARKER" -v end="$END_MARKER" '
  $0 == begin { skip=1; next }
  $0 == end   { skip=0; next }
  !skip { print }
')

# Se il crontab attuale era vuoto, `printf %s\n ""` produce una riga
# vuota — rimuoviamola per non accumulare vuoti negli aggiornamenti.
if [ -z "$(printf '%s' "$CLEANED" | tr -d '[:space:]')" ]; then
  NEW=$(printf '%s\n' "$BLOCK")
else
  NEW=$(printf '%s\n\n%s\n' "$CLEANED" "$BLOCK")
fi

# ---------- dry-run o scrittura ----------
if [ "$DRY_RUN" = "1" ]; then
  echo "=== DRY-RUN — crontab NON toccato ==="
  echo "Root progetto rilevata: $ROOT"
  echo "$TZ_NOTE"
  echo "Log directory: $LOG_DIR"
  echo
  echo "--- crontab che verrebbe installato ---"
  printf '%s\n' "$NEW"
  echo "--- fine ---"
  echo
  echo "Per applicare: sh scripts/install-cron.sh (senza --dry-run)."
  exit 0
fi

printf '%s\n' "$NEW" | crontab -

# ---------- verifica post-scrittura ----------
echo "=== crontab installato ==="
echo "Root progetto: $ROOT"
echo "$TZ_NOTE"
echo
echo "Blocco effettivo dal crontab:"
crontab -l | awk -v begin="$BEGIN_MARKER" -v end="$END_MARKER" '
  $0 == begin { p=1 }
  p { print "  " $0 }
  $0 == end { p=0 }
'
echo
echo "Log finiranno in:"
echo "  $LOG_DIR/poller.log         (dai due giri del poller)"
echo "  $LOG_DIR/genera-giri.log    (dal giro delle 06:00 Rome)"
echo
echo "Se $LOG_DIR non esiste, crealo con:"
echo "  sudo mkdir -p $LOG_DIR && sudo chown \$(id -un):\$(id -gn) $LOG_DIR"
echo
echo "Il primo run automatico del poller sarà alle 11:30 di oggi (o del"
echo "prossimo giorno feriale se il bollettino oggi non è pubblicato)."
echo "Prima dell'attesa, per popolare pubblico.allerta subito: MOD07 §21."
