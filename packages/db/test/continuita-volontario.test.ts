/**
 * §12iiiii — Test di integrazione: continuità volontario↔persona.
 *
 * Copre la regola introdotta in §12iiiii: una persona torna al
 * volontario che l'ha già contattata con esito riuscito, se il vol è
 * ancora attivo oggi e ha carico < CAP_PER_VOLONTARIO. Altrimenti
 * ricade nel round-robin per quartiere pre-esistente.
 *
 * Sei test allineati al brief §12iiiii:
 *   (a) contatto passato riuscito (sta_bene / ha_bisogno) → legame
 *       scatta, la persona torna al vol storico.
 *   (b) contatto passato con 'non_risponde' → nessun legame, la
 *       persona entra nel round-robin normale.
 *   (c) vol storico saturo (6 legami più prioritari): la persona
 *       finisce a un altro vol.
 *   (d) vol storico oggi non attivo: la persona finisce a un altro vol.
 *   (e) contatto passato con volontario_id NULL: nessun legame,
 *       round-robin normale.
 *   (f) invariante di cap: nessun vol supera CAP_PER_VOLONTARIO per
 *       effetto della continuità (né per effetto combinato con
 *       protette + fallback quartiere).
 *
 * Setup pattern:
 *  - DATA_TEST futura (2099-03-01) fuori dal range canone.
 *  - DATA_STORICO poco prima (2099-02-15): più recente di qualunque
 *    canone contatto (2026-xx-xx), quindi i test contatti vincono
 *    il `DISTINCT ON (persona_id) ORDER BY data DESC` sopra qualunque
 *    canone. Necessario perché il canone Parma ha molti contatti
 *    riuscito per le persone in cima alla classifica.
 *  - Bootstrap con `generaGiroDelGiorno` a vuoto per popolare
 *    `rango_giorno` sulla data futura (i segnali con `valido_fino`
 *    scadono, la classifica su 2099-03-01 differisce da quella
 *    canonica di 2026): dopo il bootstrap sappiamo davvero chi
 *    entra nel top-N per quella data.
 *  - Test unitari sulla query usano invece persone senza contatti
 *    canonici (`riservato.persona.id` non toccato dal generatore
 *    fixture per certi range) così l'assertion "non deve creare
 *    legame" ha significato univoco.
 *
 * Cleanup completo per data in try/finally. Nessuna scrittura al
 * canone reale. Il wrapper `test-con-invariante.ts` guarda
 * `data::date = CURRENT_DATE` sui contatti app-side, quindi le date
 * 2099 non contaminano il conteggio del wrapper.
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import postgres from "postgres";
import {
  generaGiroDelGiorno,
  ultimoVolontarioRiuscitoPerPersona,
} from "../src/index";

const DATABASE_URL = process.env.DATABASE_URL;
const skip = !DATABASE_URL
  ? { skip: "DATABASE_URL non impostata: test di integrazione saltato" as string }
  : undefined;

const ORG_PARMA = 1;
const V2 = 2;   // Volontario 1 org=1 (chiamato "V2" per id numerico)
const V3 = 3;
const CAP = 6;

const DATA_TEST = "2099-03-01";
const DATA_STORICO = "2099-02-15";

/**
 * Cleanup delle scritture di test per una data specifica. Include
 * anche DATA_STORICO perché i test scrivono contatti su entrambe.
 */
async function pulisciDataTest(sql: postgres.Sql, dataTest: string): Promise<void> {
  await sql`DELETE FROM riservato.contatto WHERE data::date = ${dataTest}::date`;
  await sql`DELETE FROM riservato.contatto WHERE data::date = ${DATA_STORICO}::date`;
  await sql`DELETE FROM riservato.assegnazione WHERE data = ${dataTest}::date`;
  await sql`DELETE FROM riservato.rango_giorno WHERE data = ${dataTest}::date`;
  await sql`DELETE FROM riservato.soglia_giorno WHERE data = ${dataTest}::date`;
  // `generaGiroDelGiorno` scrive UPSERT su `pubblico.punteggio_sezione`
  // per tutte le sezioni valutate della data (query.ts:2725-2740).
  // Va incluso nel cleanup: senza questa riga, ogni test che chiama
  // `generaGiroDelGiorno` lascia ~1039 righe residue (una per sezione
  // di Parma) sulla data futura. Scoperto post-§12jjjjj — 2078 righe
  // residue trovate a fine sessione (1039 × 2 date test).
  await sql`DELETE FROM pubblico.punteggio_sezione WHERE data = ${dataTest}::date`;
  await sql`DELETE FROM pubblico.allerta WHERE data = ${dataTest}::date`;
}

