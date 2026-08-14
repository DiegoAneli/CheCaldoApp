/**
 * Test di regressione §12zzz: separazione fra conteggio volontari
 * attivi e presenza di una riga in `riservato.soglia_giorno`.
 *
 * Prima del 2026-08-10 il conteggio dei volontari era una subquery
 * scalare appesa a `FROM riservato.soglia_giorno` dentro
 * `sogliaCorrente`. Quando la riga della soglia mancava (mattina di
 * ogni giorno nuovo, prima della generazione del giro) l'intera query
 * non restituiva nulla e la dashboard mostrava "Volontari attivi: 0 ·
 * capienza suggerita: 0" a coordinatori che avevano N volontari
 * attivi: affermazione falsa mostrata all'operatore per giorni senza
 * che nessuno se ne accorgesse.
 *
 * `contaVolontariAttivi(sql, orgId)` è ora indipendente. Questo file
 * ne è la difesa: il conteggio deve tornare corretto sia quando la
 * riga di soglia esiste sia quando manca; e `sogliaCorrente` deve
 * ritornare null quando la riga manca, senza trascinare con sé il
 * conteggio dei volontari.
 *
 * Data futura fuori range operativo (2099) per non contaminare le
 * fixture. Cleanup su try/finally.
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import postgres from "postgres";
import { contaVolontariAttivi, sogliaCorrente } from "../src/index";

const DATABASE_URL = process.env.DATABASE_URL;
const skip = !DATABASE_URL
  ? { skip: "DATABASE_URL non impostata: test di integrazione saltato" as string }
  : undefined;

const ORG_PARMA = 1;
const DATA_TEST = "2099-02-14";

async function pulisci(sql: postgres.Sql): Promise<void> {
  await sql`DELETE FROM riservato.soglia_giorno WHERE data = ${DATA_TEST}::date`;
}

test(
  "§12zzz — contaVolontariAttivi torna N anche senza riga in soglia_giorno per oggi",
  skip ?? {},
  async () => {
    const sql = postgres(DATABASE_URL!, { max: 1 });
    try {
      await pulisci(sql);

      // Precondizione: la riga di soglia per la data di test non esiste.
      const [pre] = await sql<Array<{ n: number }>>`
        SELECT count(*)::int AS n FROM riservato.soglia_giorno
         WHERE organizzazione_id = ${ORG_PARMA} AND data = ${DATA_TEST}::date
      `;
      assert.equal(pre.n, 0, "precondizione: nessuna riga di soglia per la data di test");

      // Verifica: il conteggio non dipende dalla riga di soglia.
      const n = await contaVolontariAttivi(sql, ORG_PARMA);
      assert.ok(
        n > 0,
        `contaVolontariAttivi tornerebbe 0: è il bug pre-§12zzz (subquery ` +
        `appesa a FROM soglia_giorno). Se il conteggio dei volontari torna ` +
        `a dipendere da una scrittura per-giorno, questo test cade.`,
      );

      // E sogliaCorrente, quando la riga manca, deve ritornare null pulito.
      const soglia = await sogliaCorrente(sql, ORG_PARMA, DATA_TEST);
      assert.equal(soglia, null, "sogliaCorrente deve tornare null senza riga per oggi");
    } finally {
      await pulisci(sql);
      await sql.end();
    }
  },
);

test(
  "§12zzz — contaVolontariAttivi torna lo stesso N con la riga di soglia presente",
  skip ?? {},
  async () => {
    const sql = postgres(DATABASE_URL!, { max: 1 });
    try {
      await pulisci(sql);
      const senzaRiga = await contaVolontariAttivi(sql, ORG_PARMA);

      // Insert una riga di soglia sintetica per la data di test.
      await sql`
        INSERT INTO riservato.soglia_giorno
          (organizzazione_id, data, valore, impostata_da, livello_al_salvataggio)
        VALUES
          (${ORG_PARMA}, ${DATA_TEST}::date, 30, NULL, 2)
      `;
      const conRiga = await contaVolontariAttivi(sql, ORG_PARMA);

      assert.equal(
        conRiga, senzaRiga,
        "contaVolontariAttivi deve tornare lo stesso numero indipendentemente " +
        "dalla presenza di una riga in soglia_giorno per la data",
      );

      // E sogliaCorrente ora deve tornare la riga con i suoi campi
      // (valore, impostataDa, livelloAlSalvataggio) — nessun volontariAttivi
      // nel payload, che vive nella funzione dedicata.
      const soglia = await sogliaCorrente(sql, ORG_PARMA, DATA_TEST);
      assert.notEqual(soglia, null, "sogliaCorrente deve tornare la riga appena scritta");
      assert.equal(soglia!.valore, 30);
      assert.equal(soglia!.livelloAlSalvataggio, 2);
      assert.ok(
        !Object.prototype.hasOwnProperty.call(soglia!, "volontariAttivi"),
        "SogliaCorrente non deve più portare volontariAttivi: se torna, è la " +
        "regressione del difetto §12zzz",
      );
    } finally {
      await pulisci(sql);
      await sql.end();
    }
  },
);
