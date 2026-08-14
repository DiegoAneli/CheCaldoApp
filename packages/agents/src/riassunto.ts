/**
 * Agente riassunto della giornata per il coordinatore (MOD06, §12ddddd).
 *
 * Il coordinatore preme un pulsante nella dashboard e riceve un testo
 * in prosa che racconta cosa hanno fatto i volontari oggi — quanti
 * contatti, chi ha bisogno, chi non risponde, chi ha fatto cosa.
 *
 * Terzo agente del progetto, riusa il pattern di `allerta-citta.ts` e
 * `consulente.ts`:
 *   - cache in `pubblico.riassunto_cache`;
 *   - tetto miss giornaliero `LLM_DAILY_MISS_CAP_RIASSUNTO` (default 20);
 *   - fallback silenzioso con `return null` al livello più esterno,
 *     ma il chiamante deve mostrare un messaggio esplicito perché il
 *     coordinatore ha premuto un pulsante e si aspetta una risposta
 *     (vs pagina pubblica dove il blocco può sparire) — vedi il
 *     campo `motivo` del ritorno di `generaRiassunto`.
 *
 * **Chiave a scaglioni**: `(organizzazione_id, data, scaglione,
 * prompt_version)` dove `scaglione = ceil(contattiTotali / 5)`. Il
 * testo si aggiorna man mano che la giornata avanza, ripremere il
 * pulsante senza che siano arrivati contatti nuovi non ri-chiama il
 * modello. Con ~40 contatti/giorno = ~8 miss/giorno per org.
 *
 * **Se `contattiTotali === 0`, l'agente NON viene invocato**: la
 * funzione ritorna `{ testo: null, motivo: "vuoto" }` e il pulsante
 * mostra "Nessun contatto oggi" senza spendere una chiamata.
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import type { Sql } from "postgres";
import { datiPerRiassunto, type DatiRiassunto } from "@checaldo/db";
import { chiamaModello, ErroreModello } from "./client";
import {
  PROMPT_MARKDOWN,
  PROMPT_VERSION as PROMPT_VERSION_GENERATED,
} from "./riassunto-prompt.generated";

export const PROMPT_VERSION_RIASSUNTO = PROMPT_VERSION_GENERATED;

// Default 20: una giornata piena da ~40 contatti = 8 miss (scaglioni
// di 5). Il cap protegge da "coordinatore che pigia 30 volte" oltre
// la variazione naturale. Ridimensionare via env se serve.
const MISS_CAP_DEFAULT_RIASSUNTO = 20;
function missCapConfigurato(): number {
  const raw = process.env.LLM_DAILY_MISS_CAP_RIASSUNTO;
  if (!raw) return MISS_CAP_DEFAULT_RIASSUNTO;
  const n = Number.parseInt(raw, 10);
  if (Number.isNaN(n) || n < 1) return MISS_CAP_DEFAULT_RIASSUNTO;
  return n;
}

/** Motivo del ritorno null. Il pulsante mostra un messaggio diverso per ciascuno. */
export type MotivoRiassuntoAssente =
  | "vuoto"       // 0 contatti oggi: NON abbiamo chiamato il modello
  | "tetto"       // LLM_DAILY_MISS_CAP_RIASSUNTO raggiunto
  | "errore";     // fallback silenzioso (DB down, modello down, prompt corrotto)

export interface RisultatoRiassunto {
  testo: string | null;
  motivo?: MotivoRiassuntoAssente;
  /** Dati aggregati usati (per il pulsante che vuole mostrare "N contatti"). */
  contattiTotali: number;
  scaglione: number;
  daCache: boolean;
}

/** ceil(n / 5). Rendo esplicita la formula così la chiave è ispezionabile. */
function scaglioneDa(contattiTotali: number): number {
  return Math.ceil(contattiTotali / 5);
}