/**
 * Setup base: allerta livello 3 su Parma per DATA_TEST + soglia_giorno=36.
 * Bootstrap con `generaGiroDelGiorno` a vuoto per popolare
 * `rango_giorno` sulla data futura, poi ritorna i top-N id persona
 * (numerici) dalla classifica reale del test date — non da quella
 * di oggi, che sarebbe diversa (i segnali con `valido_fino` datati
 * 2026 sono tutti scaduti al 2099).
 */
async function setupBase(sql: postgres.Sql, topN: number): Promise<number[]> {
  await sql`
    INSERT INTO pubblico.allerta
      (comune_istat, data, livello, provenienza, orizzonte_ore, data_estrazione)
    VALUES ('034027', ${DATA_TEST}::date, 3, 'stima', 24, ${DATA_TEST}::date)
  `;
  await sql`
    INSERT INTO riservato.soglia_giorno
      (organizzazione_id, data, valore, impostata_da, livello_al_salvataggio)
    VALUES (${ORG_PARMA}, ${DATA_TEST}::date, 36, NULL, 3)
  `;
  // Bootstrap: prima generazione con nessun contatto di test. Serve
  // solo a popolare `riservato.rango_giorno` per DATA_TEST, così
  // possiamo leggere il top-N reale della data 2099-03-01.
  await generaGiroDelGiorno(sql, ORG_PARMA, DATA_TEST);
  const rows = await sql<Array<{ id: number }>>`
    SELECT persona_id AS id FROM riservato.rango_giorno
     WHERE organizzazione_id = ${ORG_PARMA} AND data = ${DATA_TEST}::date
     ORDER BY rango
     LIMIT ${topN}
  `;
  return rows.map((r) => r.id);
}

async function inserisciStorico(
  sql: postgres.Sql,
  personaId: number,
  volontarioId: number | null,
  esito: "sta_bene" | "ha_bisogno" | "non_risponde",
): Promise<void> {
  await sql`
    INSERT INTO riservato.contatto (persona_id, volontario_id, data, esito)
    VALUES (${personaId}, ${volontarioId},
            ${DATA_STORICO}::date + interval '10 hours', ${esito})
  `;
}

async function volPerPersonaOggi(
  sql: postgres.Sql,
  personaId: number,
): Promise<number | null> {
  const [row] = await sql<Array<{ volontarioId: number | null }>>`
    SELECT volontario_id AS "volontarioId"
      FROM riservato.assegnazione
     WHERE data = ${DATA_TEST}::date
       AND organizzazione_id = ${ORG_PARMA}
       AND persona_id = ${personaId}
  `;
  return row?.volontarioId ?? null;
}

/**
 * Restituisce N persone dell'organizzazione senza NESSUN contatto
 * canonico (di alcun esito). Per i test unitari sulla query
 * `ultimoVolontarioRiuscitoPerPersona`: se il canone avesse contatti
 * riuscito per la persona, l'assertion "non deve creare legame"
 * mescolerebbe l'effetto della mia INSERT con quello del canone.
 */
async function personePulite(sql: postgres.Sql, n: number): Promise<number[]> {
  const rows = await sql<Array<{ id: number }>>`
    SELECT p.id FROM riservato.persona p
     WHERE p.organizzazione_id = ${ORG_PARMA} AND p.attiva
       AND NOT EXISTS (
         SELECT 1 FROM riservato.contatto c WHERE c.persona_id = p.id
       )
     ORDER BY p.id
     LIMIT ${n}
  `;
  return rows.map((r) => r.id);
}

