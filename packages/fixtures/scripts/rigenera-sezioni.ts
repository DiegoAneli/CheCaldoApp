/**
 * CheCaldo! — rigenera packages/scoring/test/parma-sezioni.json da DB.
 *
 * La fixture è la copia dei fattori di sezione che i test di @checaldo/scoring
 * esercitano. Va rilanciata quando cambia lo stato del DB che il motore legge,
 * e cioè:
 *
 *   1. dopo MOD01 (popolate le geometrie e calcolate le distanze dal fresco:
 *      cambia `metriDaPuntoFresco`)
 *   2. quando arriverà lo strato termico satellitare (MIRIFICUS o altro:
 *      popolerà `deltaTermico` in `pubblico.sezione` per la prima volta)
 *   3. dopo qualunque correzione manuale/import che tocca `pubblico.sezione`
 *      per il comune demo (comune_istat = 034027)
 *
 * Se rilanci senza uno di questi eventi, il file torna byte-identico —
 * usalo per verificare che la fixture non si sia disallineata dal DB.
 *
 * Uso:
 *   docker compose run --rm node pnpm --filter @checaldo/fixtures rigenera-sezioni
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";

const ROOT = join(__dirname, "..", "..", "..");
const OUT = join(ROOT, "packages", "scoring", "test", "parma-sezioni.json");
const COMUNE_ISTAT = "034027"; // Distretto di Parma, comune demo

const url = process.env.DATABASE_URL;
if (!url) {
  process.stderr.write("DATABASE_URL non impostata.\n");
  process.exit(1);
}
const sql = postgres(url, { idle_timeout: 5 });

interface Riga {
  id: string;
  sez21: number;
  quartiere: string | null;
  popolazione: number;
  famiglie: number;
  abitazioni: number;
  edifici_residenziali: number;
  tipo_sezione: number;
  metri_da_punto_fresco: number | null;
  delta_termico: number | null;
}

async function main() {
  const rows = await sql<Riga[]>`
    SELECT id, sez21, quartiere, popolazione, famiglie, abitazioni,
           edifici_residenziali, tipo_sezione,
           metri_da_punto_fresco, delta_termico
      FROM pubblico.sezione
     WHERE comune_istat = ${COMUNE_ISTAT}
     ORDER BY sez21
  `;
  if (rows.length === 0) {
    throw new Error(
      `pubblico.sezione vuota per ${COMUNE_ISTAT}: nulla da rigenerare.`,
    );
  }

  // Camel-case + omissione delle chiavi null: la fixture precedente all'attivo
  // del fattore non aveva metriDaPuntoFresco, e il tipo Sezione di
  // @checaldo/scoring dichiara i campi opzionali come `number | undefined`.
  // Un `null` esplicito passerebbe comunque il check `!= null` del motore ma
  // aggiunge rumore alla fixture; meglio ometterlo.
  const fixture = rows.map((r) => {
    const out: Record<string, unknown> = {
      id: r.id,
      sez21: Number(r.sez21),
      quartiere: r.quartiere,
      popolazione: Number(r.popolazione),
      famiglie: Number(r.famiglie),
      abitazioni: Number(r.abitazioni),
      edificiResidenziali: Number(r.edifici_residenziali),
      tipoSezione: Number(r.tipo_sezione),
    };
    if (r.metri_da_punto_fresco !== null) {
      out.metriDaPuntoFresco = Number(r.metri_da_punto_fresco);
    }
    if (r.delta_termico !== null) {
      out.deltaTermico = Number(r.delta_termico);
    }
    return out;
  });

  // Formato compatto su singola riga, con spazio dopo `:` e `,`. Riprodotto
  // esattamente per compatibilità con il diff atteso: `head -c` sulla
  // fixture originale mostrava questo layout.
  const json = "[" + fixture.map((r) =>
    "{" + Object.entries(r).map(([k, v]) =>
      `${JSON.stringify(k)}: ${JSON.stringify(v)}`,
    ).join(", ") + "}",
  ).join(", ") + "]";
  writeFileSync(OUT, json, "utf8");

  const conMetri = fixture.filter((r) => "metriDaPuntoFresco" in r).length;
  const conDelta = fixture.filter((r) => "deltaTermico" in r).length;
  process.stderr.write(
    `rigenerate ${fixture.length} righe (di cui ${conMetri} con `
    + `metriDaPuntoFresco, ${conDelta} con deltaTermico) in ${OUT}\n`,
  );

  await sql.end();
}

main().catch((e) => {
  process.stderr.write(`errore: ${e?.message ?? e}\n`);
  process.exit(1);
});
