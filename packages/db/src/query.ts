/**
 * CheCaldo! — query SQL per la vista volontario e per il caricamento dati.
 *
 * Usa `postgres` (postgres.js) come client: template tag per fare parametri
 * sicuri, un solo pool riusato. La connessione arriva da chi importa (la
 * factory `client()` non è qui: sta in `apps/web/lib/db.ts` per non forzare
 * @checaldo/db a dipendere dal client di runtime).
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import type { Sql } from "postgres";
import type {
  Allerta, Persona, SegnaleAttivo, Sezione, TipoSegnale,
} from "@checaldo/scoring";
import {
  capienzaSuggerita, classificaPersone, DURATA_SEGNALE_GIORNI,
  PESI_DEFAULT, valutaSezioni,
} from "@checaldo/scoring";
import { assertAppartiene } from "./autorizzazione";

// ------------------------------------------------------ tipi di lettura

export interface AssegnazioneDelGiorno {
  personaId: number;
  idEsterno: string;
  sezioneId: string;
  quartiere: string | null;
  posizione: number;              // 1..6, indice dentro il giro del volontario
  // Rango nella classifica del giorno ordinata per punteggio, fra TUTTE le
  // persone valutate del comune (non solo quelle in lista). Popolato da
  // carica-nel-db.ts con `PersonaValutata.posizione`. È l'unico spazio in
  // cui il ramo motivazionale "era Nª ieri" ha risoluzione sufficiente:
  // `posizione` (1..6) non ne aveva.
  rangoGlobale: number | null;
  azione: string;                 // testo salvato: solo indicativo. `azionePer` è la fonte viva.
  fattori: unknown;               // jsonb: FattoreSpiegabile[]
  // Rango del giorno prima fra TUTTE le persone valutate del comune
  // (spazio ~500), letto da `riservato.rango_giorno`, non da `assegnazione`.
  // Include anche chi ieri non era in lista: è il caso che conta per il
  // ramo "era Nª ieri" — l'ingresso in lista. NULL solo se non esiste una
  // riga di rango per data-1 (es. primo giorno di attività, o persona
  // creata dopo). Confrontato con `rangoGlobale` di oggi in
  // apps/web/lib/motivazione.ts.
  posizioneIeri: number | null;
  // dati persona necessari per la scheda / motivazione
  annoNascita: number | null;
  viveSolo: boolean | null;
  piano: number | null;
  ascensore: boolean | null;
  dataUltimoContatto: string | null;
  // Ultimo contatto dell'anagrafe pre-esistente dell'organizzazione
  // (`riservato.persona.data_ultimo_contatto`, §12jjj). Semantica
  // distinta da `dataUltimoContatto` che è MAX dei contatti CheCaldo:
  // qui è il dato d'anagrafe caricato dal generatore/CSV, prima che
  // CheCaldo iniziasse a registrare contatti. Usato dalla scheda
  // persona come riga di contesto ("In anagrafe: ultimo contatto ...")
  // sotto il badge Indirizzo. Alimenta anche il fattore
  // `giorni_da_ultimo_contatto` del motore via personePerClassifica.
  // NULL = anagrafe senza il dato: la riga di contesto non compare.
  dataUltimoContattoAnagrafe: string | null;
  segnalatoDaMmg: boolean;
  // "Quante volte ho provato oggi": contatti con esito 'non_risponde' fatti
  // OGGI su questa persona. Usato dalla vista in giornata (badge N°
  // tentativo, banner Fine giro). Distinto da `Persona.tentativiFalliti` del
  // motore, che ha semantica "consecutivi da ultimo contatto ≠ non_risponde"
  // — quella la calcola `tentativiFallitiConsecutivi()` sotto e la carica il
  // caricaPersone di `carica-nel-db.ts` per il giro del giorno dopo.
  tentativiOggi: number;
  // Regole della VISTA VOLONTARIO (dove il rischio è uno schermo per
  // strada). Sulla scheda persona del COORDINATORE valgono regole
  // diverse (in chiaro): deroga dichiarata in §12jjjj.
  indirizzo: string | null;       // rivelato solo quando l'azione è visita_domiciliare
  telefono: string | null;        // MAI a schermo: solo href tel:
  segnali: SegnaleAttivo[];       // già filtrati validi oggi
}

// ------------------------------------------------------ query di lettura

export async function assegnazioniDelVolontarioOggi(
  sql: Sql,
  volontarioId: number,
  dataOggi: string,
): Promise<AssegnazioneDelGiorno[]> {
  // Predicato segnali: DB-autoritativo, coerente con packages/scoring §6.7
  const rows = await sql<Array<Record<string, unknown>>>`
    SELECT
      a.persona_id                                                       AS "personaId",
      p.id_esterno                                                        AS "idEsterno",
      p.sezione_id                                                        AS "sezioneId",
      s.quartiere                                                         AS quartiere,
      a.posizione                                                         AS posizione,
      a.rango_globale                                                     AS "rangoGlobale",
      a.azione                                                            AS azione,
      a.fattori                                                           AS fattori,
      p.anno_nascita                                                      AS "annoNascita",
      p.vive_solo                                                         AS "viveSolo",
      p.piano                                                             AS piano,
      p.ascensore                                                         AS ascensore,
      p.indirizzo                                                         AS indirizzo,
      p.telefono                                                          AS telefono,
      p.segnalato_da_mmg                                                  AS "segnalatoDaMmg",
      (
        SELECT count(*)::int FROM riservato.contatto c
        WHERE c.persona_id = p.id
          AND c.data::date = ${dataOggi}::date
          AND c.esito = 'non_risponde'
      )                                                                   AS "tentativiOggi",
      (
        SELECT max(c.data)::text FROM riservato.contatto c
        WHERE c.persona_id = p.id
      )                                                                   AS "dataUltimoContatto",
      to_char(p.data_ultimo_contatto, 'YYYY-MM-DD')                       AS "dataUltimoContattoAnagrafe",
      (
        -- Rango di ieri fra TUTTE le persone valutate del comune (spazio
        -- ~500), non solo fra quelle in lista ieri. Chi ieri era 40a e
        -- oggi entra in lista trova qui il proprio rango di ieri; con la
        -- sola assegnazione.rango_globale (una riga per persona in lista)
        -- restituirebbe NULL. Vedi CHECALDO-PROGETTO 12b.
        SELECT rg.rango FROM riservato.rango_giorno rg
        WHERE rg.persona_id = p.id AND rg.data = ${dataOggi}::date - 1
      )                                                                   AS "posizioneIeri",
      COALESCE(
        (
          -- creatoIl propagato per la vista "Situazione già nota"
          -- della scheda persona (§12vvv). Il motore ignora il campo
          -- (SegnaleAttivo.creatoIl è opzionale in scoring/src/types.ts).
          SELECT jsonb_agg(jsonb_build_object(
            'tipo',       sg.tipo,
            'origine',    sg.origine,
            'validoFino', to_char(sg.valido_fino, 'YYYY-MM-DD'),
            'creatoIl',   to_char(sg.creato_il AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
          ))
          FROM riservato.segnale sg
          WHERE sg.persona_id = p.id
            AND sg.chiuso_il IS NULL
            AND (sg.valido_fino IS NULL OR sg.valido_fino >= ${dataOggi}::date)
        ),
        '[]'::jsonb
      )                                                                   AS segnali
    FROM riservato.assegnazione a
    JOIN riservato.persona p ON p.id = a.persona_id
    LEFT JOIN pubblico.sezione s ON s.id = p.sezione_id
    WHERE a.volontario_id = ${volontarioId}
      AND a.data = ${dataOggi}::date
    ORDER BY a.posizione ASC
  `;
  // JSON strappato dal driver è già oggetto — cast bidirezionale al tipo
  // strutturato di @checaldo/scoring, senza runtime schema check (i dati
  // vengono dal nostro DB, non da input pubblico).
  return rows.map((r) => ({
    ...(r as unknown as AssegnazioneDelGiorno),
    segnali: (r.segnali as SegnaleAttivo[]) ?? [],
  }));
}

export interface EsitoDelGiorno {
  personaId: number;
  idEsterno: string;
  esito: "sta_bene" | "ha_bisogno" | "non_risponde";
  quando: string;
  vaAlCoordinatore: boolean; // true se registrato un segnale sintomi_riferiti oggi
}

export async function esitiDelVolontarioOggi(
  sql: Sql,
  volontarioId: number,
  dataOggi: string,
): Promise<EsitoDelGiorno[]> {
  const rows = await sql<Array<{
    personaId: number; idEsterno: string;
    esito: EsitoDelGiorno["esito"]; quando: string;
    vaAlCoordinatore: boolean;
  }>>`
    SELECT DISTINCT ON (c.persona_id)
      c.persona_id                                            AS "personaId",
      p.id_esterno                                             AS "idEsterno",
      c.esito                                                  AS esito,
      c.data::text                                             AS quando,
      EXISTS (
        SELECT 1 FROM riservato.segnale sg
        WHERE sg.persona_id = c.persona_id
          AND sg.tipo = 'sintomi_riferiti'
          AND sg.creato_il::date = ${dataOggi}::date
      )                                                        AS "vaAlCoordinatore"
    FROM riservato.contatto c
    JOIN riservato.persona p ON p.id = c.persona_id
    WHERE c.volontario_id = ${volontarioId}
      AND c.data::date = ${dataOggi}::date
    ORDER BY c.persona_id, c.data DESC
  `;
  return rows;
}

// ------------------------------------------------------ mutazioni

export async function scriviAccessoScheda(
  sql: Sql,
  organizzazioneSessione: number,
  utenteId: number,
  personaId: number,
): Promise<void> {
  // Difesa cross-org (audit isolamento 2026-08-03, fix I via
  // [[assert-appartiene]]). scriviAccessoScheda è fire-and-forget in UI,
  // ma resta un endpoint di scrittura raggiungibile: se venisse chiamato
  // con personaId di altra organizzazione registrerebbe una riga di log
  // fittizia (log poisoning).
  //
  // `volontarioId` è il campo che EntitaDaVerificare usa per l'utente
  // generico (la primitiva controlla riservato.utente indipendentemente
  // dal ruolo — l'organizzazione è la stessa struttura per volontari e
  // coordinatori).
  await assertAppartiene(sql, organizzazioneSessione, {
    volontarioId: utenteId,
    personaId,
  });
  await sql`
    INSERT INTO riservato.accesso_scheda (utente_id, persona_id)
    VALUES (${utenteId}, ${personaId})
  `;
}

export interface RegistraContattoParams {
  /**
   * L'organizzazione della sessione utente (dedotta da utentePerId sul
   * cookie del volontario). Serve alla difesa cross-org di [[assert-appartiene]]:
   * volontarioId e personaId vanno verificati come appartenenti alla stessa
   * org prima di scrivere. Non è ridondante con volontarioId: se un attacker
   * spedisce POST con volontarioId di un'altra org, questo parametro (che
   * viene dal cookie, non dal body) fa scattare il fail.
   */
  organizzazioneSessione: number;
  volontarioId: number;
  personaId: number;
  esito: "sta_bene" | "ha_bisogno" | "non_risponde";
  notaLibera?: string;
  segnaliNuovi: { tipo: TipoSegnale; origine: "volontario" }[];
  /**
   * Tipi di segnale che la risposta di oggi smentisce (§12xxx —
   * regola "ogni domanda possiede i suoi tipi"). Ogni tipo in lista
   * viene chiuso (`chiuso_il = now()`, `chiuso_da = volontarioId`)
   * se esisteva una riga aperta per (persona, tipo). Silente se la
   * riga non c'è. La chiusura tocca segnali di **qualunque origine**
   * (fixture, mmg, coordinatore, volontario) — decisione dichiarata
   * di gerarchia fra fonti: chi va sul posto oggi porta l'evidenza
   * più recente. La traccia dell'origine resta comunque nella riga
   * chiusa.
   */
  segnaliDaChiudere: TipoSegnale[];
}

/**
 * Errore applicativo: l'esito scelto è incompatibile con i segnali che il
 * volontario sta registrando. Al momento è usato per "sta_bene" con un
 * sintomo_riferito appena aperto (regola sanitaria). Classe separata per
 * poterla distinguere lato caller (server action) dagli errori
 * infrastrutturali/di autorizzazione — il caller la traduce in un ritorno
 * discriminato invece che re-throw, così il messaggio arriva al client
 * anche in production dove Next.js redige i messaggi di Error generici.
 */
export class EsitoIncoerente extends Error {
  constructor(motivo: string) {
    super(motivo);
    this.name = "EsitoIncoerente";
  }
}

export async function registraContatto(
  sql: Sql,
  p: RegistraContattoParams,
): Promise<void> {
  // Guardia sanitaria: sintomi riferiti + esito "sta bene" è una
  // combinazione che il client rifiuta già (staBeneBloccato in
  // scheda-persona.tsx), ma la regola non può dipendere dalla UI —
  // l'istanza pubblica è ad accesso libero, un POST fabbricato fuori
  // dall'app aggirerebbe il check. Verificata qui prima di aprire la
  // transazione: nulla viene scritto se la combinazione è illegale.
  if (
    p.esito === "sta_bene" &&
    p.segnaliNuovi.some((s) => s.tipo === "sintomi_riferiti")
  ) {
    throw new EsitoIncoerente(
      "Sintomi riferiti incompatibili con esito «Sta bene».",
    );
  }
  // Fix B (audit isolamento 2026-08-03): verifica che volontario e persona
  // appartengano entrambi all'organizzazione della sessione prima di
  // scrivere. Impedisce che un volontario di un'organizzazione registri
  // un contatto/segnale su una persona di un'altra organizzazione.
  await assertAppartiene(sql, p.organizzazioneSessione, {
    volontarioId: p.volontarioId,
    personaId: p.personaId,
  });
  await sql.begin(async (tx) => {
    await tx`
      INSERT INTO riservato.contatto (persona_id, volontario_id, esito, nota_libera)
      VALUES (${p.personaId}, ${p.volontarioId}, ${p.esito}, ${p.notaLibera ?? null})
    `;
    for (const s of p.segnaliNuovi) {
      // §12uuu: `ON CONFLICT DO NOTHING` sull'unique index parziale
      // `(persona_id, tipo) WHERE chiuso_il IS NULL` (schema.sql:205-207).
      // Se la condizione è già registrata come aperta per questa
      // persona/tipo, la INSERT è silente — il volontario che risponde
      // a una domanda già registrata non riceve errore, e non nasce un
      // duplicato che gonfierebbe il moltiplicatore nel motore (loop
      // in scoring/src/index.ts:361-367). La riapertura dopo chiusura
      // resta legittima: una riga chiusa esce dal vincolo, la nuova
      // INSERT crea una riga nuova senza conflitto.
      //
      // §12cccc: `valido_fino` popolato dalla costante di dominio
      // `DURATA_SEGNALE_GIORNI` (packages/scoring/src/index.ts). Fino
      // a §12cccc l'INSERT non nominava la colonna e i segnali
      // app-side nascevano tutti `valido_fino = NULL`, cioè strutturali
      // per calendario. Ora: tipi osservativi con durata definita
      // (sintomi_riferiti 3g, ventilatore_rotto 14g,
      // nessun_contatto_riferito 21g) hanno scadenza a CURRENT_DATE
      // + durata; i tre strutturali (nessuna_climatizzazione,
      // rete_familiare_assente, difficolta_mobilita) restano NULL.
      // Fra i tre strutturali due arrivano dal form volontario —
      // `nessuna_climatizzazione` dalla domanda "Ha il condizionatore
      // o un ventilatore?" (opzione "Non ce l'ha") e
      // `rete_familiare_assente` dalla domanda "Ha qualcuno che può
      // aiutarla?" (opzione "Nessuno") — e restano validi finché una
      // risposta successiva non li chiude via `segnaliDaChiudere`
      // (regola §12xxx "domanda possiede tipi") o il coordinatore li
      // chiude dalla card. Il terzo, `difficolta_mobilita`, oggi non
      // ha percorso applicativo di scrittura né di chiusura: entra
      // solo dalle fixture (famiglia C di §12xxx, debito noto). Le
      // righe già in DB non vengono toccate: migrazione dichiarata
      // come non necessaria in §12cccc.
      const durata = DURATA_SEGNALE_GIORNI[s.tipo];
      if (durata === null) {
        // Strutturale: nessuna scadenza da spostare.
        // ON CONFLICT DO NOTHING invariato — la riga esistente
        // (aperta) resta com'è, la INSERT è silente.
        await tx`
          INSERT INTO riservato.segnale (persona_id, tipo, origine, valido_fino)
          VALUES (${p.personaId}, ${s.tipo}, ${s.origine}, NULL)
          ON CONFLICT (persona_id, tipo) WHERE chiuso_il IS NULL DO NOTHING
        `;
      } else {
        // §12ffff: conferma di un segnale osservativo sposta in avanti
        // `valido_fino`. Prima di §12ffff il conflict era DO NOTHING
        // silente: un volontario che al giorno dodici confermava "il
        // ventilatore è ancora rotto" NON spostava la scadenza, il
        // segnale moriva al giorno quattordici dalla PRIMA apertura
        // malgrado la conferma di due giorni prima. Con DO UPDATE il
        // conflict porta la nuova scadenza (CURRENT_DATE + durata)
        // ma solo se estende quella esistente — GREATEST protegge da
        // conferme che accorcerebbero un segnale fixture con finestra
        // più lunga (es. ventilatore fixture a +21g, la conferma a
        // +14g NON deve accorciarlo a 14).
        //
        // Il CASE gestisce esplicitamente la riga esistente con
        // `valido_fino IS NULL` (§12cccc: Persona 0015 pre-§12cccc,
        // ventilatore_rotto app-side con NULL): `GREATEST(NULL, x)`
        // di Postgres ignora il NULL e tornerebbe x, trasformando
        // un segnale che era stato scritto strutturale in uno con
        // scadenza — cambio di semantica non desiderato. Scelta:
        // se la riga esistente ha `valido_fino IS NULL`, resta NULL
        // (semantica strutturale preservata). Solo il coordinatore
        // dalla card può chiuderlo esplicitamente.
        //
        // `creato_il` e `origine` NON compaiono nella SET: la storia
        // del segnale resta quella della prima apertura, cambia solo
        // la scadenza. Il vincolo unique parziale
        // `(persona_id, tipo) WHERE chiuso_il IS NULL` di
        // schema.sql:206 garantisce un solo target di conflict per
        // volta.
        await tx`
          INSERT INTO riservato.segnale (persona_id, tipo, origine, valido_fino)
          VALUES (${p.personaId}, ${s.tipo}, ${s.origine},
                  CURRENT_DATE + ${durata}::int)
          ON CONFLICT (persona_id, tipo) WHERE chiuso_il IS NULL
          DO UPDATE SET valido_fino = CASE
            WHEN riservato.segnale.valido_fino IS NULL THEN NULL
            ELSE GREATEST(riservato.segnale.valido_fino, EXCLUDED.valido_fino)
          END
        `;
      }
    }
    // §12xxx — chiusura dei tipi che la risposta di oggi smentisce.
    // Dentro la stessa transazione: apre e chiude atomici, o passa
    // tutto o niente. `chiuso_da = volontarioId` è l'atto reale di
    // chi ha raccolto l'evidenza sul posto — distinto dal NULL della
    // dedup tecnica di §12uuu e dalla chiusura del coordinatore via
    // card di §12rrr. La UPDATE tocca segnali di qualunque origine
    // (§12xxx gerarchia fra fonti). `chiuso_il IS NULL` filtra le
    // righe già chiuse, così la UPDATE è idempotente.
    if (p.segnaliDaChiudere.length > 0) {
      await tx`
        UPDATE riservato.segnale
           SET chiuso_il = now(),
               chiuso_da = ${p.volontarioId}
         WHERE persona_id = ${p.personaId}
           AND tipo IN ${tx(p.segnaliDaChiudere)}
           AND chiuso_il IS NULL
      `;
    }
  });
}

// ------------------------------------------------------ ricerca persona (scheda)

export async function personaPerId(
  sql: Sql,
  volontarioId: number,
  personaId: number,
  dataOggi: string,
): Promise<AssegnazioneDelGiorno | null> {
  const l = await assegnazioniDelVolontarioOggi(sql, volontarioId, dataOggi);
  return l.find((a) => a.personaId === personaId) ?? null;
}

// ------------------------------------------------------ utenti / login stub

export interface UtenteDemo {
  id: number;
  nome: string;
  organizzazioneId: number;
  ruolo: "coordinatore" | "volontario";
}

// §12aaaaaa — ordinamento naturale sul nome. Con `ORDER BY nome`
// puro il seed "Volontario 1..12" veniva reso lessicograficamente
// come V1, V10, V11, V12, V2 … V9 sulla pagina di login. Ordinamento
// alla fonte, non nel componente (regola brief 2026-08-12): prima
// per prefisso non-numerico, poi per la parte numerica (cast a int),
// poi per nome completo come tiebreaker. Nomi senza cifra (es. "Mario
// Rossi") ricadono su un `COALESCE` a 0 e sono ordinati dal
// tiebreaker finale — non passano per una via degenere.
//
// **Pattern `[0-9]+` (non `\d+`)**: il tagged template `sql\`...\``
// di `postgres` processa la stringa prima di mandarla al DB e
// interpreta il backslash in modo che `\d` arriva come lettera `d`
// nuda — il parser Postgres poi legge `regexp_replace(nome, 'd+',
// ...)` e la stringa "d" nella regex-match non è convertibile a int
// nel cast successivo, producendo `invalid input syntax for type
// integer: "d"`. La forma esplicita `[0-9]+` evita l'ambiguità.
// La clausola è ripetuta letterale nelle due funzioni sotto perché
// il template tag di postgres non accetta un sub-template come
// snippet interpolabile in questo contesto.
export async function volontariDellOrganizzazione(
  sql: Sql,
  organizzazioneId: number,
): Promise<UtenteDemo[]> {
  const rows = await sql<UtenteDemo[]>`
    SELECT id, nome, organizzazione_id AS "organizzazioneId", ruolo
    FROM riservato.utente
    WHERE organizzazione_id = ${organizzazioneId}
      AND ruolo = 'volontario'
      AND attivo = true
    ORDER BY
      regexp_replace(nome, '[0-9]+', '', 'g'),
      COALESCE((regexp_match(nome, '[0-9]+'))[1]::int, 0),
      nome
  `;
  return rows;
}