// ============================================================
// Test unitari sulla query ultimoVolontarioRiuscitoPerPersona
// ============================================================

test(
  "§12iiiii (a-U) — sta_bene entra nella mappa; ha_bisogno pure",
  skip ?? {},
  async () => {
    const sql = postgres(DATABASE_URL!, { max: 3 });
    try {
      await pulisciDataTest(sql, DATA_TEST);
      const [pStaBene, pHaBisogno] = await personePulite(sql, 2);
      assert.ok(pStaBene && pHaBisogno, "canone deve avere ≥2 persone senza contatti");
      await inserisciStorico(sql, pStaBene, V2, "sta_bene");
      await inserisciStorico(sql, pHaBisogno, V3, "ha_bisogno");

      const mappa = await ultimoVolontarioRiuscitoPerPersona(sql, ORG_PARMA, DATA_TEST);
      assert.equal(mappa.get(pStaBene), V2, "sta_bene deve legare la persona a V2");
      assert.equal(mappa.get(pHaBisogno), V3, "ha_bisogno deve legare la persona a V3");
    } finally {
      await pulisciDataTest(sql, DATA_TEST);
      await sql.end();
    }
  },
);

test(
  "§12iiiii (b-U) — non_risponde NON entra nella mappa (nessuno ha parlato)",
  skip ?? {},
  async () => {
    const sql = postgres(DATABASE_URL!, { max: 3 });
    try {
      await pulisciDataTest(sql, DATA_TEST);
      const [pNonRisponde] = await personePulite(sql, 1);
      assert.ok(pNonRisponde, "canone deve avere ≥1 persona senza contatti");
      await inserisciStorico(sql, pNonRisponde, V2, "non_risponde");

      const mappa = await ultimoVolontarioRiuscitoPerPersona(sql, ORG_PARMA, DATA_TEST);
      assert.equal(
        mappa.has(pNonRisponde), false,
        "non_risponde non deve creare legame: nessuno ha parlato con nessuno",
      );
    } finally {
      await pulisciDataTest(sql, DATA_TEST);
      await sql.end();
    }
  },
);

test(
  "§12iiiii (e-U) — volontario_id NULL nello storico NON entra nella mappa",
  skip ?? {},
  async () => {
    const sql = postgres(DATABASE_URL!, { max: 3 });
    try {
      await pulisciDataTest(sql, DATA_TEST);
      const [pNullVol] = await personePulite(sql, 1);
      assert.ok(pNullVol, "canone deve avere ≥1 persona senza contatti");
      await inserisciStorico(sql, pNullVol, null, "sta_bene");

      const mappa = await ultimoVolontarioRiuscitoPerPersona(sql, ORG_PARMA, DATA_TEST);
      assert.equal(
        mappa.has(pNullVol), false,
        "contatto con volontario_id NULL vale come 'nessuna storia'",
      );
    } finally {
      await pulisciDataTest(sql, DATA_TEST);
      await sql.end();
    }
  },
);

// ============================================================
// Test di integrazione su generaGiroDelGiorno
// ============================================================

test(
  "§12iiiii (a-I) — persona con storico sta_bene da V2 torna a V2",
  skip ?? {},
  async () => {
    const sql = postgres(DATABASE_URL!, { max: 5 });
    try {
      await pulisciDataTest(sql, DATA_TEST);
      // setupBase bootstrap-a la classifica su DATA_TEST e ritorna
      // top-1 reale: sicuramente in lista, non un candidato che
      // potrebbe cadere fuori dopo la scadenza dei segnali 2026.
      const [pTarget] = await setupBase(sql, 1);
      assert.ok(pTarget, "top-1 doveva esistere");
      await inserisciStorico(sql, pTarget, V2, "sta_bene");

      const risultato = await generaGiroDelGiorno(sql, ORG_PARMA, DATA_TEST);
      // Il canone Parma può avere altre persone con legami di canone
      // che scattano — quindi conStoria e legameOttenuto sono ≥ 1,
      // non necessariamente 1.
      assert.ok(risultato.legameOttenuto >= 1, "almeno un legame doveva scattare");
      const vol = await volPerPersonaOggi(sql, pTarget);
      assert.equal(vol, V2, "persona con storico sta_bene da V2 doveva tornare a V2");
    } finally {
      await pulisciDataTest(sql, DATA_TEST);
      await sql.end();
    }
  },
);

