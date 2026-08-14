/**
 * Test di integrazione: isolamento cross-organizzazione.
 *
 * Copre l'audit del 2026-08-03:
 *   - primitiva `assertAppartiene`: casi positivi e negativi;
 *   - fix A: `chiudiSegnale` con segnaleId di altra org → throws;
 *   - fix B: `registraContatto` con personaId di altra org → throws;
 *   - fix I: `scriviAccessoScheda` con personaId di altra org → throws.
 *
 * Richiede una connessione al DB reale (container `postgis` di docker
 * compose): se `DATABASE_URL` manca, i test sono skipped — non è un
 * modo per farli passare in CI, è un modo per non rompere ambienti che
 * non hanno il container acceso.
 *
 * I test usano transazioni e ROLLBACK per non sporcare il DB.
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import postgres from "postgres";
import {
  AppartenenzaViolata,
  assertAppartiene,
  chiudiSegnale,
  generaGiroDelGiorno,
  registraContatto,
  scriviAccessoScheda,
} from "../src/index";

const DATABASE_URL = process.env.DATABASE_URL;
const skip = !DATABASE_URL
  ? { skip: "DATABASE_URL non impostata: test di integrazione saltato" as string }
  : undefined;

// Fixture derivata dal seed del DB (org 1 Parma, org 2 Bologna) —
// nessuna scrittura in setup: gli id sono già lì.
const ORG_PARMA = 1;
const ORG_BOLOGNA = 2;
const VOLONTARIO_PARMA = 2;     // Volontario 1 org=1
const VOLONTARIO_BOLOGNA = 224; // Volontario 1 (bologna) org=2

async function conPersone(): Promise<{
  personaParma: number; personaBologna: number;
}> {
  const sql = postgres(DATABASE_URL!, { max: 1 });
  try {
    const [p1] = await sql<Array<{ id: number }>>`
      SELECT id FROM riservato.persona
       WHERE organizzazione_id = ${ORG_PARMA} AND attiva ORDER BY id LIMIT 1
    `;
    const [p2] = await sql<Array<{ id: number }>>`
      SELECT id FROM riservato.persona
       WHERE organizzazione_id = ${ORG_BOLOGNA} AND attiva ORDER BY id LIMIT 1
    `;
    return { personaParma: p1.id, personaBologna: p2.id };
  } finally {
    await sql.end();
  }
}

// -------------------------------------------------- primitiva

test("assertAppartiene — nessun id passato: no-op", skip ?? {}, async () => {
  const sql = postgres(DATABASE_URL!, { max: 1 });
  try {
    await assertAppartiene(sql, ORG_PARMA, {}); // non deve lanciare
  } finally {
    await sql.end();
  }
});

test("assertAppartiene — persona propria della sessione: OK", skip ?? {}, async () => {
  const { personaParma } = await conPersone();
  const sql = postgres(DATABASE_URL!, { max: 1 });
  try {
    await assertAppartiene(sql, ORG_PARMA, { personaId: personaParma });
  } finally {
    await sql.end();
  }
});

test("assertAppartiene — persona di altra org: throws AppartenenzaViolata", skip ?? {}, async () => {
  const { personaBologna } = await conPersone();
  const sql = postgres(DATABASE_URL!, { max: 1 });
  try {
    await assert.rejects(
      () => assertAppartiene(sql, ORG_PARMA, { personaId: personaBologna }),
      (err) => err instanceof AppartenenzaViolata
        && err.message.includes(`persona ${personaBologna}`),
    );
  } finally {
    await sql.end();
  }
});

test("assertAppartiene — volontario di altra org: throws", skip ?? {}, async () => {
  const sql = postgres(DATABASE_URL!, { max: 1 });
  try {
    await assert.rejects(
      () => assertAppartiene(sql, ORG_PARMA, { volontarioId: VOLONTARIO_BOLOGNA }),
      (err) => err instanceof AppartenenzaViolata
        && err.message.includes(`volontario ${VOLONTARIO_BOLOGNA}`),
    );
  } finally {
    await sql.end();
  }
});

test("assertAppartiene — persona inesistente: throws", skip ?? {}, async () => {
  const sql = postgres(DATABASE_URL!, { max: 1 });
  try {
    await assert.rejects(
      () => assertAppartiene(sql, ORG_PARMA, { personaId: 999_999_999 }),
      (err) => err instanceof AppartenenzaViolata,
    );
  } finally {
    await sql.end();
  }
});

test("assertAppartiene — miscela: persona propria + volontario altrui → throws elencando solo l'altrui", skip ?? {}, async () => {
  const { personaParma } = await conPersone();
  const sql = postgres(DATABASE_URL!, { max: 1 });
  try {
    await assert.rejects(
      () => assertAppartiene(sql, ORG_PARMA, {
        personaId: personaParma,          // ok
        volontarioId: VOLONTARIO_BOLOGNA, // altrui
      }),
      (err) => {
        if (!(err instanceof AppartenenzaViolata)) return false;
        return err.message.includes(`volontario ${VOLONTARIO_BOLOGNA}`)
          && !err.message.includes(`persona ${personaParma}`);
      },
    );
  } finally {
    await sql.end();
  }
});

// -------------------------------------------------- Fix B — registraContatto

test("Fix B — registraContatto cross-org: throws e nessuna riga scritta", skip ?? {}, async () => {
  const { personaBologna } = await conPersone();
  const sql = postgres(DATABASE_URL!, { max: 2 });
  try {
    // Attack: volontario Parma tenta di registrare un contatto su persona
    // Bologna dichiarando organizzazioneSessione=Parma (come farebbe il
    // codice della pagina — l'org viene dal cookie, non dal body).
    await assert.rejects(
      () => registraContatto(sql, {
        organizzazioneSessione: ORG_PARMA,
        volontarioId: VOLONTARIO_PARMA,
        personaId: personaBologna,
        esito: "sta_bene",
        segnaliNuovi: [],
        segnaliDaChiudere: [],
      }),
      (err) => err instanceof AppartenenzaViolata,
    );

    // Verifica nel DB che NESSUNA riga di contatto sia stata inserita
    // per quella persona da quel volontario (guard contro side-effect
    // parziali prima del throw).
    const [r] = await sql<Array<{ n: number }>>`
      SELECT count(*)::int AS n FROM riservato.contatto
       WHERE volontario_id = ${VOLONTARIO_PARMA}
         AND persona_id = ${personaBologna}
    `;
    assert.equal(r.n, 0, "contatto cross-org non deve essere scritto");
  } finally {
    await sql.end();
  }
});

test("Fix B — registraContatto same-org: OK", skip ?? {}, async () => {
  const { personaParma } = await conPersone();
  const sql = postgres(DATABASE_URL!, { max: 2 });
  try {
    // Path felice: la chiamata legittima passa. Poi DELETE del contatto
    // scritto per non sporcare il DB (non uso sql.begin+rollback perché
    // registraContatto contiene già una .begin e postgres.js non
    // annida transazioni con la stessa API).
    await registraContatto(sql, {
      organizzazioneSessione: ORG_PARMA,
      volontarioId: VOLONTARIO_PARMA,
      personaId: personaParma,
      esito: "sta_bene",
      segnaliNuovi: [],
      segnaliDaChiudere: [],
    });
    const [r] = await sql<Array<{ n: number }>>`
      SELECT count(*)::int AS n FROM riservato.contatto
       WHERE volontario_id = ${VOLONTARIO_PARMA}
         AND persona_id = ${personaParma}
         AND esito = 'sta_bene'
    `;
    assert.ok(r.n >= 1, "contatto same-org deve essere scritto");
    // Cleanup: rimuovo solo l'ultimo (il test potrebbe girare più volte,
    // ma cancellare TUTTI eliminerebbe righe legittime del generatore).
    await sql`
      DELETE FROM riservato.contatto
       WHERE id IN (
         SELECT id FROM riservato.contatto
          WHERE volontario_id = ${VOLONTARIO_PARMA}
            AND persona_id = ${personaParma}
            AND esito = 'sta_bene'
          ORDER BY data DESC LIMIT 1
       )
    `;
  } finally {
    await sql.end();
  }
});

// -------------------------------------------------- Fix A — chiudiSegnale

test("Fix A — chiudiSegnale cross-org: throws e segnale rimane aperto", skip ?? {}, async () => {
  const { personaBologna } = await conPersone();
  const sql = postgres(DATABASE_URL!, { max: 2 });
  let segnaleIdBologna: number | null = null;
  try {
    // Setup: inserisce un segnale sintomi_riferiti aperto su una persona
    // Bologna. Restituisce l'id. Ripulito nel finally.
    const [ins] = await sql<Array<{ id: number }>>`
      INSERT INTO riservato.segnale
        (persona_id, tipo, origine, valido_fino, fixture_id)
      VALUES
        (${personaBologna}, 'sintomi_riferiti', 'coordinatore', NULL,
         ${'test-isolamento-' + Date.now()})
      RETURNING id
    `;
    segnaleIdBologna = ins.id;

    // Attack: coordinatore Parma (id 1 dal seed) tenta di chiudere il
    // segnale Bologna. La sessione dichiara org=Parma.
    const COORDINATORE_PARMA = 1;
    await assert.rejects(
      () => chiudiSegnale(sql, ORG_PARMA, segnaleIdBologna!, COORDINATORE_PARMA),
      (err) => err instanceof AppartenenzaViolata,
    );

    // Verifica: il segnale è ancora chiuso_il IS NULL — la UPDATE non
    // deve essere partita.
    const [r] = await sql<Array<{ chiusoIl: string | null }>>`
      SELECT chiuso_il AS "chiusoIl" FROM riservato.segnale WHERE id = ${segnaleIdBologna}
    `;
    assert.equal(r.chiusoIl, null, "chiudi cross-org non deve chiudere il segnale");
  } finally {
    if (segnaleIdBologna != null) {
      await sql`DELETE FROM riservato.segnale WHERE id = ${segnaleIdBologna}`;
    }
    await sql.end();
  }
});

// -------------------------------------------------- Fix I — scriviAccessoScheda

test("Fix I — scriviAccessoScheda cross-org: throws e nessun log scritto", skip ?? {}, async () => {
  const { personaBologna } = await conPersone();
  const sql = postgres(DATABASE_URL!, { max: 2 });
  try {
    await assert.rejects(
      () => scriviAccessoScheda(sql, ORG_PARMA, VOLONTARIO_PARMA, personaBologna),
      (err) => err instanceof AppartenenzaViolata,
    );
    const [r] = await sql<Array<{ n: number }>>`
      SELECT count(*)::int AS n FROM riservato.accesso_scheda
       WHERE utente_id = ${VOLONTARIO_PARMA} AND persona_id = ${personaBologna}
    `;
    assert.equal(r.n, 0, "log accesso cross-org non deve essere scritto");
  } finally {
    await sql.end();
  }
});

// ================================================ §12w — generaGiroDelGiorno
//
// Un test unico sul pattern "una scrittura si limita al suo perimetro".
// Copre:
//   - assegnazione: FIX del bug del 2026-08-04 (DELETE senza scope org)
//   - rango_giorno: REGRESSIONE FUTURA del pattern già corretto in §12b
//   - punteggio_sezione: INVARIANTE di comune (nessun DELETE, solo UPSERT
//     su chiave che è naturalmente comune-scoped via sezione_id)
// Più un test sulle protette (regola nuova §12w).
//
// Data futura fuori range operativo (2099) per non contaminare le fixture
// esistenti; cleanup completo su try/finally, il ROLLBACK non serve perché
// generaGiroDelGiorno usa `sql.begin` interno e commit al successo.

async function pulisciDataTest(sql: postgres.Sql, dataTest: string): Promise<void> {
  await sql`DELETE FROM riservato.contatto WHERE data::date = ${dataTest}::date`;
  await sql`DELETE FROM riservato.assegnazione WHERE data = ${dataTest}::date`;
  await sql`DELETE FROM riservato.rango_giorno WHERE data = ${dataTest}::date`;
  await sql`DELETE FROM riservato.soglia_giorno WHERE data = ${dataTest}::date`;
  await sql`DELETE FROM pubblico.punteggio_sezione WHERE data = ${dataTest}::date`;
  await sql`DELETE FROM pubblico.allerta WHERE data = ${dataTest}::date`;
}

test("§12w — generaGiroDelGiorno per Bologna non tocca le tabelle di Parma", skip ?? {}, async () => {
  const DATA_TEST = "2099-01-01";
  const sql = postgres(DATABASE_URL!, { max: 5 });
  try {
    await pulisciDataTest(sql, DATA_TEST);
    const { personaParma } = await conPersone();
    const [sezParma] = await sql<Array<{ id: string }>>`
      SELECT id FROM pubblico.sezione
       WHERE comune_istat = '034027' AND NOT fittizia
       ORDER BY id LIMIT 1
    `;

    // Setup: allerta per entrambi i comuni + sentinelle nelle tre tabelle
    // di Parma (posizione=99, rango=999, punteggio=0.42) — valori
    // inconfondibili, così se generaGiro Bologna li tocca il test cade.
    await sql`
      INSERT INTO pubblico.allerta (comune_istat, data, livello, provenienza, orizzonte_ore, data_estrazione)
      VALUES ('034027', ${DATA_TEST}::date, 2, 'stima', 24, ${DATA_TEST}::date)
    `;
    await sql`
      INSERT INTO pubblico.allerta (comune_istat, data, livello, provenienza, orizzonte_ore, data_estrazione)
      VALUES ('037006', ${DATA_TEST}::date, 3, 'bollettino', 24, ${DATA_TEST}::date)
    `;
    await sql`
      INSERT INTO riservato.assegnazione
        (data, organizzazione_id, persona_id, volontario_id, posizione, rango_globale, azione, fattori)
      VALUES
        (${DATA_TEST}::date, ${ORG_PARMA}, ${personaParma}, ${VOLONTARIO_PARMA},
         99, 999, 'prima_chiamata', '[]'::jsonb)
    `;
    await sql`
      INSERT INTO riservato.rango_giorno (organizzazione_id, data, persona_id, rango, punteggio)
      VALUES (${ORG_PARMA}, ${DATA_TEST}::date, ${personaParma}, 999, 0.5)
    `;
    await sql`
      INSERT INTO pubblico.punteggio_sezione (sezione_id, data, punteggio, ranghi, pesi, fattori_disponibili)
      VALUES (${sezParma.id}, ${DATA_TEST}::date, 0.42,
              '{}'::jsonb, '{}'::jsonb, ARRAY['test']::text[])
    `;

    // Act: genera giro Bologna sulla stessa data
    await generaGiroDelGiorno(sql, ORG_BOLOGNA, DATA_TEST);

    // Assert: le tre sentinelle Parma sono intatte
    const [a] = await sql<Array<{ n: number; posizione: number | null }>>`
      SELECT count(*)::int AS n, max(posizione) AS posizione
        FROM riservato.assegnazione
       WHERE data = ${DATA_TEST}::date
         AND organizzazione_id = ${ORG_PARMA}
         AND persona_id = ${personaParma}
    `;
    assert.equal(a.n, 1, "assegnazione Parma cancellata da generaGiro Bologna (FIX BUG §12w)");
    assert.equal(a.posizione, 99, "posizione sentinella cambiata: la riga è stata sostituita");

    const [r] = await sql<Array<{ n: number; rango: number | null }>>`
      SELECT count(*)::int AS n, max(rango) AS rango
        FROM riservato.rango_giorno
       WHERE data = ${DATA_TEST}::date
         AND organizzazione_id = ${ORG_PARMA}
         AND persona_id = ${personaParma}
    `;
    assert.equal(r.n, 1, "rango_giorno Parma cancellato da generaGiro Bologna");
    assert.equal(r.rango, 999, "rango sentinella cambiato");

    const [p] = await sql<Array<{ punteggio: number | null }>>`
      SELECT punteggio FROM pubblico.punteggio_sezione
       WHERE sezione_id = ${sezParma.id} AND data = ${DATA_TEST}::date
    `;
    assert.equal(
      p?.punteggio, 0.42,
      "punteggio_sezione di sezione Parma cancellato o sovrascritto — l'invariante di comune non ha retto",
    );
  } finally {
    await pulisciDataTest(sql, DATA_TEST);
    await sql.end();
  }
});

test("§12w — protette: chi ha un contatto oggi resta nel giro alla rigenerazione", skip ?? {}, async () => {
  const DATA_TEST = "2099-01-02";
  const sql = postgres(DATABASE_URL!, { max: 5 });
  try {
    await pulisciDataTest(sql, DATA_TEST);
    const { personaParma } = await conPersone();

    // Setup: allerta Parma + assegnazione preesistente per personaParma
    // in una posizione fuori dalla nuova soglia (99), + contatto oggi.
    // La regola §12w dice: nonostante la nuova classifica escluderebbe
    // personaParma dal giro (rango 999 fuori dai top-N), la sua riga
    // sopravvive alla rigenerazione perché ha già un contatto.
    await sql`
      INSERT INTO pubblico.allerta (comune_istat, data, livello, provenienza, orizzonte_ore, data_estrazione)
      VALUES ('034027', ${DATA_TEST}::date, 2, 'stima', 24, ${DATA_TEST}::date)
    `;
    await sql`
      INSERT INTO riservato.assegnazione
        (data, organizzazione_id, persona_id, volontario_id, posizione, rango_globale, azione, fattori)
      VALUES
        (${DATA_TEST}::date, ${ORG_PARMA}, ${personaParma}, ${VOLONTARIO_PARMA},
         99, 999, 'prima_chiamata', '[]'::jsonb)
    `;
    await sql`
      INSERT INTO riservato.contatto (persona_id, volontario_id, data, esito)
      VALUES (${personaParma}, ${VOLONTARIO_PARMA},
              ${DATA_TEST}::date + interval '10 hours', 'contattata'::text::text)
    `.catch(async () => {
      // Se il CHECK di esito non ammette 'contattata', usa 'sta_bene' che
      // è nella whitelist. La regola delle protette guarda solo l'esistenza
      // della riga in contatto, non l'esito specifico.
      await sql`
        INSERT INTO riservato.contatto (persona_id, volontario_id, data, esito)
        VALUES (${personaParma}, ${VOLONTARIO_PARMA},
                ${DATA_TEST}::date + interval '10 hours', 'sta_bene')
      `;
    });

    // Act: rigenera il giro con la nuova classifica
    await generaGiroDelGiorno(sql, ORG_PARMA, DATA_TEST);

    // Assert: la persona protetta è ancora assegnata (con posizione e
    // volontario originali — la sua riga non è mai stata cancellata)
    const [row] = await sql<Array<{
      n: number; posizione: number | null; volontarioId: number | null;
    }>>`
      SELECT count(*)::int AS n,
             max(posizione)     AS posizione,
             max(volontario_id) AS "volontarioId"
        FROM riservato.assegnazione
       WHERE data = ${DATA_TEST}::date
         AND organizzazione_id = ${ORG_PARMA}
         AND persona_id = ${personaParma}
    `;
    assert.equal(row.n, 1, "persona con contatto oggi doveva restare nel giro dopo rigenerazione");
    assert.equal(row.posizione, 99, "posizione della persona protetta cambiata: dovrebbe restare quella originale");
    assert.equal(row.volontarioId, VOLONTARIO_PARMA, "volontario cambiato: la protetta doveva restare col suo");
  } finally {
    await pulisciDataTest(sql, DATA_TEST);
    await sql.end();
  }
});

// -------------------------------------------------- §12xxx — regola "domanda possiede tipi"
//
// La risposta a una domanda del form governa il dominio di tipi che
// la domanda possiede: apre uno di quei tipi (o nessuno) e chiude
// tutti gli altri. La chiusura passa da segnaliDaChiudere in
// registraContatto, che dentro la stessa transazione fa UPDATE con
// chiuso_da = volontarioId. Testato:
//   - transizione che apre e chiude insieme (radio group climatizzazione:
//     "Non funziona" → apre ventilatore_rotto, chiude nessuna_climatizzazione)
//   - transizione che chiude senza aprire (domanda aiuto: "Sì, in famiglia"
//     → chiude rete_familiare_assente, non apre niente)
// Il primo caso verifica anche che la chiusura tocchi segnali di
// origine diversa da 'volontario' (fixture con origine 'coordinatore'
// viene chiusa dal volontario — decisione §12xxx gerarchia fra fonti).

test("§12xxx — apre ventilatore_rotto e chiude nessuna_climatizzazione insieme, atomico", skip ?? {}, async () => {
  const { personaParma } = await conPersone();
  const sql = postgres(DATABASE_URL!, { max: 2 });
  const marker = `test-12xxx-a-${Date.now()}`;
  try {
    // Setup: apro una nessuna_climatizzazione con origine 'coordinatore'
    // per verificare che la regola chiude segnali di qualunque origine
    // (decisione §12xxx: la risposta di oggi del volontario è evidenza
    // più recente delle fonti esterne).
    await sql`
      INSERT INTO riservato.segnale (persona_id, tipo, origine, fixture_id)
      VALUES (${personaParma}, 'nessuna_climatizzazione', 'coordinatore', ${marker})
    `;

    // Atto: il volontario risponde "Non funziona" alla domanda
    // climatizzazione. La regola dice: apri ventilatore_rotto, chiudi
    // nessuna_climatizzazione — tutto in una transazione.
    await registraContatto(sql, {
      organizzazioneSessione: ORG_PARMA,
      volontarioId: VOLONTARIO_PARMA,
      personaId: personaParma,
      esito: "ha_bisogno",
      segnaliNuovi: [{ tipo: "ventilatore_rotto", origine: "volontario" }],
      segnaliDaChiudere: ["nessuna_climatizzazione"],
    });

    // Verifica: nessuna_climatizzazione chiusa, chiuso_da = volontarioId,
    // origine originaria conservata (traccia della fonte).
    const [chiusa] = await sql<Array<{
      chiusoIl: string | null; chiusoDa: number | null; origine: string;
    }>>`
      SELECT chiuso_il AS "chiusoIl",
             chiuso_da AS "chiusoDa",
             origine   AS origine
        FROM riservato.segnale
       WHERE fixture_id = ${marker}
    `;
    assert.ok(chiusa.chiusoIl !== null, "nessuna_climatizzazione doveva essere chiusa");
    assert.equal(chiusa.chiusoDa, VOLONTARIO_PARMA, "chiuso_da doveva essere l'id del volontario");
    assert.equal(chiusa.origine, "coordinatore", "origine originale doveva restare (traccia della fonte)");

    // Verifica: ventilatore_rotto aperto sulla persona.
    const [aperto] = await sql<Array<{ n: number }>>`
      SELECT count(*)::int AS n FROM riservato.segnale
       WHERE persona_id = ${personaParma}
         AND tipo = 'ventilatore_rotto'
         AND chiuso_il IS NULL
         AND origine = 'volontario'
    `;
    assert.equal(aperto.n, 1, "ventilatore_rotto doveva essere aperto");
  } finally {
    // Cleanup — chiudo la ventilatore_rotto che ho aperto (non uso
    // DELETE per non toccare altre righe che il generatore avesse
    // creato in mezzo). fixture_id marker rende la nessuna_climatizzazione
    // rimovibile senza ambiguità.
    await sql`DELETE FROM riservato.segnale WHERE fixture_id = ${marker}`;
    await sql`
      DELETE FROM riservato.segnale
       WHERE persona_id = ${personaParma}
         AND tipo = 'ventilatore_rotto'
         AND origine = 'volontario'
         AND fixture_id IS NULL
    `;
    await sql`
      DELETE FROM riservato.contatto
       WHERE persona_id = ${personaParma}
         AND volontario_id = ${VOLONTARIO_PARMA}
         AND esito = 'ha_bisogno'
    `;
    await sql.end();
  }
});

test("§12xxx — chiude rete_familiare_assente senza aprire niente", skip ?? {}, async () => {
  const { personaParma } = await conPersone();
  const sql = postgres(DATABASE_URL!, { max: 2 });
  const marker = `test-12xxx-b-${Date.now()}`;
  try {
    // Setup: apro un rete_familiare_assente (origine mmg per rimarcare
    // che la regola chiude qualunque origine).
    await sql`
      INSERT INTO riservato.segnale (persona_id, tipo, origine, fixture_id)
      VALUES (${personaParma}, 'rete_familiare_assente', 'mmg', ${marker})
    `;

    // Atto: il volontario risponde "Sì, in famiglia" alla domanda
    // aiuto. La regola dice: nessun segnale nuovo, chiudi
    // rete_familiare_assente.
    await registraContatto(sql, {
      organizzazioneSessione: ORG_PARMA,
      volontarioId: VOLONTARIO_PARMA,
      personaId: personaParma,
      esito: "sta_bene",
      segnaliNuovi: [],
      segnaliDaChiudere: ["rete_familiare_assente"],
    });

    // Verifica: il segnale è ora chiuso, con chiuso_da = volontarioId,
    // origine 'mmg' conservata.
    const [chiusa] = await sql<Array<{
      chiusoIl: string | null; chiusoDa: number | null; origine: string;
    }>>`
      SELECT chiuso_il AS "chiusoIl",
             chiuso_da AS "chiusoDa",
             origine   AS origine
        FROM riservato.segnale
       WHERE fixture_id = ${marker}
    `;
    assert.ok(chiusa.chiusoIl !== null, "rete_familiare_assente doveva essere chiusa");
    assert.equal(chiusa.chiusoDa, VOLONTARIO_PARMA, "chiuso_da doveva essere l'id del volontario");
    assert.equal(chiusa.origine, "mmg", "origine 'mmg' doveva restare come traccia della fonte");

    // Verifica: nessun segnale nuovo generato dall'atto.
    const [nuovi] = await sql<Array<{ n: number }>>`
      SELECT count(*)::int AS n FROM riservato.segnale
       WHERE persona_id = ${personaParma}
         AND tipo = 'rete_familiare_assente'
         AND fixture_id IS NULL
         AND chiuso_il IS NULL
    `;
    assert.equal(nuovi.n, 0, "nessun rete_familiare_assente nuovo doveva essere creato");
  } finally {
    await sql`DELETE FROM riservato.segnale WHERE fixture_id = ${marker}`;
    await sql`
      DELETE FROM riservato.contatto
       WHERE persona_id = ${personaParma}
         AND volontario_id = ${VOLONTARIO_PARMA}
         AND esito = 'sta_bene'
    `;
    await sql.end();
  }
});