export async function coordinatoriDellOrganizzazione(
  sql: Sql,
  organizzazioneId: number,
): Promise<UtenteDemo[]> {
  const rows = await sql<UtenteDemo[]>`
    SELECT id, nome, organizzazione_id AS "organizzazioneId", ruolo
    FROM riservato.utente
    WHERE organizzazione_id = ${organizzazioneId}
      AND ruolo = 'coordinatore'
      AND attivo = true
    ORDER BY
      regexp_replace(nome, '[0-9]+', '', 'g'),
      COALESCE((regexp_match(nome, '[0-9]+'))[1]::int, 0),
      nome
  `;
  return rows;
}

export async function utentePerId(sql: Sql, id: number): Promise<UtenteDemo | null> {
  const rows = await sql<UtenteDemo[]>`
    SELECT id, nome, organizzazione_id AS "organizzazioneId", ruolo
    FROM riservato.utente
    WHERE id = ${id} AND attivo = true
  `;
  return rows[0] ?? null;
}

// ------------------------------------ tentativi falliti consecutivi

/**
 * Per ogni persona dell'organizzazione, il numero di contatti con esito
 * `'non_risponde'` **consecutivi**, contati a ritroso dall'ultimo contatto
 * registrato precedente a `primaDi` (esclusa). Si somma finché l'esito è
 * `non_risponde`, ci si ferma al primo esito diverso, si azzera se il primo
 * esito trovato non è `non_risponde`.
 *
 * È la semantica che serve al motore (`Persona.tentativiFalliti`) e ad
 * `azionePer`: "dopo due tentativi passa al contatto familiare" vuol dire
 * due **adesso**, non due nella storia. Chi è stato raggiunto ieri riparte
 * da zero domani.
 *
 * Usata da `carica-nel-db.ts` (fixtures) per popolare la classifica del
 * giorno successivo, e dal futuro `apps/worker` (MOD06) per il ricalcolo
 * cron. Non è nella subquery di `assegnazioniDelVolontarioOggi` — quella
 * conta i tentativi **oggi** (`tentativiOggi`), che è un'altra nozione.
 *
 * `primaDi` è una data ISO 'YYYY-MM-DD': si contano i contatti con
 * `data < primaDi`. Passando `oggi`, si esclude tutto ciò che è stato
 * registrato oggi (coerente con "l'esito di oggi cambia il rank di domani").
 */
export async function tentativiFallitiConsecutivi(
  sql: Sql,
  organizzazioneId: number,
  primaDi: string,
): Promise<Map<number, number>> {
  // Idea SQL: per ogni persona, prendi i contatti < primaDi ordinati per
  // data DESC, e conta la sequenza iniziale con esito='non_risponde'. Se il
  // primo non è 'non_risponde', il conteggio è 0.
  //
  // Implementazione con window function: crea una posizione ordinale
  // sui contatti (piu' recenti = piu' bassa) e conta gli 'non_risponde'
  // che occupano un run consecutivo che parte dalla posizione 1.
  const rows = await sql<Array<{ personaId: number; consecutivi: number }>>`
    WITH ordinati AS (
      SELECT c.persona_id,
             c.esito,
             row_number() OVER (
               PARTITION BY c.persona_id ORDER BY c.data DESC
             ) AS rn
        FROM riservato.contatto c
        JOIN riservato.persona p ON p.id = c.persona_id
       WHERE p.organizzazione_id = ${organizzazioneId}
         AND c.data::date < ${primaDi}::date
    ),
    corse AS (
      -- Per ogni persona il minimo rn di un esito NON 'non_risponde':
      -- indica dove finisce la corsa di miss iniziali. NULL se sono tutti
      -- 'non_risponde' (o non ci sono altri esiti sopra).
      SELECT persona_id,
             min(rn) FILTER (WHERE esito <> 'non_risponde') AS primo_diverso
        FROM ordinati
       GROUP BY persona_id
    )
    SELECT o.persona_id                                     AS "personaId",
           count(*) FILTER (
             WHERE o.esito = 'non_risponde'
               AND (c.primo_diverso IS NULL OR o.rn < c.primo_diverso)
           )::int                                            AS consecutivi
      FROM ordinati o
      JOIN corse    c ON c.persona_id = o.persona_id
     GROUP BY o.persona_id
    HAVING count(*) FILTER (
             WHERE o.esito = 'non_risponde'
               AND (c.primo_diverso IS NULL OR o.rn < c.primo_diverso)
           ) > 0
  `;
  return new Map(rows.map((r) => [r.personaId, r.consecutivi]));
}

// ------------------------------------------------------ allerta corrente

export interface AllertaRiga {
  livello: 0 | 1 | 2 | 3;
  provenienza: "bollettino" | "stima";
  data: string;               // ISO 'YYYY-MM-DD'
  nottiTropicali: number;
  comuneIstat: string;
  /**
   * Timestamp ISO della `data_estrazione` — quando il poller ha scritto
   * questa riga (bollettino: data_estrazione della fonte onData; stima:
   * data corrente del run di `allerta.py --stima --scrivi-db`). L'agente
   * città di MOD06 usa questo campo per decidere la "freshness": se
   * `now - dataEstrazione > 36h` il blocco non compare (meglio niente
   * che un livello vecchio presentato come oggi).
   */
  dataEstrazione: string;     // ISO 'YYYY-MM-DD'
  /**
   * Perché il livello ha questa provenienza. NULL nel caso normale
   * (Parma stima di design, Bologna bollettino di design). Valorizzato
   * quando c'è una ragione strutturale per cui la provenienza non è
   * quella prevista: `'fuori_stagione_bollettino'` = ramo bollettino
   * fuori dal periodo di pubblicazione ministeriale (15 mag - 15 set),
   * cade automaticamente su stima con questa etichetta (§12x). Badge
   * dashboard, pagina pubblica e agente città leggono qui per aggiungere
   * la nota "bollettino ministeriale non attivo (torna a maggio)".
   */
  motivoProvenienza: string | null;
}

/**
 * Riga di allerta più recente per il comune, considerando solo giornate
 * ≤ oggi (le previsioni a +48/+72 restano in tabella ma non vanno mostrate
 * come "livello di oggi"). Ordina per orizzonte crescente in modo che, se
 * per la stessa data esistono più orizzonti, vinca quello a 24h.
 *
 * `data_estrazione DESC` come ultimo tie-breaker: a parità di
 * `(data, orizzonte_ore)` vince l'estrazione più recente. Senza questo
 * l'ordinamento è indeterminato e Postgres può restituire una qualsiasi
 * delle righe con stessa chiave — è successo il 2026-08-13 con Bologna,
 * la card mostrava "Ultimo aggiornamento: 12 agosto" mentre in tabella
 * c'erano già le righe del 13 (vedi CHECALDO-PROGETTO §12dddddd bis).
 *
 * La tabella pubblico.allerta è alimentata da `packages/ingest/allerta.py
 * --scrivi-db COMUNE_ISTAT` (ramo stima) o dal poller del bollettino
 * (MOD06, ramo bollettino).
 */
export async function allertaCorrente(
  sql: Sql,
  comuneIstat: string,
): Promise<AllertaRiga | null> {
  const rows = await sql<Array<{
    livello: number;
    provenienza: "bollettino" | "stima";
    data: string;
    nottiTropicali: number;
    dataEstrazione: string;
    motivoProvenienza: string | null;
  }>>`
    SELECT
      livello                                  AS livello,
      provenienza                              AS provenienza,
      to_char(data, 'YYYY-MM-DD')              AS data,
      notti_tropicali                          AS "nottiTropicali",
      to_char(data_estrazione, 'YYYY-MM-DD')   AS "dataEstrazione",
      motivo_provenienza                       AS "motivoProvenienza"
    FROM pubblico.allerta
    WHERE comune_istat = ${comuneIstat} AND data <= CURRENT_DATE
    ORDER BY data DESC, orizzonte_ore ASC, data_estrazione DESC
    LIMIT 1
  `;
  const r = rows[0];
  if (!r) return null;
  return {
    livello: r.livello as AllertaRiga["livello"],
    provenienza: r.provenienza,
    data: r.data,
    nottiTropicali: r.nottiTropicali,
    comuneIstat,
    dataEstrazione: r.dataEstrazione,
    motivoProvenienza: r.motivoProvenienza,
  };
}

export interface AllertaPrevisione {
  /** Riga di oggi (orizzonte tipicamente 24h). Null se il poller non ha girato. */
  oggi: AllertaRiga | null;
  /** Riga di domani (orizzonte 48h). Null se non ancora pubblicata. */
  domani: AllertaRiga | null;
  /** Riga di dopodomani (orizzonte 72h). Null se non ancora pubblicata. */
  dopodomani: AllertaRiga | null;
}

/**
 * Livello di oggi + previsioni a 48h e 72h per il comune. Restituisce
 * per ognuno dei tre giorni la riga più recente per `data_estrazione`
 * (il poller UPSERTa a ogni giro, la stessa data può avere più
 * estrazioni successive che raffinano il livello).
 *
 * **Attendibilità dichiarata**: `allerta.py --backtest` misura SOLO
 * l'orizzonte a 24 ore e SOLO sul ramo "istantaneo" della stima (vedi
 * `packages/ingest/allerta.py:208-213,226`). I 74,3% esatti / 92,9%
 * entro-uno / 4,3% sottostime valgono per l'orizzonte a 24 ore
 * (Bologna 2025). Gli orizzonti a 48 e 72 ore NON hanno backtest;
 * l'interfaccia che li mostra deve dirlo — una previsione a tre giorni
 * è quasi sempre meno accurata di una a un giorno.
 *
 * `oggi = null` significa "il poller non ha girato di recente":
 * ricontrolla il cron in produzione. `domani = null` / `dopodomani =
 * null` sono possibili anche a poller sano (es. il bollettino di
 * venerdì non copre tutto il weekend a ogni città) e l'interfaccia
 * deve degradare in silenzio senza inventare un livello di ripiego.
 */
export async function allertaPrevisione(
  sql: Sql,
  comuneIstat: string,
): Promise<AllertaPrevisione> {
  // DISTINCT ON per data: prendo la riga più recente per data_estrazione
  // fra oggi, domani e dopodomani. Se una data manca (poller non ha ancora
  // pubblicato o bollettino non copre quel giorno), il chiamante riceve null
  // per quella chiave.
  const rows = await sql<Array<{
    offsetGiorni: number;
    livello: number;
    provenienza: "bollettino" | "stima";
    data: string;
    nottiTropicali: number;
    dataEstrazione: string;
    motivoProvenienza: string | null;
  }>>`
    SELECT DISTINCT ON (data)
      (data - CURRENT_DATE)::int              AS "offsetGiorni",
      livello                                  AS livello,
      provenienza                              AS provenienza,
      to_char(data, 'YYYY-MM-DD')              AS data,
      notti_tropicali                          AS "nottiTropicali",
      to_char(data_estrazione, 'YYYY-MM-DD')   AS "dataEstrazione",
      motivo_provenienza                       AS "motivoProvenienza"
    FROM pubblico.allerta
    WHERE comune_istat = ${comuneIstat}
      AND data BETWEEN CURRENT_DATE AND CURRENT_DATE + 2
    ORDER BY data ASC, data_estrazione DESC, orizzonte_ore ASC
  `;
  const per: Record<number, AllertaRiga> = {};
  for (const r of rows) {
    per[r.offsetGiorni] = {
      livello: r.livello as AllertaRiga["livello"],
      provenienza: r.provenienza,
      data: r.data,
      nottiTropicali: r.nottiTropicali,
      comuneIstat,
      dataEstrazione: r.dataEstrazione,
      motivoProvenienza: r.motivoProvenienza,
    };
  }
  return {
    oggi: per[0] ?? null,
    domani: per[1] ?? null,
    dopodomani: per[2] ?? null,
  };
}

/**
 * Allerta per una data specifica. Distinta da `allertaCorrente` (che filtra
 * `data <= CURRENT_DATE` e prende la più recente): qui l'invariante è "la
 * riga di quella data esatta". Usata da `carica-nel-db.ts` per costruire
 * l'`Allerta` da passare al motore, invece di un valore hardcoded. Se manca,
 * il chiamante deve fermarsi — non c'è un livello di ripiego onesto.
 *
 * `data_estrazione DESC` come ultimo tie-breaker: a parità di orizzonte
 * vince l'estrazione più recente. Vale la stessa ragione di
 * `allertaCorrente` — senza tie-breaker l'ordinamento è indeterminato.
 */
export async function allertaDelGiorno(
  sql: Sql,
  comuneIstat: string,
  data: string,
): Promise<AllertaRiga | null> {
  const rows = await sql<Array<{
    livello: number;
    provenienza: "bollettino" | "stima";
    data: string;
    nottiTropicali: number;
    dataEstrazione: string;
    motivoProvenienza: string | null;
  }>>`
    SELECT
      livello                                  AS livello,
      provenienza                              AS provenienza,
      to_char(data, 'YYYY-MM-DD')              AS data,
      notti_tropicali                          AS "nottiTropicali",
      to_char(data_estrazione, 'YYYY-MM-DD')   AS "dataEstrazione",
      motivo_provenienza                       AS "motivoProvenienza"
    FROM pubblico.allerta
    WHERE comune_istat = ${comuneIstat} AND data = ${data}::date
    ORDER BY orizzonte_ore ASC, data_estrazione DESC
    LIMIT 1
  `;
  const r = rows[0];
  if (!r) return null;
  return {
    livello: r.livello as AllertaRiga["livello"],
    provenienza: r.provenienza,
    data: r.data,
    nottiTropicali: r.nottiTropicali,
    comuneIstat,
    dataEstrazione: r.dataEstrazione,
    motivoProvenienza: r.motivoProvenienza,
  };
}

export async function comuneDellOrganizzazione(
  sql: Sql,
  organizzazioneId: number,
): Promise<string | null> {
  const rows = await sql<Array<{ comuneIstat: string }>>`
    SELECT comune_istat AS "comuneIstat"
    FROM pubblico.organizzazione
    WHERE id = ${organizzazioneId}
  `;
  return rows[0]?.comuneIstat ?? null;
}

/**
 * Inverso di `comuneDellOrganizzazione`: dato un codice ISTAT (che
 * arriva dallo slug URL /[comune]/... via risolviComune), restituisce
 * l'organizzazione corrispondente. Usato dal login-stub per-comune (§12u):
 * lo slug determina l'organizzazione, così `/login`, `/entra`,
 * `/entra-coordinatore` non hanno più l'id 1 hardcoded.
 *
 * Se l'istanza serve più organizzazioni per lo stesso comune (caso non
 * previsto oggi ma non impedito dallo schema), restituisce la prima per
 * `id` — al bisogno la lookup diventerà `slug → org_id` esplicito con
 * un mapping in `apps/web/lib/comuni.ts`.
 */
export async function organizzazionePerComuneIstat(
  sql: Sql,
  comuneIstat: string,
): Promise<{ id: number; nome: string } | null> {
  const rows = await sql<Array<{ id: number; nome: string }>>`
    SELECT id, nome
    FROM pubblico.organizzazione
    WHERE comune_istat = ${comuneIstat}
    ORDER BY id
    LIMIT 1
  `;
  return rows[0] ?? null;
}

// ------------------------------------------------------ costruzione Persona

/**
 * Converte una AssegnazioneDelGiorno nella `Persona` che il motore di scoring
 * si aspetta. I fattori sono già stati calcolati e salvati nell'assegnazione;
 * questa Persona serve per invocare `azionePer(persona, oggi)` live.
 */
export function toPersonaScoring(a: AssegnazioneDelGiorno): Persona {
  const p: Persona = {
    idEsterno: a.idEsterno,
    sezioneId: a.sezioneId,
  };
  if (a.annoNascita !== null) p.annoNascita = a.annoNascita;
  if (a.viveSolo !== null) p.viveSolo = a.viveSolo;
  if (a.piano !== null) p.piano = a.piano;
  if (a.ascensore !== null) p.ascensore = a.ascensore;
  if (a.dataUltimoContatto !== null) p.dataUltimoContatto = a.dataUltimoContatto;
  if (a.segnalatoDaMmg) p.segnalatoDaMmg = true;
  // Approssimazione: la scheda usa tentativiOggi come input alla azionePer
  // live. Con la semantica "consecutivi" di Persona.tentativiFalliti, questo
  // è un sottoinsieme (solo oggi) e la vista scheda under-reports le miss
  // storiche fino al prossimo `carica`. Fix pulito: aggiungere
  // AssegnazioneDelGiorno.tentativiConsecutivi caricato con la stessa
  // funzione usata da carica-nel-db.ts. Non fatto qui: scope MOD03-bis.
  if (a.tentativiOggi > 0) p.tentativiFalliti = a.tentativiOggi;
  if (a.segnali.length > 0) p.segnali = a.segnali;
  return p;
}

// ------------------------------------------------------ dashboard coordinatore
//
// MOD04: le tre letture della schermata principale. Nessun agente, nessuna
// riordinatura: la dashboard mostra lo stato calcolato altrove.

export interface StatoGiornata {
  /** Persone assegnate a un volontario oggi (in cima alla classifica). */
  inLista: number;
  /** Persone in lista con almeno un contatto oggi (qualunque esito). */
  contattate: number;
  /** Persone in lista il cui ultimo contatto oggi è "non_risponde". */
  nonRaggiunte: number;
  /** Soglia effettiva del giorno: numero di persone in lista. */
  soglia: number;
}

export async function statoGiornata(
  sql: Sql,
  organizzazioneId: number,
  dataOggi: string,
): Promise<StatoGiornata> {
  const rows = await sql<Array<{
    inLista: number; contattate: number; nonRaggiunte: number;
  }>>`
    WITH lista AS (
      SELECT a.persona_id
        FROM riservato.assegnazione a
        JOIN riservato.utente u ON u.id = a.volontario_id
       WHERE a.data = ${dataOggi}::date
         AND u.organizzazione_id = ${organizzazioneId}
    ),
    -- Ultimo contatto di oggi per ciascuna persona in lista (DISTINCT ON):
    -- serve per contare "non raggiunte" come persone il cui ultimo tentativo
    -- di oggi ha esito non_risponde, non ogni singolo tentativo.
    ultimo AS (
      SELECT DISTINCT ON (c.persona_id)
             c.persona_id, c.esito
        FROM riservato.contatto c
        JOIN lista l ON l.persona_id = c.persona_id
       WHERE c.data::date = ${dataOggi}::date
       ORDER BY c.persona_id, c.data DESC
    )
    SELECT
      (SELECT count(*) FROM lista)::int                                        AS "inLista",
      (SELECT count(*) FROM ultimo)::int                                       AS contattate,
      (SELECT count(*) FROM ultimo WHERE esito = 'non_risponde')::int          AS "nonRaggiunte"
  `;
  const r = rows[0]!;
  return { ...r, soglia: r.inLista };
}

/**
 * Payload alimentato al primo render server-side di
 * `<FasciaStatiLive>` in `apps/web/app/coordinatore/page.tsx` (§12ooo,
 * revisione §12gggg). I sette campi elencati sotto sono quelli che
 * la fascia superiore + card "Segnalazioni aperte" della dashboard
 * consumano. Il polling ogni 20s **non** rifà più questo payload via
 * rotta API (rimossa in §12gggg: `apps/web/app/api/coordinatore/stato`
 * cancellato): usa `router.refresh()` che rigenera l'intero server
 * component, quindi tutte le sei query del `Promise.all` — inclusa
 * `classificaDiOggi`, `uscitiRispettoAIeri`, `sogliaCorrente`,
 * `allertaCorrente`, `contaVolontariAttivi` — girano ad ogni ciclo.
 *
 * **Regola inviolabile ereditata da §12ooo**: mai includere risultati
 * di funzioni che chiamano `chiamaModello` (agenti LLM) fra i campi
 * di questa interfaccia. La regola resta valida anche col cambio a
 * `router.refresh()`: aggiungere un campo qui significa farlo
 * calcolare ad ogni ciclo di 20s, che per un output di modello
 * brucerebbe credito API e cambierebbe formulazione sotto gli occhi
 * di chi legge. Gli agenti (`generaAllertaCitta`, `generaConsiglio`)
 * vivono nella pagina pubblica dentro `<Suspense>` boundary
 * indipendenti — la dashboard coordinatore non li monta (verificato
 * in §12gggg blocco 0a).
 */
export interface StatoLiveDashboard {
  inLista: number;
  contattate: number;      // "Tentate" nel microcopy (§12kkk)
  nonRaggiunte: number;    // "Senza risposta" nel microcopy
  contattatiOggi: number;  // n. distinte con almeno un contatto oggi
  /**
   * Segnali osservativi non chiusi (`sintomi_riferiti`,
   * `ventilatore_rotto` — §12sss), ordinati con attivi prima, scaduti
   * in fondo. Ogni riga porta un flag `scaduto` per l'UI (§12ttt).
   */
  segnaliAperti: SegnaleAperto[];
  /**
   * Conteggi separati (§12ttt): `segnaliAttive` = ancora nel motore,
   * `segnaliScadute` = fuori dal motore ma visibili in card finché
   * qualcuno non le chiude. La somma è il totale confrontabile con
   * `segnaliAperti.length` per il messaggio "mostrati N di M" quando
   * la query centra il LIMIT.
   */
  segnaliAttive: number;
  segnaliScadute: number;
}