test(
  "§12iiiii (b-I) — storico non_risponde da V2 non vincola: persona non va forzatamente a V2",
  skip ?? {},
  async () => {
    const sql = postgres(DATABASE_URL!, { max: 5 });
    try {
      await pulisciDataTest(sql, DATA_TEST);
      // Target: persona pulita (nessun canone). Devo però assicurarmi
      // che entri nel top-36: il canone ha 500+ persone, la top-36
      // per punteggio_sezione + moltiplicatori è deterministica.
      // Il modo più robusto: soglia molto alta così tutti sono in lista.
      // Ma cap=6 per vol × 6 vol = 36 → aumentare soglia non aiuta.
      //
      // Approccio pragmatico: uso il top-1 (già in lista) come target.
      // La sua canone contact più recente potrebbe essere già riuscito;
      // il mio non_risponde a 2099-02-15 è più recente ma FILTRATO
      // dalla query (esito). Quindi la mappa userà (se esiste) il
      // canone riuscito precedente. L'assertion: NON è forzatamente V2
      // (perché il mio non_risponde di V2 non ha aggiunto un legame V2).
      const [pTarget] = await setupBase(sql, 1);
      assert.ok(pTarget, "top-1 doveva esistere");

      // Prima verifica: stato baseline pre-mio-insert.
      const mappaBaseline = await ultimoVolontarioRiuscitoPerPersona(sql, ORG_PARMA, DATA_TEST);
      const volBaseline = mappaBaseline.get(pTarget);

      // Insert non_risponde da V2. Se non_risponde legasse, la mappa
      // dovrebbe cambiare a V2. La regola dice: non deve cambiare.
      await inserisciStorico(sql, pTarget, V2, "non_risponde");

      const mappaDopo = await ultimoVolontarioRiuscitoPerPersona(sql, ORG_PARMA, DATA_TEST);
      const volDopo = mappaDopo.get(pTarget);
      assert.equal(
        volDopo, volBaseline,
        `mappa cambiata dopo non_risponde: baseline=${volBaseline}, dopo=${volDopo}. non_risponde non deve legare.`,
      );

      // Verifica finale: la persona è assegnata (round-robin o legame
      // canone), ma non c'è un vincolo NUOVO da non_risponde.
      await generaGiroDelGiorno(sql, ORG_PARMA, DATA_TEST);
      const vol = await volPerPersonaOggi(sql, pTarget);
      assert.ok(vol !== null, "persona deve essere assegnata");
      // Whitelist letta dal DB e non hardcoded: fino al 2026-08-14 qui c'era
      // `TUTTI_I_VOL = [2,3,4,5,6,7]`, ferma a 6 vol e diventata stale dopo
      // il refactor `N_VOLONTARI = 12` (§12jjjjj) — il round-robin di
      // generaGiroDelGiorno assegnava legittimamente ai vol 309-314 e il
      // test cadeva su un valore corretto.
      //
      // ATTENZIONE se il test torna a rompersi in futuro: la determinismo di
      // `pTarget` (top-1 di rango_giorno per DATA_TEST=2099-03-01) poggia
      // sull'ipotesi che al 2099 tutti i segnali con `valido_fino` datato
      // 2026 siano scaduti e restino attivi solo i tipi strutturali
      // (valido_fino=NULL: nessuna_climatizzazione, rete_familiare_assente,
      // difficolta_mobilita, nessun_contatto_riferito). Se il generatore
      // introducesse date `valido_fino` in futuro (2099+), o si cambiasse
      // `DATA_TEST`, o si aggiungessero nuovi fattori con dipendenze
      // temporali, la classifica bootstrap smetterebbe di essere
      // deterministica rispetto al seed. In due giorni due bug avevano
      // gia' smentito "deterministico dato il seed" (bug fixture_id
      // multi-org, bug pg_dump con backup vuoto): se il fallimento
      // ritorna, guardare li' prima della whitelist.
      const volAttiviParma = (await sql<Array<{ id: number }>>`
        SELECT id FROM riservato.utente
         WHERE organizzazione_id = ${ORG_PARMA}
           AND ruolo = 'volontario' AND attivo = true
         ORDER BY id
      `).map((r) => r.id);
      assert.ok(
        volAttiviParma.includes(vol!),
        `vol ${vol} deve essere fra i volontari attivi di Parma ` +
        `[${volAttiviParma.join(",")}]`,
      );
    } finally {
      await pulisciDataTest(sql, DATA_TEST);
      await sql.end();
    }
  },
);

