/**
 * Agente consulente cittadino della pagina pubblica (MOD06 Parte 4).
 *
 * Riceve: comune, quartiere, ora corrente locale (per finestra oraria e
 * filtro dei parchi). Ritorna: testo del consiglio (4-6 righe) oppure
 * `null` per **fallback silenzioso** — qualunque cosa vada storta, dal
 * DB al modello alla lettura del prompt, produce `null` e la pagina
 * pubblica nasconde il blocco. Nessun messaggio d'errore in pagina.
 *
 * Cache in `pubblico.consiglio_cache` con chiave
 * `(quartiere_slug, livello, ora_finestra, prompt_version)`. Miss →
 * chiama il modello, salva. Hit → restituisce il testo, incrementa
 * `pubblico.uso_modello` con `da_cache = true`. Osservabilità dei costi
 * = differenza fra righe `da_cache=false` e `da_cache=true`.
 *
 * `PROMPT_VERSION` è il SHA-256 (primi 8 char hex) del contenuto del
 * file `prompts/consulente.md`. Cambiare il prompt invalida da solo
 * tutte le voci precedenti — non serve DROP: la chiave nuova non le
 * troverà. Le vecchie righe restano in tabella come cronaca.
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import type { Sql } from "postgres";
import {
  allertaCorrente,
  puntiFreschiPerQuartiere,
  slugQuartiere,
  type PuntoFrescoVicino,
  type AllertaRiga,
} from "@checaldo/db";
import { chiamaModello, ErroreModello } from "./client";
// Prompt e sua versione (hash) inlineati a build time dal codegen —
// vedi `scripts/genera-prompt.ts`. A runtime NON si legge nulla dal
// filesystem: sopravvive al bundle di Next (dove `__dirname` punta a
// `.next/server/`) e a un deploy che non abbia più `packages/` sul
// disco. `PROMPT_VERSION` è calcolato dalla codegen sulla stessa
// stringa che qui viene inlineata: non possono divergere.
// Se questo import si rompe con "modulo non trovato", esegui:
//   docker compose run --rm node pnpm --filter @checaldo/agents codegen-prompt
// (gli hook predev/prebuild/pretypecheck lo lanciano da soli).
import {
  PROMPT_MARKDOWN,
  PROMPT_VERSION as PROMPT_VERSION_GENERATED,
} from "./consulente-prompt.generated";

export const PROMPT_VERSION = PROMPT_VERSION_GENERATED;

// Finestra 11:00-18:00 sconsigliata dalle raccomandazioni sanitarie
// (`components/raccomandazioni.tsx`): dentro questa finestra, i parchi
// (`fasciaOraria = 'mattina_sera'`) NON vengono proposti all'agente
// perché un anziano non deve stare all'aperto in quelle ore, anche se il
// parco è "aperto". Vedi §12k e MOD06 §"Cosa costruisce".
const ORA_MIN_SCONSIGLIATA = 11;
const ORA_MAX_SCONSIGLIATA = 18;

// Tetto giornaliero SULLE CHIAMATE REALI DEL CONSULENTE (cache miss).
// Difesa contro il caso "cache fredda + qualcuno che cicla i quartieri":
// se il prompt cambia (PROMPT_VERSION nuovo) e un utente/script apre in
// serie i 13 quartieri × 4 livelli × 2 fasce = 104 combinazioni, senza
// tetto una passata brucia $2-3 di credito API prima che qualcuno se ne
// accorga. A cache calda, un giorno normale genera 0 miss.
//
// **Non è un cap del wrapper** (`client.ts` conta ma non frena, §13.1:
// un cap in codice fallirebbe in silenzio nel momento peggiore — proprio
// durante un'ondata di caldo, quando serve rispondere). Qui è invece
// specifico del consulente: il fallback è "raccomandazioni statiche + il
// blocco Consiglio nascosto", che è comunque una pagina completa e
// utile (§MOD06 "Fallback silenzioso"). L'ondata di caldo non lascia
// nessuno al buio: le cinque raccomandazioni sanitarie e la mappa
// restano.
//
// Conteggio via `pubblico.consiglio_cache`: ogni miss scrive una riga
// nuova con `generato_il = now()`; il conteggio delle righe con
// `generato_il >= CURRENT_DATE` è la somma delle miss di oggi. Nessuno
// schema/tabella dedicati.
const MISS_CAP_DEFAULT = 200;
function missCapConfigurato(): number {
  const raw = process.env.LLM_DAILY_MISS_CAP_CONSULENTE;
  if (!raw) return MISS_CAP_DEFAULT;
  const n = Number.parseInt(raw, 10);
  if (Number.isNaN(n) || n < 1) return MISS_CAP_DEFAULT;
  return n;
}

// Cache: due sole finestre, non minuti — altrimenti la chiave cambia
// ogni 60 secondi e la cache non serve. Taglio 06:00 (sotto = "serale")
// / 18:00 (sopra = "serale"). Un utente che apre la pagina alle 17:59 e
// alle 18:01 riceve lo stesso testo entro la finestra "diurna" e uno
// diverso oltre, invece di due generazioni consecutive.
type OraFinestra = "diurna" | "serale";
function fasciaOrariaCache(ora: Date): OraFinestra {
  const h = ora.getHours();
  return h >= 6 && h < 18 ? "diurna" : "serale";
}

function dentroFinestraSconsigliata(ora: Date): boolean {
  const h = ora.getHours();
  return h >= ORA_MIN_SCONSIGLIATA && h < ORA_MAX_SCONSIGLIATA;
}

function filtraParchiPerOra(
  punti: PuntoFrescoVicino[],
  ora: Date,
): PuntoFrescoVicino[] {
  if (!dentroFinestraSconsigliata(ora)) return punti;
  return punti.filter((p) => p.fasciaOraria !== "mattina_sera");
}

/**
 * Compone il messaggio utente da passare a `chiamaModello`. Formato
 * volutamente identico a quello degli esempi few-shot nel prompt —
 * meno differenza fra "esempio nel prompt" e "input reale", meno
 * comportamento inatteso.
 */
