/**
 * Agente città (MOD06 BLOCCO B, §12l): la frase 2-3 righe che
 * sopravvive sopra ConsiglioLocale sulla pagina pubblica e parla
 * della città intera — livello di oggi, previsioni 48h e 72h se
 * disponibili, e numero di notti tropicali consecutive quando ≥ 3.
 *
 * Ritorna `string` non vuota (consiglio pronto da mostrare) oppure
 * `null` — fallback silenzioso — nei casi in cui il blocco non deve
 * comparire in pagina:
 *
 *   1. `allerta_oggi` mancante nel DB (il poller non ha mai scritto
 *      per questo comune): niente da dire di ufficiale, quindi tace.
 *   2. **`oggi.data` non copre oggi (Europe/Rome)**: la riga più
 *      recente restituita da `allertaCorrente` è per un giorno
 *      passato. In pratica significa che nessuna estrazione recente
 *      ha coperto oggi: il ramo stima non ha girato per oggi, o il
 *      bollettino ministeriale non ha una previsione che arrivi fin
 *      qui (vedi commento a `dataOggi` sotto per Bologna weekend).
 *      Meglio niente che un livello passato presentato come oggi.
 *      In produzione, se questo caso ricorre, va rimesso il cron di
 *      `allerta.py` (MOD07). §12aaaaaa (2026-08-12): la docstring
 *      diceva ancora "36 ore" — soglia obsoleta e mai realmente
 *      implementata in questa forma (vedi §12l "Freshness dell'agente
 *      città — modifica importante" e §12aaaaaa in CHECALDO-PROGETTO).
 *   3. Tetto giornaliero di miss superato (`LLM_DAILY_MISS_CAP_CITTA`).
 *   4. Eccezione qualsiasi (DB, modello, prompt corrotto): catch di
 *      ultimo livello.
 *
 * Cache in `pubblico.allerta_citta_cache` con chiave
 * `(comune_istat, livello_oggi, livello_domani, livello_dopodomani,
 * prompt_version)` — sentinel -1 per livelli previsti null (PostgreSQL
 * non considera NULL "uguale" in ON CONFLICT). A regime, la città
 * genera 1 chiamata/giorno.
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import type { Sql } from "postgres";
import {
  allertaPrevisione,
  oggiRome,
  type AllertaRiga,
  type AllertaPrevisione,
} from "@checaldo/db";
import { chiamaModello, ErroreModello } from "./client";
import {
  PROMPT_MARKDOWN,
  PROMPT_VERSION as PROMPT_VERSION_GENERATED,
} from "./citta-prompt.generated";

export const PROMPT_VERSION_CITTA = PROMPT_VERSION_GENERATED;

// Freshness: la riga più recente restituita da `allertaCorrente` deve
// riferirsi a **oggi** (in Europe/Rome). Se `oggi.data < oggi calendario`,
// il blocco non compare (fallback silenzioso).
//
// Precisazione importante col ramo bollettino (Bologna): il bollettino
// ministeriale esce dal lunedì al venerdì (fonte primaria:
// https://www.salute.gov.it/new/it/tema/ondate-di-calore/, verificato
// 2026-08-07). Quello di venerdì genera 3
// righe con `data = ven, sab, dom` (orizzonti 24/48/72 h). Il sabato e
// la domenica, `allertaCorrente` restituisce già la riga giusta per
// quel giorno — quindi `oggi.data == dataOggi` ✓, il blocco compare.
// Se il poller non gira per giorni (patologia da cron), la riga più
// recente resta indietro e `oggi.data < dataOggi` → fallback silenzioso.
//
// Rifiutata l'alternativa "36h su data_estrazione" (versione precedente):
// avrebbe fatto sparire il blocco a Bologna ogni domenica, perché
// l'estrazione di venerdì è già a >36h da lunedì mattina.

// Tetto miss dedicato al secondo agente. A regime: 1 miss/giorno per
// città (i livelli cambiano una volta al giorno con il poller). Cap 10
// copre "prompt cambiato 5 volte oggi + 5 città" o simili.
const MISS_CAP_DEFAULT_CITTA = 10;
function missCapConfigurato(): number {
  const raw = process.env.LLM_DAILY_MISS_CAP_CITTA;
  if (!raw) return MISS_CAP_DEFAULT_CITTA;
  const n = Number.parseInt(raw, 10);
  if (Number.isNaN(n) || n < 1) return MISS_CAP_DEFAULT_CITTA;
  return n;
}

// §12zzzz — la vecchia `dataOggiEuropeRome` locale è stata rimossa.
// La stessa logica vive ora in `@checaldo/db:oggiRome()` (sorgente
// unica per il monorepo, importata sopra). Vedi §12yyyy per la
// decisione fuso Europe/Rome e §12zzzz per l'unificazione.

function livelloOverride(riga: AllertaRiga | null): number {
  return riga ? riga.livello : -1;
}

function componiMessaggio(
  previsione: AllertaPrevisione,
  nomeComune: string,
): string {
  const oggi = previsione.oggi!;
  const prov = oggi.provenienza === "bollettino"
    ? "bollettino"
    : "stima";
  const linee: string[] = [];
  linee.push(`comune: ${nomeComune}`);
  linee.push(
    `allerta_oggi: livello ${oggi.livello}, ${prov}, notti_tropicali ${oggi.nottiTropicali}`,
  );
  // Motivo esplicito quando presente. Il prompt sa che
  // "fuori_stagione_bollettino" implica: la città sarebbe normalmente
  // sul bollettino ministeriale, ma siamo tra il 15 settembre e il 15
  // maggio, quindi il livello di oggi è stimato con lo stesso metodo
  // dei comuni non nelle 27 città (§12x). L'agente deve dirlo.
  if (oggi.motivoProvenienza) {
    linee.push(`allerta_oggi_motivo: ${oggi.motivoProvenienza}`);
  }
  if (previsione.domani) {
    linee.push(
      `allerta_domani: livello ${previsione.domani.livello}, ${previsione.domani.provenienza}`,
    );
  } else {
    linee.push(`allerta_domani: null`);
  }
  if (previsione.dopodomani) {
    linee.push(
      `allerta_dopodomani: livello ${previsione.dopodomani.livello}, ${previsione.dopodomani.provenienza}`,
    );
  } else {
    linee.push(`allerta_dopodomani: null`);
  }
  const disponibili = previsione.domani !== null || previsione.dopodomani !== null;
  linee.push(`livelli_previsti_disponibili: ${disponibili}`);
  return linee.join("\n");
}

/**
 * Genera la frase città. Punto d'ingresso unico. `null` = fallback
 * silenzioso (la pagina nasconde il blocco).
 */
