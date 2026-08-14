/**
 * Test di regressione §12jjjjjj (2026-08-13): la catena di lettura
 * riconosce correttamente il caso "ripiego a stima quando il
 * bollettino non riporta la città".
 *
 * Perché questo test. La pagina `/bologna/metodo` promette
 * pubblicamente un comportamento: quando il bollettino ministeriale
 * non copre Bologna (mancata pubblicazione, fuori stagione), il
 * sistema ripiega sulla stima statistica e il badge nella pagina
 * pubblica cambia da "bollettino del Ministero" a "livello stimato
 * · non ufficiale". Il codice del ripiego esiste
 * (`packages/ingest/allerta.py:500-538` `bollettino_o_fallback`) e
 * scrive righe con `provenienza='stima'` +
 * `motivo_provenienza='citta_non_nel_bollettino'`. C'è già un test
 * lato poller che mocca `bollettino()==[]` e verifica la scrittura
 * (`packages/ingest/test/test_allerta.py::test_fallback_bollettino_vuoto_scrive_stima_con_motivo`).
 *
 * Ma la catena "il DB restituisce quelle righe e le query TS le
 * classificano correttamente" non era mai stata verificata: il
 * ripiego non è mai scattato in produzione (query 2026-08-13 su
 * `pubblico.allerta` con `motivo_provenienza='citta_non_nel_bollettino'`
 * → 0 righe, mai). La pagina prometteva un comportamento mai
 * osservato. Abbiamo già trovato tre casi di interfaccia che
 * prometteva cose che il sistema non faceva; questo lo copre prima
 * che diventi il quarto.
 *
 * Scope contenuto. Il test simula solo l'ultimo tratto della catena:
 * righe già scritte in `pubblico.allerta` come le scriverebbe
 * `scrivi_db` in fallback; verifica che `allertaCorrente`,
 * `allertaDelGiorno`, `allertaPrevisione` restituiscano
 * `provenienza='stima'` + `motivoProvenienza='citta_non_nel_bollettino'`.
 * Il rendering del badge in `apps/web/components/card-allerta.tsx`
 * (dove `cittaNonNelBollettino` scatena il paragrafo di
 * spiegazione) resta scoperto — vedi "Limite noto" in
 * CHECALDO-PROGETTO §12jjjjjj.
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
// e i test cadevano in tarda serata italiana, quando UTC è ancora "ieri"
// e Roma è già "oggi", perché la query filtra `data BETWEEN CURRENT_DATE
// AND CURRENT_DATE+2` (Rome) e il test inseriva date UTC.
import { aggiungiGiorniIso, oggiRome } from "../src/data-oggi";

const DATABASE_URL = process.env.DATABASE_URL;
const skip = !DATABASE_URL
  ? { skip: "DATABASE_URL non impostata: test di integrazione saltato" as string }
  : undefined;

// Comune fittizio distinto da quello di `allerta-tie-breaker.test.ts`
// (`999999`) per non collidere in caso di esecuzione parallela dei
// test files. `pubblico.allerta.comune_istat` è `char(6) NOT NULL`
// senza FK a `pubblico.organizzazione`.
const COMUNE_TEST = "999998";

async function pulisci(sql: postgres.Sql): Promise<void> {
  await sql`DELETE FROM pubblico.allerta WHERE comune_istat = ${COMUNE_TEST}`;
}

test(
  "§12jjjjjj — allertaCorrente riconosce il ripiego: provenienza=stima, motivoProvenienza=citta_non_nel_bollettino",
  skip ?? {},
  async () => {
    const sql = postgres(DATABASE_URL!, { max: 1 });
    try {
      await pulisci(sql);

      const oggi = oggiRome();
      // Scrittura che simula fedelmente `scrivi_db` (allerta.py:436-483)
      // dopo `bollettino_o_fallback` con `bollettino()==[]`: le righe
      // sono generate da `stima()` (provenienza='stima') e ricevono
      // `motivo='citta_non_nel_bollettino'` prima dell'UPSERT.
      // Il CHECK di schema.sql:111 ammette esattamente questo unico
      // valore per motivo_provenienza.
      await sql`
        INSERT INTO pubblico.allerta
          (comune_istat, data, livello, provenienza,
           orizzonte_ore, notti_tropicali, data_estrazione,
           motivo_provenienza)
        VALUES
          (${COMUNE_TEST}, ${oggi}::date, 2, 'stima', 24, 3,
           ${oggi}::date, 'citta_non_nel_bollettino')
      `;

      const r = await allertaCorrente(sql, COMUNE_TEST);
      assert.ok(r, "allertaCorrente non ha trovato la riga di fallback");
      assert.equal(r.provenienza, "stima",
        "provenienza deve essere 'stima' — è così che il badge decide di ripiegare");
      assert.equal(r.motivoProvenienza, "citta_non_nel_bollettino",
        "motivoProvenienza deve essere valorizzato — è così che la card mostra il paragrafo esplicativo");
      assert.equal(r.livello, 2);
      assert.equal(r.nottiTropicali, 3);
    } finally {
      await pulisci(sql);
      await sql.end();
    }
  },
);

test(
  "§12jjjjjj — allertaDelGiorno riconosce il ripiego per una data specifica",
  skip ?? {},
  async () => {
    const sql = postgres(DATABASE_URL!, { max: 1 });
    try {
      await pulisci(sql);

      const oggi = oggiRome();
      await sql`
        INSERT INTO pubblico.allerta
          (comune_istat, data, livello, provenienza,
           orizzonte_ore, data_estrazione, motivo_provenienza)
        VALUES
          (${COMUNE_TEST}, ${oggi}::date, 1, 'stima', 24,
           ${oggi}::date, 'citta_non_nel_bollettino')
      `;

      const r = await allertaDelGiorno(sql, COMUNE_TEST, oggi);
      assert.ok(r);
      assert.equal(r.provenienza, "stima");
      assert.equal(r.motivoProvenienza, "citta_non_nel_bollettino");
    } finally {
      await pulisci(sql);
      await sql.end();
    }
  },
);

test(
  "§12jjjjjj — allertaPrevisione propaga provenienza/motivo su oggi/domani/dopodomani",
  skip ?? {},
  async () => {
    const sql = postgres(DATABASE_URL!, { max: 1 });
    try {
      await pulisci(sql);

      const oggi = oggiRome();
      const domani = aggiungiGiorniIso(oggi, 1);
      const dopodomani = aggiungiGiorniIso(oggi, 2);

      // Fallback su 3 orizzonti come farebbe stima() emettendo E, E+1, E+2.
      await sql`
        INSERT INTO pubblico.allerta
          (comune_istat, data, livello, provenienza,
           orizzonte_ore, data_estrazione, motivo_provenienza)
        VALUES
          (${COMUNE_TEST}, ${oggi}::date,       2, 'stima', 24, ${oggi}::date, 'citta_non_nel_bollettino'),
          (${COMUNE_TEST}, ${domani}::date,     1, 'stima', 48, ${oggi}::date, 'citta_non_nel_bollettino'),
          (${COMUNE_TEST}, ${dopodomani}::date, 0, 'stima', 72, ${oggi}::date, 'citta_non_nel_bollettino')
      `;

      const p = await allertaPrevisione(sql, COMUNE_TEST);
      for (const [nome, riga] of [
        ["oggi", p.oggi], ["domani", p.domani], ["dopodomani", p.dopodomani],
      ] as const) {
        assert.ok(riga, `previsione.${nome} manca`);
        assert.equal(riga.provenienza, "stima",
          `previsione.${nome}: provenienza deve essere 'stima'`);
        assert.equal(riga.motivoProvenienza, "citta_non_nel_bollettino",
          `previsione.${nome}: motivoProvenienza deve essere 'citta_non_nel_bollettino'`);
      }
    } finally {
      await pulisci(sql);
      await sql.end();
    }
  },
);
