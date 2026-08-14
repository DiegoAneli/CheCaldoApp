/**
 * Test di regressione §12aaaa: `classificaDiOggi` porta stato del
 * contatto di oggi e conteggio segnali osservativi aperti, senza
 * query aggiuntive nel Promise.all della dashboard.
 *
 * Difesa contro tre regressioni possibili:
 *   1. Il LEFT JOIN LATERAL sull'ultimo contatto di oggi torna esito
 *      corretto per chi ha contatti, e null per chi non ne ha.
 *   2. Il conteggio dei segnali si limita ai tipi osservativi
 *      (`sintomi_riferiti`, `ventilatore_rotto`) — se qualcuno estende
 *      la lista o toglie il filtro, la colonna in classifica smette
 *      di essere significativa (§12aaaa punto 2: contando tutti i tipi
 *      il numero sarebbe sempre 2-4 per costruzione).
 *   3. I segnali chiusi e scaduti non contano — è la stessa regola
 *      della card `segnaliAperti` in cima alla dashboard.
 *
 * Data futura fuori range operativo (2099) per non contaminare
 * fixture; cleanup su try/finally.
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import postgres from "postgres";
import { assegnaComodato, classificaDiOggi, statoGiornata } from "../src/index";

const DATABASE_URL = process.env.DATABASE_URL;
const skip = !DATABASE_URL
  ? { skip: "DATABASE_URL non impostata: test di integrazione saltato" as string }
  : undefined;

const ORG_PARMA = 1;
const VOLONTARIO_PARMA = 2;
const DATA_TEST = "2099-04-15";

async function pulisci(sql: postgres.Sql): Promise<void> {
  // Prima cancella dipendenze; segnali fixture con FK a persona non toccati.
  await sql`
    DELETE FROM riservato.segnale
     WHERE fixture_id LIKE 's-test-12aaaa-%' OR fixture_id LIKE 's-test-12dddd-%'
  `;
  await sql`DELETE FROM riservato.contatto WHERE data::date = ${DATA_TEST}::date`;
  await sql`DELETE FROM riservato.assegnazione WHERE data = ${DATA_TEST}::date`;
  await sql`DELETE FROM riservato.rango_giorno WHERE data = ${DATA_TEST}::date`;
}

test(
  "§12aaaa — classificaDiOggi porta ultimoEsitoOggi coerente coi contatti del giorno",
  skip ?? {},
  async () => {
    const sql = postgres(DATABASE_URL!, { max: 1 });
    try {
      await pulisci(sql);

      // Setup: tre persone in lista con esiti diversi.
      const [p1, p2, p3] = await sql<Array<{ id: number }>>`
        SELECT id FROM riservato.persona
         WHERE organizzazione_id = ${ORG_PARMA} AND attiva
         ORDER BY id LIMIT 3
      `;
      const persone = [p1!.id, p2!.id, p3!.id];

      // Tre assegnazioni per DATA_TEST.
      for (let i = 0; i < 3; i++) {
        await sql`
          INSERT INTO riservato.assegnazione
            (data, organizzazione_id, persona_id, volontario_id,
             posizione, rango_globale, azione, fattori)
          VALUES
            (${DATA_TEST}::date, ${ORG_PARMA}, ${persone[i]!}, ${VOLONTARIO_PARMA},
             ${i + 1}, ${i + 1}, 'prima_chiamata', '[]'::jsonb)
        `;
      }

      // Contatti: p1 raggiunta (sta_bene), p2 non_risponde, p3 nessun contatto.
      await sql`
        INSERT INTO riservato.contatto (persona_id, volontario_id, data, esito)
        VALUES (${persone[0]!}, ${VOLONTARIO_PARMA},
                ${DATA_TEST + " 09:15:00+00"}::timestamptz, 'sta_bene')
      `;
      // Per p2: due tentativi nella stessa giornata — la LATERAL deve
      // prendere il più recente (non_risponde), non il primo.
      await sql`
        INSERT INTO riservato.contatto (persona_id, volontario_id, data, esito)
        VALUES (${persone[1]!}, ${VOLONTARIO_PARMA},
                ${DATA_TEST + " 10:00:00+00"}::timestamptz, 'ha_bisogno')
      `;
      await sql`
        INSERT INTO riservato.contatto (persona_id, volontario_id, data, esito)
        VALUES (${persone[1]!}, ${VOLONTARIO_PARMA},
                ${DATA_TEST + " 14:30:00+00"}::timestamptz, 'non_risponde')
      `;

      const righe = await classificaDiOggi(sql, ORG_PARMA, DATA_TEST);
      const perId = new Map(righe.map((r) => [r.personaId, r]));

      assert.equal(
        perId.get(persone[0]!)?.ultimoEsitoOggi, "sta_bene",
        "p1 raggiunta: ultimoEsitoOggi deve essere sta_bene",
      );
      assert.equal(
        perId.get(persone[1]!)?.ultimoEsitoOggi, "non_risponde",
        "p2 due contatti: LATERAL deve tornare il più recente (non_risponde)",
      );
      assert.equal(
        perId.get(persone[2]!)?.ultimoEsitoOggi, null,
        "p3 nessun contatto: ultimoEsitoOggi deve essere null (mappa a 'Non ancora' in UI)",
      );
    } finally {
      await pulisci(sql);
      await sql.end();
    }
  },
);

test(
  "§12aaaa — nSegnaliOsservativi filtra: solo osservativi aperti e non scaduti",
  skip ?? {},
  async () => {
    const sql = postgres(DATABASE_URL!, { max: 1 });
    try {
      await pulisci(sql);

      // Due persone: la prima verifica il filtro sul tipo (osservativi
      // contano, strutturali no); la seconda verifica i filtri chiuso/scaduto.
      // Divise perché l'unique index parziale
      // `segnale_persona_id_tipo_idx WHERE chiuso_il IS NULL` non permette
      // due open dello stesso tipo per la stessa persona (§12uuu).
      //
      // Scelgo persone SENZA segnali aperti da fixture, così le mie INSERT
      // di test non collidono col canone. Se un giorno il generatore
      // sintetico assegna un `sintomi_riferiti` a tutte le persone dell'org
      // il test cade con `no persone senza segnali aperti` e va rivisto.
      const [p1, p2] = await sql<Array<{ id: number }>>`
        SELECT p.id
          FROM riservato.persona p
         WHERE p.organizzazione_id = ${ORG_PARMA} AND p.attiva
           AND NOT EXISTS (
             SELECT 1 FROM riservato.segnale s
              WHERE s.persona_id = p.id AND s.chiuso_il IS NULL
                AND s.tipo IN ('sintomi_riferiti','ventilatore_rotto',
                               'nessuna_climatizzazione')
           )
         ORDER BY p.id
         LIMIT 2
      `;
      assert.notEqual(p1, undefined, "servono ≥2 persone senza segnali aperti in fixture");
      assert.notEqual(p2, undefined, "servono ≥2 persone senza segnali aperti in fixture");
      for (const [i, pid] of [p1!.id, p2!.id].entries()) {
        await sql`
          INSERT INTO riservato.assegnazione
            (data, organizzazione_id, persona_id, volontario_id,
             posizione, rango_globale, azione, fattori)
          VALUES
            (${DATA_TEST}::date, ${ORG_PARMA}, ${pid}, ${VOLONTARIO_PARMA},
             ${i + 1}, ${i + 1}, 'prima_chiamata', '[]'::jsonb)
        `;
      }

      // p1: 2 osservativi aperti e validi + 1 strutturale aperto.
      // Atteso count = 2 (lo strutturale non conta — §12aaaa punto 2).
      await sql`
        INSERT INTO riservato.segnale (persona_id, tipo, origine, valido_fino, fixture_id)
        VALUES (${p1!.id}, 'sintomi_riferiti', 'volontario', NULL, 's-test-12aaaa-a1')
      `;
      await sql`
        INSERT INTO riservato.segnale (persona_id, tipo, origine, valido_fino, fixture_id)
        VALUES (${p1!.id}, 'ventilatore_rotto', 'volontario', NULL, 's-test-12aaaa-a2')
      `;
      await sql`
        INSERT INTO riservato.segnale (persona_id, tipo, origine, valido_fino, fixture_id)
        VALUES (${p1!.id}, 'nessuna_climatizzazione', 'coordinatore', NULL, 's-test-12aaaa-a3')
      `;

      // p2: 1 osservativo chiuso + 1 osservativo aperto con valido_fino
      // scaduto. Atteso count = 0 (chiuso e scaduto ignorati).
      await sql`
        INSERT INTO riservato.segnale
          (persona_id, tipo, origine, valido_fino, chiuso_il, chiuso_da, fixture_id)
        VALUES (${p2!.id}, 'sintomi_riferiti', 'volontario', NULL,
                now(), ${VOLONTARIO_PARMA}, 's-test-12aaaa-b1')
      `;
      await sql`
        INSERT INTO riservato.segnale (persona_id, tipo, origine, valido_fino, fixture_id)
        VALUES (${p2!.id}, 'ventilatore_rotto', 'volontario',
                ${DATA_TEST}::date - 1, 's-test-12aaaa-b2')
      `;

      const righe = await classificaDiOggi(sql, ORG_PARMA, DATA_TEST);
      const rigaP1 = righe.find((r) => r.personaId === p1!.id);
      const rigaP2 = righe.find((r) => r.personaId === p2!.id);
      assert.notEqual(rigaP1, undefined, "p1 deve essere nella classifica");
      assert.notEqual(rigaP2, undefined, "p2 deve essere nella classifica");

      assert.equal(
        rigaP1!.nSegnaliOsservativi, 2,
        "p1: due osservativi aperti-validi + uno strutturale → count 2. Se " +
        "torna 3, il filtro sui tipi osservativi è saltato (§12aaaa: sarebbe " +
        "la tautologia — top classifica ha tutte 2-4 condizioni).",
      );
      assert.equal(
        rigaP2!.nSegnaliOsservativi, 0,
        "p2: un osservativo chiuso + un osservativo scaduto → count 0. Se " +
        "torna 1, non filtra chiuso_il; se torna 2, non filtra valido_fino " +
        "(inconsistente con card §12ttt e col motore di scoring).",
      );
    } finally {
      await pulisci(sql);
      await sql.end();
    }
  },
);

test(
  "§12aaaa — invariante chip statoGiornata ↔ classifica ultimoEsitoOggi",
  skip ?? {},
  async () => {
    // Le chip in cima alla dashboard (Tentate, Senza risposta) e la
    // colonna "Stato contatto" della classifica sono due query diverse
    // che devono raccontare la stessa cosa sugli stessi dati:
    //
    //   classifica.righe.length                       === stato.inLista
    //   classifica.filter(esito != null).length       === stato.contattate
    //   classifica.filter(esito == non_risponde).len  === stato.nonRaggiunte
    //
    // Storia: prima di §12aaaa la classifica non portava lo stato;
    // dopo, sono due letture parallele. Ogni volta che due query in
    // questo progetto dicevano la stessa cosa, prima o poi hanno
    // smesso — questo test blocca la deriva.
    //
    // Setup ricco: 4 persone con scenari che stressano l'ultimo-vince
    // (persona con più contatti nella stessa giornata, esiti misti).
    const sql = postgres(DATABASE_URL!, { max: 1 });
    try {
      await pulisci(sql);

      const [pA, pB, pC, pD] = await sql<Array<{ id: number }>>`
        SELECT id FROM riservato.persona
         WHERE organizzazione_id = ${ORG_PARMA} AND attiva
         ORDER BY id LIMIT 4
      `;
      const persone = [pA!.id, pB!.id, pC!.id, pD!.id];

      // 4 assegnazioni per DATA_TEST.
      for (let i = 0; i < 4; i++) {
        await sql`
          INSERT INTO riservato.assegnazione
            (data, organizzazione_id, persona_id, volontario_id,
             posizione, rango_globale, azione, fattori)
          VALUES
            (${DATA_TEST}::date, ${ORG_PARMA}, ${persone[i]!}, ${VOLONTARIO_PARMA},
             ${i + 1}, ${i + 1}, 'prima_chiamata', '[]'::jsonb)
        `;
      }

      // pA raggiunta, pB non_risponde, pC due contatti (sta_bene poi
      // non_risponde — verifica che entrambe le query prendano il più
      // recente), pD nessun contatto.
      await sql`
        INSERT INTO riservato.contatto (persona_id, volontario_id, data, esito)
        VALUES (${persone[0]!}, ${VOLONTARIO_PARMA},
                ${DATA_TEST + " 09:00:00+00"}::timestamptz, 'sta_bene')
      `;
      await sql`
        INSERT INTO riservato.contatto (persona_id, volontario_id, data, esito)
        VALUES (${persone[1]!}, ${VOLONTARIO_PARMA},
                ${DATA_TEST + " 09:30:00+00"}::timestamptz, 'non_risponde')
      `;
      await sql`
        INSERT INTO riservato.contatto (persona_id, volontario_id, data, esito)
        VALUES (${persone[2]!}, ${VOLONTARIO_PARMA},
                ${DATA_TEST + " 10:00:00+00"}::timestamptz, 'sta_bene')
      `;
      await sql`
        INSERT INTO riservato.contatto (persona_id, volontario_id, data, esito)
        VALUES (${persone[2]!}, ${VOLONTARIO_PARMA},
                ${DATA_TEST + " 15:00:00+00"}::timestamptz, 'non_risponde')
      `;

      const [righe, stato] = await Promise.all([
        classificaDiOggi(sql, ORG_PARMA, DATA_TEST),
        statoGiornata(sql, ORG_PARMA, DATA_TEST),
      ]);

      // Restringi la classifica alle 4 persone del setup — altre
      // assegnazioni per DATA_TEST non dovrebbero esistere (pulisci
      // le rimuove) ma la difesa è cintura+bretelle.
      const idsSetup = new Set(persone);
      const righeSetup = righe.filter((r) => idsSetup.has(r.personaId));

      const nRighe = righeSetup.length;
      const nContattate = righeSetup.filter((r) => r.ultimoEsitoOggi !== null).length;
      const nNonRaggiunte = righeSetup.filter(
        (r) => r.ultimoEsitoOggi === "non_risponde",
      ).length;

      // Precondizioni sul setup — se cadono, il test è mal costruito
      // (non un bug del prodotto).
      assert.equal(nRighe, 4, "setup: 4 assegnazioni nella data di test");
      assert.equal(stato.inLista, 4, "setup: statoGiornata vede 4 in lista");

      // Invariante 1: totale righe classifica = inLista chip.
      assert.equal(
        nRighe, stato.inLista,
        "invariante rotto: righe classifica != stato.inLista. Uno dei due " +
        "filtri sull'assegnazione per data+org è divergente. Classifica: " +
        `${nRighe}, chip: ${stato.inLista}.`,
      );

      // Invariante 2: contattate (chip "Tentate") = righe non-Non ancora.
      // Con il setup: 3 contattate (A, B, C — D senza contatto).
      assert.equal(nContattate, 3, "setup: 3 persone hanno almeno un contatto oggi");
      assert.equal(
        nContattate, stato.contattate,
        "invariante rotto: righe con ultimoEsitoOggi != null != stato.contattate. " +
        "Probabile causa: uno dei filtri guarda tutti i contatti invece di " +
        "solo l'ultimo, oppure uno scope-a per volontario e l'altro no, " +
        `oppure divergono su c.data::date vs c.data. Classifica: ${nContattate}, ` +
        `chip: ${stato.contattate}.`,
      );

      // Invariante 3: nonRaggiunte (chip "Senza risposta") = righe con
      // ultimoEsitoOggi == 'non_risponde'. Con setup: 2 (B con singolo
      // non_risponde, C con sta_bene→non_risponde last-wins). Se una
      // delle due query prende il PRIMO invece dell'ULTIMO per pC, i
      // due numeri divergono e la regressione si vede qui.
      assert.equal(
        nNonRaggiunte, 2,
        "setup: 2 persone con ultimo esito 'non_risponde' (B singolo + C " +
        "che ha sta_bene→non_risponde nella stessa giornata: last-wins)",
      );
      assert.equal(
        nNonRaggiunte, stato.nonRaggiunte,
        "invariante rotto: count(esito=='non_risponde') classifica != " +
        "stato.nonRaggiunte. Probabile: le due query hanno strategie " +
        "diverse per il tie-break sui contatti multipli dello stesso " +
        "giorno (DISTINCT ON vs LATERAL LIMIT 1). Classifica: " +
        `${nNonRaggiunte}, chip: ${stato.nonRaggiunte}.`,
      );

      // Corollario: (nContattate - nNonRaggiunte) === "Raggiunte".
      // Non c'è chip omologa, ma per completezza dell'assertion sui
      // tre gruppi disgiunti.
      const nRaggiunte = righeSetup.filter(
        (r) => r.ultimoEsitoOggi === "sta_bene" || r.ultimoEsitoOggi === "ha_bisogno",
      ).length;
      assert.equal(
        nContattate, nRaggiunte + nNonRaggiunte,
        "tre gruppi non disgiunti: contattate != raggiunte + nonRaggiunte. " +
        "Un esito diverso dai tre attesi ('sta_bene'|'ha_bisogno'|" +
        "'non_risponde') è entrato nel DB o nel mapping.",
      );
    } finally {
      await pulisci(sql);
      await sql.end();
    }
  },
);

test(
  "§12dddd — statoCondizionatore torna 'assente' / 'rotto' / 'presente' con precedenza dichiarata + segnali scaduti ignorati",
  skip ?? {},
  async () => {
    // Quattro persone, quattro casi:
    //   pA — nessuna_climatizzazione aperto+valido       → 'assente'
    //   pB — ventilatore_rotto aperto+valido             → 'rotto'
    //   pC — entrambi aperti+validi (fixture-inconsistenza) → 'assente'
    //        (precedenza `assente` > `rotto`, §12dddd)
    //   pD — ventilatore_rotto aperto ma scaduto         → 'presente'
    //        (il segnale non pesa più sul motore; UI coerente)
    const sql = postgres(DATABASE_URL!, { max: 1 });
    try {
      await pulisci(sql);

      const [pA, pB, pC, pD] = await sql<Array<{ id: number }>>`
        SELECT p.id FROM riservato.persona p
         WHERE p.organizzazione_id = ${ORG_PARMA} AND p.attiva
           AND NOT EXISTS (
             SELECT 1 FROM riservato.segnale s
              WHERE s.persona_id = p.id AND s.chiuso_il IS NULL
                AND s.tipo IN ('nessuna_climatizzazione','ventilatore_rotto')
           )
         ORDER BY p.id LIMIT 4
      `;
      const persone = [pA!.id, pB!.id, pC!.id, pD!.id];
      for (let i = 0; i < 4; i++) {
        await sql`
          INSERT INTO riservato.assegnazione
            (data, organizzazione_id, persona_id, volontario_id,
             posizione, rango_globale, azione, fattori)
          VALUES
            (${DATA_TEST}::date, ${ORG_PARMA}, ${persone[i]!}, ${VOLONTARIO_PARMA},
             ${i + 1}, ${i + 1}, 'prima_chiamata', '[]'::jsonb)
        `;
      }

      await sql`
        INSERT INTO riservato.segnale (persona_id, tipo, origine, valido_fino, fixture_id)
        VALUES (${pA!.id}, 'nessuna_climatizzazione', 'volontario', NULL, 's-test-12dddd-a')
      `;
      await sql`
        INSERT INTO riservato.segnale (persona_id, tipo, origine, valido_fino, fixture_id)
        VALUES (${pB!.id}, 'ventilatore_rotto', 'volontario', NULL, 's-test-12dddd-b')
      `;
      await sql`
        INSERT INTO riservato.segnale (persona_id, tipo, origine, valido_fino, fixture_id)
        VALUES (${pC!.id}, 'nessuna_climatizzazione', 'volontario', NULL, 's-test-12dddd-c1')
      `;
      await sql`
        INSERT INTO riservato.segnale (persona_id, tipo, origine, valido_fino, fixture_id)
        VALUES (${pC!.id}, 'ventilatore_rotto', 'volontario', NULL, 's-test-12dddd-c2')
      `;
      await sql`
        INSERT INTO riservato.segnale (persona_id, tipo, origine, valido_fino, fixture_id)
        VALUES (${pD!.id}, 'ventilatore_rotto', 'volontario',
                ${DATA_TEST}::date - 1, 's-test-12dddd-d')
      `;

      const righe = await classificaDiOggi(sql, ORG_PARMA, DATA_TEST);
      const stato = (id: number) =>
        righe.find((r) => r.personaId === id)?.statoCondizionatore;

      assert.equal(stato(pA!.id), "assente", "pA: solo nessuna_climatizzazione aperto → 'assente'");
      assert.equal(stato(pB!.id), "rotto",   "pB: solo ventilatore_rotto aperto → 'rotto'");
      assert.equal(
        stato(pC!.id), "assente",
        "pC: entrambi aperti → 'assente' per precedenza §12dddd. Se torna " +
        "'rotto', qualcuno ha invertito l'ordine dei WHEN nel CASE.",
      );
      assert.equal(
        stato(pD!.id), "presente",
        "pD: unico segnale è scaduto → 'presente'. Se torna 'rotto', il " +
        "filtro `valido_fino >= dataOggi` non è applicato — la card della " +
        "dashboard verrebbe usata da un motore che non conta più il segnale.",
      );
    } finally {
      await pulisci(sql);
      await sql.end();
    }
  },
);

test(
  "§12dddd — il comodato salta chi ha clima presente e arriva a persone più in basso senza",
  skip ?? {},
  async () => {
    // Simula la logica di assegnazione comodato che vive in page.tsx:
    // prime N per rango fra chi ha `statoCondizionatore !== 'presente'`.
    // Setup: 5 persone in classifica con ranghi 1..5. Rango 1 ha clima
    // PRESENTE (viene saltata); ranghi 2, 3, 4 hanno clima assente/rotto
    // (ricevono comodato); rango 5 anche assente ma se N=3 non entra.
    const sql = postgres(DATABASE_URL!, { max: 1 });
    try {
      await pulisci(sql);

      const [p1, p2, p3, p4, p5] = await sql<Array<{ id: number }>>`
        SELECT p.id FROM riservato.persona p
         WHERE p.organizzazione_id = ${ORG_PARMA} AND p.attiva
           AND NOT EXISTS (
             SELECT 1 FROM riservato.segnale s
              WHERE s.persona_id = p.id AND s.chiuso_il IS NULL
                AND s.tipo IN ('nessuna_climatizzazione','ventilatore_rotto')
           )
         ORDER BY p.id LIMIT 5
      `;
      const persone = [p1!.id, p2!.id, p3!.id, p4!.id, p5!.id];
      for (let i = 0; i < 5; i++) {
        await sql`
          INSERT INTO riservato.assegnazione
            (data, organizzazione_id, persona_id, volontario_id,
             posizione, rango_globale, azione, fattori)
          VALUES
            (${DATA_TEST}::date, ${ORG_PARMA}, ${persone[i]!}, ${VOLONTARIO_PARMA},
             ${i + 1}, ${i + 1}, 'prima_chiamata', '[]'::jsonb)
        `;
      }
      // p1 rango 1 → PRESENTE (nessun segnale) — saltato dal comodato
      // p2 rango 2 → assente
      await sql`
        INSERT INTO riservato.segnale (persona_id, tipo, origine, valido_fino, fixture_id)
        VALUES (${p2!.id}, 'nessuna_climatizzazione', 'volontario', NULL, 's-test-12dddd-e2')
      `;
      // p3 rango 3 → rotto
      await sql`
        INSERT INTO riservato.segnale (persona_id, tipo, origine, valido_fino, fixture_id)
        VALUES (${p3!.id}, 'ventilatore_rotto', 'volontario', NULL, 's-test-12dddd-e3')
      `;
      // p4 rango 4 → assente
      await sql`
        INSERT INTO riservato.segnale (persona_id, tipo, origine, valido_fino, fixture_id)
        VALUES (${p4!.id}, 'nessuna_climatizzazione', 'volontario', NULL, 's-test-12dddd-e4')
      `;
      // p5 rango 5 → assente (candidato ma se N=3 non entra)
      await sql`
        INSERT INTO riservato.segnale (persona_id, tipo, origine, valido_fino, fixture_id)
        VALUES (${p5!.id}, 'nessuna_climatizzazione', 'volontario', NULL, 's-test-12dddd-e5')
      `;

      // §12iiii: il test chiama la funzione pura invece di
      // riscriverla. `classificaDiOggi` ordina già per rango ASC
      // NULLS LAST — condizione richiesta da `assegnaComodato`.
      // Se qualcuno rimuovesse in `page.tsx` la chiamata a
      // `assegnaComodato` e reintroducesse un filtro sul rango a
      // tappeto, questo test resterebbe verde solo se la funzione
      // pura fosse ancora corretta — ma la regressione sarebbe in
      // `page.tsx`, non qui. Difesa complementare: un test di
      // browser/integrazione su page.tsx sarebbe la copertura
      // mancante; non aggiunto in §12iiii.
      const righe = await classificaDiOggi(sql, ORG_PARMA, DATA_TEST);
      const righeSetup = righe.filter((r) => persone.includes(r.personaId));
      const N = 3;
      const idsConComodato = assegnaComodato(righeSetup, N);

      assert.equal(idsConComodato.size, 3, "N=3 comodati assegnati");
      assert.ok(
        !idsConComodato.has(p1!.id),
        "p1 (rango 1, clima presente) NON deve ricevere comodato: la regola §12dddd " +
        "salta chi ha clima presente anche se è primo in classifica.",
      );
      assert.ok(idsConComodato.has(p2!.id), "p2 (rango 2, assente) riceve");
      assert.ok(idsConComodato.has(p3!.id), "p3 (rango 3, rotto) riceve");
      assert.ok(idsConComodato.has(p4!.id), "p4 (rango 4, assente) riceve — arrivato al posto di p1 che è stata saltata");
      assert.ok(
        !idsConComodato.has(p5!.id),
        "p5 (rango 5, assente) NON riceve: N=3 già coperti da p2/p3/p4",
      );
    } finally {
      await pulisci(sql);
      await sql.end();
    }
  },
);
