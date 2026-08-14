// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Test di regressione per il bug del 2026-08-14: carica-nel-db.ts
 * costruiva `fixture_id = "s-<idEsterno>-<tipo>"` senza includere
 * l'organizzazione. Poiche' il generatore emette `id_esterno` "Persona
 * 0000..0499" per ogni comune e l'unique index su
 * `riservato.segnale (fixture_id) WHERE fixture_id IS NOT NULL` e'
 * globale, caricare Bologna dopo Parma faceva scattare
 * `ON CONFLICT DO NOTHING` su ogni INSERT di Bologna: la seconda org
 * finiva in DB con zero segnali. Il carica dichiarava successo.
 *
 * La suite era verde e il bug e' passato inosservato perche' nessun
 * test caricava due org e verificava che entrambe avessero i propri
 * segnali. Questo file copre due livelli:
 *   - unit: `fixtureIdSegnale` con `orgId` diverse produce chiavi
 *     distinte a parita' di `idEsterno + tipo`. Cade se qualcuno
 *     rimuove `orgId` dalla funzione.
 *   - integrazione: due INSERT con lo stesso pattern del carica di
 *     produzione (ON CONFLICT DO NOTHING sull'unique index globale),
 *     stesso `idEsterno` in due org diverse, coesistono in DB. Cade
 *     se cambia l'invariante DB in un modo che rompe la separazione
 *     per org.
 *
 * Il test integrazione crea DUE PERSONE TEMPORANEE dedicate al test
 * (una per org) invece di riusare persone del canone, perche' il DB
 * ha anche un secondo unique index `(persona_id, tipo) WHERE chiuso_il
 * IS NULL` — una persona canonica con `ventilatore_rotto` gia' aperto
 * dal seed rifiuterebbe l'INSERT del test per quel vincolo. Usare
 * persone di test isolate rimuove l'accoppiamento allo stato del seed
 * e rende il test indipendente dall'ordine di esecuzione.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import postgres from "postgres";
import { fixtureIdSegnale } from "../src/fixture-id";

const DATABASE_URL = process.env.DATABASE_URL;
const skip = !DATABASE_URL
  ? { skip: "DATABASE_URL non impostata: test di integrazione saltato" as string }
  : undefined;

const ORG_PARMA = 1;
const ORG_BOLOGNA = 2;

// -------------------------------------------------- unit

test("fixtureIdSegnale — orgId diversi producono chiavi distinte a parita' di idEsterno+tipo", () => {
  const a = fixtureIdSegnale(1, "Persona 0000", "ventilatore_rotto");
  const b = fixtureIdSegnale(2, "Persona 0000", "ventilatore_rotto");
  assert.notEqual(
    a, b,
    "senza orgId nella chiave, due org sulla stessa istanza collidono " +
    "sull'unique index globale di riservato.segnale (fixture_id) e la " +
    "seconda org perde tutti i segnali silenziosamente per ON CONFLICT DO NOTHING",
  );
});

test("fixtureIdSegnale — stessi argomenti producono la stessa chiave (determinismo)", () => {
  const a = fixtureIdSegnale(1, "Persona 0042", "sintomi_riferiti");
  const b = fixtureIdSegnale(1, "Persona 0042", "sintomi_riferiti");
  assert.equal(a, b, "la funzione deve essere pura");
});

// -------------------------------------------------- integrazione
//
// Replica esattamente il pattern SQL del carica (INSERT con ON CONFLICT
// (fixture_id) WHERE fixture_id IS NOT NULL DO NOTHING) su due org
// diverse con lo stesso idEsterno. Il test cade se il vincolo di
// unicita' non consente la coesistenza — cioe' se qualcuno spostasse
// l'unique index su una chiave che non discrimina l'organizzazione, o
// se `fixtureIdSegnale` perdesse `orgId`.

test(
  "carica multi-org — INSERT dello stesso idEsterno+tipo per due org coesistono in DB",
  skip ?? {},
  async () => {
    const sql = postgres(DATABASE_URL!, { max: 2 });
    const marker = `test-fixture-id-${Date.now()}`;
    const idEsterno = `${marker}-persona`; // stesso letterale per entrambe le org
    const tipo = "ventilatore_rotto";

    let personaIdParma: number | null = null;
    let personaIdBologna: number | null = null;
    try {
      // Sezioni valide dal DB, una per comune. `NOT fittizia` per evitare
      // le SEZ21 di servizio (senza dimora in poligono di comodo, escluse
      // dal punteggio — v. CLAUDE.md "Sezioni fittizie da escludere sempre").
      const [sezP] = await sql<Array<{ id: string }>>`
        SELECT id FROM pubblico.sezione
         WHERE comune_istat = '034027' AND NOT fittizia
         ORDER BY id LIMIT 1
      `;
      const [sezB] = await sql<Array<{ id: string }>>`
        SELECT id FROM pubblico.sezione
         WHERE comune_istat = '037006' AND NOT fittizia
         ORDER BY id LIMIT 1
      `;
      assert.ok(sezP && sezB, "sezioni per Parma e Bologna devono esistere in DB");

      // Persone temporanee, una per org, con lo stesso `id_esterno`
      // letterale. E' il caso critico che il bug faceva sbagliare: la
      // chiave `fixture_id` senza `orgId` collideva su queste due.
      const [pP] = await sql<Array<{ id: number }>>`
        INSERT INTO riservato.persona
          (organizzazione_id, id_esterno, sezione_id, attiva)
        VALUES (${ORG_PARMA}, ${idEsterno}, ${sezP.id}, true)
        RETURNING id
      `;
      const [pB] = await sql<Array<{ id: number }>>`
        INSERT INTO riservato.persona
          (organizzazione_id, id_esterno, sezione_id, attiva)
        VALUES (${ORG_BOLOGNA}, ${idEsterno}, ${sezB.id}, true)
        RETURNING id
      `;
      personaIdParma = pP.id;
      personaIdBologna = pB.id;

      const fixtureIdP = fixtureIdSegnale(ORG_PARMA, idEsterno, tipo);
      const fixtureIdB = fixtureIdSegnale(ORG_BOLOGNA, idEsterno, tipo);

      // Stesso pattern SQL del carica di produzione (righe 244-251 di
      // carica-nel-db.ts al momento della scrittura del test).
      await sql`
        INSERT INTO riservato.segnale (persona_id, tipo, origine, fixture_id)
        VALUES (${personaIdParma}, ${tipo}, 'volontario', ${fixtureIdP})
        ON CONFLICT (fixture_id) WHERE fixture_id IS NOT NULL DO NOTHING
      `;
      await sql`
        INSERT INTO riservato.segnale (persona_id, tipo, origine, fixture_id)
        VALUES (${personaIdBologna}, ${tipo}, 'volontario', ${fixtureIdB})
        ON CONFLICT (fixture_id) WHERE fixture_id IS NOT NULL DO NOTHING
      `;

      // Assert: entrambe le righe scritte, una per org.
      const [conta] = await sql<Array<{ n: number }>>`
        SELECT count(*)::int AS n
          FROM riservato.segnale
         WHERE fixture_id IN (${fixtureIdP}, ${fixtureIdB})
      `;
      assert.equal(
        conta.n, 2,
        "attesi 2 segnali (uno per org) ma trovati " + conta.n +
        ". Se e' 1, la chiave fixture_id non discrimina l'organizzazione " +
        "e il carica della seconda org perde tutti i segnali in silenzio.",
      );

      // Assert per-org: ognuna delle due org ha la sua riga.
      const [contaParma] = await sql<Array<{ n: number }>>`
        SELECT count(*)::int AS n
          FROM riservato.segnale s
          JOIN riservato.persona p ON p.id = s.persona_id
         WHERE p.organizzazione_id = ${ORG_PARMA}
           AND s.fixture_id = ${fixtureIdP}
      `;
      const [contaBologna] = await sql<Array<{ n: number }>>`
        SELECT count(*)::int AS n
          FROM riservato.segnale s
          JOIN riservato.persona p ON p.id = s.persona_id
         WHERE p.organizzazione_id = ${ORG_BOLOGNA}
           AND s.fixture_id = ${fixtureIdB}
      `;
      assert.equal(contaParma.n, 1, "Parma deve avere il proprio segnale");
      assert.equal(contaBologna.n, 1, "Bologna deve avere il proprio segnale");
    } finally {
      // Cleanup: segnali via ON DELETE CASCADE dalla persona, ma cancello
      // esplicitamente prima per non lasciare orfani se qualcuno cambia
      // la FK. Poi le due persone.
      if (personaIdParma !== null) {
        await sql`DELETE FROM riservato.segnale WHERE persona_id = ${personaIdParma}`;
        await sql`DELETE FROM riservato.persona WHERE id = ${personaIdParma}`;
      }
      if (personaIdBologna !== null) {
        await sql`DELETE FROM riservato.segnale WHERE persona_id = ${personaIdBologna}`;
        await sql`DELETE FROM riservato.persona WHERE id = ${personaIdBologna}`;
      }
      await sql.end();
    }
  },
);
