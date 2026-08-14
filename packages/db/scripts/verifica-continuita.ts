// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Diagnostica una-tantum §12iiiii — rigenera il giro di oggi per
 * Parma e riporta le metriche di continuità volontario↔persona.
 *
 * NON è uno script per l'operativa: è uno strumento di verifica
 * dopo l'introduzione della feature (§12iiiii). Legge PRIMA le
 * assegnazioni correnti, rigenera, legge DOPO, e stampa il delta.
 * La rigenerazione è idempotente per costruzione (transazione unica
 * dentro `generaGiroDelGiorno`); rilanciarla non peggiora lo stato.
 */

import postgres from "postgres";
import {
  generaGiroDelGiorno,
  ultimoVolontarioRiuscitoPerPersona,
} from "../src/index";

const ORG_PARMA = 1;

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL non impostata");
    process.exit(2);
  }
  const dataOggi = process.argv[2] ?? new Date().toISOString().slice(0, 10);
  const sql = postgres(url, { max: 5 });
  try {
    console.log(`=== §12iiiii verifica canone Parma su ${dataOggi} ===\n`);

    // PRIMA
    const primaCarichi = await sql<Array<{ vol: number; n: number }>>`
      SELECT volontario_id AS vol, count(*)::int AS n
        FROM riservato.assegnazione
       WHERE data = ${dataOggi}::date AND organizzazione_id = ${ORG_PARMA}
       GROUP BY volontario_id ORDER BY volontario_id
    `;
    const primaMappa = new Map<number, number>(); // persona → vol
    const primaRows = await sql<Array<{ p: number; v: number }>>`
      SELECT persona_id AS p, volontario_id AS v
        FROM riservato.assegnazione
       WHERE data = ${dataOggi}::date AND organizzazione_id = ${ORG_PARMA}
    `;
    for (const r of primaRows) primaMappa.set(r.p, r.v);

    console.log("PRIMA della rigenerazione:");
    console.log(`  totale assegnate: ${primaRows.length}`);
    console.log("  carico per volontario:");
    for (const r of primaCarichi) console.log(`    V${r.vol}: ${r.n}`);

    // Ricognizione: quanti in lista oggi hanno un legame storico?
    const legameMap = await ultimoVolontarioRiuscitoPerPersona(sql, ORG_PARMA, dataOggi);
    const inLista = new Set(primaRows.map((r) => r.p));
    const inListaConLegame = [...inLista].filter((p) => legameMap.has(p));
    const primaCoerenti = inListaConLegame.filter(
      (p) => primaMappa.get(p) === legameMap.get(p),
    );
    console.log(`\nRicognizione continuità PRE-rigenerazione:`);
    console.log(`  in lista oggi con legame storico: ${inListaConLegame.length} / ${inLista.size}`);
    console.log(`  di cui già al volontario storico:  ${primaCoerenti.length}`);
    console.log(`  di cui a un vol diverso:           ${inListaConLegame.length - primaCoerenti.length}`);

    // Distribuzione dei legami: quanti punti per volontario prima
    // della rigenerazione (per aspettarsi quale vol sarà saturato).
    const distribuzLegami = new Map<number, number>();
    for (const [, v] of legameMap) {
      distribuzLegami.set(v, (distribuzLegami.get(v) ?? 0) + 1);
    }
    console.log(`\nLegami totali nel canone (persona → vol, tutte le persone org):`);
    for (const v of [2, 3, 4, 5, 6, 7]) {
      console.log(`    V${v}: ${distribuzLegami.get(v) ?? 0} legami`);
    }

    // RIGENERA
    console.log(`\n>>> Rigenerando il giro di ${dataOggi}...\n`);
    const risultato = await generaGiroDelGiorno(sql, ORG_PARMA, dataOggi);
    console.log("Risultato:");
    console.log(`  totaleAssegnate:          ${risultato.totaleAssegnate}`);
    console.log(`  protette:                 ${risultato.protette}`);
    console.log(`  nuoveAssegnate:           ${risultato.nuoveAssegnate}`);
    console.log(`  volontariAttivi:          ${risultato.volontariAttivi}`);
    console.log(`  sogliaUsata:              ${risultato.sogliaUsata}`);
    console.log(`  livelloUsato:             ${risultato.livelloUsato}`);
    console.log("");
    console.log("  §12iiiii continuità:");
    console.log(`    conStoria:              ${risultato.conStoria}`);
    console.log(`    legameOttenuto:         ${risultato.legameOttenuto}`);
    console.log(`    legamePersoVolInattivo: ${risultato.legamePersoVolInattivo}`);
    console.log(`    legamePersoCapProtette: ${risultato.legamePersoCapProtette}`);
    console.log(`    legamePersoCapLegami:   ${risultato.legamePersoCapLegami}`);

    // DOPO
    const dopoCarichi = await sql<Array<{ vol: number; n: number }>>`
      SELECT volontario_id AS vol, count(*)::int AS n
        FROM riservato.assegnazione
       WHERE data = ${dataOggi}::date AND organizzazione_id = ${ORG_PARMA}
       GROUP BY volontario_id ORDER BY volontario_id
    `;
    const dopoMappa = new Map<number, number>();
    const dopoRows = await sql<Array<{ p: number; v: number }>>`
      SELECT persona_id AS p, volontario_id AS v
        FROM riservato.assegnazione
       WHERE data = ${dataOggi}::date AND organizzazione_id = ${ORG_PARMA}
    `;
    for (const r of dopoRows) dopoMappa.set(r.p, r.v);

    console.log(`\nDOPO la rigenerazione:`);
    console.log(`  totale assegnate: ${dopoRows.length}`);
    console.log("  carico per volontario:");
    for (const r of dopoCarichi) console.log(`    V${r.vol}: ${r.n}`);

    // Coerenza post-rigenerazione con legame storico.
    const dopoConLegame = [...new Set(dopoRows.map((r) => r.p))]
      .filter((p) => legameMap.has(p));
    const dopoCoerenti = dopoConLegame.filter(
      (p) => dopoMappa.get(p) === legameMap.get(p),
    );
    console.log(`\nCopertura legame DOPO-rigenerazione:`);
    console.log(`  in lista dopo con legame storico: ${dopoConLegame.length}`);
    console.log(`  di cui al volontario storico:     ${dopoCoerenti.length}`);
    console.log(`  di cui a un vol diverso:          ${dopoConLegame.length - dopoCoerenti.length}`);

    // Quante persone hanno cambiato vol fra prima e dopo?
    let cambiate = 0;
    let stesseCoerentiConLegame = 0;
    let cambiateVersoLegame = 0;
    for (const [p, v] of dopoMappa) {
      const vPrima = primaMappa.get(p);
      if (vPrima !== undefined && vPrima !== v) {
        cambiate++;
        if (legameMap.get(p) === v) cambiateVersoLegame++;
      }
      if (vPrima === v && legameMap.get(p) === v) stesseCoerentiConLegame++;
    }
    console.log(`\nDelta persona → vol (prima vs dopo):`);
    console.log(`  cambiate volontario:               ${cambiate}`);
    console.log(`  di cui verso il vol storico:       ${cambiateVersoLegame}`);
    console.log(`  identiche e coerenti col legame:   ${stesseCoerentiConLegame}`);
  } finally {
    await sql.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
