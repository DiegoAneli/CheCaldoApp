/**
 * Test di regressione §12dddddd-bis (2026-08-13): le query di lettura
 * di `pubblico.allerta` devono spezzare la parità su `data_estrazione
 * DESC`, così a parità di (comune, data, orizzonte) vince sempre la
 * scrittura più recente.
 *
 * Il bug che questo test previene. Il 2026-08-13 il poller di Bologna
 * scrisse regolarmente le nuove righe con `data_estrazione =
 * 2026-08-13`, ma la card pubblica continuava a mostrare "Ultimo
 * aggiornamento: 12 agosto 2026" perché `allertaCorrente` ordinava
 * `data DESC, orizzonte_ore ASC` senza tie-breaker. La UNIQUE key su
 * `(comune_istat, data, orizzonte_ore, data_estrazione)` (schema.sql:112)
 * ammette due righe con stessa `data` e stesso `orizzonte_ore` — è
 * l'invariante voluto, il poller UPSERTa per estrazione — e Postgres
 * senza `data_estrazione DESC` esplicito restituiva la riga vecchia.
 *
 * Un ordinamento ambiguo dà risultati non deterministici: oggi ha
 * scelto la riga vecchia, domani potrebbe scegliere quella giusta e
 * nascondere il problema. Questo test lega la scelta al comportamento
 * atteso, indipendentemente dal piano di esecuzione.
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import postgres from "postgres";
import {
  allertaCorrente,
  allertaDelGiorno,
  allertaPrevisione,
} from "../src/index";
// `oggiRome` è la sorgente unica di "oggi" del monorepo (§12yyyy/§12zzzz):
// formatta l'istante corrente in Europe/Rome, stessa nozione del
// `CURRENT_DATE` del container postgis (`-c timezone=Europe/Rome`).
// Prima questo file usava `new Date().toISOString().slice(0,10)` — UTC —
// e il test di `allertaPrevisione` cadeva in tarda serata italiana,
// quando UTC è ancora "ieri" e Roma è già "oggi", perché la query
// filtra `data BETWEEN CURRENT_DATE AND CURRENT_DATE+2` (Rome) e il
// test inseriva date UTC (una fuori range, una mancante).
import { aggiungiGiorniIso, oggiRome } from "../src/data-oggi";

const DATABASE_URL = process.env.DATABASE_URL;
const skip = !DATABASE_URL
  ? { skip: "DATABASE_URL non impostata: test di integrazione saltato" as string }
  : undefined;

// `pubblico.allerta.comune_istat` è `char(6) NOT NULL` senza FK a
// `pubblico.organizzazione` (schema.sql:86-113): un codice fittizio a
// 6 cifre non collide con Parma/Bologna e non contamina le fixture.
const COMUNE_TEST = "999999";

async function pulisci(sql: postgres.Sql): Promise<void> {
  await sql`DELETE FROM pubblico.allerta WHERE comune_istat = ${COMUNE_TEST}`;
}

test(
  "§12dddddd-bis — allertaCorrente vince la data_estrazione più recente a parità di (data, orizzonte)",
  skip ?? {},
  async () => {
    const sql = postgres(DATABASE_URL!, { max: 1 });
    try {
      await pulisci(sql);

      const oggi = oggiRome();
      const ieri = aggiungiGiorniIso(oggi, -1);

      // Ordine di INSERT scelto per NON aiutare la query: prima la riga
      // vecchia (che è quella sbagliata da restituire), poi la nuova.
      // Senza `ORDER BY data_estrazione DESC`, un piano che scandisce
      // in ordine di inserimento restituirebbe la vecchia.
      await sql`
        INSERT INTO pubblico.allerta
          (comune_istat, data, livello, provenienza, orizzonte_ore, data_estrazione)
        VALUES
          (${COMUNE_TEST}, ${oggi}::date, 1, 'bollettino', 24, ${ieri}::date),
          (${COMUNE_TEST}, ${oggi}::date, 3, 'bollettino', 24, ${oggi}::date)
      `;

      const r = await allertaCorrente(sql, COMUNE_TEST);
      assert.ok(r, "allertaCorrente non ha trovato la riga di oggi");
      assert.equal(
        r.livello, 3,
        `regressione: allertaCorrente ha restituito la riga vecchia ` +
        `(livello ${r.livello}, dataEstrazione ${r.dataEstrazione}). ` +
        `Deve vincere la scrittura con data_estrazione più recente.`,
      );
      assert.equal(r.dataEstrazione, oggi);
    } finally {
      await pulisci(sql);
      await sql.end();
    }
  },
);

test(
  "§12dddddd-bis — allertaDelGiorno vince la data_estrazione più recente a parità di orizzonte",
  skip ?? {},
  async () => {
    const sql = postgres(DATABASE_URL!, { max: 1 });
    try {
      await pulisci(sql);

      const oggi = oggiRome();
      const ieri = aggiungiGiorniIso(oggi, -1);

      await sql`
        INSERT INTO pubblico.allerta
          (comune_istat, data, livello, provenienza, orizzonte_ore, data_estrazione)
        VALUES
          (${COMUNE_TEST}, ${oggi}::date, 0, 'bollettino', 24, ${ieri}::date),
          (${COMUNE_TEST}, ${oggi}::date, 2, 'bollettino', 24, ${oggi}::date)
      `;

      const r = await allertaDelGiorno(sql, COMUNE_TEST, oggi);
      assert.ok(r, "allertaDelGiorno non ha trovato la riga");
      assert.equal(
        r.livello, 2,
        `regressione: allertaDelGiorno ha restituito la riga vecchia ` +
        `(livello ${r.livello}, dataEstrazione ${r.dataEstrazione}).`,
      );
      assert.equal(r.dataEstrazione, oggi);
    } finally {
      await pulisci(sql);
      await sql.end();
    }
  },
);

test(
  "§12dddddd-bis — allertaPrevisione: per ogni offset vince la data_estrazione più recente",
  skip ?? {},
  async () => {
    const sql = postgres(DATABASE_URL!, { max: 1 });
    try {
      await pulisci(sql);

      const oggi = oggiRome();
      const ieri = aggiungiGiorniIso(oggi, -1);
      const domani = aggiungiGiorniIso(oggi, 1);

      // Per "domani" (offset +1) inserisco due righe con stessa data e
      // stesso orizzonte, estrazioni diverse. allertaPrevisione usa
      // DISTINCT ON (data) ORDER BY data ASC, data_estrazione DESC:
      // deve vincere quella con data_estrazione più recente.
      await sql`
        INSERT INTO pubblico.allerta
          (comune_istat, data, livello, provenienza, orizzonte_ore, data_estrazione)
        VALUES
          (${COMUNE_TEST}, ${oggi}::date,   3, 'bollettino', 24, ${oggi}::date),
          (${COMUNE_TEST}, ${domani}::date, 0, 'bollettino', 48, ${ieri}::date),
          (${COMUNE_TEST}, ${domani}::date, 3, 'bollettino', 48, ${oggi}::date)
      `;

      const p = await allertaPrevisione(sql, COMUNE_TEST);
      assert.ok(p.oggi, "previsione.oggi manca");
      assert.equal(p.oggi.livello, 3);
      assert.ok(p.domani, "previsione.domani manca");
      assert.equal(
        p.domani.livello, 3,
        `regressione: allertaPrevisione.domani ha restituito la riga ` +
        `vecchia (livello ${p.domani.livello}, dataEstrazione ` +
        `${p.domani.dataEstrazione}).`,
      );
      assert.equal(p.domani.dataEstrazione, oggi);
    } finally {
      await pulisci(sql);
      await sql.end();
    }
  },
);