/**
 * Batch consolidato per il primo render server-side della fascia
 * live: chiama le query esistenti in parallelo, ritorna un unico
 * oggetto tipizzato. Zero SQL nuovo — solo composizione. Consumer
 * unico dopo §12gggg: il `Promise.all` di
 * `apps/web/app/coordinatore/page.tsx`. La rotta API dedicata è
 * stata rimossa. Se qualcuno domani volesse aggiungere un campo,
 * deve modificare esplicitamente `StatoLiveDashboard` — non emerge
 * per errore da una modifica agli altri query.
 */
export async function statoLiveDashboard(
  sql: Sql,
  organizzazioneId: number,
  dataOggi: string,
): Promise<StatoLiveDashboard> {
  const [stato, conteggi, segnaliAperti_, contattatiOggiRows] = await Promise.all([
    statoGiornata(sql, organizzazioneId, dataOggi),
    contaSegnaliAperti(sql, organizzazioneId, dataOggi),
    segnaliAperti(sql, organizzazioneId, dataOggi),
    sql<Array<{ n: number }>>`
      SELECT count(DISTINCT c.persona_id)::int AS n
        FROM riservato.contatto c
        JOIN riservato.persona p ON p.id = c.persona_id
       WHERE p.organizzazione_id = ${organizzazioneId}
         AND c.data::date = ${dataOggi}::date
    `,
  ]);
  return {
    inLista: stato.inLista,
    contattate: stato.contattate,
    nonRaggiunte: stato.nonRaggiunte,
    contattatiOggi: contattatiOggiRows[0]?.n ?? 0,
    segnaliAperti: segnaliAperti_,
    segnaliAttive: conteggi.attive,
    segnaliScadute: conteggi.scadute,
  };
}

export interface SogliaCorrente {
  /** Valore effettivo salvato in riservato.soglia_giorno per la data. */
  valore: number;
  /** Chi ha impostato la soglia: NULL = default registrato dal batch. */
  impostataDa: number | null;
  /**
   * Livello di allerta al momento del salvataggio. NULL per righe
   * precedenti a §12w (2026-08-04): la UI le presenta come "livello non
   * registrato". Nuove scritture lo popolano sempre.
   */
  livelloAlSalvataggio: number | null;
}

export async function sogliaCorrente(
  sql: Sql,
  organizzazioneId: number,
  dataOggi: string,
): Promise<SogliaCorrente | null> {
  const rows = await sql<Array<{
    valore: number; impostataDa: number | null;
    livelloAlSalvataggio: number | null;
  }>>`
    SELECT sg.valore                                                 AS valore,
           sg.impostata_da                                            AS "impostataDa",
           sg.livello_al_salvataggio                                  AS "livelloAlSalvataggio"
      FROM riservato.soglia_giorno sg
     WHERE sg.organizzazione_id = ${organizzazioneId}
       AND sg.data = ${dataOggi}::date
  `;
  return rows[0] ?? null;
}

/**
 * Numero di volontari attivi di un'organizzazione. Fatto sull'organizzazione,
 * non sul giorno: si legge live da `riservato.utente` e non dipende dallo
 * stato di `soglia_giorno`. Separata da `sogliaCorrente` in §12zzz — prima
 * era una subquery scalare appesa a `FROM soglia_giorno`, quindi quando
 * mancava la riga della soglia (mattina prima della generazione) la
 * dashboard mostrava "Volontari attivi: 0" a coordinatori che avevano N
 * volontari: affermazione falsa mostrata all'operatore per giorni.
 * Il regression test in `packages/db/test/soglia.test.ts` fissa la
 * separazione: il conteggio deve tornare corretto senza riga di soglia.
 */
export async function contaVolontariAttivi(
  sql: Sql,
  organizzazioneId: number,
): Promise<number> {
  const rows = await sql<Array<{ n: number }>>`
    SELECT count(*)::int AS n FROM riservato.utente
     WHERE organizzazione_id = ${organizzazioneId}
       AND ruolo = 'volontario' AND attivo = true
  `;
  return rows[0]?.n ?? 0;
}

// ============================================================
// §12jjjjj — Presenza giornaliera dei volontari
// ============================================================

/**
 * Rappresentazione compatta della presenza di un volontario oggi.
 * Include SEMPRE tutti i volontari attivi dell'organizzazione (uno
 * per riga), coi campi UI necessari per la card "Volontari e soglia"
 * e la pagina di gestione. `inPausa` distingue "in pausa oggi" da
 * "attivo e di turno".
 */
export interface VolontarioConPresenza {
  id: number;
  nome: string;
  email: string;
  inPausa: boolean;         // true se ha riga in pausa_volontario per data
  personeInCarico: number;  // COUNT assegnazione per (data, vol) — 0 se nessuna
}

/**
 * §12jjjjj — Legge tutti i volontari attivi dell'org con lo stato
 * di presenza per `dataOggi` e il carico assegnato per quel giorno.
 *
 * `LEFT JOIN pausa_volontario` per rilevare la pausa (assenza di
 * riga = di turno, presenza di riga = in pausa). `LEFT JOIN
 * assegnazione ... GROUP BY` per il carico corrente. Un'unica query.
 *
 * Ordinamento per `email`: stesso di `generaGiroDelGiorno` (§12w)
 * per la determinismo dell'ordine nell'UI. Il coord vede sempre la
 * stessa sequenza di volontari.
 *
 * Include volontari `attivo=true` in generale: `attivo=false` NON
 * compare qui. La pagina di gestione separa "attivi" (mostrati con
 * interruttore pausa) da "non attivi" (elencati in una sezione a
 * parte con azione "riattiva").
 */
export async function presenzaVolontariOggi(
  sql: Sql,
  organizzazioneId: number,
  dataOggi: string,
): Promise<VolontarioConPresenza[]> {
  const rows = await sql<Array<{
    id: number; nome: string; email: string;
    inPausa: boolean; personeInCarico: number;
  }>>`
    SELECT u.id                                              AS id,
           u.nome                                            AS nome,
           u.email                                           AS email,
           (p.volontario_id IS NOT NULL)                     AS "inPausa",
           COALESCE(a.n, 0)                                  AS "personeInCarico"
      FROM riservato.utente u
      LEFT JOIN riservato.pausa_volontario p
             ON p.volontario_id = u.id AND p.data = ${dataOggi}::date
      LEFT JOIN (
        SELECT volontario_id, count(*)::int AS n
          FROM riservato.assegnazione
         WHERE data = ${dataOggi}::date
           AND organizzazione_id = ${organizzazioneId}
         GROUP BY volontario_id
      ) a ON a.volontario_id = u.id
     WHERE u.organizzazione_id = ${organizzazioneId}
       AND u.ruolo = 'volontario' AND u.attivo = true
     ORDER BY u.email
  `;
  return rows;
}

/**
 * Vero se il volontario risulta in pausa per la data indicata.
 *
 * Query mirata alla singola persona: la vista volontario ha bisogno di
 * sapere se `oggi` per sé sta in pausa, e ha già in mano il proprio
 * `volontarioId` dal cookie. `presenzaVolontariOggi` risponderebbe alla
 * stessa domanda ma restituisce una riga per ogni volontario dell'org:
 * sensato per la card del coordinatore, sprecato per il singolo utente.
 *
 * Non serve scoping cross-org: `pausa_volontario` ha PRIMARY KEY
 * `(volontario_id, data)` — se un volontario è in pausa in quella data,
 * la sua riga è unica. La sicurezza cross-org è già garantita a monte
 * dal cookie che identifica `volontarioId` (l'utente può interrogare
 * solo sé stesso).
 */
export async function volontarioInPausaOggi(
  sql: Sql,
  volontarioId: number,
  dataOggi: string,
): Promise<boolean> {
  const rows = await sql<Array<{ inPausa: boolean }>>`
    SELECT EXISTS (
      SELECT 1 FROM riservato.pausa_volontario
       WHERE volontario_id = ${volontarioId}
         AND data = ${dataOggi}::date
    ) AS "inPausa"
  `;
  return rows[0]?.inPausa ?? false;
}

/**
 * Vero se esiste almeno una riga in `riservato.assegnazione` per
 * l'organizzazione e la data — cioè se `generaGiroDelGiorno` ha
 * scritto qualcosa per quel giorno, per quella org.
 *
 * Serve alla vista volontario per distinguere due stati vuoti che
 * hanno la stessa risposta della query personale (`assegnazioni.length
 * === 0`): "il giro non è stato generato per la mia organizzazione"
 * (nessuna riga per l'org quel giorno — cron non partito, cron partito
 * ma fallito prima del commit, SKIP per allerta mancante) vs "il giro
 * esiste per altri, non per me" (righe per l'org ma non per il mio id
 * — soglia bassa, capienza corta).
 *
 * Il primo caso è quello che rende il fallimento del cron sul VPS
 * visibile a qualcuno: un volontario che apre la vista al mattino e
 * legge "il giro non è stato preparato" può avvisare il coordinatore,
 * altrimenti il fallimento resta silenzioso finché non lo scopre chi
 * legge `/var/log/checaldo/genera-giri.log`.
 */
export async function esistonoAssegnazioniOggi(
  sql: Sql,
  organizzazioneId: number,
  dataOggi: string,
): Promise<boolean> {
  const rows = await sql<Array<{ esistono: boolean }>>`
    SELECT EXISTS (
      SELECT 1 FROM riservato.assegnazione
       WHERE organizzazione_id = ${organizzazioneId}
         AND data = ${dataOggi}::date
    ) AS esistono
  `;
  return rows[0]?.esistono ?? false;
}

/**
 * §12jjjjj — Conta i volontari **di turno** oggi: attivi in generale
 * E non in pausa per la data. Sostituisce `contaVolontariAttivi`
 * come input a `capienzaSuggerita` (la capienza dipende da chi c'è
 * oggi, non dall'anagrafe globale).
 *
 * `contaVolontariAttivi` resta per usi che davvero servono l'anagrafe
 * (pagina gestione volontari, log operativo): non è deprecata.
 */
export async function contaVolontariDiTurnoOggi(
  sql: Sql,
  organizzazioneId: number,
  dataOggi: string,
): Promise<number> {
  const rows = await sql<Array<{ n: number }>>`
    SELECT count(*)::int AS n
      FROM riservato.utente u
     WHERE u.organizzazione_id = ${organizzazioneId}
       AND u.ruolo = 'volontario' AND u.attivo = true
       AND NOT EXISTS (
         SELECT 1 FROM riservato.pausa_volontario p
          WHERE p.volontario_id = u.id AND p.data = ${dataOggi}::date
       )
  `;
  return rows[0]?.n ?? 0;
}

/**
 * §12jjjjj — Mette un volontario in pausa per una data specifica.
 * Idempotente: se già in pausa, non fa nulla e non solleva.
 *
 * **`assertAppartiene`**: verifica che sia il volontario che l'utente
 * che sta scrivendo appartengano all'`organizzazioneSessione`. Impedisce
 * a un coord di un'altra org di mettere in pausa i volontari altrui.
 *
 * Uso: server action della dashboard e della pagina gestione. Il
 * coordinatore autenticato = `impostataDa`.
 */
export async function metteInPausa(
  sql: Sql,
  organizzazioneSessione: number,
  volontarioId: number,
  dataOggi: string,
  impostataDa: number,
): Promise<void> {
  await assertAppartiene(sql, organizzazioneSessione, {
    volontarioId,
    utenteId: impostataDa,
  });
  await sql`
    INSERT INTO riservato.pausa_volontario
      (volontario_id, data, organizzazione_id, impostata_da)
    VALUES
      (${volontarioId}, ${dataOggi}::date, ${organizzazioneSessione}, ${impostataDa})
    ON CONFLICT (volontario_id, data) DO NOTHING
  `;
}

/**
 * §12jjjjj — Riprende un volontario dalla pausa per una data specifica.
 * Idempotente: se non era in pausa, non fa nulla e non solleva.
 *
 * **`assertAppartiene`**: come sopra.
 *
 * NB: la DELETE è scopata su `organizzazione_id` come difesa in
 * profondità, oltre alla FK compound che già impedisce la scrittura
 * cross-org. Se `assertAppartiene` fallisce non si arriva qui.
 */
export async function riprendeDallaPausa(
  sql: Sql,
  organizzazioneSessione: number,
  volontarioId: number,
  dataOggi: string,
  richiedente: number,
): Promise<void> {
  await assertAppartiene(sql, organizzazioneSessione, {
    volontarioId,
    utenteId: richiedente,
  });
  await sql`
    DELETE FROM riservato.pausa_volontario
     WHERE volontario_id = ${volontarioId}
       AND data = ${dataOggi}::date
       AND organizzazione_id = ${organizzazioneSessione}
  `;
}

/**
 * §12jjjjj — Attiva o disattiva un volontario in generale (colonna
 * `attivo` di `riservato.utente`). Diverso da mettere in pausa oggi:
 * `attivo=false` significa "non lavora più con noi", `pausa=true`
 * significa "non oggi". Un vol non attivo NON è candidato al giro
 * di alcun giorno.
 *
 * `assertAppartiene` protegge cross-org. `richiedente` è il
 * coordinatore autenticato — l'attivazione arriva via server action
 * dalla pagina di gestione, mai da input aperto.
 */
export async function impostaAttivo(
  sql: Sql,
  organizzazioneSessione: number,
  volontarioId: number,
  attivo: boolean,
  richiedente: number,
): Promise<void> {
  await assertAppartiene(sql, organizzazioneSessione, {
    volontarioId,
    utenteId: richiedente,
  });
  await sql`
    UPDATE riservato.utente
       SET attivo = ${attivo}
     WHERE id = ${volontarioId}
       AND organizzazione_id = ${organizzazioneSessione}
       AND ruolo = 'volontario'
  `;
}

/**
 * UPSERT sulla soglia del giorno. Un giorno una riga; cambiarla è UPDATE,
 * non append. Il coordinatore la fissa dalla dashboard (impostataDa =
 * utente_id); `carica-nel-db.ts` la scrive con impostataDa = NULL come
 * default se nessuno l'ha ancora fissata. Vedi §12d "Soglia dinamica".
 *
 * `livelloAllerta` viene salvato in `livello_al_salvataggio` (§12w): serve
 * alla dashboard per dire "soglia scelta quando l'allerta era X, oggi
 * è Y". Chi chiama la funzione conosce il livello di allerta corrente
 * (il coordinatore lo vede in pagina, il batch lo ha appena letto da
 * pubblico.allerta), quindi non serve rileggerlo qui.
 */
export async function impostaSogliaGiorno(
  sql: Sql,
  organizzazioneId: number,
  dataOggi: string,
  valore: number,
  utenteId: number,
  livelloAllerta: number | null,
): Promise<void> {
  await sql`
    INSERT INTO riservato.soglia_giorno
      (organizzazione_id, data, valore, impostata_da, livello_al_salvataggio)
    VALUES
      (${organizzazioneId}, ${dataOggi}::date, ${valore}, ${utenteId}, ${livelloAllerta})
    ON CONFLICT (organizzazione_id, data) DO UPDATE
      SET valore = EXCLUDED.valore,
          impostata_da = EXCLUDED.impostata_da,
          livello_al_salvataggio = EXCLUDED.livello_al_salvataggio,
          impostata_il = now()
  `;
}

export interface UscitoDallaLista {
  personaId: number;
  idEsterno: string;
  quartiere: string | null;
  rangoIeri: number | null;
  rangoOggi: number | null;
  /** Numero di segnali scaduti nella notte (valido_fino = dataOggi - 1). */
  segnaliScaduti: number;
  /** True se fra i segnali scaduti c'è almeno un 'sintomi_riferiti'. */
  scadutiIncludonoSintomi: boolean;
  /** True se oggi la persona ha un contatto con esito 'sta_bene'. */
  contattataStaBene: boolean;
  /**
   * Soglia della lista di ieri e di oggi. Servono a `motivo()` per
   * riconoscere il caso "sarebbe rimasta in lista con la soglia di
   * ieri" (§12kkk): quando `rango_oggi ≤ soglia_ieri`, la causa
   * dominante dell'uscita è il taglio della lista, non un cambio
   * della persona. In quel caso il motivo soglia vince su segnale
   * scaduto/chiuso/raggiunta — altrimenti diremmo "sintomo passato
   * nella notte" per una persona che con la soglia di ieri sarebbe
   * ancora dentro anche senza il segnale. NULL se la riga
   * `riservato.soglia_giorno` manca per quella data.
   */
  sogliaIeri: number | null;
  sogliaOggi: number | null;
}

/**
 * Chi era in lista ieri (riga in `assegnazione` con `data = dataOggi - 1`)
 * ma non è in lista oggi (nessuna riga in `assegnazione` con `data = dataOggi`).
 * Ordinato per gravità della discesa: chi ha perso più posizioni prima.
 *
 * "Motivo" della discesa: euristica sui dati disponibili in DB, senza
 * ricalcolare i fattori con `@checaldo/scoring`. Cerca:
 *   1. Segnali scaduti nella notte (`valido_fino = dataOggi - 1`, non
 *      chiusi): questa è la storia di Persona 0193 (23 `sintomi_riferiti`
 *      con `valido_fino = 2026-07-31`, scaduti in `2026-08-01`).
 *   2. Contatti con esito 'sta_bene' registrati oggi: la persona è stata
 *      raggiunta e ha risposto bene. Reset di `tentativi_falliti`.
 * Se nessuna delle due condizioni scatta, la discesa è "punteggio ricalcolato"
 * — cambio proporzionale di `giorni_da_ultimo_contatto` o rumore
 * cumulativo — e va lasciato senza pretesa di spiegazione. Vedi §12b
 * "Chiusura del ramo era Nª ieri".
 *
 * NOTA: il motivo qui è approssimato per BLOCCO 1. Se la dashboard cresce
 * fino a doverlo spiegare in modo autoritativo, la fonte pulita è
 * salvare i fattori in `rango_giorno` (nuova colonna `fattori jsonb`) e
 * fare il diff con quelli di ieri. Non fatto qui perché il caso principale
 * (segnali scaduti) è già coperto e la scena del video si accontenta.
 */
export async function uscitiRispettoAIeri(
  sql: Sql,
  organizzazioneId: number,
  dataOggi: string,
): Promise<UscitoDallaLista[]> {
  const rows = await sql<Array<{
    personaId: number; idEsterno: string; quartiere: string | null;
    rangoIeri: number | null; rangoOggi: number | null;
    segnaliScaduti: number; scadutiIncludonoSintomi: boolean;
    contattataStaBene: boolean;
    sogliaIeri: number | null; sogliaOggi: number | null;
  }>>`
    SELECT a_ieri.persona_id                                         AS "personaId",
           p.id_esterno                                              AS "idEsterno",
           s.quartiere                                               AS quartiere,
           rg_ieri.rango                                             AS "rangoIeri",
           rg_oggi.rango                                             AS "rangoOggi",
           (
             SELECT count(*)::int FROM riservato.segnale sg
              WHERE sg.persona_id = p.id
                AND sg.valido_fino = ${dataOggi}::date - 1
                AND sg.chiuso_il IS NULL
           )                                                          AS "segnaliScaduti",
           EXISTS (
             SELECT 1 FROM riservato.segnale sg
              WHERE sg.persona_id = p.id
                AND sg.valido_fino = ${dataOggi}::date - 1
                AND sg.tipo = 'sintomi_riferiti'
                AND sg.chiuso_il IS NULL
           )                                                          AS "scadutiIncludonoSintomi",
           EXISTS (
             SELECT 1 FROM riservato.contatto c
              WHERE c.persona_id = p.id
                AND c.data::date = ${dataOggi}::date - 1
                AND c.esito = 'sta_bene'
           )                                                          AS "contattataStaBene",
           sg_ieri.valore                                             AS "sogliaIeri",
           sg_oggi.valore                                             AS "sogliaOggi"
      FROM riservato.assegnazione a_ieri
      JOIN riservato.utente u_ieri ON u_ieri.id = a_ieri.volontario_id
      JOIN riservato.persona p ON p.id = a_ieri.persona_id
      LEFT JOIN pubblico.sezione s ON s.id = p.sezione_id AND NOT s.fittizia
      LEFT JOIN riservato.rango_giorno rg_ieri
        ON rg_ieri.persona_id = a_ieri.persona_id AND rg_ieri.data = ${dataOggi}::date - 1
      LEFT JOIN riservato.rango_giorno rg_oggi
        ON rg_oggi.persona_id = a_ieri.persona_id AND rg_oggi.data = ${dataOggi}::date
      LEFT JOIN riservato.assegnazione a_oggi
        ON a_oggi.persona_id = a_ieri.persona_id AND a_oggi.data = ${dataOggi}::date
      LEFT JOIN riservato.soglia_giorno sg_ieri
        ON sg_ieri.organizzazione_id = ${organizzazioneId}
       AND sg_ieri.data = ${dataOggi}::date - 1
      LEFT JOIN riservato.soglia_giorno sg_oggi
        ON sg_oggi.organizzazione_id = ${organizzazioneId}
       AND sg_oggi.data = ${dataOggi}::date
     WHERE a_ieri.data = ${dataOggi}::date - 1
       AND u_ieri.organizzazione_id = ${organizzazioneId}
       AND a_oggi.persona_id IS NULL
     ORDER BY (rg_oggi.rango - rg_ieri.rango) DESC NULLS FIRST
  `;
  return rows;
}