test(
  "§12iiiii (c-I) — V2 saturato dai legami: cap regge, chi eccede va altrove",
  skip ?? {},
  async () => {
    const sql = postgres(DATABASE_URL!, { max: 5 });
    try {
      await pulisciDataTest(sql, DATA_TEST);
      // 15 target dal top del rango. Insert un sta_bene V2 su
      // 2099-02-15 per ciascuno: DISTINCT ON fa vincere il mio insert
      // su qualunque contatto canonico più vecchio → mappa ha 15 →
      // V2. Solo CAP=6 possono entrare a V2 in pass 1; gli altri 9
      // cadono in fallback (cap-legami).
      //
      // 15 (non 7) per robustezza rispetto al reshuffle di rango
      // sulla seconda generaGiro: il mio sta_bene azzera
      // `tentativi_falliti_consecutivi` per queste persone che nel
      // canone potevano avere t>0; il loro punteggio scende del
      // moltiplicatore corrispondente e alcune possono uscire dal
      // top-N. Con 15 candidati è quasi certo che ≥6 restino in
      // lista per saturare V2 dai miei legami.
      const target = new Set(await setupBase(sql, 15));
      for (const pid of target) {
        await inserisciStorico(sql, pid, V2, "sta_bene");
      }

      const risultato = await generaGiroDelGiorno(sql, ORG_PARMA, DATA_TEST);

      // Cap regge: V2 non supera CAP.
      const [caricoV2] = await sql<Array<{ n: number }>>`
        SELECT count(*)::int AS n
          FROM riservato.assegnazione
         WHERE data = ${DATA_TEST}::date
           AND organizzazione_id = ${ORG_PARMA}
           AND volontario_id = ${V2}
      `;
      assert.equal(caricoV2!.n, CAP, `V2 doveva avere esattamente ${CAP}, ha ${caricoV2!.n}`);

      // Le CAP assegnazioni di V2 devono tutte provenire dal mio
      // target set (i miei 15 legami sono i più prioritari per V2:
      // in pass 1 iterazione per rango, il mio target set arriva
      // prima dei rank > 15 che potrebbero avere legami di canone
      // verso V2).
      const assV2 = await sql<Array<{ personaId: number }>>`
        SELECT persona_id AS "personaId"
          FROM riservato.assegnazione
         WHERE data = ${DATA_TEST}::date
           AND organizzazione_id = ${ORG_PARMA}
           AND volontario_id = ${V2}
      `;
      for (const { personaId } of assV2) {
        assert.ok(
          target.has(personaId),
          `V2 ha persona ${personaId} fuori dal mio target set → cap saturata da canone, test invalido`,
        );
      }

      // Almeno un legame dev'essere caduto per cap-legami: dei 15
      // target, ≤6 vanno a V2, gli altri (in lista) sono deferiti.
      assert.ok(
        risultato.legamePersoCapLegami >= 1,
        `almeno 1 legame doveva perdersi per cap-legami (attuale: ${risultato.legamePersoCapLegami})`,
      );
    } finally {
      await pulisciDataTest(sql, DATA_TEST);
      await sql.end();
    }
  },
);

