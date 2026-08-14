/**
 * Test di integrazione: pipeline query → motore per il fattore
 * `giorni_da_ultimo_contatto`.
 *
 * Regressione difesa (§12jjj): il fattore esiste in
 * `packages/scoring/src/index.ts` ed è testato in isolamento in
 * `packages/scoring/test/scoring.test.ts:147` passando manualmente
 * `dataUltimoContatto` alla Persona costruita. Ma per settimane la
 * classifica reale non l'ha mai applicato — `personePerClassifica`
 * non popolava il campo, e il fattore restava dormiente.
 *
 * Questi due test bloccano quel modo di sbagliare:
 *   1. `dataUltimoContatto` arriva nel Persona restituito quando il
 *      DB ha il campo popolato.
 *   2. `classificaPersone` alimentata da `personePerClassifica`
 *      produce il fattore `giorni_da_ultimo_contatto` fra i
 *      `fattori` dell'output. Se domani qualcuno rimuove la
 *      colonna dalla SELECT, la query resta valida ma il fattore
 *      sparisce — questo test rompe.
 *
 * Richiede DATABASE_URL: se manca, skipped come gli altri test di
 * integrazione. Il setup usa una transazione con ROLLBACK per non
 * sporcare il DB reale.
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import postgres from "postgres";
import { personePerClassifica } from "../src/index";
import {
  classificaPersone,
  valutaSezioni,
  type Allerta,
  type Sezione,
} from "@checaldo/scoring";

const DATABASE_URL = process.env.DATABASE_URL;
const skip = !DATABASE_URL
  ? { skip: "DATABASE_URL non impostata: test di integrazione saltato" as string }
  : undefined;

const ORG_PARMA = 1;
const COMUNE_PARMA = "034027";

const allertaFinta: Allerta = {
  livello: 2,
  provenienza: "stima",
  data: "2026-08-07",
  orizzonteOre: 24,
  nottiTropicali: 0,
};

test(
  "§12jjj — personePerClassifica popola dataUltimoContatto dalla colonna DB",
  skip ?? {},
  async () => {
    const sql = postgres(DATABASE_URL!, { max: 1 });
    try {
      // Prendo una persona esistente del canone Parma e ne salvo il valore
      // corrente di data_ultimo_contatto per confronto. NON scrivo nulla:
      // se il canone attuale ha già alcune persone con data valorizzata e
      // altre no (canone del generatore, ~70/30), verifico entrambi i casi.
      const [conData] = await sql<Array<{ idEsterno: string; data: string }>>`
        SELECT id_esterno AS "idEsterno",
               to_char(data_ultimo_contatto, 'YYYY-MM-DD') AS data
          FROM riservato.persona
         WHERE organizzazione_id = ${ORG_PARMA}
           AND data_ultimo_contatto IS NOT NULL
           AND attiva
         ORDER BY id LIMIT 1
      `;
      const [senzaData] = await sql<Array<{ idEsterno: string }>>`
        SELECT id_esterno AS "idEsterno"
          FROM riservato.persona
         WHERE organizzazione_id = ${ORG_PARMA}
           AND data_ultimo_contatto IS NULL
           AND attiva
         ORDER BY id LIMIT 1
      `;

      // Se il canone corrente non contiene entrambi i casi (es. istanza
      // fresca dove tutti hanno NULL), saltiamo. Il test resta valido
      // per il caso comune (~70/30 dal generatore).
      if (!conData || !senzaData) {
        return;
      }

      const persone = await personePerClassifica(sql, ORG_PARMA, "2026-08-07");
      const pConData = persone.find((p) => p.idEsterno === conData.idEsterno);
      const pSenzaData = persone.find((p) => p.idEsterno === senzaData.idEsterno);

      assert.ok(pConData, `persona ${conData.idEsterno} presente nell'output`);
      assert.equal(
        pConData!.dataUltimoContatto,
        conData.data,
        "il campo dataUltimoContatto deve arrivare dal DB, formattato YYYY-MM-DD",
      );

      assert.ok(pSenzaData, `persona ${senzaData.idEsterno} presente nell'output`);
      assert.equal(
        pSenzaData!.dataUltimoContatto,
        undefined,
        "il campo dataUltimoContatto deve essere undefined per righe NULL in DB",
      );
    } finally {
      await sql.end();
    }
  },
);

test(
  "§12jjj — classificaPersone produce il fattore giorni_da_ultimo_contatto quando c'è la data",
  skip ?? {},
  async () => {
    const sql = postgres(DATABASE_URL!, { max: 1 });
    try {
      const persone = await personePerClassifica(sql, ORG_PARMA, "2026-08-07");
      if (persone.length === 0) return;

      const sezioni = await sql<Sezione[]>`
        SELECT id AS id, quartiere AS quartiere, popolazione AS popolazione,
               famiglie AS famiglie, abitazioni AS abitazioni,
               edifici_residenziali AS "edificiResidenziali",
               tipo_sezione AS "tipoSezione",
               metri_da_punto_fresco AS "metriDaPuntoFresco",
               delta_termico AS "deltaTermico"
          FROM pubblico.sezione
         WHERE comune_istat = ${COMUNE_PARMA} AND NOT fittizia
      `;
      const valutate = valutaSezioni(sezioni);
      const classifica = classificaPersone(persone, valutate, {
        allerta: allertaFinta,
        soglia: 30,
        oggi: new Date("2026-08-07T00:00:00Z"),
      });

      const almenoUnaConFattore = classifica.some((r) =>
        r.fattori.some((f) => f.chiave === "giorni_da_ultimo_contatto"),
      );
      assert.ok(
        almenoUnaConFattore,
        "almeno una persona in classifica deve portare il fattore " +
          "giorni_da_ultimo_contatto. Se questo test fallisce, o la SELECT " +
          "in personePerClassifica ha perso la colonna, o il canone corrente " +
          "ha tutte le data_ultimo_contatto NULL (verificare con " +
          "SELECT count(*) FILTER (WHERE data_ultimo_contatto IS NOT NULL) " +
          "FROM riservato.persona WHERE organizzazione_id=1).",
      );

      // Contributo entro il range calibrato [0.75, 1.00] (§12jjj
      // revisione: verso invertito, il moltiplicatore penalizza chi
      // è stato contattato di recente, resta neutro per NULL o
      // contatto ≥ 30 giorni). Non è una promessa che ogni riga con
      // il fattore abbia questo range — è una promessa che se il
      // motore lo emette, il numero è quello atteso dalla formula
      // 0.75 + min(gg,30)/120.
      for (const r of classifica) {
        const f = r.fattori.find((x) => x.chiave === "giorni_da_ultimo_contatto");
        if (!f) continue;
        assert.ok(
          f.contributo >= 0.75 && f.contributo <= 1.0001,
          `contributo del fattore fuori range [0.75, 1.00]: ${f.contributo} ` +
            `(persona ${r.idEsterno}, gg=${f.valore})`,
        );
      }
    } finally {
      await sql.end();
    }
  },
);