function componiMessaggio(
  allerta: AllertaRiga,
  quartiereNome: string,
  finestra: OraFinestra,
  punti: PuntoFrescoVicino[],
): string {
  const provLabel =
    allerta.provenienza === "bollettino"
      ? "bollettino del Ministero"
      : "stima, non ufficiale";
  const puntiTxt =
    punti.length === 0
      ? "  (nessun punto fresco nell'elenco)"
      : punti.map(formattaPunto).join("\n");
  return [
    `allerta: livello ${allerta.livello} (${provLabel})`,
    `quartiere: ${quartiereNome}`,
    `ora_finestra: ${finestra}`,
    `punti_vicini:`,
    puntiTxt,
  ].join("\n");
}

function formattaPunto(p: PuntoFrescoVicino): string {
  const nome = p.nome && p.nome.trim().length > 0 ? p.nome.trim() : "(senza nome)";
  const meta: string[] = [];
  meta.push(
    p.quartiereProprio
      ? "quartiere_proprio: true"
      : `quartiere_proprio: false, quartiere_del_punto: ${p.quartiereDelPunto ?? "n.d."}`,
  );
  if (p.indirizzo && p.indirizzo.trim().length > 0) {
    meta.push(`indirizzo: ${p.indirizzo.trim()}`);
  }
  meta.push(p.orari && p.orari.trim().length > 0 ? `orari: ${p.orari.trim()}` : `orari: null`);
  if (p.accessibile === "yes") meta.push("accessibile: yes");
  return (
    `  - ${nome} (${p.tipo}, ${p.categoria}, priorita ${p.priorita}), a ${p.distanzaMetri} m\n` +
    `    ${meta.join(", ")}`
  );
}

/**
 * Genera il consiglio per un quartiere. Punto d'ingresso unico dell'agente.
 *
 * Regole del ritorno:
 *   - `string` non vuota = consiglio pronto per essere mostrato in pagina.
 *   - `null` = fallback silenzioso: la pagina deve nascondere il blocco.
 *     Le cause (DB giù, API modello giù, prompt file corrotto, quartiere
 *     inesistente, allerta mancante per il comune) sono loggate su stderr
 *     ma **non** propagate in pagina. Il cittadino continua a leggere
 *     livello + raccomandazioni statiche + mappa + form, che sono la
 *     risposta di base del servizio.
 */