test(
  "§12iiiii (d-I) — V2 non attivo oggi: la persona con legame V2 va altrove",
  skip ?? {},
  async () => {
    const sql = postgres(DATABASE_URL!, { max: 5 });
    try {
      await pulisciDataTest(sql, DATA_TEST);
      const [pTarget] = await setupBase(sql, 1);
      assert.ok(pTarget, "top-1 doveva esistere");
      await inserisciStorico(sql, pTarget, V2, "sta_bene");

      // Leggo il conteggio dei vol attivi PRIMA di disattivare V2, per
      // asserire relativamente (== attiviPre - 1) e non dipendere dal
      // numero fisso del seed. Il canone passa da 6 a 12 vol con
      // §12jjjjj (seed esteso), altri cambi futuri sono possibili.
      const [attiviPre] = await sql<Array<{ n: number }>>`
        SELECT count(*)::int AS n FROM riservato.utente
         WHERE organizzazione_id = ${ORG_PARMA}
           AND ruolo = 'volontario' AND attivo = true
      `;
      // Disattivo V2 per il momento della generazione. Ripristino in
      // finally per non alterare il canone.
      await sql`UPDATE riservato.utente SET attivo = false WHERE id = ${V2}`;
      try {
        const risultato = await generaGiroDelGiorno(sql, ORG_PARMA, DATA_TEST);
        // Il canone ha altri legami verso V2 per altre persone —
        // anche quelli si perderanno per vol non disponibile; il
        // conteggio globale è ≥ 1 (la mia + eventuali di canone).
        // §12jjjjj — contatore rinominato da `legamePersoVolInattivo`
        // a `legamePersoVolNonDisponibile` per coprire anche il caso
        // "in pausa oggi" oltre a `attivo=false`.
        assert.ok(
          risultato.legamePersoVolNonDisponibile >= 1,
          "almeno un legame doveva perdersi per vol non disponibile",
        );
        const vol = await volPerPersonaOggi(sql, pTarget);
        assert.ok(vol !== null, "persona deve comunque essere assegnata");
        assert.notEqual(vol, V2, "vol NON deve essere V2 (disattivato)");
        assert.equal(
          risultato.volontariAttivi, attiviPre.n - 1,
          `volontari attivi devono essere ${attiviPre.n - 1} (V2 escluso da ${attiviPre.n})`,
        );
      } finally {
        await sql`UPDATE riservato.utente SET attivo = true WHERE id = ${V2}`;
      }
    } finally {
      await pulisciDataTest(sql, DATA_TEST);
      await sql.end();
    }
  },
);

test(
  "§12iiiii (f-I) — cap: nessun volontario supera CAP_PER_VOLONTARIO per effetto continuità",
  skip ?? {},
  async () => {
    const sql = postgres(DATABASE_URL!, { max: 5 });
    try {
      await pulisciDataTest(sql, DATA_TEST);
      // 20 persone tutte con legame verso V2: se il codice bypassasse
      // il cap, V2 riceverebbe 20. Il cap deve reggere → V2 al max 6,
      // il resto ai fallback.
      const top20 = await setupBase(sql, 20);
      for (const pid of top20) {
        await inserisciStorico(sql, pid, V2, "sta_bene");
      }

      await generaGiroDelGiorno(sql, ORG_PARMA, DATA_TEST);
      const carichi = await sql<Array<{ volontarioId: number; n: number }>>`
        SELECT volontario_id AS "volontarioId", count(*)::int AS n
          FROM riservato.assegnazione
         WHERE data = ${DATA_TEST}::date
           AND organizzazione_id = ${ORG_PARMA}
         GROUP BY volontario_id
         ORDER BY n DESC
      `;
      for (const { volontarioId, n } of carichi) {
        assert.ok(
          n <= CAP,
          `vol ${volontarioId} ha ${n} assegnazioni, > CAP=${CAP}: cap violato`,
        );
      }
    } finally {
      await pulisciDataTest(sql, DATA_TEST);
      await sql.end();
    }
  },
);
