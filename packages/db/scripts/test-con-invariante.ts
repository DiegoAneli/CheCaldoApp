// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Wrapper del comando `pnpm --filter @checaldo/db test`.
 *
 * Verifica che la suite di test di `packages/db` non lasci residui
 * app-side in `riservato.segnale`, `riservato.contatto` e
 * `pubblico.punteggio_sezione`. I test di integrazione scrivono
 * davvero nel DB (fixture con `fixture_id NULL` per essere
 * distinguibili dal canone), e ogni test è responsabile del proprio
 * cleanup. Un cleanup rotto — come quello del `finally` di
 * `test/registra-contatto.test.ts` prima di §12nnnn, che ricalcolava
 * `personaPulita` invece di riusare la persona del corpo del test —
 * accumula silenziosamente residui che portano la card
 * "Segnalazioni aperte" della dashboard da 13 attive a 104 in
 * qualche giorno.
 *
 * §12jjjjj — Aggiunta la sorveglianza su `pubblico.punteggio_sezione`
 * dopo che il cleanup di `continuita-volontario.test.ts` e
 * `pausa-volontario.test.ts` ha lasciato 2078 righe residue (1039 ×
 * 2 date test) sulla tabella. Ogni chiamata a `generaGiroDelGiorno`
 * fa UPSERT sulla tabella per tutte le sezioni della data
 * (query.ts:2725-2740); i test che la chiamano devono ripulire.
 * Il wrapper controlla il **count totale** pre/post: differenza != 0
 * = residuo, come per segnale/contatto. La regola generale — se un
 * test file scrive su qualunque tabella, il conteggio pre/post di
 * quella tabella va sorvegliato qui, altrimenti il DB si sporca in
 * silenzio.
 *
 * PERCHÉ NON UN TEST STANDARD (node:test). Il runner di node:test
 * esegue i file di test in **subprocess in parallelo** (concorrenza
 * = os.availableParallelism() da Node 20+). Un file "che gira per
 * ultimo" (per ordine alfabetico o esplicito) può iniziare quando
 * altri file stanno ancora scrivendo: i suoi conteggi "pre" e "post"
 * catturano stati intermedi. Un test così passerebbe o fallirebbe a
 * caso in funzione dello scheduling.
 *
 * Il wrapper risolve il problema perché legge lo stato GLOBALE del
 * DB prima di lanciare la suite come subprocess, la lancia in
 * blocco, e rilegge dopo. Nessun test file corre in parallelo con
 * la lettura pre/post.
 *
 * EXIT CODES:
 *   0  — suite verde E invariante rispettata (nessun residuo)
 *   1  — la suite ha fallito (dettagli nel TAP output)
 *   2  — la suite è verde ma i conteggi post ≠ pre (residui in DB)
 */

import postgres from "postgres";
import { spawnSync } from "node:child_process";
import { globSync } from "node:fs";

interface Conteggi {
  segnaleAppSide: number;
  contattoOggi: number;
  punteggioSezione: number;
}

async function leggiConteggi(): Promise<Conteggi> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    // Se manca il DB, i test di integrazione sono skipped: l'invariante
    // è banalmente rispettata (nessuno scrive). Ritorna zeri, `main`
    // non farà confronti significativi ma non causerà falsi positivi.
    return { segnaleAppSide: 0, contattoOggi: 0, punteggioSezione: 0 };
  }
  const sql = postgres(url, { max: 1 });
  try {
    // Segnale app-side: fixture_id IS NULL, qualunque tipo, qualunque
    // organizzazione, aperto o chiuso. Il canone fresco NON ha righe
    // con fixture_id IS NULL — tutti i segnali sintetici hanno il
    // fixture_id `s-<orgId>-<idEsterno>-<tipo>` popolato da carica-nel-db.ts
    // (chiave costruita da `fixtureIdSegnale` in @checaldo/db, include
    // l'org per evitare collisioni fra comuni sulla stessa istanza).
    // Il residuo dello script one-shot (§12cccc, Persona 0015) resta
    // in DB come baseline: viene contato allo stesso modo pre e post,
    // quindi non altera il delta.
    const [segn] = await sql<Array<{ n: number }>>`
      SELECT count(*)::int AS n
        FROM riservato.segnale
       WHERE fixture_id IS NULL
    `;
    // Contatto oggi: se un test scrive un contatto sul giorno corrente,
    // deve rimuoverlo. Il filtro `data::date = CURRENT_DATE` limita il
    // conteggio a residui giornalieri.
    //
    // `AND fixture_id IS NULL` (§12rrrr): difesa preventiva. Oggi il
    // generatore `genera-contatti-storici.ts` esclude il giorno corrente
    // per scelta (i contatti reali del coordinatore restano gli unici
    // di CURRENT_DATE), quindi l'intersezione fra fixture e "oggi" è
    // vuota per costruzione e questo filtro non ha effetto. Se un
    // domani il generatore riempisse anche il giorno corrente, il
    // filtro impedirebbe al wrapper di scambiarli per residui di test
    // e falso-fallire la suite.
    //
    // **Perimetro implicito**: il conteggio guarda SOLO
    // `data::date = CURRENT_DATE`. Un test rotto che scrivesse un
    // contatto con data passata (`data = '2020-01-01'`) e non lo
    // pulisse NON verrebbe rilevato — cadrebbe fuori dal filtro data
    // e (senza fixture_id) sarebbe indistinguibile dai contatti reali
    // storici già presenti (13 del 07-31, 10 del 08-07, ecc.). Il
    // wrapper protegge dai residui giornalieri, non dai residui su
    // date arbitrarie. Estenderlo a tutte le date richiederebbe di
    // ricalibrare la baseline sui ~29 contatti reali storici + i
    // fixture — non fatto in questa sessione. Se domani serve una
    // difesa più ampia, la strada è quella (documentare la baseline
    // e confrontarla).
    const [cont] = await sql<Array<{ n: number }>>`
      SELECT count(*)::int AS n
        FROM riservato.contatto
       WHERE data::date = CURRENT_DATE
         AND fixture_id IS NULL
    `;
    // §12jjjjj — `pubblico.punteggio_sezione` non ha `fixture_id`; il
    // canone la popola col count `numSezioni × numDate` cumulato dai
    // `carica-nel-db.ts` e dai `generaGiroDelGiorno` di ogni giorno.
    // La sorveglianza confronta il **count totale** pre/post: se la
    // suite scrive righe su date test e non le pulisce, il delta
    // scatta. Delta==0 tolera il pattern "UPSERT su (sezione,data)
    // già esistente" — la riga viene aggiornata, non aggiunta. Solo
    // le date NUOVE (le tipiche 2099-xx-xx dei test futuri) fanno
    // salire il count. Vedi `pulisciDataTest` in
    // continuita-volontario.test.ts e pausa-volontario.test.ts per
    // il DELETE che chiude il ciclo.
    const [ps] = await sql<Array<{ n: number }>>`
      SELECT count(*)::int AS n FROM pubblico.punteggio_sezione
    `;
    return {
      segnaleAppSide: segn.n,
      contattoOggi: cont.n,
      punteggioSezione: ps.n,
    };
  } finally {
    await sql.end();
  }
}