export async function generaAllertaCitta(
  sql: Sql,
  comuneIstat: string,
  nomeComune: string,
  ora: Date = new Date(),
): Promise<string | null> {
  try {
    const previsione = await allertaPrevisione(sql, comuneIstat);
    const oggi = previsione.oggi;
    if (!oggi) {
      process.stderr.write(
        `[allerta-citta] fallback: allerta oggi mancante per ${comuneIstat}\n`,
      );
      return null;
    }

    // Freshness: la riga più recente deve coprire OGGI (Europe/Rome).
    // Vedi commento in testa: il ramo bollettino serve la riga di
    // sabato/domenica dall'estrazione di venerdì; il ramo stima serve
    // la riga del giorno stesso. Se `oggi.data < dataOggi`, il poller
    // non ha aggiornato per oggi.
    const dataOggi = oggiRome(ora);
    if (oggi.data !== dataOggi) {
      process.stderr.write(
        `[allerta-citta] fallback: allerta.data (${oggi.data}) non copre oggi ` +
          `(${dataOggi}). Ramo ${oggi.provenienza}: se stima, controlla il cron ` +
          `di allerta.py; se bollettino, verifica che l'ultima estrazione contenga ` +
          `previsioni per oggi. Vedi MOD07 §7.\n`,
      );
      return null;
    }

    // Cache lookup — chiave con sentinel -1 per livelli previsti null.
    const livOggi = oggi.livello;
    const livDom = livelloOverride(previsione.domani);
    const livDopo = livelloOverride(previsione.dopodomani);
    const cached = await sql<Array<{ testo: string }>>`
      SELECT testo
        FROM pubblico.allerta_citta_cache
       WHERE comune_istat = ${comuneIstat}
         AND livello_oggi = ${livOggi}
         AND livello_domani = ${livDom}
         AND livello_dopodomani = ${livDopo}
         AND prompt_version = ${PROMPT_VERSION_CITTA}
       LIMIT 1
    `;
    if (cached.length > 0) {
      // Registra cache hit (best-effort, no rollback).
      try {
        await sql`
          INSERT INTO pubblico.uso_modello (data, da_cache, chiamate)
          VALUES (CURRENT_DATE, true, 1)
          ON CONFLICT (data, da_cache) DO UPDATE
            SET chiamate = pubblico.uso_modello.chiamate + 1
        `;
      } catch {
        /* best-effort */
      }
      return cached[0]!.testo;
    }

    // Miss reale: PRIMA tetto, POI chiamata.
    const missOggi = await sql<Array<{ n: number }>>`
      SELECT count(*)::int AS n
        FROM pubblico.allerta_citta_cache
       WHERE generato_il >= CURRENT_DATE
    `;
    const cap = missCapConfigurato();
    if ((missOggi[0]?.n ?? 0) >= cap) {
      process.stderr.write(
        `[allerta-citta] tetto miss raggiunto (${missOggi[0]?.n}/${cap}), ` +
          `fallback silenzioso.\n`,
      );
      return null;
    }

    const messaggio = componiMessaggio(previsione, nomeComune);
    const testo = await chiamaModello(PROMPT_MARKDOWN, messaggio, {
      agente: "allerta-citta",
      sql,
      // 250 tok ~ 180 parole IT, ampiamente oltre le 2-3 righe volute.
      maxTokens: 250,
    });
    const testoRifinito = testo.trim();
    if (testoRifinito.length === 0) {
      process.stderr.write("[allerta-citta] fallback: modello ha risposto vuoto\n");
      return null;
    }

    try {
      await sql`
        INSERT INTO pubblico.allerta_citta_cache
          (comune_istat, livello_oggi, livello_domani, livello_dopodomani,
           prompt_version, testo)
        VALUES
          (${comuneIstat}, ${livOggi}, ${livDom}, ${livDopo},
           ${PROMPT_VERSION_CITTA}, ${testoRifinito})
        ON CONFLICT (comune_istat, livello_oggi, livello_domani,
                     livello_dopodomani, prompt_version)
          DO UPDATE SET testo = EXCLUDED.testo, generato_il = now(),
                        audio = NULL, audio_generato_il = NULL
      `;
    } catch {
      /* best-effort */
    }
    return testoRifinito;
  } catch (e) {
    const dettaglio =
      e instanceof ErroreModello
        ? `${e.message} (status=${e.status ?? "?"})`
        : e instanceof Error
          ? e.message
          : String(e);
    process.stderr.write(`[allerta-citta] fallback silenzioso: ${dettaglio}\n`);
    return null;
  }
}
