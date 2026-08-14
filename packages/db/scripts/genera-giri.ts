// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * CheCaldo! — genera il giro di oggi per tutte le organizzazioni servite.
 *
 * Batch idempotente pensato per il cron di produzione (MOD07 §7). Fa
 * quello che il bottone "Genera il giro" della dashboard coordinatore
 * farebbe cliccato per ogni organizzazione, senza dipendere da un
 * essere umano al desktop la mattina presto.
 *
 * DIFFERENZA con `packages/fixtures/scripts/carica-nel-db.ts`. Quello
 * è la pipeline completa di seed: legge CSV, inserisce persone e
 * segnali, crea volontari demo, POI chiama `generaGiroDelGiorno`. È
 * un rebuild da zero, non un batch giornaliero. Questo script fa SOLO
 * l'ultima riga di `carica-nel-db.ts`, iterando su tutte le org.
 *
 * REGOLA DI SICUREZZA. Se per l'organizzazione X esistono già righe
 * in `riservato.assegnazione` con `data = OGGI`, lo script SALTA
 * quell'org e stampa `[SKIP]`. Motivo: `generaGiroDelGiorno` fa
 * DELETE+INSERT scopato per organizzazione, protetta solo dalle
 * "protette" (persone con contatto oggi, `query.ts:2628-2650`).
 * Una persona che era in lista ma non ancora contattata verrebbe
 * cancellata; se il ricalcolo la lascia fuori (soglia cambiata, o
 * segnali scaduti nel frattempo) si perde traccia. Il cron può
 * ritentare dopo un fallimento parziale senza distruggere ciò che
 * è già in piedi.
 *
 * `--forza` salta la protezione. Va usato a mano quando si sa cosa
 * si sta facendo — mai dal cron.
 *
 * ISOLAMENTO PER ORGANIZZAZIONE. Come `packages/ingest/allerta.py`
 * righe 582-618: try/except attorno a ogni org, i falliti finiscono
 * in `[FAIL]`, gli altri procedono. A fine ciclo exit non-zero se
 * `falliti > 0`, così il cron lo segnala. Un fail su Bologna non
 * lascia Parma senza giro.
 *
 * MESSAGGIO LEGGIBILE quando manca l'allerta. `generaGiroDelGiorno`
 * fa `throw new Error("nessuna allerta in pubblico.allerta per X al Y")`
 * (`query.ts:2540-2544`). Nel contesto cron quel testo va tradotto
 * in qualcosa che chi legge il log capisca in prima lettura, con
 * indicazione dove andare a guardare.
 *
 * ORARI E FUSO. Il cron di prod passa `CHECALDO_OGGI` esplicito così
 * lo script non dipende dal `TZ` del container node (fintanto che
 * §12vvvv non è risolto). Vedi MOD07 §7 per gli orari.
 *
 * Uso (dev):
 *   docker compose run --rm node sh -c \
 *     "cd /app/packages/db && npx tsx scripts/genera-giri.ts"
 *
 * Uso (prod, dal cron):
 *   docker compose -f docker-compose.prod.yml --env-file .env \
 *     --profile oneshot run --rm node sh -c \
 *     "cd /app/packages/db && npx tsx scripts/genera-giri.ts"
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import postgres from "postgres";
import { generaGiroDelGiorno, oggiRome } from "../src/index";

// §12zzzz — Europe/Rome via oggiRome() invece di UTC via toISOString.
// Con -c timezone=Europe/Rome sul DB (§12yyyy), il CURRENT_DATE del
// database e questo `OGGI` restano coerenti anche nella finestra
// 00:00-02:00 Rome. `CHECALDO_OGGI` resta l'override esplicito.
const OGGI = (process.env.CHECALDO_OGGI ?? oggiRome()).slice(0, 10);

const FORZA = process.argv.includes("--forza");

const url = process.env.DATABASE_URL;
if (!url) {
  process.stderr.write("DATABASE_URL non impostata\n");
  process.exit(2);
}

