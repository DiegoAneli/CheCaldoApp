/**
 * §12jjjjj — Test di integrazione: pausa/di-turno dei volontari.
 *
 * Copre le regole introdotte in §12jjjjj:
 *
 *   (a) il giro si distribuisce solo sui volontari di turno;
 *   (b) un volontario attivo ma in pausa oggi non riceve assegnazioni;
 *   (c) la continuità di §12iiiii non riporta la persona a un vol non
 *       di turno (fallback su round-robin come per vol inattivo);
 *   (d) fail-hard se nessuno è di turno (tutti in pausa);
 *   (e) `assertAppartiene` blocca `metteInPausa` / `riprendeDallaPausa`
 *       / `impostaAttivo` sui volontari di altra org;
 *   (f) generazione parziale + `nonAssegnatePerCapSaturato > 0` quando
 *       soglia > vol_di_turno × CAP.
 *
 * Setup pattern identico a §12iiiii: DATA_TEST=2099-04-01 fuori
 * range canone, cleanup completo in try/finally, wrapper invariante
 * non colpito (le date 2099 non finiscono nel conteggio
 * data::date=CURRENT_DATE).
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import postgres from "postgres";
import {
  AppartenenzaViolata,
  generaGiroDelGiorno,
  impostaAttivo,
  metteInPausa,
  presenzaVolontariOggi,
  riprendeDallaPausa,
  ultimoVolontarioRiuscitoPerPersona,
} from "../src/index";

const DATABASE_URL = process.env.DATABASE_URL;
const skip = !DATABASE_URL
  ? { skip: "DATABASE_URL non impostata: test di integrazione saltato" as string }
  : undefined;

const ORG_PARMA = 1;
const ORG_BOLOGNA = 2;
const COORDINATORE_PARMA = 1;
const V2 = 2;   // Volontario 1 org=1
const V3 = 3;
const V4 = 4;
const V5 = 5;
const V6 = 6;
const V7 = 7;
const VOLONTARIO_BOLOGNA = 224;
const CAP = 6;

const DATA_TEST = "2099-04-01";
const DATA_STORICO = "2099-03-15";

async function pulisciDataTest(sql: postgres.Sql, dataTest: string): Promise<void> {
  await sql`DELETE FROM riservato.contatto WHERE data::date = ${dataTest}::date`;
  await sql`DELETE FROM riservato.contatto WHERE data::date = ${DATA_STORICO}::date`;
  await sql`DELETE FROM riservato.assegnazione WHERE data = ${dataTest}::date`;
  await sql`DELETE FROM riservato.rango_giorno WHERE data = ${dataTest}::date`;
  await sql`DELETE FROM riservato.soglia_giorno WHERE data = ${dataTest}::date`;
  await sql`DELETE FROM riservato.pausa_volontario WHERE data = ${dataTest}::date`;
  // `generaGiroDelGiorno` scrive UPSERT su `pubblico.punteggio_sezione`
  // per tutte le sezioni valutate della data (query.ts:2725-2740).
  // Va incluso nel cleanup: senza questa riga ogni test che chiama
  // `generaGiroDelGiorno` lascia ~1039 righe residue (una per sezione
  // di Parma) sulla data futura. Scoperto post-§12jjjjj — 2078 righe
  // residue trovate a fine sessione (1039 × 2 date test).
  await sql`DELETE FROM pubblico.punteggio_sezione WHERE data = ${dataTest}::date`;
  await sql`DELETE FROM pubblico.allerta WHERE data = ${dataTest}::date`;
}

async function setupAllerta(
  sql: postgres.Sql, livello: number, soglia: number,
): Promise<void> {
  await sql`
    INSERT INTO pubblico.allerta
      (comune_istat, data, livello, provenienza, orizzonte_ore, data_estrazione)
    VALUES ('034027', ${DATA_TEST}::date, ${livello}, 'stima', 24, ${DATA_TEST}::date)
  `;
  await sql`
    INSERT INTO riservato.soglia_giorno
      (organizzazione_id, data, valore, impostata_da, livello_al_salvataggio)
    VALUES (${ORG_PARMA}, ${DATA_TEST}::date, ${soglia}, NULL, ${livello})
  `;
}

async function volOggiPer(sql: postgres.Sql, personaId: number): Promise<number | null> {
  const [row] = await sql<Array<{ volontarioId: number | null }>>`
    SELECT volontario_id AS "volontarioId"
      FROM riservato.assegnazione
     WHERE data = ${DATA_TEST}::date
       AND organizzazione_id = ${ORG_PARMA}
       AND persona_id = ${personaId}
  `;
  return row?.volontarioId ?? null;
}

// ============================================================
// (a) Il giro si distribuisce solo sui volontari di turno
// (b) Un vol attivo ma in pausa non riceve assegnazioni
// ============================================================

test(
  "§12jjjjj (a+b) — vol in pausa oggi non riceve assegnazioni, il giro va agli altri",
  skip ?? {},
  async () => {
    const sql = postgres(DATABASE_URL!, { max: 5 });
    try {
      await pulisciDataTest(sql, DATA_TEST);
      await setupAllerta(sql, 3, 36);
      // Metto V2 e V3 in pausa per DATA_TEST. Restano di turno V4-V7
      // (+ V8-V13 se il seed è stato esteso a 12 vol). Il giro deve
      // distribuire solo su chi è di turno.
      await metteInPausa(sql, ORG_PARMA, V2, DATA_TEST, COORDINATORE_PARMA);
      await metteInPausa(sql, ORG_PARMA, V3, DATA_TEST, COORDINATORE_PARMA);

      const risultato = await generaGiroDelGiorno(sql, ORG_PARMA, DATA_TEST);

      // Nessuna riga in assegnazione con V2 o V3 come vol.
      const [carichiPaused] = await sql<Array<{ n: number }>>`
        SELECT count(*)::int AS n FROM riservato.assegnazione
         WHERE data = ${DATA_TEST}::date
           AND organizzazione_id = ${ORG_PARMA}
           AND volontario_id IN (${V2}, ${V3})
      `;
      assert.equal(
        carichiPaused!.n, 0,
        "V2/V3 in pausa NON dovrebbero avere assegnazioni",
      );

      // Volontari di turno riportati correttamente in RisultatoGiro.
      assert.ok(
        risultato.volontariDiTurno < risultato.volontariAttivi,
        `volontariDiTurno (${risultato.volontariDiTurno}) < volontariAttivi (${risultato.volontariAttivi})`,
      );
      assert.equal(
        risultato.volontariAttivi - risultato.volontariDiTurno, 2,
        "differenza attivi-di_turno deve essere 2 (V2+V3 in pausa)",
      );
    } finally {
      await pulisciDataTest(sql, DATA_TEST);
      await sql.end();
    }
  },
);

// ============================================================
// (c) Continuità non riporta a vol non di turno
// ============================================================

test(
  "§12jjjjj (c) — continuità §12iiiii non riporta a vol in pausa, cade nel fallback",
  skip ?? {},
  async () => {
    const sql = postgres(DATABASE_URL!, { max: 5 });
    try {
      await pulisciDataTest(sql, DATA_TEST);
      await setupAllerta(sql, 3, 36);

      // Bootstrap: prima generazione a vuoto per popolare rango_giorno.
      await generaGiroDelGiorno(sql, ORG_PARMA, DATA_TEST);
      const [top1] = await sql<Array<{ id: number }>>`
        SELECT persona_id AS id FROM riservato.rango_giorno
         WHERE organizzazione_id = ${ORG_PARMA} AND data = ${DATA_TEST}::date
         ORDER BY rango LIMIT 1
      `;
      assert.ok(top1, "top-1 doveva esistere");

      // Insert storico sta_bene da V2 per top-1 (data < DATA_TEST).
      await sql`
        INSERT INTO riservato.contatto (persona_id, volontario_id, data, esito)
        VALUES (${top1.id}, ${V2},
                ${DATA_STORICO}::date + interval '10 hours', 'sta_bene')
      `;
      // Verifica che il legame ci sia (baseline).
      const mappa = await ultimoVolontarioRiuscitoPerPersona(sql, ORG_PARMA, DATA_TEST);
      assert.equal(mappa.get(top1.id), V2, "legame baseline verso V2");

      // Metto V2 in pausa oggi: continuità non deve scattare.
      await metteInPausa(sql, ORG_PARMA, V2, DATA_TEST, COORDINATORE_PARMA);
      const risultato = await generaGiroDelGiorno(sql, ORG_PARMA, DATA_TEST);

      const vol = await volOggiPer(sql, top1.id);
      assert.ok(vol !== null, "persona deve essere assegnata");
      assert.notEqual(vol, V2, "vol NON deve essere V2 (in pausa oggi)");
      assert.ok(
        risultato.legamePersoVolNonDisponibile >= 1,
        `contatore legamePersoVolNonDisponibile ≥ 1 (attuale: ${risultato.legamePersoVolNonDisponibile})`,
      );
    } finally {
      await pulisciDataTest(sql, DATA_TEST);
      await sql.end();
    }
  },
);

// ============================================================
// (d) Fail-hard se nessuno di turno
// ============================================================

test(
  "§12jjjjj (d) — fail-hard se tutti i volontari sono in pausa oggi",
  skip ?? {},
  async () => {
    const sql = postgres(DATABASE_URL!, { max: 5 });
    try {
      await pulisciDataTest(sql, DATA_TEST);
      await setupAllerta(sql, 3, 36);

      // Metto TUTTI i volontari attivi in pausa oggi.
      const attivi = await sql<Array<{ id: number }>>`
        SELECT id FROM riservato.utente
         WHERE organizzazione_id = ${ORG_PARMA}
           AND ruolo = 'volontario' AND attivo = true
      `;
      for (const v of attivi) {
        await metteInPausa(sql, ORG_PARMA, v.id, DATA_TEST, COORDINATORE_PARMA);
      }

      await assert.rejects(
        () => generaGiroDelGiorno(sql, ORG_PARMA, DATA_TEST),
        (err) => err instanceof Error
          && err.message.includes("nessun volontario di turno"),
        "deve throwsare con messaggio 'nessun volontario di turno'",
      );
    } finally {
      await pulisciDataTest(sql, DATA_TEST);
      await sql.end();
    }
  },
);

// ============================================================
// (e) assertAppartiene cross-org
// ============================================================

test(
  "§12jjjjj (e) — metteInPausa cross-org lancia AppartenenzaViolata",
  skip ?? {},
  async () => {
    const sql = postgres(DATABASE_URL!, { max: 2 });
    try {
      // Sessione = Parma, tento di mettere in pausa un vol di Bologna.
      await assert.rejects(
        () => metteInPausa(
          sql, ORG_PARMA, VOLONTARIO_BOLOGNA, DATA_TEST, COORDINATORE_PARMA,
        ),
        (err) => err instanceof AppartenenzaViolata,
        "deve lanciare AppartenenzaViolata",
      );
      // Verifica che NON sia stata scritta la riga.
      const [rows] = await sql<Array<{ n: number }>>`
        SELECT count(*)::int AS n FROM riservato.pausa_volontario
         WHERE volontario_id = ${VOLONTARIO_BOLOGNA}
           AND data = ${DATA_TEST}::date
      `;
      assert.equal(rows!.n, 0, "nessuna riga scritta cross-org");
    } finally {
      await sql.end();
    }
  },
);

test(
  "§12jjjjj (e) — impostaAttivo cross-org lancia AppartenenzaViolata",
  skip ?? {},
  async () => {
    const sql = postgres(DATABASE_URL!, { max: 2 });
    try {
      // Salvo lo stato pre per verifica no-write.
      const [pre] = await sql<Array<{ attivo: boolean }>>`
        SELECT attivo FROM riservato.utente WHERE id = ${VOLONTARIO_BOLOGNA}
      `;
      await assert.rejects(
        () => impostaAttivo(
          sql, ORG_PARMA, VOLONTARIO_BOLOGNA, false, COORDINATORE_PARMA,
        ),
        (err) => err instanceof AppartenenzaViolata,
      );
      const [post] = await sql<Array<{ attivo: boolean }>>`
        SELECT attivo FROM riservato.utente WHERE id = ${VOLONTARIO_BOLOGNA}
      `;
      assert.equal(post!.attivo, pre!.attivo, "attivo cross-org NON deve cambiare");
    } finally {
      await sql.end();
    }
  },
);

// ============================================================
// (f) Generazione parziale quando cap saturato
// ============================================================

test(
  "§12jjjjj (f) — soglia > vol_di_turno × CAP: generazione parziale + contatore",
  skip ?? {},
  async () => {
    const sql = postgres(DATABASE_URL!, { max: 5 });
    try {
      await pulisciDataTest(sql, DATA_TEST);
      // Soglia 30, ma metto in pausa abbastanza vol da lasciare posti
      // < 30. Se ho 6 vol attivi e ne metto in pausa 2 → 4 di turno →
      // 24 posti. Soglia 30 → 6 non assegnate.
      //
      // Attivo pochi conteggi: prima leggo quanti vol attivi ci sono
      // per non dipendere da 6 o 12 (in dipendenza dallo stato del seed).
      const [attivi] = await sql<Array<{ n: number }>>`
        SELECT count(*)::int AS n FROM riservato.utente
         WHERE organizzazione_id = ${ORG_PARMA}
           AND ruolo = 'volontario' AND attivo = true
      `;
      const nAttivi = attivi!.n;
      assert.ok(nAttivi >= 4, "test richiede almeno 4 vol attivi");

      // Metto in pausa (nAttivi - 4) volontari così restano 4 di turno.
      // Prendo i primi in ordine di email per essere deterministico.
      const daMettereInPausa = await sql<Array<{ id: number }>>`
        SELECT id FROM riservato.utente
         WHERE organizzazione_id = ${ORG_PARMA}
           AND ruolo = 'volontario' AND attivo = true
         ORDER BY email
         LIMIT ${nAttivi - 4}
      `;
      for (const v of daMettereInPausa) {
        await metteInPausa(sql, ORG_PARMA, v.id, DATA_TEST, COORDINATORE_PARMA);
      }

      // Setup allerta + soglia 30: 4 vol × 6 = 24 posti < 30 = 6 fuori.
      await setupAllerta(sql, 3, 30);

      const risultato = await generaGiroDelGiorno(sql, ORG_PARMA, DATA_TEST);

      assert.equal(
        risultato.volontariDiTurno, 4,
        "4 vol di turno attesi",
      );
      assert.equal(
        risultato.nonAssegnatePerCapSaturato, 6,
        `6 persone attese fuori (soglia 30 - 24 posti); ottenute ${risultato.nonAssegnatePerCapSaturato}`,
      );
      // La generazione ha comunque prodotto assegnazioni: NON è
      // fail-hard, è parziale. Il totale assegnate deve essere ≤ 24.
      assert.ok(
        risultato.totaleAssegnate <= 24,
        `totaleAssegnate=${risultato.totaleAssegnate} deve essere ≤ 24 (cap)`,
      );
      assert.ok(
        risultato.totaleAssegnate > 0,
        `totaleAssegnate=${risultato.totaleAssegnate} deve essere > 0 (parziale, non zero)`,
      );

      // Verifica DB: nessun vol supera CAP.
      const carichi = await sql<Array<{ vol: number; n: number }>>`
        SELECT volontario_id AS vol, count(*)::int AS n
          FROM riservato.assegnazione
         WHERE data = ${DATA_TEST}::date
           AND organizzazione_id = ${ORG_PARMA}
         GROUP BY volontario_id
      `;
      for (const { vol, n } of carichi) {
        assert.ok(n <= CAP, `vol ${vol} con ${n} > CAP=${CAP}`);
      }
    } finally {
      // Cleanup — riprendo tutti dalla pausa (idempotente).
      const attivi = await sql<Array<{ id: number }>>`
        SELECT id FROM riservato.utente
         WHERE organizzazione_id = ${ORG_PARMA}
           AND ruolo = 'volontario' AND attivo = true
      `;
      for (const v of attivi) {
        await riprendeDallaPausa(sql, ORG_PARMA, v.id, DATA_TEST, COORDINATORE_PARMA);
      }
      await pulisciDataTest(sql, DATA_TEST);
      await sql.end();
    }
  },
);

// ============================================================
// (g) presenzaVolontariOggi torna gli stati corretti
// ============================================================

test(
  "§12jjjjj (g) — presenzaVolontariOggi torna inPausa e personeInCarico corretti",
  skip ?? {},
  async () => {
    const sql = postgres(DATABASE_URL!, { max: 3 });
    try {
      await pulisciDataTest(sql, DATA_TEST);
      await setupAllerta(sql, 2, 20);

      await metteInPausa(sql, ORG_PARMA, V2, DATA_TEST, COORDINATORE_PARMA);
      const primaGenera = await presenzaVolontariOggi(sql, ORG_PARMA, DATA_TEST);
      // V2 in pausa, nessuna assegnazione ancora scritta.
      const v2Pre = primaGenera.find((v) => v.id === V2)!;
      assert.equal(v2Pre.inPausa, true, "V2 in pausa dopo metteInPausa");
      assert.equal(v2Pre.personeInCarico, 0, "V2 senza assegnazioni pre-generazione");

      // Genero il giro: V2 non riceve (in pausa), gli altri sì.
      await generaGiroDelGiorno(sql, ORG_PARMA, DATA_TEST);
      const dopoGenera = await presenzaVolontariOggi(sql, ORG_PARMA, DATA_TEST);
      const v2Post = dopoGenera.find((v) => v.id === V2)!;
      const v3Post = dopoGenera.find((v) => v.id === V3)!;
      assert.equal(v2Post.inPausa, true, "V2 resta in pausa");
      assert.equal(v2Post.personeInCarico, 0, "V2 in pausa: nessuna assegnazione");
      assert.equal(v3Post.inPausa, false, "V3 non in pausa");
      assert.ok(v3Post.personeInCarico > 0, "V3 di turno ha carico > 0");
    } finally {
      await pulisciDataTest(sql, DATA_TEST);
      await sql.end();
    }
  },
);