export async function generaConsiglio(
  sql: Sql,
  comuneIstat: string,
  quartiereNome: string,
  ora: Date = new Date(),
): Promise<string | null> {
  const slug = slugQuartiere(quartiereNome);
  const finestra = fasciaOrariaCache(ora);

  try {
    const allerta = await allertaCorrente(sql, comuneIstat);
    if (!allerta) {
      // Senza livello di allerta non c'è consiglio possibile.
      // Il coordinatore vede questo caso nei log: se persiste, il
      // poller allerta.py non gira.
      process.stderr.write(
        `[consulente] fallback: allerta mancante per comune ${comuneIstat}\n`,
      );
      return null;
    }

    // Cache lookup PRIMA di raccogliere i punti — se hit, risparmiamo
    // anche una query PostGIS (non solo la chiamata modello).
    const cached = await sql<Array<{ testo: string }>>`
      SELECT testo
        FROM pubblico.consiglio_cache
       WHERE quartiere_slug = ${slug}
         AND livello = ${allerta.livello}
         AND ora_finestra = ${finestra}
         AND prompt_version = ${PROMPT_VERSION}
       LIMIT 1
    `;
    if (cached.length > 0) {
      // Contatore cache hit: separato da miss (schema.sql, PK con da_cache).
      // Best-effort: se il DB fallisce qui, il testo va comunque restituito.
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

    // Miss reale: PRIMA di raccogliere i punti e chiamare il modello,
    // controllo il tetto giornaliero. La query costa il conteggio di
    // una tabella piccola con PK indicizzata su `generato_il`? No —
    // la PK è su (slug, livello, ora, version). Non c'è un indice su
    // `generato_il`; il count fa scan sequenziale. È OK: la tabella
    // resta piccola (~100 righe/giorno max) e questo è il percorso di
    // miss (raro a cache calda). Se un giorno la tabella cresce oltre
    // qualche migliaio di righe, si aggiunge un indice parziale.
    const missOggi = await sql<Array<{ n: number }>>`
      SELECT count(*)::int AS n
        FROM pubblico.consiglio_cache
       WHERE generato_il >= CURRENT_DATE
    `;
    const cap = missCapConfigurato();
    if ((missOggi[0]?.n ?? 0) >= cap) {
      process.stderr.write(
        `[consulente] tetto miss raggiunto (${missOggi[0]?.n}/${cap}), ` +
          `fallback silenzioso. La pagina resterà completa con le sole ` +
          `raccomandazioni statiche.\n`,
      );
      return null;
    }

    // Miss: raccolgo i punti e chiamo il modello.
    const puntiRaw = await puntiFreschiPerQuartiere(sql, comuneIstat, quartiereNome, 3);
    if (puntiRaw.length === 0 && dentroFinestraSconsigliata(ora)) {
      // Quartiere che non ha nessun punto (non dovrebbe succedere per Parma
      // ma è possibile su altri comuni). L'agente sa gestirlo dal prompt
      // (regola 7); lascio proseguire.
    }
    const punti = filtraParchiPerOra(puntiRaw, ora);
    const messaggio = componiMessaggio(allerta, quartiereNome, finestra, punti);

    const testo = await chiamaModello(PROMPT_MARKDOWN, messaggio, {
      agente: "consulente",
      sql,
      // 500 tokens sono ~370 parole italiane, oltre il limite delle 4-6
      // righe volute. Se l'agente supera, il prompt è mal calibrato — meglio
      // troncarlo che permettergli di dilagare (§12k vincolo 5).
      maxTokens: 500,
    });

    const testoRifinito = testo.trim();
    if (testoRifinito.length === 0) {
      process.stderr.write("[consulente] fallback: modello ha risposto vuoto\n");
      return null;
    }

    // Salvataggio in cache. Uso UPSERT — se un'altra richiesta parallela
    // ha già scritto la stessa chiave, EXCLUDED sovrascrive col testo
    // corrente. Non è idempotente al 100% ma non danneggia: le due
    // generazioni sono per la stessa chiave, quindi il contenuto è
    // sovrapponibile.
    try {
      await sql`
        INSERT INTO pubblico.consiglio_cache
          (quartiere_slug, livello, ora_finestra, prompt_version, testo)
        VALUES
          (${slug}, ${allerta.livello}, ${finestra}, ${PROMPT_VERSION}, ${testoRifinito})
        ON CONFLICT (quartiere_slug, livello, ora_finestra, prompt_version)
          DO UPDATE SET testo = EXCLUDED.testo, generato_il = now(),
                        audio = NULL, audio_generato_il = NULL
      `;
    } catch {
      // Best-effort: se il salvataggio fallisce, il testo va comunque
      // restituito. La prossima richiesta chiamerà di nuovo il modello,
      // ma il servizio non si rompe.
    }

    return testoRifinito;
  } catch (e) {
    // Cattura di ultimo livello: qualunque cosa vada storta (DB
    // irraggiungibile, chiamaModello che lancia ErroreModello, altro),
    // la pagina non deve vedere il fallimento.
    const dettaglio =
      e instanceof ErroreModello
        ? `${e.message} (status=${e.status ?? "?"})`
        : e instanceof Error
        ? e.message
        : String(e);
    process.stderr.write(`[consulente] fallback silenzioso: ${dettaglio}\n`);
    return null;
  }
}
