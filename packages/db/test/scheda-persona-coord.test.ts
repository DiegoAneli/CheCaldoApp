/**
 * Test §12jjjj — scheda persona lato coordinatore.
 *
 * Tre invarianti:
 *
 * 1. Ricostruzione del punteggio dai `fattori` di una riga di
 *    `riservato.assegnazione`: base × prodotto(molt con
 *    `fonte IN ('organizzazione','segnale')`) deve coincidere col
 *    valore salvato in `riservato.rango_giorno.punteggio`, a floating
 *    point tolerance. Verificato su Persona 65 (id 65) dove la
 *    ricostruzione era già stata fatta a mano in sessione di analisi.
 *
 * 2. I fattori ISTAT diversi da `punteggio_sezione` (persone per
 *    famiglia, abitazioni per edificio, metri da punto fresco,
 *    delta termico) NON entrano nel prodotto — sono già dentro il
 *    `punteggio_sezione`. Se qualcuno cambia la scomposizione UI
 *    per moltiplicarli, il punteggio ricostruito diverge. Il test
 *    calcola due volte, con e senza, e verifica che solo il "senza"
 *    coincide col DB.
 *
 * 3. `assertAppartiene` blocca la lettura di una persona di un'altra
 *    organizzazione. Prima volta del suo uso in lettura (§12jjjj):
 *    il test replica lo scenario "coordinatore Parma prova a
 *    caricare la persona 0 di Bologna".
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import postgres from "postgres";
import {
  AppartenenzaViolata,
  assertAppartiene,
  datiPersonaCoord,
} from "../src/index";

const DATABASE_URL = process.env.DATABASE_URL;
const skip = !DATABASE_URL
  ? { skip: "DATABASE_URL non impostata: test di integrazione saltato" as string }
  : undefined;

const ORG_PARMA = 1;
const ORG_BOLOGNA = 2;

interface Fattore {
  chiave: string;
  contributo: number;
  fonte: string;
}

test(
  "§12jjjj — ricostruzione punteggio da fattori (base × molt org+segnale)",
  skip ?? {},
  async () => {
    const sql = postgres(DATABASE_URL!, { max: 1 });
    try {
      const dati = await datiPersonaCoord(sql, 65, "2026-08-10");
      assert.notEqual(dati, null, "persona 65 deve esistere in org 1");
      assert.notEqual(dati!.ultimaAssegnazione, null, "persona 65 deve avere assegnazione");
      const ua = dati!.ultimaAssegnazione!;

      const fattori = ua.fattori as Fattore[];
      const base = fattori.find((f) => f.chiave === "punteggio_sezione");
      assert.notEqual(base, undefined, "deve esistere fattore punteggio_sezione");

      const moltCorretti = fattori
        .filter((f) => f.fonte === "organizzazione" || f.fonte === "segnale")
        .reduce((acc, f) => acc * f.contributo, 1);

      const ricostruito = base!.contributo * moltCorretti;

      // Tolleranza floating-point: la sessione di analisi aveva
      // verificato coincidenza a 15 cifre; qui accetto delta ≤ 1e-9
      // che è sopravvivere a un cambio di ordine di somma.
      const delta = Math.abs(ricostruito - ua.punteggio);
      assert.ok(
        delta < 1e-9,
        `punteggio ricostruito ${ricostruito} vs DB ${ua.punteggio}, delta ${delta}. ` +
        "Se non torna, la scomposizione UI mostra numeri che non producono " +
        "il punteggio finale — chi legge somma male.",
      );
    } finally {
      await sql.end();
    }
  },
);

test(
  "§12jjjj — fattori ISTAT non-base NON entrano nel prodotto",
  skip ?? {},
  async () => {
    const sql = postgres(DATABASE_URL!, { max: 1 });
    try {
      const dati = await datiPersonaCoord(sql, 65, "2026-08-10");
      const ua = dati!.ultimaAssegnazione!;
      const fattori = ua.fattori as Fattore[];
      const base = fattori.find((f) => f.chiave === "punteggio_sezione")!;

      // Ricostruzione CORRETTA: solo `organizzazione` + `segnale`.
      const moltCorretti = fattori
        .filter((f) => f.fonte === "organizzazione" || f.fonte === "segnale")
        .reduce((acc, f) => acc * f.contributo, 1);
      const corretto = base.contributo * moltCorretti;

      // Ricostruzione ROTTA: include anche gli ISTAT non-base
      // (persone_per_famiglia, abitazioni_per_edificio, ecc.).
      // Simuliamo l'errore che qualcuno potrebbe fare mescolando i
      // fattori nella tabella.
      const istatNonBase = fattori.filter(
        (f) => f.fonte === "istat" && f.chiave !== "punteggio_sezione",
      );
      assert.ok(
        istatNonBase.length > 0,
        "canone: persona 65 deve avere fattori ISTAT non-base (persone_per_famiglia, ecc.)",
      );
      const moltRotti = fattori
        .filter((f) => f.fonte !== "istat" || f.chiave === "punteggio_sezione")
        .concat(istatNonBase)
        .filter((f) => f.chiave !== "punteggio_sezione")
        .reduce((acc, f) => acc * f.contributo, 1);
      const rotto = base.contributo * moltRotti;

      assert.notEqual(
        Math.abs(rotto - ua.punteggio) < 1e-9,
        true,
        "se il calcolo 'rotto' coincidesse col DB, l'invariante non discrimina — " +
        "il canone non ha ISTAT non-base o i loro contributi sono tutti 1.0",
      );
      assert.ok(
        Math.abs(corretto - ua.punteggio) < 1e-9,
        "il calcolo corretto (solo org+segnale) deve coincidere col DB",
      );
    } finally {
      await sql.end();
    }
  },
);

test(
  "§12jjjj — assertAppartiene blocca lettura di persona di altra org",
  skip ?? {},
  async () => {
    const sql = postgres(DATABASE_URL!, { max: 1 });
    try {
      // Trova una persona di Bologna. Prima volta di
      // `assertAppartiene` su lettura: replica lo scenario del
      // coordinatore Parma che cambia id in URL.
      const [pBologna] = await sql<Array<{ id: number }>>`
        SELECT id FROM riservato.persona
         WHERE organizzazione_id = ${ORG_BOLOGNA} AND attiva
         ORDER BY id LIMIT 1
      `;
      assert.notEqual(pBologna, undefined, "canone: serve almeno una persona in org 2 (Bologna)");

      await assert.rejects(
        () => assertAppartiene(sql, ORG_PARMA, { personaId: pBologna!.id }),
        (err: unknown) => err instanceof AppartenenzaViolata,
        "assertAppartiene(persona di Bologna, sessione Parma) deve lanciare AppartenenzaViolata. " +
        "Se non lancia, la page /coordinatore/persona/[id] apre schede cross-org via URL manipulation.",
      );

      // Contro-verifica: la persona di Parma passa senza throw.
      const [pParma] = await sql<Array<{ id: number }>>`
        SELECT id FROM riservato.persona
         WHERE organizzazione_id = ${ORG_PARMA} AND attiva
         ORDER BY id LIMIT 1
      `;
      assert.notEqual(pParma, undefined);
      await assertAppartiene(sql, ORG_PARMA, { personaId: pParma!.id });
    } finally {
      await sql.end();
    }
  },
);

// ------------------------------------------------------ §12kkkk — tre stati "Perché sta lì"
//
// La scheda distingue: (1) in lista oggi, (2) valutata fuori soglia,
// (3) mai valutata. Prima di §12kkkk la scheda collassava (2) e (3)
// in "Mai stata in lista", che era falso per le 448 persone di org 1
// valutate ogni giorno ma sempre fuori dalla soglia di taglio.

test(
  "§12kkkk — persona in lista oggi: ultimoRangoValutato con valutataOggi=true + ultimaAssegnazione.inListaOggi=true",
  skip ?? {},
  async () => {
    const sql = postgres(DATABASE_URL!, { max: 1 });
    try {
      // §12wwww — rimosso l'ancoraggio a persona 65 + data fissa
      // "2026-08-10". Il test cadeva ogni giorno dal 2026-08-11 in
      // avanti perché `rango_giorno` per persona 65 aveva sempre una
      // data più recente di 2026-08-10 → `valutataOggi === false`
      // contro `assert.equal(..., true)`. Ora il setup pesca una
      // coppia (persona, data) realmente in lista alla data più
      // recente disponibile, con `data <= CURRENT_DATE` per escludere
      // le sentinelle a 2099 che `isolamento.test.ts` inserisce in
      // parallelo. Le due asserzioni sui valori assoluti (`data ===
      // "2026-08-10"`) sono diventate asserzioni sulla RELAZIONE
      // (`data === maxData` letta nel setup).
      const [pick] = await sql<Array<{ personaId: number; maxData: string }>>`
        SELECT a.persona_id                        AS "personaId",
               to_char(a.data, 'YYYY-MM-DD')       AS "maxData"
          FROM riservato.assegnazione a
          JOIN riservato.rango_giorno rg
            ON rg.persona_id = a.persona_id
           AND rg.data = a.data
           AND rg.organizzazione_id = a.organizzazione_id
         WHERE a.organizzazione_id = ${ORG_PARMA}
           AND a.data <= CURRENT_DATE
         ORDER BY a.data DESC, a.persona_id ASC
         LIMIT 1
      `;
      assert.notEqual(
        pick, undefined,
        "nessuna persona in lista in org 1 per data <= oggi: " +
        "carica il seed sintetico e genera almeno un giro",
      );

      const d = await datiPersonaCoord(sql, pick!.personaId, pick!.maxData);
      assert.notEqual(d, null);
      assert.notEqual(d!.ultimoRangoValutato, null, "in lista oggi implica anche valutata oggi");
      assert.equal(d!.ultimoRangoValutato!.valutataOggi, true, "il rango è di oggi");
      assert.equal(d!.ultimoRangoValutato!.data, pick!.maxData);
      assert.notEqual(d!.ultimaAssegnazione, null, "in lista oggi implica assegnazione");
      assert.equal(d!.ultimaAssegnazione!.inListaOggi, true);
      // Il rango di rango_giorno e quello di assegnazione devono
      // coincidere per il giorno in cui la persona è in lista.
      assert.equal(
        d!.ultimoRangoValutato!.rango,
        d!.ultimaAssegnazione!.rango,
        "rango di oggi da rango_giorno deve coincidere con rango_globale dell'assegnazione di oggi",
      );
      assert.ok(
        d!.ultimoRangoValutato!.totaleValutati >= 400,
        "canone: ~500 persone valutate ogni giorno",
      );
    } finally {
      await sql.end();
    }
  },
);

test(
  "§12kkkk — persona valutata fuori soglia: rango+punteggio da rango_giorno, assegnazione può essere null",
  skip ?? {},
  async () => {
    const sql = postgres(DATABASE_URL!, { max: 1 });
    try {
      // §12wwww — rimosso l'ancoraggio a persona 1 + data "2026-08-10"
      // + rango 464 + punteggio 0.5435. Rango e punteggio dipendono
      // dallo stato dei segnali e dall'allerta del giorno: variano
      // ogni giro. Il test cadeva ogni giorno dal 2026-08-11 in
      // avanti su `data === "2026-08-10"` non appena il ciclo notturno
      // scriveva `rango_giorno` per una data più recente. Ora il
      // setup pesca la data più recente di `rango_giorno` per org 1
      // (con `data <= CURRENT_DATE` per escludere le sentinelle 2099
      // di isolamento.test.ts) e una persona valutata a quella data
      // MA senza assegnazione per la stessa data — "fuori soglia" in
      // senso operativo. Rango, punteggio, totaleValutati vengono
      // letti live dal DB e usati come valori attesi: si verifica la
      // RELAZIONE (datiPersonaCoord serve gli stessi numeri di
      // rango_giorno alla stessa data), non un canone congelato.
      // `ORDER BY rango DESC LIMIT 1` prende la persona più lontana
      // dalla soglia — la più solidamente fuori.
      const [pick] = await sql<Array<{
        personaId: number; maxData: string;
        rango: number; punteggio: number; totale: number;
      }>>`
        WITH ultima AS (
          SELECT max(data) AS d
            FROM riservato.rango_giorno
           WHERE organizzazione_id = ${ORG_PARMA}
             AND data <= CURRENT_DATE
        )
        SELECT rg.persona_id                             AS "personaId",
               to_char(rg.data, 'YYYY-MM-DD')            AS "maxData",
               rg.rango                                  AS rango,
               rg.punteggio                              AS punteggio,
               (SELECT count(*)::int FROM riservato.rango_giorno rg2
                 WHERE rg2.organizzazione_id = rg.organizzazione_id
                   AND rg2.data = rg.data)               AS totale
          FROM riservato.rango_giorno rg
          JOIN ultima ON ultima.d = rg.data
         WHERE rg.organizzazione_id = ${ORG_PARMA}
           AND NOT EXISTS (
             SELECT 1 FROM riservato.assegnazione a
              WHERE a.persona_id = rg.persona_id
                AND a.data = rg.data
                AND a.organizzazione_id = rg.organizzazione_id
           )
         ORDER BY rg.rango DESC
         LIMIT 1
      `;
      assert.notEqual(
        pick, undefined,
        "nessuna persona valutata fuori soglia in org 1 alla data più recente: " +
        "carica il seed e genera un giro con soglia < totale valutati",
      );

      const d = await datiPersonaCoord(sql, pick!.personaId, pick!.maxData);
      assert.notEqual(d, null);
      assert.notEqual(
        d!.ultimoRangoValutato, null,
        "persona valutata deve avere ultimoRangoValutato",
      );
      assert.equal(d!.ultimoRangoValutato!.data, pick!.maxData);
      assert.equal(d!.ultimoRangoValutato!.valutataOggi, true);
      assert.equal(
        d!.ultimoRangoValutato!.rango, pick!.rango,
        `rango a ${pick!.maxData} da datiPersonaCoord deve coincidere con quello letto in setup`,
      );
      assert.ok(
        Math.abs(d!.ultimoRangoValutato!.punteggio - pick!.punteggio) < 1e-9,
        `punteggio a ${pick!.maxData} atteso ${pick!.punteggio}, trovato ${d!.ultimoRangoValutato!.punteggio}`,
      );
      assert.equal(
        d!.ultimoRangoValutato!.totaleValutati, pick!.totale,
        "totaleValutati letto in setup deve coincidere con quello di datiPersonaCoord",
      );
      // Nota: NON asserisce `ultimaAssegnazione == null`. Il test §12w
      // in isolamento.test.ts inserisce una riga su `personaParma` (la
      // persona di id minimo, spesso persona 1) con data futura
      // 2099-01-01 durante l'esecuzione parallela (`node --test` gira
      // i file in parallelo per default), che il mio test vedrebbe se
      // catturato nel timing sbagliato. Il canone di produzione ha
      // molte persone valutate senza assegnazioni; il test resta
      // robusto verificando solo la parte `ultimoRangoValutato` che è
      // ciò che davvero distingue lo stato §12kkkk "valutata fuori soglia".
    } finally {
      await sql.end();
    }
  },
);

test(
  "§12kkkk — persona mai valutata: entrambi null",
  skip ?? {},
  async () => {
    // Nel canone tutte le 500 persone di org 1 hanno rango_giorno
    // (il generatore le valuta tutte). Per testare il caso "mai
    // valutata" INSERT di una persona nuova di test, verifica, DELETE
    // nel finally.
    const sql = postgres(DATABASE_URL!, { max: 1 });
    const idEsternoTest = "TEST-12KKKK-mai-valutata";
    try {
      // Cleanup preventivo se qualcosa era rimasto da un run precedente.
      await sql`DELETE FROM riservato.persona WHERE id_esterno = ${idEsternoTest}`;

      // Sezione: la prima non-fittizia di Parma.
      const [sez] = await sql<Array<{ id: string }>>`
        SELECT id FROM pubblico.sezione
         WHERE comune_istat = '034027' AND NOT fittizia
         ORDER BY id LIMIT 1
      `;
      const [ins] = await sql<Array<{ id: number }>>`
        INSERT INTO riservato.persona
          (organizzazione_id, id_esterno, sezione_id, anno_nascita,
           vive_solo, telefono, indirizzo)
        VALUES
          (${ORG_PARMA}, ${idEsternoTest}, ${sez!.id}, 1940,
           true, '000 000 0000', 'via test 1')
        RETURNING id
      `;
      const personaId = ins!.id;

      const d = await datiPersonaCoord(sql, personaId, "2026-08-10");
      assert.notEqual(d, null, "la persona nuova deve essere leggibile");
      assert.equal(
        d!.ultimoRangoValutato, null,
        "persona appena creata non ha righe in rango_giorno: 'mai valutata'",
      );
      assert.equal(
        d!.ultimaAssegnazione, null,
        "persona appena creata non ha righe in assegnazione",
      );
    } finally {
      await sql`DELETE FROM riservato.persona WHERE id_esterno = ${idEsternoTest}`;
      await sql.end();
    }
  },
);