// ------------------------------ MOD04: classifica / sintomi

export interface PersonaInClassifica {
  personaId: number;
  idEsterno: string;
  quartiere: string | null;
  rangoGlobale: number | null;
  posizioneNelGiro: number;
  volontarioId: number;
  volontarioNome: string;
  annoNascita: number | null;
  /**
   * Esito dell'ultimo contatto registrato oggi in `riservato.contatto`
   * per questa persona. `null` quando nessun contatto per la data
   * corrente esiste. Semantica dei tre gruppi disgiunti (§12aaaa):
   * - `null` → "Non ancora" (nessuno l'ha tentata oggi)
   * - `'non_risponde'` → "Non risponde" (tentata, ma senza risposta
   *   dopo l'ultimo tentativo)
   * - `'sta_bene' | 'ha_bisogno'` → "Raggiunta"
   *
   * Coincide con la semantica dei tre gruppi della pagina fine giro
   * volontario (`apps/web/app/volontario/fine-giro/page.tsx`), NON con
   * la chip "Tentate" della dashboard (che include anche i non_risponde
   * nel conteggio).
   */
  ultimoEsitoOggi: "sta_bene" | "ha_bisogno" | "non_risponde" | null;
  /**
   * Segnali osservativi aperti (`sintomi_riferiti`, `ventilatore_rotto`)
   * ancora validi oggi (non chiusi e non scaduti). Coerente col
   * filtro di `segnaliAperti` / `contaSegnaliAperti` della card
   * "Segnalazioni aperte" (§12sss). I tipi strutturali sono esclusi
   * per scelta di design (§12aaaa): includerli produrrebbe una
   * seconda tautologia — le persone in cima hanno tutte 2-4 condizioni,
   * il numero mostrato sarebbe sempre 2-4.
   */
  nSegnaliOsservativi: number;
  /**
   * Stato della climatizzazione della persona derivato dai segnali
   * aperti e validi oggi (§12dddd):
   * - `'assente'`   → `nessuna_climatizzazione` aperto (non ce l'ha)
   * - `'rotto'`     → `ventilatore_rotto` aperto ma NON
   *   `nessuna_climatizzazione`
   * - `'presente'` → nessuno dei due segnali aperto
   *
   * **Precedenza `assente` > `rotto`**: se una persona ha entrambi i
   * segnali aperti (situazione che il vincolo §12xxx eviterebbe per
   * scritture app-side ma che il generatore fixture può seminare
   * indipendentemente — sul canone corrente due casi, ranghi 6 e 7),
   * si assume `assente` perché è la mancanza più grave (non ha nulla,
   * non solo un pezzo rotto). La scelta è deterministica: la subquery
   * scalare per `nessuna_climatizzazione` viene valutata prima di
   * quella per `ventilatore_rotto` — se la prima è vera, il CASE
   * ritorna `'assente'` senza guardare la seconda.
   *
   * Serve alla page coordinatore per assegnare il comodato ai primi
   * N in graduatoria fra le persone con clima 'assente' o 'rotto',
   * saltando chi ha clima presente (§12dddd sostituisce la regola
   * pre-esistente "primi N per rango a tappeto").
   */
  statoCondizionatore: "assente" | "rotto" | "presente";
}

const TIPI_OSSERVATIVI_CLASSIFICA = ["sintomi_riferiti", "ventilatore_rotto"] as const;

/**
 * La classifica completa di oggi, ordinata per rango globale. Serve alla
 * dashboard per la vista "chi è in lista, quale volontario ce l'ha, chi
 * riceve il comodato". La colonna "condizionatore" è calcolata a schermo
 * dalla soglia comodati (rango ≤ N).
 *
 * **§12aaaa**: la query trasporta anche stato del contatto di oggi (via
 * LEFT JOIN LATERAL sull'indice `riservato.contatto (persona_id, data
 * DESC)` di schema.sql:221 — O(log n) per riga) e conteggio segnali
 * osservativi aperti (subquery scalare). Nessuna query aggiuntiva nel
 * `Promise.all` di `apps/web/app/coordinatore/page.tsx`.
 */
export async function classificaDiOggi(
  sql: Sql,
  organizzazioneId: number,
  dataOggi: string,
): Promise<PersonaInClassifica[]> {
  const rows = await sql<PersonaInClassifica[]>`
    SELECT a.persona_id                              AS "personaId",
           p.id_esterno                              AS "idEsterno",
           s.quartiere                               AS quartiere,
           a.rango_globale                           AS "rangoGlobale",
           a.posizione                               AS "posizioneNelGiro",
           a.volontario_id                           AS "volontarioId",
           u.nome                                    AS "volontarioNome",
           p.anno_nascita                            AS "annoNascita",
           ult.esito                                 AS "ultimoEsitoOggi",
           (SELECT count(*)::int FROM riservato.segnale sg
             WHERE sg.persona_id = a.persona_id
               AND sg.chiuso_il IS NULL
               AND sg.tipo IN ${sql(TIPI_OSSERVATIVI_CLASSIFICA)}
               AND (sg.valido_fino IS NULL OR sg.valido_fino >= ${dataOggi}::date)
           )                                          AS "nSegnaliOsservativi",
           -- §12dddd: stato clima da segnali aperti+validi oggi.
           -- Precedenza assente > rotto (dichiarata nella docstring di
           -- PersonaInClassifica): se entrambi aperti, si assume assente.
           -- L indice parziale (persona_id, valido_fino) WHERE chiuso_il
           -- IS NULL di schema.sql:189 copre entrambe le subquery.
           CASE
             WHEN EXISTS (SELECT 1 FROM riservato.segnale sc
                           WHERE sc.persona_id = a.persona_id
                             AND sc.chiuso_il IS NULL
                             AND sc.tipo = 'nessuna_climatizzazione'
                             AND (sc.valido_fino IS NULL OR sc.valido_fino >= ${dataOggi}::date))
               THEN 'assente'
             WHEN EXISTS (SELECT 1 FROM riservato.segnale sc
                           WHERE sc.persona_id = a.persona_id
                             AND sc.chiuso_il IS NULL
                             AND sc.tipo = 'ventilatore_rotto'
                             AND (sc.valido_fino IS NULL OR sc.valido_fino >= ${dataOggi}::date))
               THEN 'rotto'
             ELSE 'presente'
           END                                        AS "statoCondizionatore"
      FROM riservato.assegnazione a
      JOIN riservato.utente u ON u.id = a.volontario_id
      JOIN riservato.persona p ON p.id = a.persona_id
      LEFT JOIN pubblico.sezione s
        ON s.id = p.sezione_id AND NOT s.fittizia
      LEFT JOIN LATERAL (
        SELECT c.esito
          FROM riservato.contatto c
         WHERE c.persona_id = a.persona_id
           AND c.data::date = ${dataOggi}::date
         ORDER BY c.data DESC
         LIMIT 1
      ) ult ON true
     WHERE a.data = ${dataOggi}::date
       AND u.organizzazione_id = ${organizzazioneId}
     ORDER BY a.rango_globale ASC NULLS LAST
  `;
  return rows;
}

/**
 * Regola comodato (§12dddd): dato l'insieme di righe della classifica
 * di oggi, ritorna le personaId che ricevono il condizionatore in
 * comodato. Prime `n` per rango fra chi ha `statoCondizionatore !==
 * 'presente'`. Chi ha clima 'presente' è saltato — se le candidate
 * sono meno di `n`, il comodato va solo a quelle, non si riempie con
 * clima-presente per "arrivare a n".
 *
 * Funzione pura, deterministica, senza I/O. Estratta in
 * §12iiii da `apps/web/app/coordinatore/page.tsx` dove viveva
 * inline: il test §12dddd riscriveva la stessa logica dentro sé
 * stesso e restava verde anche se `page.tsx` regrediva a "primi n
 * per rango a tappeto". Ora page.tsx e test chiamano questa
 * funzione, la duplicazione è andata.
 *
 * Accetta un tipo strutturale minimo (`Pick`) per non forzare il
 * chiamante a costruire un `PersonaInClassifica` completo nei test:
 * bastano `personaId`, `rangoGlobale`, `statoCondizionatore`.
 * Richiede che `righe` sia già ordinata per `rangoGlobale ASC` come
 * la restituisce `classificaDiOggi` (`ORDER BY a.rango_globale ASC
 * NULLS LAST`); l'ordinamento non è ripetuto qui — se un chiamante
 * passa righe non ordinate, il comodato non va necessariamente ai
 * primi in graduatoria.
 */
export function assegnaComodato(
  righe: readonly Pick<PersonaInClassifica, "personaId" | "rangoGlobale" | "statoCondizionatore">[],
  n: number,
): Set<number> {
  return new Set(
    righe
      .filter((r) => r.statoCondizionatore !== "presente")
      .slice(0, n)
      .map((r) => r.personaId),
  );
}

// ------------------------------ MOD04 §12jjjj — scheda persona coordinatore
//
// Tre letture per singola persona, chiamate in `Promise.all` dalla
// `/coordinatore/persona/[id]` server component. La regola di
// autorizzazione (§12jjjj primo uso di `assertAppartiene` in lettura)
// vive nella page, non qui — qui non filtriamo per org: se la persona
// non appartiene all'org della sessione la page si è già fermata con
// `notFound()` prima di chiamarci.

export interface DatiPersonaCoord {
  personaId: number;
  idEsterno: string;
  organizzazioneId: number;
  annoNascita: number | null;
  viveSolo: boolean | null;
  piano: number | null;
  ascensore: boolean | null;
  telefono: string | null;
  indirizzo: string | null;
  segnalatoDaMmg: boolean;
  dataUltimoContattoAnagrafe: string | null;
  quartiere: string | null;
  /**
   * Riga di `riservato.assegnazione` per la data più recente in cui la
   * persona è stata in lista, con rango e punteggio. `null` se la
   * persona non è mai stata in lista.
   *
   * Contiene i fattori: la scomposizione del punteggio è ricostruibile
   * solo da qui. `rango_giorno` porta rango+punteggio ma NON i fattori
   * (scelta di §12kkkk: salvare i fattori per tutte le 500 persone ×
   * 8 giorni moltiplicherebbe per 20 il volume della tabella,
   * l'utilità operativa è marginale — chi è fuori soglia serve solo
   * "so che è al rango N su 500", non "ecco i fattori").
   */
  ultimaAssegnazione: {
    dataRango: string;
    rango: number | null;
    punteggio: number;
    /** Array grezzo di `FattoreSpiegabile`, come lo produce `classificaPersone`. */
    fattori: unknown;
    inListaOggi: boolean;
  } | null;
  /**
   * §12kkkk: la riga di `riservato.rango_giorno` per la data più recente
   * disponibile per la persona (tipicamente `dataOggi`, altrimenti la
   * più recente del batch precedente). `null` se la persona non è mai
   * stata valutata dal motore — spazio ~500 persone.
   *
   * Serve la sezione "Perché sta lì" della scheda coordinatore per
   * distinguere:
   *   - **in lista oggi**: assegnazione oggi presente (contiene tutto);
   *   - **valutata fuori soglia**: ultimoRangoValutato presente ma
   *     assegnazione oggi assente — mostra il rango di oggi qui e la
   *     scomposizione dell'ultima assegnazione (di altra data), con
   *     due date dichiarate;
   *   - **mai valutata**: entrambe null.
   *
   * `totaleValutati` è il conteggio di `rango_giorno` per (org, data)
   * — dà senso al rango ("464 su 500"); letto qui e non da una
   * costante perché il numero cambia se qualche persona è disattivata
   * fra un giro e l'altro.
   *
   * `valutataOggi` = data coincide con `dataOggi`.
   */
  ultimoRangoValutato: {
    data: string;
    rango: number;
    punteggio: number;
    totaleValutati: number;
    valutataOggi: boolean;
  } | null;
}

export async function datiPersonaCoord(
  sql: Sql,
  personaId: number,
  dataOggi: string,
): Promise<DatiPersonaCoord | null> {
  const rows = await sql<Array<DatiPersonaCoord>>`
    SELECT
      p.id                                                       AS "personaId",
      p.id_esterno                                               AS "idEsterno",
      p.organizzazione_id                                        AS "organizzazioneId",
      p.anno_nascita                                             AS "annoNascita",
      p.vive_solo                                                AS "viveSolo",
      p.piano                                                    AS piano,
      p.ascensore                                                AS ascensore,
      p.telefono                                                 AS telefono,
      p.indirizzo                                                AS indirizzo,
      p.segnalato_da_mmg                                         AS "segnalatoDaMmg",
      to_char(p.data_ultimo_contatto, 'YYYY-MM-DD')              AS "dataUltimoContattoAnagrafe",
      s.quartiere                                                AS quartiere,
      (
        -- Ultima assegnazione della persona (data piu recente).
        -- Restituita come oggetto o null. Fattori come jsonb grezzo
        -- (formato di FattoreSpiegabile di scoring): la ricostruzione
        -- del punteggio la fa la UI di /coordinatore/persona/[id].
        SELECT jsonb_build_object(
          'dataRango',    to_char(a.data, 'YYYY-MM-DD'),
          'rango',        a.rango_globale,
          'punteggio',    rg.punteggio,
          'fattori',      a.fattori,
          'inListaOggi',  (a.data = ${dataOggi}::date)
        )
          FROM riservato.assegnazione a
          LEFT JOIN riservato.rango_giorno rg
                 ON rg.persona_id = a.persona_id
                AND rg.data = a.data
                AND rg.organizzazione_id = a.organizzazione_id
         WHERE a.persona_id = p.id
         ORDER BY a.data DESC
         LIMIT 1
      )                                                          AS "ultimaAssegnazione",
      (
        -- SS12kkkk: ultimo rango valutato dal motore (data piu recente
        -- di rango_giorno). Copre le persone che il motore ha valutato
        -- ma non ha mai messo in lista (rango > soglia). Indice
        -- (persona_id, data) di schema.sql:317 copre il seek.
        --
        -- totaleValutati letto dentro l'oggetto: e' il conteggio di
        -- rango_giorno per la stessa (org, data) di rg1 — serve a
        -- dire "rango N su 500" e cambia se qualche persona e'
        -- disattivata fra un giro e l'altro.
        SELECT jsonb_build_object(
          'data',           to_char(rg1.data, 'YYYY-MM-DD'),
          'rango',          rg1.rango,
          'punteggio',      rg1.punteggio,
          'totaleValutati', (SELECT count(*)::int FROM riservato.rango_giorno rg2
                              WHERE rg2.organizzazione_id = rg1.organizzazione_id
                                AND rg2.data = rg1.data),
          'valutataOggi',   (rg1.data = ${dataOggi}::date)
        )
          FROM riservato.rango_giorno rg1
         WHERE rg1.persona_id = p.id
         ORDER BY rg1.data DESC
         LIMIT 1
      )                                                          AS "ultimoRangoValutato"
      FROM riservato.persona p
      LEFT JOIN pubblico.sezione s
             ON s.id = p.sezione_id AND NOT s.fittizia
     WHERE p.id = ${personaId}
  `;
  return rows[0] ?? null;
}

/**
 * Segnali di una persona, TUTTI (aperti e chiusi), ordinati per
 * data di apertura crescente. Include il nome del `chiuso_da`
 * risolto via JOIN a `riservato.utente`, così la UI non fa lookup
 * separati per etichetta. `chiusoDaNome` NULL su due casi
 * distinti da dichiarare in UI:
 *   - segnale ancora aperto (`chiuso_il IS NULL`);
 *   - segnale chiuso ma `chiuso_da IS NULL` (chiusura tecnica per
 *     dedup dell'unique parziale §12uuu, non azione umana).
 */
export interface SegnalePersona {
  id: number;
  tipo: string;
  origine: string;
  creatoIl: string;
  validoFino: string | null;
  chiusoIl: string | null;
  chiusoDaId: number | null;
  chiusoDaNome: string | null;
}

export async function segnaliPersona(
  sql: Sql,
  personaId: number,
): Promise<SegnalePersona[]> {
  return await sql<SegnalePersona[]>`
    SELECT
      s.id                                                          AS id,
      s.tipo                                                        AS tipo,
      s.origine                                                     AS origine,
      to_char(s.creato_il AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "creatoIl",
      to_char(s.valido_fino, 'YYYY-MM-DD')                           AS "validoFino",
      to_char(s.chiuso_il AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')  AS "chiusoIl",
      s.chiuso_da                                                   AS "chiusoDaId",
      u.nome                                                        AS "chiusoDaNome"
      FROM riservato.segnale s
      LEFT JOIN riservato.utente u ON u.id = s.chiuso_da
     WHERE s.persona_id = ${personaId}
     ORDER BY s.creato_il ASC
  `;
}

export interface ContattoPersona {
  id: number;
  data: string;
  esito: "sta_bene" | "ha_bisogno" | "non_risponde";
  volontarioId: number | null;
  volontarioNome: string | null;
}

export async function contattiPersona(
  sql: Sql,
  personaId: number,
): Promise<ContattoPersona[]> {
  return await sql<ContattoPersona[]>`
    SELECT
      c.id                                                         AS id,
      to_char(c.data AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS data,
      c.esito                                                      AS esito,
      c.volontario_id                                              AS "volontarioId",
      u.nome                                                       AS "volontarioNome"
      FROM riservato.contatto c
      LEFT JOIN riservato.utente u ON u.id = c.volontario_id
     WHERE c.persona_id = ${personaId}
     ORDER BY c.data DESC
  `;
}

export interface SegnaleAperto {
  segnaleId: number;
  personaId: number;
  idEsterno: string;
  quartiere: string | null;
  tipo: string;                  // 'sintomi_riferiti' | 'ventilatore_rotto'
  origine: string;               // 'volontario' | 'cittadino' | 'mmg' | 'coordinatore'
  creatoIl: string;              // ISO timestamp
  validoFino: string | null;     // 'YYYY-MM-DD' o null (nessuna scadenza a calendario)
  /**
   * True se `valido_fino < dataOggi` (calcolato server-side per non
   * dover propagare `dataOggi` al client). Un segnale scaduto è
   * `chiuso_il IS NULL` ma il motore di scoring non lo conta più
   * (`scoring/src/index.ts:187-190`, filtro `!validoFino || validoFino >= oggi`).
   * L'UI lo mostra in fondo con badge "scaduto il D mese · non pesa
   * più sul punteggio" (§12ttt).
   */
  scaduto: boolean;
  /**
   * Ultimo contatto registrato in `riservato.contatto` con `data`
   * successiva a `creatoIl` del segnale, per la stessa persona.
   * Null se nessun contatto è stato registrato dopo la segnalazione —
   * al coordinatore serve per decidere se chiudere o mandare un altro
   * volontario (§12qqq).
   */
  ultimoEsitoDopo: "sta_bene" | "ha_bisogno" | "non_risponde" | null;
  ultimoContattoDopo: string | null;  // ISO timestamp, o null
  /**
   * True se la persona è nell'assegnazione di oggi (giro attivo).
   * Usato per ordinare: le persone in lista compaiono in cima —
   * sono quelle su cui il coordinatore può agire mandando un
   * volontario. Le altre restano visibili in fondo, non sparite —
   * un sintomo su chi è uscito dalla lista è comunque un caso che
   * vale la pena notare (§12rrr).
   */
  inListaOggi: boolean;
}

/**
 * Segnali di tipo **osservativo** ancora aperti (`chiuso_il IS NULL`),
 * per l'organizzazione indicata. Ridotto in §12sss ai due tipi che
 * un percorso applicativo può effettivamente produrre e che descrivono
 * qualcosa di osservato in un momento e ha senso "chiudere":
 *   - `sintomi_riferiti`   — evento clinico da verificare
 *   - `ventilatore_rotto`  — evento risolvibile (riparazione/sostit.)
 *
 * Escluso in §12sss `nessun_contatto_riferito`: nel modello resta
 * (motore, schema, generatore intatti — vincolo 1), ma nell'app non
 * è producibile da nessun percorso — il modulo del volontario non lo
 * genera (scheda-persona.tsx:33-82), la dashboard può solo chiuderlo,
 * l'agente di triage è stato tagliato (MOD06:45-50). L'unico produttore
 * è il generatore sintetico: in un'istanza reale la card non ne
 * mostrerebbe mai uno. Escluderlo dalla card rende la demo più fedele
 * alla produzione, non meno.
 *
 * Esclusi i tre tipi **strutturali** che il generatore emette con
 * `valido_fino = NULL` e che descrivono il profilo della persona:
 *   - `nessuna_climatizzazione`  — la casa non ha aria condizionata
 *   - `rete_familiare_assente`   — non c'è famiglia che possa aiutare
 *   - `difficolta_mobilita`      — condizione motoria
 * Restano nel motore per il punteggio, sono visibili sulla scheda
 * persona, ma non sono materia della card "Segnalazioni aperte" —
 * non c'è niente da chiudere, non è successo niente.
 *
 * **Segnali SCADUTI** (§12ttt): il filtro WHERE tiene ancora
 * `chiuso_il IS NULL` senza guardare `valido_fino`. Il motore di
 * scoring li scarta già (`scoring/src/index.ts:187-190`), ma la card
 * li mostra in fondo con badge esplicito perché il coordinatore
 * possa comunque chiuderli formalmente. Il flag `scaduto` è
 * calcolato server-side (`(s.valido_fino IS NOT NULL AND s.valido_fino
 * < dataOggi)`) e restituito nella riga. In produzione lo stato
 * "scaduto" non si verifica: `registraContatto` non imposta
 * `valido_fino` (decisione §12rrr, §12ttt), i segnali app-side
 * nascono senza scadenza e non scadono mai — la visibilità dei
 * scaduti serve solo per il canone di demo dove le scadenze le
 * mette il generatore.
 *
 * **ORDER BY** (§12rrr, aggiornato §12sss, §12ttt):
 *   1. non scaduto DESC — attivi prima, scaduti in fondo (§12ttt).
 *      Uno scaduto non pesa più sul punteggio: retrocedere a fondo
 *      card è coerente con la retrocessione già avvenuta nel motore.
 *   2. persona in lista oggi DESC — dentro il blocco attivi (o dentro
 *      il blocco scaduti), prime le persone su cui il coordinatore
 *      può agire mandando un volontario.
 *   3. urgenza del tipo — sintomi_riferiti > ventilatore_rotto
 *      (ordinati per moltiplicatore MOLT_SEGNALE di scoring: 1.45 > 1.18).
 *   4. creato_il DESC — tiebreaker: più recenti prima.
 * Il client raggruppa poi per persona preservando l'ordine di query:
 * il gruppo persona compare dove compare il suo primo segnale, quindi
 * "attivo + in lista + più urgente" domina il posizionamento del gruppo.
 *
 * **LATERAL join** su ultimo contatto: dato che manca oggi per
 * chiudere consapevolmente. Indice `riservato.contatto (persona_id,
 * data DESC)` di schema.sql:207 copre la subquery.
 */