async function main() {
  const pre = await leggiConteggi();
  process.stderr.write(
    `[invariante] pre-suite: segnale.fixture_id=NULL=${pre.segnaleAppSide}, ` +
    `contatto oggi=${pre.contattoOggi}, ` +
    `punteggio_sezione=${pre.punteggioSezione}\n`,
  );

  // Espandi il glob in Node — non affido allo shell perché il
  // comportamento di `sh -c` sotto `tsx` è variabile fra sistemi.
  const files = globSync("test/*.test.ts").sort();
  if (files.length === 0) {
    process.stderr.write("[invariante] nessun file di test trovato in test/\n");
    process.exit(1);
  }
  // §12jjjjj — `--test-concurrency=1` serializza l'esecuzione dei file
  // di test. Motivo: alcuni test modificano stato globale non
  // scopato per data (es. §12iiiii `(d-I)` fa
  // `UPDATE utente SET attivo=false WHERE id=V2`, ripristinato in
  // finally). Con l'esecuzione parallela di default (concurrency =
  // os.availableParallelism()), un test di `pausa-volontario.test.ts`
  // che legge `presenzaVolontariOggi` mentre `(d-I)` ha V2
  // temporaneamente disattivato vede un numero inconsistente di
  // volontari e fallisce non-deterministicamente. Il fallimento
  // dipende dal timing scheduler → è ineliminabile senza
  // serializzazione o savepoint. Serializzo qui perché è la fix con
  // superficie di attacco minima (un solo flag, nessun test da
  // riscrivere). Costo: la suite passa da ~65s a ~90s; accettabile,
  // gira solo in CI + prima del commit.
  const risultato = spawnSync(
    "tsx", ["--test", "--test-concurrency=1", ...files],
    { stdio: "inherit", env: process.env },
  );
  const exitSuite = risultato.status ?? 1;

  const post = await leggiConteggi();
  process.stderr.write(
    `[invariante] post-suite: segnale.fixture_id=NULL=${post.segnaleAppSide}, ` +
    `contatto oggi=${post.contattoOggi}, ` +
    `punteggio_sezione=${post.punteggioSezione}\n`,
  );

  if (exitSuite !== 0) {
    process.stderr.write(`[invariante] suite fallita (exit ${exitSuite})\n`);
    process.exit(exitSuite);
  }

  const deltaSegn = post.segnaleAppSide - pre.segnaleAppSide;
  const deltaCont = post.contattoOggi - pre.contattoOggi;
  const deltaPs = post.punteggioSezione - pre.punteggioSezione;
  if (deltaSegn !== 0 || deltaCont !== 0 || deltaPs !== 0) {
    process.stderr.write(
      `[invariante] VIOLATA: la suite ha lasciato residui in DB.\n` +
      `  segnale (fixture_id IS NULL): pre=${pre.segnaleAppSide}, ` +
      `post=${post.segnaleAppSide}, delta=${deltaSegn > 0 ? "+" : ""}${deltaSegn}\n` +
      `  contatto (oggi):              pre=${pre.contattoOggi}, ` +
      `post=${post.contattoOggi}, delta=${deltaCont > 0 ? "+" : ""}${deltaCont}\n` +
      `  punteggio_sezione:            pre=${pre.punteggioSezione}, ` +
      `post=${post.punteggioSezione}, delta=${deltaPs > 0 ? "+" : ""}${deltaPs}\n` +
      `Un test non pulisce quello che scrive: controlla i \`finally\` dei\n` +
      `test che chiamano registraContatto, generaGiroDelGiorno o INSERT\n` +
      `diretti su riservato.segnale / riservato.contatto /\n` +
      `pubblico.punteggio_sezione. Il cleanup deve includere il DELETE\n` +
      `di TUTTE le tabelle su cui il test scrive, incluse quelle scritte\n` +
      `indirettamente da funzioni di libreria come generaGiroDelGiorno.\n`,
    );
    process.exit(2);
  }

  process.stderr.write("[invariante] OK — nessun residuo dopo la suite\n");
  process.exit(0);
}

main().catch((e) => {
  process.stderr.write(`[invariante] errore: ${(e as Error).message}\n`);
  process.exit(1);
});
