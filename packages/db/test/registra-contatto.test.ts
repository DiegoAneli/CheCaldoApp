/**
 * Test §12cccc: `registraContatto` popola `valido_fino` in base al
 * tipo del segnale, usando la costante `DURATA_SEGNALE_GIORNI` di
 * `packages/scoring/src/index.ts`.
 *
 * Prima di §12cccc l'INSERT non nominava `valido_fino` e ogni segnale
 * app-side nasceva con `valido_fino = NULL` (valido per sempre).
 * Se qualcuno riscrive l'INSERT senza `valido_fino` o senza usare la
 * costante di dominio, questi test cadono.
 *
 * PATTERN CLEANUP (§12nnnn). `personaId` è dichiarato PRIMA del `try`
 * come `let personaId: number | null = null`, assegnato una sola
 * volta all'inizio del `try`, e riletto nel `finally` per pulire la
 * stessa riga. Prima di §12nnnn il `finally` chiamava di nuovo
 * `personaPulita(sql)` — che filtra sulle persone SENZA segnali
 * osservativi aperti — e siccome il corpo del test ne aveva appena
 * aperto uno, la seconda chiamata restituiva una persona diversa e
 * `pulisci` operava sul nulla. 17 esecuzioni della suite in un
 * giorno hanno lasciato ~102 righe di segnale app-side in DB;
 * dettaglio in CHECALDO-PROGETTO §12nnnn.
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import postgres from "postgres";
import { EsitoIncoerente, registraContatto } from "../src/index";
import { DURATA_SEGNALE_GIORNI } from "@checaldo/scoring";

const DATABASE_URL = process.env.DATABASE_URL;
const skip = !DATABASE_URL
  ? { skip: "DATABASE_URL non impostata: test di integrazione saltato" as string }
  : undefined;

const ORG_PARMA = 1;
const VOLONTARIO_PARMA = 2;

async function personaPulita(sql: postgres.Sql): Promise<number> {
  const [p] = await sql<Array<{ id: number }>>`
    SELECT p.id FROM riservato.persona p
     WHERE p.organizzazione_id = ${ORG_PARMA} AND p.attiva
       AND NOT EXISTS (
         SELECT 1 FROM riservato.segnale s
          WHERE s.persona_id = p.id AND s.chiuso_il IS NULL
            AND s.tipo IN ('sintomi_riferiti','nessuna_climatizzazione',
                           'ventilatore_rotto','rete_familiare_assente')
       )
     ORDER BY p.id LIMIT 1
  `;
  assert.notEqual(p, undefined, "serve una persona senza segnali osservativi aperti in fixture");
  return p!.id;
}

async function pulisci(sql: postgres.Sql, personaId: number): Promise<void> {
  // §12nnnn — rimosso il filtro `AND origine = 'volontario'`. Il test
  // §12ffff "creato_il/origine invariati" inserisce nel setup una riga
  // con origine 'mmg' (fixture_id NULL); il vecchio filtro conservativo
  // saltava quella riga e la lasciava in DB per sempre. Aggiunto
  // `AND fixture_id IS NULL` in sostituzione: protegge le fixture del
  // canone (che hanno fixture_id NOT NULL) e pulisce qualunque origine
  // app-side.
  //
  // Copre anche le righe di setup pre-registraContatto: i test §12ffff
  // 3-5 fanno INSERT diretto con `origine='volontario', valido_fino=...`
  // ma senza fixture_id → cadono in questo criterio.
  await sql`
    DELETE FROM riservato.segnale
     WHERE persona_id = ${personaId}
       AND chiuso_il IS NULL
       AND fixture_id IS NULL
       AND tipo IN ('sintomi_riferiti','nessuna_climatizzazione','ventilatore_rotto')
  `;
  await sql`
    DELETE FROM riservato.contatto
     WHERE persona_id = ${personaId}
       AND volontario_id = ${VOLONTARIO_PARMA}
       AND data > now() - interval '1 minute'
  `;
}

test(
  "§12cccc — registraContatto scrive sintomi_riferiti con valido_fino a DURATA_SEGNALE_GIORNI['sintomi_riferiti'] giorni",
  skip ?? {},
  async () => {
    const sql = postgres(DATABASE_URL!, { max: 1 });
    let personaId: number | null = null;
    try {
      personaId = await personaPulita(sql);
      await pulisci(sql, personaId);

      await registraContatto(sql, {
        organizzazioneSessione: ORG_PARMA,
        volontarioId: VOLONTARIO_PARMA,
        personaId,
        esito: "ha_bisogno",
        segnaliNuovi: [{ tipo: "sintomi_riferiti", origine: "volontario" }],
        segnaliDaChiudere: [],
      });

      const [row] = await sql<Array<{ valido_fino: string | null; delta_giorni: number | null }>>`
        SELECT to_char(valido_fino, 'YYYY-MM-DD') AS valido_fino,
               (valido_fino - CURRENT_DATE)::int AS delta_giorni
          FROM riservato.segnale
         WHERE persona_id = ${personaId}
           AND tipo = 'sintomi_riferiti'
           AND chiuso_il IS NULL
      `;
      assert.notEqual(row, undefined, "il segnale sintomi_riferiti deve essere stato scritto");
      assert.notEqual(
        row!.valido_fino, null,
        "valido_fino deve essere valorizzato per un tipo osservativo con durata (§12cccc)",
      );
      const atteso = DURATA_SEGNALE_GIORNI.sintomi_riferiti;
      assert.equal(
        row!.delta_giorni, atteso,
        `valido_fino - oggi = ${row!.delta_giorni} giorni, atteso ${atteso} ` +
        `(DURATA_SEGNALE_GIORNI['sintomi_riferiti']). Divergenza: probabilmente ` +
        `registraContatto non usa la costante o l'INSERT non nomina valido_fino.`,
      );
    } finally {
      if (personaId != null) await pulisci(sql, personaId);
      await sql.end();
    }
  },
);

test(
  "§12cccc — registraContatto scrive nessuna_climatizzazione con valido_fino NULL (strutturale)",
  skip ?? {},
  async () => {
    const sql = postgres(DATABASE_URL!, { max: 1 });
    let personaId: number | null = null;
    try {
      personaId = await personaPulita(sql);
      await pulisci(sql, personaId);

      await registraContatto(sql, {
        organizzazioneSessione: ORG_PARMA,
        volontarioId: VOLONTARIO_PARMA,
        personaId,
        esito: "sta_bene",
        segnaliNuovi: [{ tipo: "nessuna_climatizzazione", origine: "volontario" }],
        segnaliDaChiudere: [],
      });

      const [row] = await sql<Array<{ valido_fino: string | null }>>`
        SELECT to_char(valido_fino, 'YYYY-MM-DD') AS valido_fino
          FROM riservato.segnale
         WHERE persona_id = ${personaId}
           AND tipo = 'nessuna_climatizzazione'
           AND chiuso_il IS NULL
           AND origine = 'volontario'
      `;
      assert.notEqual(row, undefined, "il segnale nessuna_climatizzazione deve essere stato scritto");
      assert.equal(
        row!.valido_fino, null,
        `valido_fino atteso NULL (strutturale, DURATA_SEGNALE_GIORNI['nessuna_climatizzazione']=null), ` +
        `trovato ${row!.valido_fino}. Divergenza: la scrittura app-side sta popolando ` +
        `la colonna anche per i tipi che il generatore lascia NULL.`,
      );
    } finally {
      if (personaId != null) await pulisci(sql, personaId);
      await sql.end();
    }
  },
);

// ------------------------------------------------------ §12ffff
//
// La conferma di un segnale osservativo estende la scadenza. Prima
// di §12ffff `ON CONFLICT DO NOTHING` significava che un volontario
// che confermava una condizione al giorno 12 NON spostava la
// scadenza — il segnale moriva al giorno 14 malgrado la conferma
// di due giorni prima. Ora `DO UPDATE SET valido_fino = CASE ...
// GREATEST ...`.

test(
  "§12ffff — conferma di un ventilatore_rotto vecchio sposta valido_fino a CURRENT_DATE+14",
  skip ?? {},
  async () => {
    const sql = postgres(DATABASE_URL!, { max: 1 });
    let personaId: number | null = null;
    try {
      personaId = await personaPulita(sql);
      await pulisci(sql, personaId);
      // Setup: un ventilatore_rotto aperto 5 giorni fa, valido_fino a +2gg
      // (simula un segnale che sta per scadere e viene confermato).
      await sql`
        INSERT INTO riservato.segnale (persona_id, tipo, origine, valido_fino, creato_il)
        VALUES (${personaId}, 'ventilatore_rotto', 'volontario',
                CURRENT_DATE + 2, now() - interval '5 days')
      `;

      await registraContatto(sql, {
        organizzazioneSessione: ORG_PARMA,
        volontarioId: VOLONTARIO_PARMA,
        personaId,
        esito: "sta_bene",
        segnaliNuovi: [{ tipo: "ventilatore_rotto", origine: "volontario" }],
        segnaliDaChiudere: [],
      });

      const [row] = await sql<Array<{ delta_giorni: number }>>`
        SELECT (valido_fino - CURRENT_DATE)::int AS delta_giorni
          FROM riservato.segnale
         WHERE persona_id = ${personaId}
           AND tipo = 'ventilatore_rotto'
           AND chiuso_il IS NULL
      `;
      const atteso = DURATA_SEGNALE_GIORNI.ventilatore_rotto!;
      assert.equal(
        row!.delta_giorni, atteso,
        `conferma non ha spostato valido_fino: delta=${row!.delta_giorni}, atteso ` +
        `${atteso}. Se torna 2, il DO NOTHING è ancora attivo (pre-§12ffff): ` +
        `la conferma non estende la scadenza.`,
      );
    } finally {
      if (personaId != null) await pulisci(sql, personaId);
      await sql.end();
    }
  },
);

test(
  "§12ffff — conferma di un ventilatore_rotto con valido_fino più lontano NON lo accorcia (GREATEST)",
  skip ?? {},
  async () => {
    const sql = postgres(DATABASE_URL!, { max: 1 });
    let personaId: number | null = null;
    try {
      personaId = await personaPulita(sql);
      await pulisci(sql, personaId);
      // Setup: ventilatore_rotto fixture-style con valido_fino a +21gg.
      // La conferma app-side porterebbe +14 — GREATEST deve mantenere +21.
      await sql`
        INSERT INTO riservato.segnale (persona_id, tipo, origine, valido_fino)
        VALUES (${personaId}, 'ventilatore_rotto', 'volontario', CURRENT_DATE + 21)
      `;

      await registraContatto(sql, {
        organizzazioneSessione: ORG_PARMA,
        volontarioId: VOLONTARIO_PARMA,
        personaId,
        esito: "sta_bene",
        segnaliNuovi: [{ tipo: "ventilatore_rotto", origine: "volontario" }],
        segnaliDaChiudere: [],
      });

      const [row] = await sql<Array<{ delta_giorni: number }>>`
        SELECT (valido_fino - CURRENT_DATE)::int AS delta_giorni
          FROM riservato.segnale
         WHERE persona_id = ${personaId}
           AND tipo = 'ventilatore_rotto'
           AND chiuso_il IS NULL
      `;
      assert.equal(
        row!.delta_giorni, 21,
        `GREATEST non ha protetto la scadenza più lontana: delta=${row!.delta_giorni}, ` +
        `atteso 21. Se torna 14 (DURATA_SEGNALE_GIORNI), il DO UPDATE ha assegnato ` +
        `EXCLUDED.valido_fino invece di GREATEST(esistente, EXCLUDED).`,
      );
    } finally {
      if (personaId != null) await pulisci(sql, personaId);
      await sql.end();
    }
  },
);

test(
  "§12ffff — conferma di un nessuna_climatizzazione lascia valido_fino NULL (strutturale)",
  skip ?? {},
  async () => {
    const sql = postgres(DATABASE_URL!, { max: 1 });
    let personaId: number | null = null;
    try {
      personaId = await personaPulita(sql);
      await pulisci(sql, personaId);
      await sql`
        INSERT INTO riservato.segnale (persona_id, tipo, origine, valido_fino)
        VALUES (${personaId}, 'nessuna_climatizzazione', 'volontario', NULL)
      `;

      await registraContatto(sql, {
        organizzazioneSessione: ORG_PARMA,
        volontarioId: VOLONTARIO_PARMA,
        personaId,
        esito: "sta_bene",
        segnaliNuovi: [{ tipo: "nessuna_climatizzazione", origine: "volontario" }],
        segnaliDaChiudere: [],
      });

      const [row] = await sql<Array<{ valido_fino: string | null }>>`
        SELECT to_char(valido_fino, 'YYYY-MM-DD') AS valido_fino
          FROM riservato.segnale
         WHERE persona_id = ${personaId}
           AND tipo = 'nessuna_climatizzazione'
           AND chiuso_il IS NULL
      `;
      assert.equal(
        row!.valido_fino, null,
        `strutturale trasformato in a-scadenza: valido_fino=${row!.valido_fino}, ` +
        "atteso NULL. Il ramo 'if (durata === null)' di registraContatto deve " +
        "usare DO NOTHING, non DO UPDATE.",
      );
    } finally {
      if (personaId != null) await pulisci(sql, personaId);
      await sql.end();
    }
  },
);

test(
  "§12ffff — conferma di un ventilatore_rotto con valido_fino NULL preesistente lo lascia NULL (CASE esplicito)",
  skip ?? {},
  async () => {
    const sql = postgres(DATABASE_URL!, { max: 1 });
    let personaId: number | null = null;
    try {
      personaId = await personaPulita(sql);
      await pulisci(sql, personaId);
      // Setup: ventilatore_rotto con valido_fino NULL (caso Persona 0015
      // pre-§12cccc). La conferma app-side arriverebbe con GREATEST(NULL,
      // CURRENT_DATE+14) = CURRENT_DATE+14 se non gestissimo il CASE:
      // trasformerebbe un segnale "resta finché chiuso" in uno a scadenza.
      await sql`
        INSERT INTO riservato.segnale (persona_id, tipo, origine, valido_fino)
        VALUES (${personaId}, 'ventilatore_rotto', 'volontario', NULL)
      `;

      await registraContatto(sql, {
        organizzazioneSessione: ORG_PARMA,
        volontarioId: VOLONTARIO_PARMA,
        personaId,
        esito: "sta_bene",
        segnaliNuovi: [{ tipo: "ventilatore_rotto", origine: "volontario" }],
        segnaliDaChiudere: [],
      });

      const [row] = await sql<Array<{ valido_fino: string | null }>>`
        SELECT to_char(valido_fino, 'YYYY-MM-DD') AS valido_fino
          FROM riservato.segnale
         WHERE persona_id = ${personaId}
           AND tipo = 'ventilatore_rotto'
           AND chiuso_il IS NULL
      `;
      assert.equal(
        row!.valido_fino, null,
        `il segnale con valido_fino NULL pre-§12cccc è stato trasformato: ` +
        `nuovo valido_fino=${row!.valido_fino}, atteso NULL. GREATEST(NULL, ` +
        `EXCLUDED) ha propagato EXCLUDED — manca il CASE esplicito che ` +
        `preserva la semantica strutturale della riga preesistente.`,
      );
    } finally {
      if (personaId != null) await pulisci(sql, personaId);
      await sql.end();
    }
  },
);

test(
  "§12ffff — creato_il e origine restano invariati dopo una conferma",
  skip ?? {},
  async () => {
    const sql = postgres(DATABASE_URL!, { max: 1 });
    let personaId: number | null = null;
    try {
      personaId = await personaPulita(sql);
      await pulisci(sql, personaId);
      // Setup: segnale scritto 5 giorni fa da 'mmg', valido_fino a +2gg.
      // La conferma arriva da 'volontario' e non deve cambiare origine
      // né creato_il — la storia del segnale resta della prima apertura.
      const creatoAtteso = "2026-08-05 10:30:00+00";
      await sql`
        INSERT INTO riservato.segnale (persona_id, tipo, origine, valido_fino, creato_il)
        VALUES (${personaId}, 'ventilatore_rotto', 'mmg',
                CURRENT_DATE + 2, ${creatoAtteso}::timestamptz)
      `;

      await registraContatto(sql, {
        organizzazioneSessione: ORG_PARMA,
        volontarioId: VOLONTARIO_PARMA,
        personaId,
        esito: "sta_bene",
        segnaliNuovi: [{ tipo: "ventilatore_rotto", origine: "volontario" }],
        segnaliDaChiudere: [],
      });

      const [row] = await sql<Array<{ origine: string; creato_il: string; delta_giorni: number }>>`
        SELECT origine,
               to_char(creato_il AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS creato_il,
               (valido_fino - CURRENT_DATE)::int AS delta_giorni
          FROM riservato.segnale
         WHERE persona_id = ${personaId}
           AND tipo = 'ventilatore_rotto'
           AND chiuso_il IS NULL
      `;
      assert.equal(
        row!.origine, 'mmg',
        `origine cambiata da 'mmg' a '${row!.origine}': la conferma app-side ` +
        `non deve sovrascrivere la storia della prima apertura.`,
      );
      assert.equal(
        row!.creato_il, "2026-08-05T10:30:00Z",
        `creato_il cambiato da 2026-08-05T10:30:00Z a '${row!.creato_il}': la ` +
        `SET del DO UPDATE non deve toccare creato_il.`,
      );
      assert.equal(
        row!.delta_giorni, DURATA_SEGNALE_GIORNI.ventilatore_rotto,
        `sanity: la conferma ha spostato valido_fino (${row!.delta_giorni} vs ` +
        `atteso ${DURATA_SEGNALE_GIORNI.ventilatore_rotto}).`,
      );
    } finally {
      if (personaId != null) await pulisci(sql, personaId);
      await sql.end();
    }
  },
);

test(
  "§12ppppp — registraContatto rifiuta sta_bene + sintomi_riferiti con EsitoIncoerente e non scrive nulla",
  skip ?? {},
  async () => {
    const sql = postgres(DATABASE_URL!, { max: 1 });
    let personaId: number | null = null;
    try {
      personaId = await personaPulita(sql);
      await pulisci(sql, personaId);

      // Combinazione illegale: la regola vive nel client
      // (`staBeneBloccato` in `scheda-persona.tsx`) ma qui viene
      // rispedita al server come se qualcuno avesse aggirato la UI.
      // La funzione deve rifiutare, non scrivere, e lanciare
      // EsitoIncoerente — non un Error generico, così il caller
      // (server action) può discriminarla dagli errori
      // infrastrutturali per tradurla in messaggio user-facing.
      await assert.rejects(
        registraContatto(sql, {
          organizzazioneSessione: ORG_PARMA,
          volontarioId: VOLONTARIO_PARMA,
          personaId: personaId!,
          esito: "sta_bene",
          segnaliNuovi: [{ tipo: "sintomi_riferiti", origine: "volontario" }],
          segnaliDaChiudere: [],
        }),
        (err: unknown) => err instanceof EsitoIncoerente,
        "deve lanciare EsitoIncoerente su sta_bene + sintomi_riferiti",
      );

      // Nessuna riga scritta: né il contatto né il segnale.
      // La guardia è prima di sql.begin — la transazione non parte.
      const [contattoRow] = await sql<Array<{ n: number }>>`
        SELECT count(*)::int AS n
          FROM riservato.contatto
         WHERE persona_id = ${personaId}
           AND volontario_id = ${VOLONTARIO_PARMA}
           AND data > now() - interval '1 minute'
      `;
      assert.equal(
        contattoRow!.n, 0,
        "nessun contatto deve essere stato scritto quando la combinazione è rifiutata",
      );
      const [segnaleRow] = await sql<Array<{ n: number }>>`
        SELECT count(*)::int AS n
          FROM riservato.segnale
         WHERE persona_id = ${personaId}
           AND tipo = 'sintomi_riferiti'
           AND chiuso_il IS NULL
      `;
      assert.equal(
        segnaleRow!.n, 0,
        "nessun segnale sintomi_riferiti deve essere stato scritto quando la combinazione è rifiutata",
      );
    } finally {
      if (personaId != null) await pulisci(sql, personaId);
      await sql.end();
    }
  },
);

test(
  "§12ppppp — regressione: la stessa combinazione con esito 'ha_bisogno' passa (rifiuto è mirato)",
  skip ?? {},
  async () => {
    const sql = postgres(DATABASE_URL!, { max: 1 });
    let personaId: number | null = null;
    try {
      personaId = await personaPulita(sql);
      await pulisci(sql, personaId);

      // Sanity: la guardia rifiuta SOLO sta_bene + sintomi_riferiti.
      // Le sei chiamate valide del canone corrente (sta_bene con
      // altri segnali, ha_bisogno con qualunque segnale) devono
      // continuare a passare. Copre il rischio "il check è troppo
      // largo e blocca l'uso normale".
      await registraContatto(sql, {
        organizzazioneSessione: ORG_PARMA,
        volontarioId: VOLONTARIO_PARMA,
        personaId: personaId!,
        esito: "ha_bisogno",
        segnaliNuovi: [{ tipo: "sintomi_riferiti", origine: "volontario" }],
        segnaliDaChiudere: [],
      });

      const [row] = await sql<Array<{ n: number }>>`
        SELECT count(*)::int AS n
          FROM riservato.segnale
         WHERE persona_id = ${personaId}
           AND tipo = 'sintomi_riferiti'
           AND chiuso_il IS NULL
      `;
      assert.equal(
        row!.n, 1,
        "ha_bisogno + sintomi_riferiti deve scrivere il segnale (combinazione legittima)",
      );
    } finally {
      if (personaId != null) await pulisci(sql, personaId);
      await sql.end();
    }
  },
);