export async function generaRiassunto(
  sql: Sql,
  organizzazioneId: number,
  dataOggi: string,
): Promise<RisultatoRiassunto> {
  try {
    const dati = await datiPerRiassunto(sql, organizzazioneId, dataOggi);
    if (dati.contattiTotali === 0) {
      // Zero contatti oggi: NON chiamiamo il modello. Il pulsante
      // mostra "Nessun contatto oggi". Non è un errore, è la
      // giornata che non è ancora iniziata (o è finita vuota).
      return {
        testo: null,
        motivo: "vuoto",
        contattiTotali: 0,
        scaglione: 0,
        daCache: false,
      };
    }

    const scaglione = scaglioneDa(dati.contattiTotali);

    // Cache lookup.
    const cached = await sql<Array<{ testo: string }>>`
      SELECT testo FROM pubblico.riassunto_cache
       WHERE organizzazione_id = ${organizzazioneId}
         AND data = ${dataOggi}::date
         AND scaglione = ${scaglione}
         AND prompt_version = ${PROMPT_VERSION_RIASSUNTO}
       LIMIT 1
    `;
    if (cached.length > 0) {
      try {
        await sql`
          INSERT INTO pubblico.uso_modello (data, da_cache, chiamate)
          VALUES (CURRENT_DATE, true, 1)
          ON CONFLICT (data, da_cache) DO UPDATE
            SET chiamate = pubblico.uso_modello.chiamate + 1
        `;
      } catch { /* best-effort */ }
      return {
        testo: cached[0]!.testo,
        contattiTotali: dati.contattiTotali,
        scaglione,
        daCache: true,
      };
    }

    // Miss: PRIMA il tetto, POI la chiamata al modello.
    const [missOggi] = await sql<Array<{ n: number }>>`
      SELECT count(*)::int AS n
        FROM pubblico.riassunto_cache
       WHERE generato_il >= CURRENT_DATE
    `;
    const cap = missCapConfigurato();
    if ((missOggi?.n ?? 0) >= cap) {
      process.stderr.write(
        `[riassunto] tetto miss raggiunto (${missOggi?.n}/${cap}), ` +
          `fallback esplicito ("tetto").\n`,
      );
      return {
        testo: null,
        motivo: "tetto",
        contattiTotali: dati.contattiTotali,
        scaglione,
        daCache: false,
      };
    }

    // Serializzo il pacchetto integrale: il prompt sa la forma esatta.
    const messaggio = componiMessaggio(dati);
    const testo = await chiamaModello(PROMPT_MARKDOWN, messaggio, {
      agente: "riassunto",
      sql,
      // 1500 tok ~ 1100 parole IT — copre giornate lunghe (40+
      // contatti, 8 ha_bisogno, 6 volontari + 10 non-risponde) senza
      // troncare a metà. Il prompt chiede "6-12 righe" per giornata
      // tipica; giornate ricche escono naturalmente più lunghe.
      // Verificato in §12ddddd: giornata 2026-07-31 (41 contatti) ~ 2200 chars.
      maxTokens: 1500,
    });
    const testoRifinito = testo.trim();
    if (testoRifinito.length === 0) {
      process.stderr.write("[riassunto] fallback: modello ha risposto vuoto\n");
      return {
        testo: null, motivo: "errore",
        contattiTotali: dati.contattiTotali, scaglione, daCache: false,
      };
    }

    try {
      await sql`
        INSERT INTO pubblico.riassunto_cache
          (organizzazione_id, data, scaglione, prompt_version, testo)
        VALUES
          (${organizzazioneId}, ${dataOggi}::date, ${scaglione},
           ${PROMPT_VERSION_RIASSUNTO}, ${testoRifinito})
        ON CONFLICT (organizzazione_id, data, scaglione, prompt_version)
          DO UPDATE SET testo = EXCLUDED.testo, generato_il = now(),
                        audio = NULL, audio_generato_il = NULL
      `;
    } catch { /* best-effort */ }

    return {
      testo: testoRifinito,
      contattiTotali: dati.contattiTotali,
      scaglione,
      daCache: false,
    };
  } catch (e) {
    const dettaglio =
      e instanceof ErroreModello ? `${e.message} (status=${e.status ?? "?"})`
      : e instanceof Error ? e.message : String(e);
    process.stderr.write(`[riassunto] fallback: ${dettaglio}\n`);
    return {
      testo: null, motivo: "errore",
      contattiTotali: 0, scaglione: 0, daCache: false,
    };
  }
}

/**
 * Serializza `DatiRiassunto` come messaggio utente. JSON compatto —
 * il prompt sa già la forma. Metto le chiavi in ordine narrativo così
 * il modello ha già la "traccia" giusta se scansiona sequenzialmente.
 */
function componiMessaggio(d: DatiRiassunto): string {
  return JSON.stringify({
    data: d.data,
    organizzazioneNome: d.organizzazioneNome,
    contattiTotali: d.contattiTotali,
    personeInLista: d.personeInLista,
    personeContattate: d.personeContattate,
    personeDaContattare: d.personeDaContattare,
    esitiGiornata: d.esitiGiornata,
    condizioniChiuseOggi: d.condizioniChiuseOggi,
    ritmoConIeri: d.ritmoConIeri,
    volontari: d.volontari,
    haBisogno: d.haBisogno,
    nonRisponde: d.nonRisponde,
  }, null, 2);
}