const TIPI_OSSERVATIVI = ["sintomi_riferiti", "ventilatore_rotto"] as const;

export async function segnaliAperti(
  sql: Sql,
  organizzazioneId: number,
  dataOggi: string,
): Promise<SegnaleAperto[]> {
  const rows = await sql<SegnaleAperto[]>`
    SELECT s.id                                     AS "segnaleId",
           p.id                                     AS "personaId",
           p.id_esterno                             AS "idEsterno",
           se.quartiere                             AS quartiere,
           s.tipo                                   AS tipo,
           s.origine                                AS origine,
           to_char(s.creato_il AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
                                                    AS "creatoIl",
           to_char(s.valido_fino, 'YYYY-MM-DD')     AS "validoFino",
           (s.valido_fino IS NOT NULL AND s.valido_fino < ${dataOggi}::date)
                                                    AS scaduto,
           ult.esito                                AS "ultimoEsitoDopo",
           to_char(ult.data AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
                                                    AS "ultimoContattoDopo",
           (a_oggi.persona_id IS NOT NULL)          AS "inListaOggi"
      FROM riservato.segnale s
      JOIN riservato.persona p ON p.id = s.persona_id
      LEFT JOIN pubblico.sezione se
        ON se.id = p.sezione_id AND NOT se.fittizia
      LEFT JOIN LATERAL (
        SELECT c.esito, c.data
          FROM riservato.contatto c
         WHERE c.persona_id = s.persona_id
           AND c.data > s.creato_il
         ORDER BY c.data DESC LIMIT 1
      ) ult ON true
      LEFT JOIN riservato.assegnazione a_oggi
        ON a_oggi.persona_id = p.id
       AND a_oggi.data = ${dataOggi}::date
       AND a_oggi.organizzazione_id = ${organizzazioneId}
     WHERE p.organizzazione_id = ${organizzazioneId}
       AND s.chiuso_il IS NULL
       AND s.tipo IN ${sql(TIPI_OSSERVATIVI)}
     ORDER BY (s.valido_fino IS NULL OR s.valido_fino >= ${dataOggi}::date) DESC,
              (a_oggi.persona_id IS NOT NULL) DESC,
              CASE s.tipo
                WHEN 'sintomi_riferiti'  THEN 1
                WHEN 'ventilatore_rotto' THEN 2
                ELSE 99
              END,
              s.creato_il DESC
     LIMIT 50
  `;
  return rows;
}

export interface ContaSegnaliAperti {
  /** `chiuso_il IS NULL AND (valido_fino IS NULL OR valido_fino >= dataOggi)`. */
  attive: number;
  /** `chiuso_il IS NULL AND valido_fino IS NOT NULL AND valido_fino < dataOggi`. */
  scadute: number;
}

export async function contaSegnaliAperti(
  sql: Sql,
  organizzazioneId: number,
  dataOggi: string,
): Promise<ContaSegnaliAperti> {
  const rows = await sql<Array<{ attive: number; scadute: number }>>`
    SELECT
      count(*) FILTER (
        WHERE s.valido_fino IS NULL OR s.valido_fino >= ${dataOggi}::date
      )::int AS attive,
      count(*) FILTER (
        WHERE s.valido_fino IS NOT NULL AND s.valido_fino < ${dataOggi}::date
      )::int AS scadute
      FROM riservato.segnale s
      JOIN riservato.persona p ON p.id = s.persona_id
     WHERE p.organizzazione_id = ${organizzazioneId}
       AND s.chiuso_il IS NULL
       AND s.tipo IN ${sql(TIPI_OSSERVATIVI)}
  `;
  return rows[0] ?? { attive: 0, scadute: 0 };
}

// ------------------------------------------------------ MOD05 pagina pubblica
//
// Il cittadino sceglie il quartiere via <select> (form GET, no JS) o via
// geolocalizzazione (progressive enhancement, POST /api/quartiere). Il
// profilo del quartiere aggrega dati per sezione: rapporto degli aggregati
// per persone/famiglia e ab/edificio, media pesata sulla popolazione per
// la distanza dal parco, rango del quartiere fra 13 per l'isolamento.
// Vedi §12e per le motivazioni. WHERE NOT fittizia su ogni query di sezione.

export interface QuartiereBase {
  nome: string;
  slug: string;
}

/**
 * Slug URL-friendly dal nome quartiere: lowercase, rimuove punti e
 * apostrofi, sostituisce spazi con "-". Usato come chiave del param `?q=`
 * e come identificatore stabile lato client. Es. "C.S. Martino" → "cs-martino",
 * "S.Leonardo" → "sleonardo", "Parma Centro" → "parma-centro".
 */