async function main() {
  const sql = postgres(url!, { idle_timeout: 5 });
  try {
    const orgs = await sql<Array<{
      id: number; nome: string; comuneIstat: string;
    }>>`
      SELECT id, nome, comune_istat AS "comuneIstat"
        FROM pubblico.organizzazione
       ORDER BY id
    `;
    if (orgs.length === 0) {
      process.stderr.write(
        "nessuna organizzazione in pubblico.organizzazione: " +
          "eseguire packages/db/seed-organizzazione.sql prima.\n",
      );
      process.exit(2);
    }

    let nOk = 0;
    let nSaltati = 0;
    const falliti: Array<{ org: string; motivo: string }> = [];

    for (const o of orgs) {
      const etichetta = `${o.nome} (id=${o.id}, ${o.comuneIstat})`;
      try {
        if (!FORZA) {
          const gia = await sql<Array<{ n: number }>>`
            SELECT count(*)::int AS n
              FROM riservato.assegnazione
             WHERE organizzazione_id = ${o.id}
               AND data = ${OGGI}::date
          `;
          const n = gia[0]?.n ?? 0;
          if (n > 0) {
            process.stdout.write(
              `[SKIP] ${etichetta} @ ${OGGI}: ${n} assegnazioni già ` +
                `presenti — il giro esiste, nessuna rigenerazione. ` +
                `Usa --forza per ignorare (non farlo dal cron).\n`,
            );
            nSaltati++;
            continue;
          }
        }

        const r = await generaGiroDelGiorno(sql, o.id, OGGI);
        process.stdout.write(
          `[OK]   ${etichetta} @ ${OGGI}: ` +
            `totale=${r.totaleAssegnate} ` +
            `(protette=${r.protette}+nuove=${r.nuoveAssegnate}), ` +
            `soglia=${r.sogliaUsata}, livello=${r.livelloUsato}, ` +
            `vol_attivi=${r.volontariAttivi}, vol_di_turno=${r.volontariDiTurno}\n`,
        );
        // §12jjjjj — Log esplicito quando la soglia supera il cap dei
        // vol di turno. Il cron gira senza operatori a schermo: se
        // non compare qui, il coord scopre solo aprendo la dashboard
        // che k persone sono rimaste fuori. In banda con [OK] per non
        // fingere che sia un errore (la generazione parziale è
        // decisione voluta), ma con marker `[CAP]` distinto.
        if (r.nonAssegnatePerCapSaturato > 0) {
          const postiTotali = r.volontariDiTurno * 6;
          process.stdout.write(
            `[CAP]  ${etichetta} @ ${OGGI}: ` +
              `soglia=${r.sogliaUsata} > posti=${postiTotali} ` +
              `(${r.volontariDiTurno} vol × 6), ` +
              `${r.nonAssegnatePerCapSaturato} persone senza volontario. ` +
              `Il coord può riprendere un vol dalla pausa o abbassare la soglia.\n`,
          );
        }
        nOk++;
      } catch (e) {
        const raw = e instanceof Error ? e.message : String(e);
        const leggibile = raw.startsWith("nessuna allerta in pubblico.allerta")
          ? `manca il livello di allerta per ${OGGI} (comune ${o.comuneIstat}). ` +
            `Il poller allerta.py non ha ancora scritto una riga per oggi — ` +
            `controlla che il cron del poller giri (MOD07 §7) e leggi ` +
            `/var/log/checaldo/poller.log. Il giro non parte finché la riga ` +
            `manca (fail-hard voluto, query.ts:2540-2544).`
          : raw;
        process.stdout.write(`[FAIL] ${etichetta} @ ${OGGI}: ${leggibile}\n`);
        falliti.push({ org: etichetta, motivo: leggibile });
      }
    }

    process.stdout.write(
      `\nRiepilogo: ${nOk} OK, ${nSaltati} saltati, ${falliti.length} falliti su ${orgs.length}\n`,
    );
    if (falliti.length > 0) {
      process.stderr.write(
        `${falliti.length} organizzazioni non generate: ${falliti
          .map((f) => f.org)
          .join(", ")}\n`,
      );
      process.exit(1);
    }
  } finally {
    await sql.end();
  }
}

main().catch((e) => {
  process.stderr.write(`errore: ${(e as Error).message ?? e}\n`);
  process.exit(1);
});
