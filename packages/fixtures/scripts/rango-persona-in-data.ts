/**
 * Script one-shot READ-ONLY: calcola il rango di una persona su una
 * data storica passando dal motore di punteggio, senza scrivere nulla
 * in DB (niente generaGiroDelGiorno, niente INSERT/DELETE).
 *
 * Serve a verificare la "scena Persona 0193" documentata in
 * CHECALDO-PROGETTO §12ee ("rango 8→115 fra 07-31 e 08-01") e in
 * MOD00-INDICE:14, senza pagare il costo del ciclo completo di
 * regenerazione + carica + ripristino.
 *
 * Limite di questo approccio: usa i dati che sono in DB adesso —
 * segnali (in particolare `valido_fino`) sono quelli emessi dal
 * generatore all'ultima esecuzione. Se il canone dei `valido_fino`
 * è cambiato rispetto a quando lo scenario storico fu documentato,
 * il rango calcolato qui NON riprodurrà esattamente quello storico.
 *
 * Uso:
 *   docker compose run --rm node pnpm --filter @checaldo/fixtures \
 *     exec tsx scripts/rango-persona-in-data.ts \
 *     --id "Persona 0193" --data 2026-08-01 --data 2026-08-02
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import postgres from "postgres";
import {
  personePerClassifica,
} from "@checaldo/db";
import {
  classificaPersone,
  valutaSezioni,
  type Allerta,
  type Sezione,
} from "@checaldo/scoring";

function argsMulti(nome: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < process.argv.length - 1; i++) {
    if (process.argv[i] === `--${nome}`) out.push(process.argv[i + 1]!);
  }
  return out;
}

function argSingle(nome: string, def?: string): string | undefined {
  const idx = process.argv.indexOf(`--${nome}`);
  if (idx >= 0 && idx + 1 < process.argv.length) return process.argv[idx + 1];
  return def;
}

async function main() {
  const idEsterno = argSingle("id", "Persona 0193")!;
  const orgId = Number(argSingle("org", "1"));
  const date = argsMulti("data");
  if (date.length === 0) {
    process.stderr.write("almeno --data YYYY-MM-DD (ripetibile) richiesta\n");
    process.exit(2);
  }

  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL mancante");
  const sql = postgres(url, { idle_timeout: 5 });
  try {
    // Lettura sezioni una sola volta: gli attributi sezione non
    // dipendono dalla data (ISTAT, geometrie, distanze al fresco).
    const sezioni = await sql<Sezione[]>`
      SELECT id AS id, quartiere AS quartiere, popolazione AS popolazione,
             famiglie AS famiglie, abitazioni AS abitazioni,
             edifici_residenziali AS "edificiResidenziali",
             tipo_sezione AS "tipoSezione",
             metri_da_punto_fresco AS "metriDaPuntoFresco",
             delta_termico AS "deltaTermico"
        FROM pubblico.sezione
       WHERE comune_istat = '034027' AND NOT fittizia
    `;
    const valutate = valutaSezioni(sezioni);

    for (const dataOggi of date) {
      // personePerClassifica costruisce Persona[] con:
      //   - anagrafica da riservato.persona (fissa)
      //   - segnali attivi al dataOggi (filtro `valido_fino >= dataOggi`)
      //   - tentativi_falliti da riservato.contatto (probabilmente 0 su
      //     date storiche non caricate)
      // dataUltimoContatto = MAX(riservato.contatto.data) — non filtrato
      // per data. Se non ci sono contatti, è null.
      const persone = await personePerClassifica(sql, orgId, dataOggi);

      // Allerta di quella data. Se manca uso un placeholder (livello 0):
      // il livello non incide sull'ordine della classifica, solo su
      // capienzaSuggerita (che qui non ci interessa).
      const allertaRows = await sql<Array<{
        livello: number; provenienza: string; data: string;
        nottiTropicali: number;
      }>>`
        SELECT livello, provenienza,
               to_char(data,'YYYY-MM-DD') AS data,
               notti_tropicali AS "nottiTropicali"
          FROM pubblico.allerta
         WHERE comune_istat='034027' AND data = ${dataOggi}::date
         ORDER BY orizzonte_ore ASC LIMIT 1
      `;
      const allerta: Allerta = allertaRows[0]
        ? {
            livello: allertaRows[0].livello as Allerta["livello"],
            provenienza: allertaRows[0].provenienza as Allerta["provenienza"],
            data: allertaRows[0].data,
            orizzonteOre: 24,
            nottiTropicali: allertaRows[0].nottiTropicali,
          }
        : { livello: 0, provenienza: "stima", data: dataOggi, orizzonteOre: 24, nottiTropicali: 0 };

      const classifica = classificaPersone(persone, valutate, {
        allerta,
        soglia: 15,
        oggi: new Date(dataOggi + "T00:00:00Z"),
      });

      const idx = classifica.findIndex((r) => r.idEsterno === idEsterno);
      const trg = classifica[idx];
      const totale = classifica.length;
      console.log(
        `${dataOggi}: allerta lv${allerta.livello} (${allerta.provenienza}). ` +
          `${idEsterno} → ` +
          (trg
            ? `posizione ${trg.posizione} / ${totale}, punteggio ${trg.punteggio.toFixed(3)}`
            : `non trovata (${totale} persone valutate)`),
      );
      if (trg) {
        const fattoriBreve = trg.fattori
          .map((f) => `${f.chiave}=${f.valore}(×${f.contributo.toFixed(2)})`)
          .join(" · ");
        console.log(`  fattori: ${fattoriBreve}`);
      }
    }
  } finally {
    await sql.end();
  }
}

main().catch((e) => {
  process.stderr.write(`errore: ${e?.message ?? e}\n`);
  process.exit(1);
});