export function slugQuartiere(nome: string): string {
  return nome
    .toLowerCase()
    .replace(/[.'']/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export async function elencoQuartieri(
  sql: Sql,
  comuneIstat: string,
): Promise<QuartiereBase[]> {
  const rows = await sql<Array<{ nome: string }>>`
    SELECT DISTINCT quartiere AS nome
      FROM pubblico.sezione
     WHERE comune_istat = ${comuneIstat}
       AND NOT fittizia
       AND tipo_sezione = 1
       AND popolazione > 0
       AND quartiere IS NOT NULL
     ORDER BY quartiere
  `;
  return rows.map((r) => ({ nome: r.nome, slug: slugQuartiere(r.nome) }));
}

export interface ProfiloQuartiere {
  nome: string;
  slug: string;
  sezioniAbitate: number;
  popolazione: number;
  famiglie: number;
  /** SUM(pop21) / SUM(fam21) — media pesata (definizione dell'indicatore). */
  personePerFamiglia: number;
  /** SUM(abi21) / SUM(edi21) — media pesata. */
  abitazioniPerEdificio: number;
  /**
   * SUM(dist × pop) / SUM(pop) sulle sezioni con dato — distanza tipica
   * per la persona media del quartiere. NULL se nessuna sezione ha il dato.
   * Nota: dopo MOD01 (§12c) questo numero conta soprattutto in zone dense;
   * in quartieri rurali "900 m dal parco" non descrive rischio (c'è verde
   * privato). Il microcopy della pagina lo dice.
   */
  distanzaParcoMediaPesata: number | null;
  /** 1..N (1 = più famiglie sole del comune). */
  posizioneIsolamento: number;
  /** Denominatore per il microcopy "N° su M". */
  totaleQuartieri: number;
}

export async function profiloQuartiere(
  sql: Sql,
  comuneIstat: string,
  quartiereSlug: string,
): Promise<ProfiloQuartiere | null> {
  // Calcolo gli aggregati per TUTTI i 13 quartieri (serve il rango fra
  // pari), poi filtro sul quartiere richiesto. Costo trascurabile: 13
  // gruppi su 1.039 sezioni.
  // Slug ricalcolato lato SQL con la stessa logica di `slugQuartiere` (TS):
  // (1) rimuovi punti e apostrofi, (2) lowercase, (3) non-alfanumerici → "-",
  // (4) trim dei dash residui. Deve restare in sincronia con quella TS —
  // se cambia una, deve cambiare l'altra.
  const rows = await sql<Array<{
    nome: string;
    sezioniAbitate: number;
    popolazione: number;
    famiglie: number;
    personePerFamiglia: string;    // numeric arriva come string
    abitazioniPerEdificio: string;
    distanzaParcoMediaPesata: string | null;
    posizioneIsolamento: number;
    totaleQuartieri: number;
  }>>`
    WITH per_quartiere AS (
      SELECT quartiere                                    AS nome,
             trim(both '-' from
               regexp_replace(
                 lower(regexp_replace(quartiere, '[.'']', '', 'g')),
                 '[^a-z0-9]+', '-', 'g'))                 AS slug,
             count(*)::int                                AS "sezioniAbitate",
             SUM(popolazione)::int                        AS popolazione,
             SUM(famiglie)::int                           AS famiglie,
             SUM(popolazione)::numeric
               / NULLIF(SUM(famiglie), 0)                 AS "personePerFamiglia",
             SUM(abitazioni)::numeric
               / NULLIF(SUM(edifici_residenziali), 0)     AS "abitazioniPerEdificio",
             SUM(metri_da_punto_fresco * popolazione)
               FILTER (WHERE metri_da_punto_fresco IS NOT NULL)
               / NULLIF(SUM(popolazione)
                        FILTER (WHERE metri_da_punto_fresco IS NOT NULL), 0)
                                                          AS "distanzaParcoMediaPesata"
        FROM pubblico.sezione
       WHERE comune_istat = ${comuneIstat}
         AND NOT fittizia
         AND tipo_sezione = 1
         AND popolazione > 0
         AND quartiere IS NOT NULL
       GROUP BY quartiere
    ),
    ranghi AS (
      SELECT *,
             rank() OVER (ORDER BY "personePerFamiglia" ASC)::int AS "posizioneIsolamento"
        FROM per_quartiere
    ),
    tot AS (SELECT count(*)::int AS n FROM ranghi)
    SELECT r.nome, r."sezioniAbitate", r.popolazione, r.famiglie,
           r."personePerFamiglia", r."abitazioniPerEdificio",
           r."distanzaParcoMediaPesata", r."posizioneIsolamento",
           tot.n AS "totaleQuartieri"
      FROM ranghi r, tot
     WHERE r.slug = ${quartiereSlug}
  `;
  const r = rows[0];
  if (!r) return null;
  return {
    nome: r.nome,
    slug: slugQuartiere(r.nome),
    sezioniAbitate: r.sezioniAbitate,
    popolazione: r.popolazione,
    famiglie: r.famiglie,
    personePerFamiglia: Number(r.personePerFamiglia),
    abitazioniPerEdificio: Number(r.abitazioniPerEdificio),
    distanzaParcoMediaPesata:
      r.distanzaParcoMediaPesata === null ? null : Number(r.distanzaParcoMediaPesata),
    posizioneIsolamento: Number(r.posizioneIsolamento),
    totaleQuartieri: r.totaleQuartieri,
  };
}

/**
 * Metadati cartografici del comune per l'inizializzazione della mappa
 * pubblica (§12n MOD07 refactor multi-comune): centro geometrico,
 * bounds SW/NE + buffer di 300 m (per il `maxBounds` di MapLibre) e
 * il `minZoom` che inquadra il comune intero nella viewport 734×600
 * (§12i formula z_fit). Sostituisce le costanti `CENTRO_PARMA`,
 * `MAX_BOUNDS_PARMA`, `MIN_ZOOM_PARMA` hardcoded in
 * `components/mappa-pubblica.tsx` — ora sono per-comune, letti dal
 * DB al render della pagina.
 *
 * `WHERE NOT fittizia AND tipo_sezione = 1 AND popolazione > 0` come
 * altrove — il centro/bounds di un comune ignora sezioni fittizie,
 * non-residenziali e disabitate.
 */
export interface MetadatiCartografici {
  /** Centro geometrico del comune, [lng, lat]. */
  centro: [number, number];
  /** Envelope SW/NE lng-lat con buffer 300 m, per `maxBounds`. */
  bounds: [[number, number], [number, number]];
  /** Livello di zoom che inquadra il comune intero (viewport 734×600). */
  minZoom: number;
}

export async function metadatiCartografici(
  sql: Sql,
  comuneIstat: string,
): Promise<MetadatiCartografici | null> {
  const rows = await sql<Array<{
    centroLng: string; centroLat: string;
    swLng: string; swLat: string; neLng: string; neLat: string;
  }>>`
    WITH agg AS (
      SELECT ST_Union(geom) AS g
        FROM pubblico.sezione
       WHERE comune_istat = ${comuneIstat}
         AND NOT fittizia
         AND tipo_sezione = 1
         AND popolazione > 0
    ),
    box AS (
      SELECT ST_Envelope(ST_Buffer(g::geography, 300)::geometry) AS bbox,
             ST_Centroid(g)                                       AS ctr
        FROM agg
       WHERE g IS NOT NULL
    )
    SELECT ST_X(ctr)::text  AS "centroLng",
           ST_Y(ctr)::text  AS "centroLat",
           ST_XMin(bbox)::text AS "swLng",
           ST_YMin(bbox)::text AS "swLat",
           ST_XMax(bbox)::text AS "neLng",
           ST_YMax(bbox)::text AS "neLat"
      FROM box
  `;
  const r = rows[0];
  if (!r) return null;
  const centro: [number, number] = [Number(r.centroLng), Number(r.centroLat)];
  const bounds: [[number, number], [number, number]] = [
    [Number(r.swLng), Number(r.swLat)],
    [Number(r.neLng), Number(r.neLat)],
  ];
  // z_fit su viewport standard 734×600 (§12i): z_horiz e z_vert dalla
  // formula Mercator log2(360·pix / (span_deg · 256)). Uso lo `span_lat`
  // corretto per la latitudine media (proiezione Mercator "stira" il lat
  // andando a nord). Arrotondato in giù a 0.1 per lasciare 1-2 px di
  // cuscinetto verticale — coerente col comportamento manuale a Parma
  // (10.26 → 10.2).
  const VIEWPORT_W = 734;
  const VIEWPORT_H = 600;
  const spanLng = bounds[1][0] - bounds[0][0];
  const latMed = (bounds[0][1] + bounds[1][1]) / 2;
  const spanLatMerc = (bounds[1][1] - bounds[0][1]) / Math.cos((latMed * Math.PI) / 180);
  const zH = Math.log2((360 * VIEWPORT_W) / (spanLng * 256));
  const zV = Math.log2((360 * VIEWPORT_H) / (spanLatMerc * 256));
  const minZoom = Math.floor(Math.min(zH, zV) * 10) / 10;
  return { centro, bounds, minZoom };
}

/**
 * Extent geografico (bounding box) delle sezioni di un quartiere,
 * usato dal client mappa (§12i) per `fitBounds` quando l'utente
 * seleziona un quartiere dal selettore. Restituisce SW/NE lng-lat
 * (formato MapLibre) o `null` se lo slug non esiste.
 *
 * `WHERE NOT fittizia AND tipo_sezione = 1 AND popolazione > 0` per
 * coerenza con `elencoQuartieri` e `profiloQuartiere` — sennò due
 * quartieri con le stesse sezioni residenziali potrebbero avere
 * estent diversi. Slug ricalcolato con la stessa regexp di
 * `slugQuartiere` TS + `profiloQuartiere` SQL (§12i): se cambia
 * una, cambiano tutte e tre.
 *
 * L'output è comunque limitato a monte dal `maxBounds` del comune:
 * un quartiere che occupa quasi tutto il comune (es. Vigatto) fa
 * fitBounds sotto `minZoom = 10.2`, MapLibre clampa e si vede
 * l'intera Parma — comportamento voluto, non un errore.
 */
export async function boundsQuartiere(
  sql: Sql,
  comuneIstat: string,
  quartiereSlug: string,
): Promise<[[number, number], [number, number]] | null> {
  const rows = await sql<Array<{
    swLng: string; swLat: string; neLng: string; neLat: string;
  }>>`
    WITH per_quartiere AS (
      SELECT trim(both '-' from
               regexp_replace(
                 lower(regexp_replace(quartiere, '[.'']', '', 'g')),
                 '[^a-z0-9]+', '-', 'g'))    AS slug,
             ST_Extent(geom)                 AS bbox
        FROM pubblico.sezione
       WHERE comune_istat = ${comuneIstat}
         AND NOT fittizia
         AND tipo_sezione = 1
         AND popolazione > 0
         AND quartiere IS NOT NULL
       GROUP BY quartiere
    )
    SELECT ST_XMin(bbox)::text AS "swLng",
           ST_YMin(bbox)::text AS "swLat",
           ST_XMax(bbox)::text AS "neLng",
           ST_YMax(bbox)::text AS "neLat"
      FROM per_quartiere
     WHERE slug = ${quartiereSlug}
  `;
  const r = rows[0];
  if (!r) return null;
  return [
    [Number(r.swLng), Number(r.swLat)],
    [Number(r.neLng), Number(r.neLat)],
  ];
}

/**
 * Trova il quartiere che contiene il punto (lat, lon). ST_Contains sul
 * poligono della sezione, ricava il quartiere. Restituisce null se il
 * punto cade fuori dalle sezioni non-fittizie del comune (fuori Parma,
 * o in un parco/area industriale senza attributo `quartiere`). Chi chiama
 * mostra al cittadino "sei fuori dal comune di riferimento" con il select
 * come fallback.
 */
export async function quartierePerPunto(
  sql: Sql,
  comuneIstat: string,
  lat: number,
  lon: number,
): Promise<QuartiereBase | null> {
  const rows = await sql<Array<{ nome: string }>>`
    SELECT quartiere AS nome
      FROM pubblico.sezione
     WHERE comune_istat = ${comuneIstat}
       AND NOT fittizia
       AND quartiere IS NOT NULL
       AND ST_Contains(geom, ST_SetSRID(ST_MakePoint(${lon}, ${lat}), 4326))
     LIMIT 1
  `;
  const r = rows[0];
  if (!r) return null;
  return { nome: r.nome, slug: slugQuartiere(r.nome) };
}

/**
 * Chiude un segnale (tipicamente `sintomi_riferiti`) dopo che il
 * coordinatore ha valutato il caso. Il filtro `chiuso_il IS NULL`
 * rende la mutation idempotente: doppio click non riscrive il timestamp.
 */
export async function chiudiSegnale(
  sql: Sql,
  organizzazioneSessione: number,
  segnaleId: number,
  coordinatoreId: number,
): Promise<void> {
  // Fix A (audit isolamento 2026-08-03): verifica che segnale E coordinatore
  // siano della stessa organizzazione. Impedisce che un coordinatore chiuda
  // segnali di persone di un'altra organizzazione.
  await assertAppartiene(sql, organizzazioneSessione, {
    segnaleId,
    volontarioId: coordinatoreId,
  });
  await sql`
    UPDATE riservato.segnale
       SET chiuso_il = now(),
           chiuso_da = ${coordinatoreId}
     WHERE id        = ${segnaleId}
       AND chiuso_il IS NULL
  `;
}

// ------------------------------ MOD05 BLOCCO 4 — vector tiles (MVT)

/**
 * MVT per la mappa pubblica. `ST_AsMVT` di `pubblico.v_mappa` — le 1.039
 * sezioni residenziali abitate di Parma con il loro `punteggio` (§12e).
 * Reprojection 4326 → 3857 fatta lato DB, buffer 64 per evitare seam
 * fra tile, `clip_geom = true` per non trasmettere geometria fuori
 * dall'envelope.
 *
 * Bytes grezzi (Uint8Array) restituiti al chiamante, che li serve con
 * `Content-Type: application/vnd.mapbox-vector-tile`. `punteggio IS NOT
 * NULL` esclude sezioni non ancora punteggiate (prima del primo carica)
 * — sulla mappa pubblica compaiono solo poligoni con dato.
 */
export async function mvtSezioni(
  sql: Sql,
  comuneIstat: string,
  z: number, x: number, y: number,
): Promise<Uint8Array> {
  const rows = await sql<Array<{ mvt: Buffer }>>`
    WITH bounds AS (
      SELECT ST_TileEnvelope(${z}::int, ${x}::int, ${y}::int) AS geom
    ),
    tile AS (
      SELECT v.id,
             v.quartiere,
             v.punteggio,
             ST_AsMVTGeom(
               ST_Transform(v.geom, 3857),
               bounds.geom,
               4096, 64, true
             ) AS geom
        FROM pubblico.v_mappa v, bounds
       WHERE v.comune_istat = ${comuneIstat}
         AND v.geom && ST_Transform(bounds.geom, 4326)
         AND v.punteggio IS NOT NULL
    )
    SELECT ST_AsMVT(tile.*, 'sezioni', 4096, 'geom') AS mvt
      FROM tile
     WHERE geom IS NOT NULL
  `;
  const buf = rows[0]?.mvt;
  return buf ? new Uint8Array(buf) : new Uint8Array(0);
}

/**
 * MVT per il layer dei punti freschi sulla mappa pubblica. Layer chiamato
 * `punti_freschi` — rotta separata da `sezioni` perché la visibilità per
 * zoom è diversa (i tipi densi si mostrano solo a zoom alto, gestito lato
 * client) e la cache può avere TTL diverso in futuro.
 *
 * Properties esposte al client MapLibre:
 *   id, tipo, categoria, fascia_oraria, priorita, livello_sosta (1..5),
 *   nome, orari, accessibile, fonte, indirizzo.
 *
 * `livello_sosta` è un intero 1..5 derivato dalla categoria — comodità per
 * il client che filtra/stila per soglia di zoom, senza dover confrontare
 * stringhe enum. La mappatura vive qui (non nello schema) perché è una
 * lente di visualizzazione: se la mappa dovesse cambiare il criterio di
 * priorità visiva senza toccare i dati, si tocca solo questo CASE.
 */
export async function mvtPuntiFreschi(
  sql: Sql,
  comuneIstat: string,
  z: number, x: number, y: number,
): Promise<Uint8Array> {
  const rows = await sql<Array<{ mvt: Buffer }>>`
    WITH bounds AS (
      SELECT ST_TileEnvelope(${z}::int, ${x}::int, ${y}::int) AS geom
    ),
    tile AS (
      SELECT p.id, p.tipo, p.categoria,
             p.fascia_oraria AS fascia_oraria,
             p.priorita,
             CASE p.categoria
               WHEN 'rifugio'      THEN 1
               WHEN 'sosta_fresca' THEN 2
               WHEN 'ombra_aperta' THEN 3
               WHEN 'acqua'        THEN 4
               WHEN 'ripiego'      THEN 5
             END AS livello_sosta,
             p.nome, p.orari, p.accessibile, p.fonte, p.indirizzo,
             ST_AsMVTGeom(
               ST_Transform(p.geom, 3857),
               bounds.geom,
               4096, 64, true
             ) AS geom
        FROM pubblico.punto_fresco p
        JOIN pubblico.sezione s ON s.id = p.sezione_id, bounds
       WHERE s.comune_istat = ${comuneIstat}
         AND p.geom && ST_Transform(bounds.geom, 4326)
    )
    SELECT ST_AsMVT(tile.*, 'punti_freschi', 4096, 'geom') AS mvt
      FROM tile
     WHERE geom IS NOT NULL
  `;
  const buf = rows[0]?.mvt;
  return buf ? new Uint8Array(buf) : new Uint8Array(0);
}

// ------------------------------ MOD06: punti freschi per quartiere

export type TipoPuntoFresco =
  | "biblioteca" | "farmacia" | "centro_commerciale" | "centro_sociale"
  | "chiesa" | "fontanella" | "parco" | "casetta_iren";

export type CategoriaPuntoFresco =
  | "rifugio"        // chiuso + AC, ore lunghe: biblioteca, CC, centro sociale
  | "sosta_fresca"   // chiuso + AC, sosta breve: farmacia
  | "ombra_aperta"   // parco (utile solo mattina/sera)
  | "acqua"          // casetta_iren, fontanella
  | "ripiego";       // chiesa (massa muraria, orari incerti)

export type FasciaOraria = "giorno_intero" | "mattina_sera";

export interface PuntoFrescoVicino {
  id: number;
  tipo: TipoPuntoFresco;
  categoria: CategoriaPuntoFresco;
  /**
   * Quando è utile come punto fresco (non "quando è aperto" — quello sta
   * in `orari`). L'agente filtra `mattina_sera` fra le 11 e le 18: un
   * parco a mezzogiorno non sostituisce un ambiente chiuso per un anziano
   * anche se è aperto.
   */
  fasciaOraria: FasciaOraria;
  /** 1 = alto, dentro la categoria. Definito nello schema, non dall'agente. */
  priorita: number;
  nome: string | null;
  indirizzo: string | null;
  /** Stringa OSM opening_hours grezza. L'agente la interpreta o dice "verifica". */
  orari: string | null;
  /** OSM wheelchair: yes/no/limited/designated. NULL se il tag manca. */
  accessibile: string | null;
  /**
   * Aria condizionata certificata dal gestore (dataset comunali). NULL =
   * dato non ricevuto (OSM non ha questo attributo). true/false = valore
   * dal dataset (es. biblioteche del Comune di Bologna). L'agente lo usa
   * come informazione ricevuta, non come attributo da inventare.
   */
  ariaCondi: boolean | null;
  fonte: "osm" | "iren" | "comune";
  /** Metri dal centroide del quartiere richiesto, misurati via geography. */
  distanzaMetri: number;
  /** True se il punto ricade dentro il quartiere richiesto stesso. */
  quartiereProprio: boolean;
  /**
   * Quartiere in cui ricade fisicamente il punto (colonna denormalizzata
   * `pubblico.punto_fresco.quartiere`, valorizzata al carico). Utile
   * all'agente quando `quartiereProprio = false` per dire "nel quartiere
   * X" invece di generico "in un altro quartiere".
   */
  quartiereDelPunto: string | null;
}

/**
 * I punti freschi più vicini al centroide del quartiere, top `nPerTipo`
 * per ciascuno degli 8 tipi. Distanza in metri via `geography` (con
 * `geometry` l'errore è silenzioso e i metri sono sbagliati — vedi
 * CLAUDE.md "Geospaziale").
 *
 * Il centroide del quartiere è calcolato sulle sole sezioni residenziali
 * abitate (`tipo_sezione = 1 AND popolazione > 0`), coerente con
 * `profiloQuartiere` e `boundsQuartiere`. Un quartiere che estende oltre
 * l'abitato (Vigatto) ha centroide baricentrato sull'abitato, non sui
 * campi.
 *
 * L'output è ordinato per (categoria, priorita, distanza): l'agente lo
 * riceve pronto per essere raggruppato per categoria — chi ha sete legge
 * "acqua" (casetta Iren prima, fontanella dopo), chi vuole stare al
 * fresco per ore legge "rifugio" (biblioteca e centro commerciale pari
 * per priorita, centro sociale un gradino sotto).
 *
 * `fasciaOraria` è restituita ma non filtrata a livello DB: la finestra
 * "sconsigliato fra le 11 e le 18" dipende dall'ora corrente della
 * richiesta, e la applica l'agente al momento di comporre l'output.
 * Vincoli §12k: l'agente cita solo ciò che è qui, non inventa distanze
 * né orari; se `orari` è NULL dice "verifica gli orari"; se
 * `fasciaOraria = mattina_sera` e l'ora corrente cade fra 11 e 18, non
 * propone il punto (le raccomandazioni sanitarie dicono di stare al
 * chiuso in quelle ore).
 */
/**
 * I punti freschi più vicini a un punto (lat, lon) — usato dalla pagina
 * pubblica quando l'utente ha dato la geolocalizzazione: sotto il testo
 * dell'agente compare "vicino a te", con distanze in metri reali dal
 * punto esatto (non dal centroide del quartiere) e link alle indicazioni
 * stradali. Il testo dell'agente parla del quartiere; questo elenco
 * parla di dove sei adesso.
 *
 * Restituisce fino a `nMax` punti in totale, ordinati per distanza
 * crescente — non top-N-per-tipo come `puntiFreschiPerQuartiere` (che
 * serve all'agente a mostrare varietà). Qui l'ordine geografico puro è
 * la cosa utile: se le 5 cose più vicine sono 3 farmacie e 2 chiese,
 * questo elenco lo dice così.
 *
 * `quartiereDelPunto` restituito ma non usato per filtrare — un utente
 * geolocalizzato al confine fra quartieri vede legittimamente cose in
 * entrambi.
 */
/** Come `PuntoFrescoVicino` + lat/lon del punto per link mappa. */
export interface PuntoFrescoConCoord extends PuntoFrescoVicino {
  lat: number;
  lon: number;
}

export async function puntiFreschiPerCoordinate(
  sql: Sql,
  comuneIstat: string,
  lat: number,
  lon: number,
  nMax = 8,
): Promise<PuntoFrescoConCoord[]> {
  // Fix C (audit isolamento 2026-08-03): la versione precedente aveva
  // `AND ${comuneIstat}::text IS NOT NULL`, tautologia che non
  // restringeva alcunché. Ora il JOIN con `pubblico.sezione` restringe i
  // punti al comune richiesto (la colonna comune vive sulla sezione).
  const rows = await sql<Array<PuntoFrescoVicino & { lat: string; lon: string }>>`
    WITH me AS (
      SELECT ST_SetSRID(ST_MakePoint(${lon}::double precision,
                                     ${lat}::double precision), 4326) AS geom
    )
    SELECT p.id, p.tipo, p.categoria,
           p.fascia_oraria                                        AS "fasciaOraria",
           p.priorita,
           p.nome, p.indirizzo, p.orari, p.accessibile,
           p.aria_condi                                           AS "ariaCondi",
           p.fonte,
           ST_Distance(me.geom::geography, p.geom::geography)::int AS "distanzaMetri",
           false                                                   AS "quartiereProprio",
           p.quartiere                                            AS "quartiereDelPunto",
           ST_Y(p.geom)::text                                     AS lat,
           ST_X(p.geom)::text                                     AS lon
      FROM pubblico.punto_fresco p
      JOIN pubblico.sezione s ON s.id = p.sezione_id, me
     WHERE p.geom IS NOT NULL
       AND s.comune_istat = ${comuneIstat}
     ORDER BY me.geom::geography <-> p.geom::geography
     LIMIT ${nMax}
  `;
  return rows.map((r) => ({ ...r, lat: Number(r.lat), lon: Number(r.lon) }));
}

export async function puntiFreschiPerQuartiere(
  sql: Sql,
  comuneIstat: string,
  nomeQuartiere: string,
  nPerTipo = 3,
): Promise<PuntoFrescoVicino[]> {
  return await sql<PuntoFrescoVicino[]>`
    WITH q AS (
      SELECT ST_Centroid(ST_Collect(geom)) AS centro,
             quartiere
        FROM pubblico.sezione
       WHERE comune_istat = ${comuneIstat}
         AND NOT fittizia
         AND tipo_sezione = 1
         AND popolazione > 0
         AND quartiere = ${nomeQuartiere}
       GROUP BY quartiere
    ),
    ranked AS (
      -- Fix D (audit isolamento 2026-08-03): aggiunto JOIN con sezione +
      -- filtro comune_istat sul CTE 'ranked'; prima la SELECT scorreva
      -- TUTTI i punti freschi (di ogni comune) e li ordinava per distanza
      -- dal centroide. Innocuo finora perché Parma e Bologna sono a 80
      -- km, ma latente.
      SELECT p.id, p.tipo, p.categoria,
             p.fascia_oraria                                        AS "fasciaOraria",
             p.priorita,
             p.nome, p.indirizzo, p.orari, p.accessibile, p.aria_condi AS "ariaCondi", p.fonte,
             ST_Distance(q.centro::geography, p.geom::geography)::int
                                                                   AS "distanzaMetri",
             (p.quartiere = q.quartiere)                           AS "quartiereProprio",
             p.quartiere                                           AS "quartiereDelPunto",
             row_number() OVER (
               PARTITION BY p.tipo
               ORDER BY ST_Distance(q.centro::geography, p.geom::geography)
             )                                                     AS rn
        FROM pubblico.punto_fresco p
        JOIN pubblico.sezione s ON s.id = p.sezione_id, q
       WHERE s.comune_istat = ${comuneIstat}
    )
    SELECT id, tipo, categoria, "fasciaOraria", priorita,
           nome, indirizzo, orari, accessibile, "ariaCondi", fonte,
           "distanzaMetri", "quartiereProprio", "quartiereDelPunto"
      FROM ranked
     WHERE rn <= ${nPerTipo}
     ORDER BY categoria, priorita, "distanzaMetri"
  `;
}

/**
 * Punti freschi più vicini al centroide di un quartiere, ordinati per
 * distanza puramente (nessuna partizione per tipo). Serve all'elenco
 * sotto la mappa quando l'utente sceglie un quartiere dal menu (§12aa,
 * miglioramento 3/3 del brief mockup). Distinta da `puntiFreschiPerQuartiere`
 * che partiziona per tipo e restituisce top-N di ciascuno (input dell'agente
 * consulente): qui il consumo è un elenco flat top-N globale, con lat/lon
 * per costruire il link a OSRM pedone come nel caso `puntiFreschiPerCoordinate`.
 *
 * Il centroide del quartiere è calcolato sulle sezioni residenziali abitate
 * (tipo_sezione=1, popolazione>0, NOT fittizia) — stessa regola di
 * `puntiFreschiPerQuartiere` per coerenza fra "centro del quartiere" nei
 * due contesti.
 */
export async function puntiFreschiPerCentroQuartiere(
  sql: Sql,
  comuneIstat: string,
  nomeQuartiere: string,
  nMax = 20,
): Promise<PuntoFrescoConCoord[]> {
  const rows = await sql<Array<PuntoFrescoVicino & { lat: string; lon: string }>>`
    WITH q AS (
      SELECT ST_Centroid(ST_Collect(geom)) AS centro,
             quartiere
        FROM pubblico.sezione
       WHERE comune_istat = ${comuneIstat}
         AND NOT fittizia
         AND tipo_sezione = 1
         AND popolazione > 0
         AND quartiere = ${nomeQuartiere}
       GROUP BY quartiere
    )
    SELECT p.id, p.tipo, p.categoria,
           p.fascia_oraria                                        AS "fasciaOraria",
           p.priorita,
           p.nome, p.indirizzo, p.orari, p.accessibile,
           p.aria_condi                                           AS "ariaCondi",
           p.fonte,
           ST_Distance(q.centro::geography, p.geom::geography)::int
                                                                  AS "distanzaMetri",
           (p.quartiere = q.quartiere)                            AS "quartiereProprio",
           p.quartiere                                            AS "quartiereDelPunto",
           ST_Y(p.geom)::text                                     AS lat,
           ST_X(p.geom)::text                                     AS lon
      FROM pubblico.punto_fresco p
      JOIN pubblico.sezione s ON s.id = p.sezione_id, q
     WHERE p.geom IS NOT NULL
       AND s.comune_istat = ${comuneIstat}
     ORDER BY q.centro::geography <-> p.geom::geography
     LIMIT ${nMax}
  `;
  return rows.map((r) => ({ ...r, lat: Number(r.lat), lon: Number(r.lon) }));
}

// ================================================ §12w — genera giro del giorno
//
// Blocco autoportante: legge persone/segnali/allerta/soglia dal DB,
// calcola classifica con @checaldo/scoring, distribuisce ai volontari
// rispettando le protette (persone già contattate oggi). Chiamato sia
// dal batch `carica-nel-db.ts` (dopo l'import CSV) sia dalla server
// action "Genera il giro di oggi" della dashboard coordinatore. Una
// sola fonte di verità: se batch e UI facessero cose diverse, un
// giorno divergerebbero.

/**
 * Persone attive di un'organizzazione arricchite di segnali validi e
 * tentativi falliti consecutivi — l'input di `classificaPersone`.
 * Estratto dal caricaPersone di `packages/fixtures/scripts/carica-nel-db.ts`
 * per riuso fra script batch e server action (§12w).
 */
export async function personePerClassifica(
  sql: Sql,
  organizzazioneId: number,
  dataOggi: string,
): Promise<Persona[]> {
  const rows = await sql<Array<{
    id: number; idEsterno: string; sezioneId: string;
    annoNascita: number | null; viveSolo: boolean | null;
    segnalatoDaMmg: boolean;
    dataUltimoContatto: string | null;
  }>>`
    SELECT id AS id, id_esterno AS "idEsterno", sezione_id AS "sezioneId",
           anno_nascita AS "annoNascita", vive_solo AS "viveSolo",
           segnalato_da_mmg AS "segnalatoDaMmg",
           to_char(data_ultimo_contatto, 'YYYY-MM-DD') AS "dataUltimoContatto"
      FROM riservato.persona
     WHERE organizzazione_id = ${organizzazioneId} AND attiva = true
  `;
  const tentMap = await tentativiFallitiConsecutivi(sql, organizzazioneId, dataOggi);
  const sig = await sql<Array<{
    personaEsterno: string; tipo: TipoSegnale;
    origine: string; validoFino: string | null;
  }>>`
    SELECT p.id_esterno AS "personaEsterno", s.tipo AS tipo, s.origine AS origine,
           to_char(s.valido_fino, 'YYYY-MM-DD') AS "validoFino"
      FROM riservato.segnale s
      JOIN riservato.persona p ON p.id = s.persona_id
     WHERE p.organizzazione_id = ${organizzazioneId}
       AND s.chiuso_il IS NULL
       AND (s.valido_fino IS NULL OR s.valido_fino >= ${dataOggi}::date)
  `;
  const segMap = new Map<string, SegnaleAttivo[]>();
  for (const s of sig) {
    const arr = segMap.get(s.personaEsterno) ?? [];
    const sa: SegnaleAttivo = {
      tipo: s.tipo,
      origine: s.origine as SegnaleAttivo["origine"],
    };
    if (s.validoFino) sa.validoFino = s.validoFino;
    arr.push(sa);
    segMap.set(s.personaEsterno, arr);
  }
  return rows.map((r): Persona => {
    const p: Persona = { idEsterno: r.idEsterno, sezioneId: r.sezioneId };
    if (r.annoNascita !== null) p.annoNascita = r.annoNascita;
    if (r.viveSolo !== null) p.viveSolo = r.viveSolo;
    if (r.segnalatoDaMmg) p.segnalatoDaMmg = true;
    // §12jjj: popolare dataUltimoContatto sull'oggetto Persona attiva
    // il fattore `giorni_da_ultimo_contatto` nel motore. Il campo era
    // caricato ma non popolato qui — quindi il fattore restava
    // dormiente. NULL in DB → undefined qui → nel motore giorniDa()
    // ritorna undefined → fattore non applicato (comportamento neutro).
    if (r.dataUltimoContatto !== null) p.dataUltimoContatto = r.dataUltimoContatto;
    const segs = segMap.get(r.idEsterno);
    if (segs && segs.length > 0) p.segnali = segs;
    const t = tentMap.get(r.id);
    if (t !== undefined && t > 0) p.tentativiFalliti = t;
    return p;
  });
}

/**
 * Riallinea la soglia salvata alla capienza suggerita dal livello di
 * allerta corrente. Chiamato dal pulsante "Riallinea" della dashboard
 * quando `soglia.livelloAlSalvataggio ≠ allerta.livello`. Aggiorna solo
 * `riservato.soglia_giorno`: NON tocca le assegnazioni — se il
 * coordinatore vuole il giro nuovo, deve premere "Genera il giro".
 *
 * `livello_al_salvataggio` scritto al livello corrente, così la banda
 * di divergenza scompare dopo il click e lo slider mostra il nuovo
 * valore alla prossima render (`revalidatePath` dalla server action).
 */
export async function riallineaSoglia(
  sql: Sql,
  organizzazioneId: number,
  dataOggi: string,
  coordinatoreId: number,
): Promise<{ vecchioValore: number | null; nuovoValore: number; livello: number }> {
  const comuneIstat = await comuneDellOrganizzazione(sql, organizzazioneId);
  if (!comuneIstat) {
    throw new Error(`organizzazione ${organizzazioneId} senza comune_istat`);
  }
  const allertaRiga = await allertaDelGiorno(sql, comuneIstat, dataOggi);
  if (!allertaRiga) {
    throw new Error(
      `nessuna allerta per ${comuneIstat} al ${dataOggi}: non si può riallineare`,
    );
  }
  const allerta: Allerta = {
    livello: allertaRiga.livello,
    provenienza: allertaRiga.provenienza,
    data: allertaRiga.data,
    orizzonteOre: 24,
    nottiTropicali: allertaRiga.nottiTropicali,
  };
  const vRows = await sql<Array<{ n: number }>>`
    SELECT count(*)::int AS n FROM riservato.utente
     WHERE organizzazione_id = ${organizzazioneId}
       AND ruolo = 'volontario' AND attivo = true
  `;
  const nVolontari = vRows[0]?.n ?? 0;
  const nuovoValore = capienzaSuggerita(allerta, nVolontari);
  const vecchie = await sql<Array<{ valore: number }>>`
    SELECT valore FROM riservato.soglia_giorno
     WHERE organizzazione_id = ${organizzazioneId} AND data = ${dataOggi}::date
  `;
  const vecchioValore = vecchie[0]?.valore ?? null;
  await sql`
    INSERT INTO riservato.soglia_giorno
      (organizzazione_id, data, valore, impostata_da, livello_al_salvataggio)
    VALUES
      (${organizzazioneId}, ${dataOggi}::date, ${nuovoValore},
       ${coordinatoreId}, ${allerta.livello})
    ON CONFLICT (organizzazione_id, data) DO UPDATE
      SET valore = EXCLUDED.valore,
          impostata_da = EXCLUDED.impostata_da,
          livello_al_salvataggio = EXCLUDED.livello_al_salvataggio,
          impostata_il = now()
  `;
  return { vecchioValore, nuovoValore, livello: allerta.livello };
}

export interface RisultatoGiro {
  totaleAssegnate: number;
  protette: number;
  nuoveAssegnate: number;
  sogliaUsata: number;
  livelloUsato: number;
  // §12jjjjj — `volontariAttivi` è l'anagrafe (utente.attivo=true),
  // `volontariDiTurno` è chi lavora oggi (attivi ∧ non in pausa
  // oggi). `generaGiroDelGiorno` distribuisce su volontariDiTurno,
  // non su volontariAttivi.
  volontariAttivi: number;
  volontariDiTurno: number;
  // §12iiiii — Continuità volontario↔persona fra giorni diversi.
  //   conStoria = persone della lista di oggi (non-protette) con
  //     almeno un contatto passato riuscito (`sta_bene`/`ha_bisogno`)
  //     e `volontario_id NOT NULL`. Somma dei quattro sotto-esiti.
  //   legameOttenuto = pass 1: assegnate al vol storico.
  //   legamePersoVolNonDisponibile (§12jjjjj: rinominato da
  //     `legamePersoVolInattivo`) = vol storico oggi non disponibile,
  //     due sotto-casi: (a) `attivo=false` — non lavora più con
  //     l'organizzazione; (b) `pausa oggi` — attivo ma non di turno
  //     per questa data. Entrambi hanno la stessa conseguenza:
  //     legame salta, persona va altrove. Un contatore per non
  //     duplicare l'interfaccia; la query su `pausa_volontario` per
  //     data dice esattamente chi era in pausa se serve distinguere.
  //   legamePersoCapProtette = vol storico saturo (≥ CAP) di sole
  //     protette (ha già lavorato tanto oggi).
  //   legamePersoCapLegami = vol storico pieno per combinazione di
  //     protette + legami più prioritari (rango minore ha vinto).
  conStoria: number;
  legameOttenuto: number;
  legamePersoVolNonDisponibile: number;
  legamePersoCapProtette: number;
  legamePersoCapLegami: number;
  // §12jjjjj — Persone della classifica in lista oggi (posizione ≤
  // sogliaUsata) che NON hanno ricevuto assegnazione perché il cap
  // dei volontari di turno era saturato. Zero nel caso normale
  // (sogliaUsata ≤ volontariDiTurno × CAP_PER_VOLONTARIO). > 0
  // segnala che la banda `sogliaSuperaCapPosti` deve mostrarsi in
  // dashboard e che il log del cron deve riportarlo. Decisione:
  // generazione parziale + banda esplicita, non fail-hard, per non
  // fermare il cron del mattino con "zero contatti".
  nonAssegnatePerCapSaturato: number;
}

const CAP_PER_VOLONTARIO = 6;

/**
 * §12iiiii — Per ogni persona dell'organizzazione, restituisce l'id
 * del volontario che l'ha contattata con esito RIUSCITO più di recente,
 * escludendo il giorno corrente.
 *
 * "Riuscito" = `esito IN ('sta_bene','ha_bisogno')`. `non_risponde`
 * non lega (nessuno ha parlato con nessuno). Valori esatti dal CHECK
 * di `riservato.contatto` (`packages/db/schema.sql:249`).
 *
 * Esclude oggi (`data::date < dataOggi`): la continuità disegnata
 * per §12iiiii vive **fra giorni diversi**. Chi ha già un contatto
 * oggi è coperto dalla carve-out "protette" del §12w in
 * `generaGiroDelGiorno`.
 *
 * Filtra `volontario_id IS NOT NULL`: i contatti storici pre-app
 * possono avere NULL (schema `riservato.contatto` colonna nullable
 * per compatibilità); il brief §12iiiii li conta come "nessuna
 * storia" e li lascia al round-robin normale.
 *
 * Indice `contatto_persona_id_data_idx (persona_id, data DESC)`
 * copre `DISTINCT ON (persona_id) ORDER BY persona_id, data DESC`.
 *
 * Ritorno: Map (personaId numerico) → volontarioId. Persone senza
 * storia non compaiono nella mappa (nessuna chiave); la
 * distribuzione le tratta come "no legame".
 */
export async function ultimoVolontarioRiuscitoPerPersona(
  sql: Sql,
  organizzazioneId: number,
  dataOggi: string,
): Promise<Map<number, number>> {
  const rows = await sql<Array<{ personaId: number; volontarioId: number }>>`
    SELECT DISTINCT ON (c.persona_id)
           c.persona_id     AS "personaId",
           c.volontario_id  AS "volontarioId"
      FROM riservato.contatto c
      JOIN riservato.persona p ON p.id = c.persona_id
     WHERE p.organizzazione_id = ${organizzazioneId}
       AND c.esito IN ('sta_bene', 'ha_bisogno')
       AND c.volontario_id IS NOT NULL
       AND c.data::date < ${dataOggi}::date
     ORDER BY c.persona_id, c.data DESC
  `;
  return new Map(rows.map((r) => [r.personaId, r.volontarioId]));
}

/**
 * Genera il giro del giorno per un'organizzazione: legge lo stato del
 * DB, calcola la classifica, distribuisce ai volontari. È l'operazione
 * core del sistema, condivisa fra il batch (`carica-nel-db.ts` dopo
 * l'import CSV) e la server action "Genera il giro di oggi" della
 * dashboard coordinatore.
 *
 * **Regola delle protette (§12w)**: le persone che oggi hanno già
 * almeno un contatto registrato **e** sono attualmente assegnate a un
 * volontario dell'org restano nel giro con la loro assegnazione
 * originale — anche se con la nuova classifica cadrebbero fuori. Motivo:
 * un volontario che ha già chiamato qualcuno non deve vederselo sparire
 * dalla lista sotto le mani; e avere un `contatto` in DB su una persona
 * che il sistema "non ha mai assegnato" rende la cronologia incoerente.
 *
 * **Scope organizzazione su ogni scrittura** (§12u + §12w):
 * - `riservato.assegnazione`: DELETE include `AND organizzazione_id = X`
 *   e `AND persona_id != ALL(protette)` — fix del bug del 2026-08-04
 *   per cui `carica --org 2` cancellava le assegnazioni di `--org 1`.
 * - `riservato.rango_giorno`: DELETE già scopato (schema con PK
 *   composita), invariante mantenuto.
 * - `pubblico.punteggio_sezione`: no DELETE, solo UPSERT per
 *   `(sezione_id, data)` — comune-scoped per costruzione dal loop.
 *
 * Transazione unica: se una delle tre scritture fallisce, nessuna delle
 * altre resta a metà (`sql.begin`).
 *
 * Fail-hard se manca allerta per la data (`allertaDelGiorno` null) o
 * non ci sono volontari attivi. Nessun livello di ripiego, nessun
 * assegnamento vuoto silenzioso.
 */
export async function generaGiroDelGiorno(
  sql: Sql,
  organizzazioneId: number,
  dataOggi: string,
): Promise<RisultatoGiro> {
  const comuneIstat = await comuneDellOrganizzazione(sql, organizzazioneId);
  if (!comuneIstat) {
    throw new Error(`organizzazione ${organizzazioneId} senza comune_istat`);
  }
  const allertaRiga = await allertaDelGiorno(sql, comuneIstat, dataOggi);
  if (!allertaRiga) {
    throw new Error(
      `nessuna allerta in pubblico.allerta per ${comuneIstat} al ${dataOggi}`,
    );
  }
  const allerta: Allerta = {
    livello: allertaRiga.livello,
    provenienza: allertaRiga.provenienza,
    data: allertaRiga.data,
    orizzonteOre: 24,
    nottiTropicali: allertaRiga.nottiTropicali,
  };

  // §12jjjjj — Anagrafe (attivi in generale): usata solo per il
  // conteggio in RisultatoGiro e per il messaggio d'errore. La
  // distribuzione va sui vol DI TURNO oggi (attivi ∧ non in pausa
  // per `dataOggi`). Un volontario attivo ma in pausa oggi non
  // riceve assegnazioni.
  const volontariAttiviRows = await sql<{ id: number }[]>`
    SELECT id FROM riservato.utente
     WHERE organizzazione_id = ${organizzazioneId}
       AND ruolo = 'volontario' AND attivo = true
     ORDER BY email
  `;
  const volontari = await sql<{ id: number }[]>`
    SELECT u.id FROM riservato.utente u
     WHERE u.organizzazione_id = ${organizzazioneId}
       AND u.ruolo = 'volontario' AND u.attivo = true
       AND NOT EXISTS (
         SELECT 1 FROM riservato.pausa_volontario p
          WHERE p.volontario_id = u.id AND p.data = ${dataOggi}::date
       )
     ORDER BY u.email
  `;
  if (volontari.length === 0) {
    // Distinguo i due casi nel messaggio: "nessun attivo" è un
    // problema di anagrafe (org appena installata, tutti dimessi),
    // "tutti in pausa" è un problema operativo del giorno (coord
    // ha messo in pausa tutti o dimenticato di riprenderne uno).
    // Il coord vede due messaggi diversi e sa dove intervenire.
    if (volontariAttiviRows.length === 0) {
      throw new Error(`nessun volontario attivo per org ${organizzazioneId}`);
    }
    throw new Error(
      `nessun volontario di turno per org ${organizzazioneId} in ${dataOggi}: `
      + `${volontariAttiviRows.length} attivi ma tutti in pausa`,
    );
  }

  // Soglia: se esiste, si rispetta il valore che il coordinatore (o il
  // batch precedente) ha scelto. Se manca, default via capienzaSuggerita
  // e scrittura con impostata_da NULL + livello_al_salvataggio corrente.
  const sogliaRows = await sql<Array<{ valore: number }>>`
    SELECT valore FROM riservato.soglia_giorno
     WHERE organizzazione_id = ${organizzazioneId} AND data = ${dataOggi}::date
  `;
  let soglia: number;
  if (sogliaRows.length > 0) {
    soglia = sogliaRows[0]!.valore;
  } else {
    soglia = capienzaSuggerita(allerta, volontari.length);
    await sql`
      INSERT INTO riservato.soglia_giorno
        (organizzazione_id, data, valore, impostata_da, livello_al_salvataggio)
      VALUES
        (${organizzazioneId}, ${dataOggi}::date, ${soglia},
         NULL, ${allerta.livello})
      ON CONFLICT (organizzazione_id, data) DO NOTHING
    `;
  }

  const sezioni = await sql<Sezione[]>`
    SELECT
      id                                          AS id,
      quartiere                                   AS quartiere,
      popolazione                                 AS popolazione,
      famiglie                                    AS famiglie,
      abitazioni                                  AS abitazioni,
      edifici_residenziali                        AS "edificiResidenziali",
      tipo_sezione                                AS "tipoSezione",
      metri_da_punto_fresco                       AS "metriDaPuntoFresco",
      delta_termico                               AS "deltaTermico"
    FROM pubblico.sezione
   WHERE comune_istat = ${comuneIstat} AND NOT fittizia
  `;
  if (sezioni.length === 0) {
    throw new Error(
      `pubblico.sezione vuota per ${comuneIstat}: caricare gli attributi ISTAT prima`,
    );
  }

  const persone = await personePerClassifica(sql, organizzazioneId, dataOggi);
  const valutate = valutaSezioni(sezioni);
  const quartierePerId = new Map(valutate.map((s) => [s.id, s.quartiere ?? "n.d."]));

  const classifica = classificaPersone(persone, valutate, {
    allerta,
    soglia,
    oggi: new Date(dataOggi + "T00:00:00Z"),
  });

  // Mappa idEsterno ↔ id numerico per join a riservato.persona.
  const idPersone = await sql<Array<{ id: number; idEsterno: string }>>`
    SELECT id, id_esterno AS "idEsterno" FROM riservato.persona
     WHERE organizzazione_id = ${organizzazioneId} AND attiva = true
  `;
  const idPerEsterno = new Map(idPersone.map((r) => [r.idEsterno, r.id]));
  const esternoPerId = new Map(idPersone.map((r) => [r.id, r.idEsterno]));

  // Protette: persone con almeno un contatto oggi già assegnate all'org.
  // Query fatta contro riservato.assegnazione ∩ contatto per essere
  // sicuri di lavorare su chi era realmente in lista quando è stato
  // chiamato (non su un contatto "orfano" registrato per errore).
  const protetteRows = await sql<Array<{
    personaId: number; volontarioId: number; posizione: number;
    rangoGlobale: number | null; azione: string; fattori: unknown;
  }>>`
    SELECT DISTINCT ON (a.persona_id)
           a.persona_id       AS "personaId",
           a.volontario_id    AS "volontarioId",
           a.posizione        AS posizione,
           a.rango_globale    AS "rangoGlobale",
           a.azione           AS azione,
           a.fattori          AS fattori
      FROM riservato.assegnazione a
      JOIN riservato.contatto c ON c.persona_id = a.persona_id
                                AND c.data::date = ${dataOggi}::date
     WHERE a.data = ${dataOggi}::date
       AND a.organizzazione_id = ${organizzazioneId}
  `;
  const idsProtette = new Set(protetteRows.map((r) => r.personaId));
  const idsProtetteEsterno = new Set<string>();
  for (const id of idsProtette) {
    const ext = esternoPerId.get(id);
    if (ext) idsProtetteEsterno.add(ext);
  }

  // Carico iniziale: parte dal numero di protette che ogni volontario
  // già ha in lista — così il cap CAP_PER_VOLONTARIO=6 vale su carico
  // vecchio + nuovo. `posDaScrivere` parte a max(posizioni protette)+1
  // così le posizioni delle nuove non collidono con le protette.
  //
  // **Non riordinare i tre passi che seguono per motivi di leggibilità
  // (§12iiiii)**: l'ordine `protette → pass 1 continuità → pass 2
  // quartiere` è funzionale. Se il pass 1 girasse dopo il pass 2, i
  // volontari sarebbero già saturi di persone senza storia e il
  // legame non scatterebbe quasi mai — la continuità morirebbe in
  // silenzio invece di essere la regola.
  const carico = new Map<number, number>(volontari.map((v) => [v.id, 0]));
  const posDaScrivere = new Map<number, number>(volontari.map((v) => [v.id, 1]));
  // Conteggio protette per volontario: serve al pass 1 per
  // classificare, quando il legame si perde perché il vol è pieno,
  // se è pieno "di sole protette" (già ≥ CAP al momento del pass 1)
  // o "di protette + legami più prioritari". Vedi RisultatoGiro.
  const protettePerVol = new Map<number, number>(volontari.map((v) => [v.id, 0]));
  for (const pa of protetteRows) {
    carico.set(pa.volontarioId, (carico.get(pa.volontarioId) ?? 0) + 1);
    protettePerVol.set(pa.volontarioId, (protettePerVol.get(pa.volontarioId) ?? 0) + 1);
    // posizione della prossima assegnazione: max(posizioni protette) + 1.
    // Sicuro anche se le protette avessero posizioni non contigue.
    const attuale = posDaScrivere.get(pa.volontarioId) ?? 1;
    if (pa.posizione + 1 > attuale) {
      posDaScrivere.set(pa.volontarioId, pa.posizione + 1);
    }
  }

  // §12iiiii — mappa persona → ultimo volontario riuscito. Vive fra
  // giorni diversi (la funzione esclude oggi). Usata solo in pass 1
  // sotto. Query unica, non una per persona (indice
  // (persona_id, data DESC) sul contatto la copre).
  const legameMap = await ultimoVolontarioRiuscitoPerPersona(
    sql, organizzazioneId, dataOggi,
  );
  const volontariSet = new Set(volontari.map((v) => v.id));

  const nuoveAssegnazioni: Array<{
    persId: number; volontarioId: number; posizione: number;
    rangoGlobale: number; azione: string; fattori: unknown;
  }> = [];

  // Contatori esiti pass 1 — riportati in RisultatoGiro.
  let conStoria = 0;
  let legameOttenuto = 0;
  let legamePersoVolNonDisponibile = 0;
  let legamePersoCapProtette = 0;
  let legamePersoCapLegami = 0;

  // ============================================================
  // Pass 1 — CONTINUITÀ (§12iiiii)
  // ============================================================
  // Itera la classifica in ordine di rango globale ASC (la classifica
  // è già ordinata per punteggio DESC, quindi l'iterazione naturale
  // produce rango 1..N). Motivo dell'ordine per rango: quando il
  // vol storico ha posti limitati, la continuità la mantengono le
  // persone più a rischio, non quelle che capitano prima.
  //
  // **Il carico iniziale è già quello delle protette**: se un
  // volontario ha lavorato tanto la mattina (ha molte protette),
  // ha meno spazio per accogliere legami nel pomeriggio. È voluto:
  // la protetta è un contatto già in corso, il legame è una
  // preferenza — la protetta vince, e se satura il vol il legame
  // cade in fallback. Classificato come `legamePersoCapProtette`.
  //
  // Le persone senza legame vanno direttamente in pass 2 (quartiere).
  // Le persone con legame che non scatta finiscono in `daPassareAQuartiere`.
  const daPassareAQuartiere: Array<typeof classifica[number]> = [];
  for (const p of classifica) {
    if (!p.inListaOggi) continue;
    if (idsProtetteEsterno.has(p.idEsterno)) continue;
    const persId = idPerEsterno.get(p.idEsterno);
    if (!persId) continue;
    const legameVol = legameMap.get(persId);
    if (legameVol === undefined) {
      // Nessuna storia riuscita: pass 2.
      daPassareAQuartiere.push(p);
      continue;
    }
    conStoria++;
    if (!volontariSet.has(legameVol)) {
      // Vol storico non disponibile oggi (§12jjjjj): due sotto-casi
      // fisici, entrambi = legame salta. (a) `attivo=false` — non
      // lavora più con l'org; (b) attivo ma in pausa oggi — non di
      // turno per questa data. Unico contatore, come deciso in
      // §12jjjjj (i due casi hanno la stessa conseguenza operativa,
      // sdoppiare aggiungerebbe un contatore per una distinzione che
      // nessuno usa). Cade in pass 2.
      legamePersoVolNonDisponibile++;
      daPassareAQuartiere.push(p);
      continue;
    }
    const nCorrente = carico.get(legameVol) ?? 0;
    if (nCorrente >= CAP_PER_VOLONTARIO) {
      // Vol saturo. Classifica il motivo:
      //   ≥ CAP di sole protette → l'hanno saturato le vecchie
      //     assegnazioni contattate stamattina, il legame non
      //     aveva chance a prescindere.
      //   < CAP di protette → c'erano posti liberi ma altri legami
      //     più prioritari (rango minore) li hanno consumati.
      const protetteVol = protettePerVol.get(legameVol) ?? 0;
      if (protetteVol >= CAP_PER_VOLONTARIO) {
        legamePersoCapProtette++;
      } else {
        legamePersoCapLegami++;
      }
      daPassareAQuartiere.push(p);
      continue;
    }
    // Legame scatta: assegna al vol storico.
    const pos = posDaScrivere.get(legameVol) ?? 1;
    nuoveAssegnazioni.push({
      persId,
      volontarioId: legameVol,
      posizione: pos,
      rangoGlobale: p.posizione,
      azione: p.azione,
      fattori: p.fattori,
    });
    carico.set(legameVol, nCorrente + 1);
    posDaScrivere.set(legameVol, pos + 1);
    legameOttenuto++;
  }

  // ============================================================
  // Pass 2 — QUARTIERE (comportamento pre-§12iiiii)
  // ============================================================
  // Le persone senza legame + quelle il cui legame è caduto tornano
  // qui: raggruppamento per quartiere e greedy min-carico dentro
  // ciascun quartiere, quartieri ordinati per popolosità decrescente.
  // Identico all'algoritmo pre-§12iiiii, applicato solo alle persone
  // che non hanno preso la corsia continuità.
  const perQuartiere = new Map<string, typeof classifica>();
  for (const p of daPassareAQuartiere) {
    const q = quartierePerId.get(p.sezioneId) ?? "n.d.";
    if (!perQuartiere.has(q)) perQuartiere.set(q, []);
    perQuartiere.get(q)!.push(p);
  }

  // §12jjjjj — Traccia le persone che restano fuori quando tutti i
  // vol di turno sono saturi. Comportamento (decisione §12jjjjj):
  // generazione parziale + banda esplicita in dashboard + log del
  // cron, NON fail-hard. Motivo: il giro lo genera il cron alle
  // 3-6 del mattino senza nessuno che guardi; se si rifiutasse,
  // quel giorno nessuno verrebbe contattato e il coord scoprirebbe
  // solo aprendo la dashboard. Una lista di N-k è meglio di zero.
  let nonAssegnatePerCapSaturato = 0;
  const quartieriOrdinati = [...perQuartiere.entries()].sort(
    (a, b) => b[1].length - a[1].length,
  );
  for (const [, gruppo] of quartieriOrdinati) {
    for (const p of gruppo) {
      const disponibile = [...carico.entries()]
        .filter(([, n]) => n < CAP_PER_VOLONTARIO)
        .sort((a, b) => a[1] - b[1])[0];
      if (!disponibile) {
        // Cap dei vol di turno saturato. Il break usciva silente
        // pre-§12jjjjj; oggi conta esplicitamente le persone
        // rimanenti in tutti i quartieri ancora da processare +
        // quelle rimanenti in questo quartiere corrente. Uso un
        // conteggio ex-post: (persone in daPassareAQuartiere) -
        // (già assegnate in pass 2 finora nel loop). Non serve
        // fine di iterazione — esce da qui.
        //
        // NB: le persone protette e quelle già assegnate in pass 1
        // continuità sono già nella loro riga; qui contiamo solo
        // quelle deferite al pass 2 e non ancora servite.
        const assegnateInPass2 = nuoveAssegnazioni.length - legameOttenuto;
        nonAssegnatePerCapSaturato = daPassareAQuartiere.length - assegnateInPass2;
        break;
      }
      const [volontarioId, n] = disponibile;
      const persId = idPerEsterno.get(p.idEsterno);
      if (!persId) continue;
      const pos = posDaScrivere.get(volontarioId) ?? 1;
      nuoveAssegnazioni.push({
        persId,
        volontarioId,
        posizione: pos,
        rangoGlobale: p.posizione,
        azione: p.azione,
        fattori: p.fattori,
      });
      carico.set(volontarioId, n + 1);
      posDaScrivere.set(volontarioId, pos + 1);
    }
    // Se il cap è saturo, il break interno esce da UN solo
    // for-quartiere. Ma i quartieri successivi hanno tutti persone
    // che non potranno essere servite (il cap non si sblocca).
    // Break anche dal loop esterno per correttezza semantica: non
    // ha senso iterare quartieri sapendo che nessuna assegnazione
    // sarà possibile. `nonAssegnatePerCapSaturato` include già le
    // persone di quei quartieri (calcolo ex-post sopra).
    if (nonAssegnatePerCapSaturato > 0) break;
  }

  await sql.begin(async (tx) => {
    // rango_giorno: già scopato org da §12b.
    await tx`
      DELETE FROM riservato.rango_giorno
       WHERE organizzazione_id = ${organizzazioneId} AND data = ${dataOggi}::date
    `;
    for (const p of classifica) {
      const persId = idPerEsterno.get(p.idEsterno);
      if (!persId) continue;
      await tx`
        INSERT INTO riservato.rango_giorno
          (organizzazione_id, data, persona_id, rango, punteggio)
        VALUES
          (${organizzazioneId}, ${dataOggi}::date, ${persId},
           ${p.posizione}, ${p.punteggio})
      `;
    }

    // punteggio_sezione: solo UPSERT, comune-scoped dall'iterazione.
    for (const v of valutate) {
      await tx`
        INSERT INTO pubblico.punteggio_sezione
          (sezione_id, data, punteggio, ranghi, pesi, fattori_disponibili)
        VALUES
          (${v.id}, ${dataOggi}::date, ${v.punteggio},
           ${tx.json(v.rango as unknown as never)},
           ${tx.json(PESI_DEFAULT as unknown as never)},
           ${v.fattoriDisponibili})
        ON CONFLICT (sezione_id, data) DO UPDATE
          SET punteggio           = EXCLUDED.punteggio,
              ranghi              = EXCLUDED.ranghi,
              pesi                = EXCLUDED.pesi,
              fattori_disponibili = EXCLUDED.fattori_disponibili
      `;
    }

    // assegnazione: DELETE con scope org e protette escluse.
    // Il fix del bug §12w è QUI, in `AND organizzazione_id = X`.
    if (idsProtette.size > 0) {
      const idsArr = Array.from(idsProtette);
      await tx`
        DELETE FROM riservato.assegnazione
         WHERE data = ${dataOggi}::date
           AND organizzazione_id = ${organizzazioneId}
           AND persona_id <> ALL(${idsArr}::int[])
      `;
    } else {
      await tx`
        DELETE FROM riservato.assegnazione
         WHERE data = ${dataOggi}::date
           AND organizzazione_id = ${organizzazioneId}
      `;
    }
    for (const a of nuoveAssegnazioni) {
      await tx`
        INSERT INTO riservato.assegnazione
          (data, organizzazione_id, persona_id, volontario_id,
           posizione, rango_globale, azione, fattori)
        VALUES
          (${dataOggi}::date, ${organizzazioneId}, ${a.persId}, ${a.volontarioId},
           ${a.posizione}, ${a.rangoGlobale}, ${a.azione},
           ${tx.json(a.fattori as never)})
      `;
    }
  });

  return {
    totaleAssegnate: idsProtette.size + nuoveAssegnazioni.length,
    protette: idsProtette.size,
    nuoveAssegnate: nuoveAssegnazioni.length,
    sogliaUsata: soglia,
    livelloUsato: allerta.livello,
    volontariAttivi: volontariAttiviRows.length,
    volontariDiTurno: volontari.length,
    conStoria,
    legameOttenuto,
    legamePersoVolNonDisponibile,
    legamePersoCapProtette,
    legamePersoCapLegami,
    nonAssegnatePerCapSaturato,
  };
}

// ================================================================
// §12ddddd — pacchetto per l'agente riassunto della giornata (MOD06)
// ================================================================
//
// Dati precomputati per il coordinatore: cosa hanno fatto i volontari
// oggi. Il pacchetto è pensato per essere serializzato integralmente
// nel messaggio utente inviato al modello — quindi contiene SOLO
// numeri già calcolati e stringhe già selezionate, mai liste raw da
// far contare al modello (vincolo 5 CLAUDE.md).
//
// Cosa il pacchetto NON contiene, deliberatamente:
//   - Nessuna attribuzione di APERTURA di un segnale a un volontario:
//     `riservato.segnale.origine` è testuale ('volontario' vs
//     'coordinatore' vs 'mmg' vs 'cittadino'), non un utente_id. Chi
//     ha aperto una condizione non è ricostruibile con certezza; il
//     prompt della §12ddddd vieta esplicitamente questa affermazione.
//   - Nessun "giro chiuso"/"giro finito": `/volontario/fine-giro` è
//     solo una schermata di riepilogo, non scrive nulla in DB.
//   - Nessun motivo del "ha bisogno": l'esito è categorico
//     (sta_bene / ha_bisogno / non_risponde), il perché è nella nota
//     libera che oggi è NULL su tutti i contatti (in prod il modello
//     lo saprebbe solo se scritto dal volontario, oggi non è così).
//
// La documentazione completa dei fatti non ricostruibili è in
// CHECALDO-PROGETTO §12ddddd.

export interface EsitiCount {
  staBene: number;
  haBisogno: number;
  nonRisponde: number;
}

export interface DatiRiassuntoVolontario {
  id: number;
  nome: string;
  assegnate: number;
  contattate: number;         // persone DISTINCT contattate almeno una volta
  contattiTotali: number;     // n. contatti (può essere > contattate se retry)
  restano: number;            // assegnate - contattate distinct
  esiti: EsitiCount;
  primoContatto: string | null;  // "HH:MM" Rome, null se nessun contatto
  ultimoContatto: string | null;
  condizioniChiuse: number;   // segnali chiusi oggi con chiuso_da = questo volontario
}

export interface DatiRiassuntoHaBisogno {
  idEsterno: string;
  quartiere: string | null;
  eta: number | null;          // §12ddddd fix: età al momento della query, non anno di nascita
  viveSolo: boolean | null;
  condizioniAttive: string[];  // tipi di segnale aperti al momento
  volontarioNome: string;
  oraContatto: string;         // "HH:MM"
}

export interface DatiRiassuntoNonRisponde {
  idEsterno: string;
  tentativiFallitiConsecutivi: number;
  ultimoTentativo: string;     // "HH:MM" Rome
}

export interface DatiRiassunto {
  data: string;                // "YYYY-MM-DD"
  organizzazioneNome: string;
  contattiTotali: number;      // 0 → chiamante NON invoca l'agente
  personeInLista: number;
  personeContattate: number;
  personeDaContattare: number;
  esitiGiornata: EsitiCount;
  condizioniChiuseOggi: number;
  ritmoConIeri: {
    contattiOggiFinoraOra: number;   // count contatti oggi con hour <= now hour
    contattiIeriStessaOra: number;   // count contatti ieri con hour <= now hour
    contattiIeriTotali: number;
  } | null;                     // null se ieri non ha alcun contatto
  volontari: DatiRiassuntoVolontario[];
  haBisogno: DatiRiassuntoHaBisogno[];
  nonRisponde: DatiRiassuntoNonRisponde[];
}

/**
 * Raccoglie il pacchetto per l'agente riassunto in una sola andata.
 * Riusa `tentativiFallitiConsecutivi` per la sezione non_risponde;
 * il resto è aggregazione SQL diretta — le funzioni esistenti
 * (`statoLiveDashboard`, `esitiDelVolontarioOggi`) ritornerebbero
 * dati raw troppo dettagliati, il pacchetto vuole numeri già
 * aggregati.
 */
export async function datiPerRiassunto(
  sql: Sql,
  organizzazioneId: number,
  dataOggi: string,
): Promise<DatiRiassunto> {
  // ---- header organizzazione ----
  const [orgRow] = await sql<Array<{ nome: string }>>`
    SELECT nome FROM pubblico.organizzazione WHERE id = ${organizzazioneId}
  `;
  const organizzazioneNome = orgRow?.nome ?? `org #${organizzazioneId}`;

  // ---- totali giornata ----
  // `esitiGiornata` conta **persone distinte per ULTIMO esito** (non
  // conteggi di contatti). Motivo: se una persona è stata contattata
  // due volte con esito diverso (es. "non_risponde" alle 10 poi
  // "sta_bene" alle 15), il coordinatore vuole raccontarla come
  // "sta bene", non contarla in entrambe le colonne. Il totale dei
  // tre esiti coincide con `personeContattate`. `contattiTotali` è
  // separato: n. di contatti (righe in `riservato.contatto`).
  const [tot] = await sql<Array<{
    contattiTotali: number; personeContattate: number;
    staBene: number; haBisogno: number; nonRisponde: number;
  }>>`
    WITH ultimi AS (
      SELECT DISTINCT ON (c.persona_id)
             c.persona_id, c.esito
        FROM riservato.contatto c
        JOIN riservato.persona p ON p.id = c.persona_id
       WHERE p.organizzazione_id = ${organizzazioneId}
         AND c.data::date = ${dataOggi}::date
       ORDER BY c.persona_id, c.data DESC
    ), tot_contatti AS (
      SELECT count(*)::int AS n
        FROM riservato.contatto c
        JOIN riservato.persona p ON p.id = c.persona_id
       WHERE p.organizzazione_id = ${organizzazioneId}
         AND c.data::date = ${dataOggi}::date
    )
    SELECT
      (SELECT n FROM tot_contatti)                           AS "contattiTotali",
      count(*)::int                                          AS "personeContattate",
      count(*) FILTER (WHERE esito='sta_bene')::int          AS "staBene",
      count(*) FILTER (WHERE esito='ha_bisogno')::int        AS "haBisogno",
      count(*) FILTER (WHERE esito='non_risponde')::int      AS "nonRisponde"
      FROM ultimi
  `;

  const [inLista] = await sql<Array<{ n: number }>>`
    SELECT count(*)::int AS n FROM riservato.assegnazione
     WHERE organizzazione_id = ${organizzazioneId} AND data = ${dataOggi}::date
  `;
  const personeInLista = inLista?.n ?? 0;
  const personeContattate = tot?.personeContattate ?? 0;

  // §12eeeee — formula insiemistica: persone ASSEGNATE che non
  // compaiono fra le contattate. Sostituisce `personeInLista -
  // personeContattate`, che era matematicamente sbagliata quando
  // qualcuno contattava persone non in lista (contatti orfani
  // app-side): produceva sottrazioni tipo 36-40=-4 → clampate a 0
  // artificialmente. Ora coincide col totale per volontario
  // (assegnate MINUS contattate ∩ assegnate) sommato sulle N righe.
  const [nonToccate] = await sql<Array<{ n: number }>>`
    SELECT count(*)::int AS n
      FROM riservato.assegnazione a
     WHERE a.organizzazione_id = ${organizzazioneId}
       AND a.data = ${dataOggi}::date
       AND NOT EXISTS (
         SELECT 1 FROM riservato.contatto c
          WHERE c.persona_id = a.persona_id
            AND c.data::date = ${dataOggi}::date
       )
  `;
  const personeDaContattare = nonToccate?.n ?? 0;

  const [chiusi] = await sql<Array<{ n: number }>>`
    SELECT count(*)::int AS n FROM riservato.segnale sg
      JOIN riservato.persona p ON p.id = sg.persona_id
     WHERE p.organizzazione_id = ${organizzazioneId}
       AND sg.chiuso_il::date = ${dataOggi}::date
       AND sg.chiuso_da IS NOT NULL
  `;

  // ---- per volontario ----
  const volontari = await sql<Array<DatiRiassuntoVolontario>>`
    WITH ass AS (
      SELECT volontario_id, count(*)::int AS assegnate
        FROM riservato.assegnazione
       WHERE organizzazione_id = ${organizzazioneId}
         AND data = ${dataOggi}::date
       GROUP BY volontario_id
    ), cont AS (
      SELECT c.volontario_id,
             count(*)::int                                        AS "contattiTotali",
             count(DISTINCT c.persona_id)::int                    AS contattate,
             count(*) FILTER (WHERE c.esito='sta_bene')::int      AS sta_bene,
             count(*) FILTER (WHERE c.esito='ha_bisogno')::int    AS ha_bisogno,
             count(*) FILTER (WHERE c.esito='non_risponde')::int  AS non_risponde,
             to_char(min(c.data) AT TIME ZONE 'Europe/Rome', 'HH24:MI') AS "primoContatto",
             to_char(max(c.data) AT TIME ZONE 'Europe/Rome', 'HH24:MI') AS "ultimoContatto"
        FROM riservato.contatto c
        JOIN riservato.persona p ON p.id = c.persona_id
       WHERE p.organizzazione_id = ${organizzazioneId}
         AND c.data::date = ${dataOggi}::date
       GROUP BY c.volontario_id
    ), restanti AS (
      -- §12eeeee formula insiemistica: assegnate che NON compaiono
      -- fra le contattate del volontario stesso. Prima usava
      -- assegnate meno contattate_distinct, che sottraeva anche persone
      -- contattate dal volontario ma non assegnate a lui (contatti
      -- orfani), producendo "restano 0" quando in realta restavano
      -- persone del suo giro non toccate. Ora coincide per costruzione
      -- col personeDaContattare a livello org (somma delle rimaste
      -- di ogni volontario).
      SELECT a.volontario_id, count(*)::int AS n
        FROM riservato.assegnazione a
       WHERE a.organizzazione_id = ${organizzazioneId}
         AND a.data = ${dataOggi}::date
         AND NOT EXISTS (
           SELECT 1 FROM riservato.contatto c
            WHERE c.persona_id = a.persona_id
              AND c.volontario_id = a.volontario_id
              AND c.data::date = ${dataOggi}::date
         )
       GROUP BY a.volontario_id
    ), chius AS (
      SELECT sg.chiuso_da AS volontario_id, count(*)::int AS n
        FROM riservato.segnale sg
        JOIN riservato.persona p ON p.id = sg.persona_id
       WHERE p.organizzazione_id = ${organizzazioneId}
         AND sg.chiuso_il::date = ${dataOggi}::date
         AND sg.chiuso_da IS NOT NULL
       GROUP BY sg.chiuso_da
    )
    SELECT u.id                                                 AS id,
           u.nome                                               AS nome,
           COALESCE(ass.assegnate, 0)                           AS assegnate,
           COALESCE(cont.contattate, 0)                         AS contattate,
           COALESCE(cont."contattiTotali", 0)                   AS "contattiTotali",
           COALESCE(restanti.n, 0)                              AS restano,
           jsonb_build_object(
             'staBene',     COALESCE(cont.sta_bene, 0),
             'haBisogno',   COALESCE(cont.ha_bisogno, 0),
             'nonRisponde', COALESCE(cont.non_risponde, 0)
           )                                                    AS esiti,
           cont."primoContatto"                                 AS "primoContatto",
           cont."ultimoContatto"                                AS "ultimoContatto",
           COALESCE(chius.n, 0)                                 AS "condizioniChiuse"
      FROM riservato.utente u
      LEFT JOIN ass  ON ass.volontario_id  = u.id
      LEFT JOIN cont ON cont.volontario_id = u.id
      LEFT JOIN restanti ON restanti.volontario_id = u.id
      LEFT JOIN chius ON chius.volontario_id = u.id
     WHERE u.organizzazione_id = ${organizzazioneId}
       AND u.ruolo = 'volontario'
       AND u.attivo = true
       AND (ass.assegnate IS NOT NULL OR cont.contattate IS NOT NULL)
     ORDER BY COALESCE(cont."contattiTotali", 0) DESC, u.id
  `;

  // ---- ha_bisogno di oggi ----
  // Filtro sull'ULTIMO esito del giorno (non "almeno un contatto con
  // esito ha_bisogno"): coerente con `esitiGiornata.haBisogno` che
  // conta persone per ultimo esito. Se una persona ha detto
  // "ha_bisogno" alle 10 e "sta_bene" alle 15, non compare qui —
  // il volontario ha già rivisto la sua situazione.
  const haBisogno = await sql<Array<DatiRiassuntoHaBisogno>>`
    WITH ultimi AS (
      SELECT DISTINCT ON (c.persona_id)
             c.persona_id, c.data, c.esito, c.volontario_id
        FROM riservato.contatto c
        JOIN riservato.persona p ON p.id = c.persona_id
       WHERE p.organizzazione_id = ${organizzazioneId}
         AND c.data::date = ${dataOggi}::date
       ORDER BY c.persona_id, c.data DESC
    )
    SELECT p.id_esterno                                                       AS "idEsterno",
           s.quartiere                                                        AS quartiere,
           CASE WHEN p.anno_nascita IS NULL THEN NULL
                ELSE (extract(year FROM CURRENT_DATE)::int - p.anno_nascita)
           END                                                                AS eta,
           p.vive_solo                                                        AS "viveSolo",
           COALESCE((
             SELECT array_agg(sg.tipo ORDER BY sg.tipo)
               FROM riservato.segnale sg
              WHERE sg.persona_id = p.id
                AND sg.chiuso_il IS NULL
                AND (sg.valido_fino IS NULL OR sg.valido_fino >= ${dataOggi}::date)
           ), '{}')                                                           AS "condizioniAttive",
           u.nome                                                             AS "volontarioNome",
           to_char(ultimi.data AT TIME ZONE 'Europe/Rome', 'HH24:MI')         AS "oraContatto"
      FROM ultimi
      JOIN riservato.persona p ON p.id = ultimi.persona_id
      LEFT JOIN pubblico.sezione s ON s.id = p.sezione_id
      LEFT JOIN riservato.utente u ON u.id = ultimi.volontario_id
     WHERE ultimi.esito = 'ha_bisogno'
  `;

  // ---- non_risponde di oggi ----
  // Filtro sull'ULTIMO esito, come `haBisogno`: se qualcuno ha
  // detto "non_risponde" alle 10 e poi ha risposto alle 15,
  // non compare qui — è stato raggiunto. Coerente con
  // `esitiGiornata.nonRisponde` (persone per ultimo esito).
  const streak = await tentativiFallitiConsecutivi(sql, organizzazioneId, dataOggi);
  const nonRispondeRaw = await sql<Array<{
    idEsterno: string; personaId: number;
    ultimoTentativo: string; tentativiOggi: number;
  }>>`
    WITH ultimi AS (
      SELECT DISTINCT ON (c.persona_id)
             c.persona_id, c.data, c.esito
        FROM riservato.contatto c
        JOIN riservato.persona p ON p.id = c.persona_id
       WHERE p.organizzazione_id = ${organizzazioneId}
         AND c.data::date = ${dataOggi}::date
       ORDER BY c.persona_id, c.data DESC
    )
    SELECT ultimi.persona_id                                                  AS "personaId",
           p.id_esterno                                                       AS "idEsterno",
           to_char(ultimi.data AT TIME ZONE 'Europe/Rome', 'HH24:MI')         AS "ultimoTentativo",
           (SELECT count(*)::int FROM riservato.contatto c2
              WHERE c2.persona_id = ultimi.persona_id
                AND c2.data::date = ${dataOggi}::date
                AND c2.esito = 'non_risponde')                                AS "tentativiOggi"
      FROM ultimi
      JOIN riservato.persona p ON p.id = ultimi.persona_id
     WHERE ultimi.esito = 'non_risponde'
  `;
  // Conteggio "consecutivi" = fallits precedenti a oggi + tentativi oggi
  // se anche oggi è tutto miss. `streak` è count fino a ieri; sommo i
  // miss di oggi solo se la persona non è stata raggiunta oggi (che è
  // implicito: siamo nel branch DISTINCT ON esito='non_risponde').
  const nonRisponde: DatiRiassuntoNonRisponde[] = nonRispondeRaw.map((r) => ({
    idEsterno: r.idEsterno,
    tentativiFallitiConsecutivi: (streak.get(r.personaId) ?? 0) + r.tentativiOggi,
    ultimoTentativo: r.ultimoTentativo,
  }));

  // ---- ritmo con ieri ----
  const [ritmo] = await sql<Array<{
    contattiOggiFinoraOra: number;
    contattiIeriStessaOra: number;
    contattiIeriTotali: number;
  }>>`
    WITH ora_max AS (
      SELECT extract(hour FROM now() AT TIME ZONE 'Europe/Rome')::int AS h
    )
    SELECT
      (SELECT count(*)::int FROM riservato.contatto c
         JOIN riservato.persona p ON p.id = c.persona_id
        WHERE p.organizzazione_id = ${organizzazioneId}
          AND c.data::date = ${dataOggi}::date
          AND extract(hour FROM c.data AT TIME ZONE 'Europe/Rome') <= (SELECT h FROM ora_max))
      AS "contattiOggiFinoraOra",
      (SELECT count(*)::int FROM riservato.contatto c
         JOIN riservato.persona p ON p.id = c.persona_id
        WHERE p.organizzazione_id = ${organizzazioneId}
          AND c.data::date = ${dataOggi}::date - 1
          AND extract(hour FROM c.data AT TIME ZONE 'Europe/Rome') <= (SELECT h FROM ora_max))
      AS "contattiIeriStessaOra",
      (SELECT count(*)::int FROM riservato.contatto c
         JOIN riservato.persona p ON p.id = c.persona_id
        WHERE p.organizzazione_id = ${organizzazioneId}
          AND c.data::date = ${dataOggi}::date - 1)
      AS "contattiIeriTotali"
  `;
  const ritmoConIeri = ritmo && ritmo.contattiIeriTotali > 0 ? ritmo : null;

  return {
    data: dataOggi,
    organizzazioneNome,
    contattiTotali: tot?.contattiTotali ?? 0,
    personeInLista,
    personeContattate,
    personeDaContattare,
    esitiGiornata: {
      staBene: tot?.staBene ?? 0,
      haBisogno: tot?.haBisogno ?? 0,
      nonRisponde: tot?.nonRisponde ?? 0,
    },
    condizioniChiuseOggi: chiusi?.n ?? 0,
    ritmoConIeri,
    volontari,
    haBisogno,
    nonRisponde,
  };
}
