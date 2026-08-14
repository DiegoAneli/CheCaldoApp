/**
 * Test manuale del consulente cittadino: genera un consiglio per una
 * lista di quartieri e stampa il risultato su stdout. Usato per
 * verificare visivamente il prompt su input reali.
 *
 * Ogni run consuma credito API — la cache DB (`pubblico.consiglio_cache`)
 * fa sì che una seconda esecuzione con la stessa (quartiere, livello,
 * finestra, prompt_version) NON chiami il modello. Per forzare una nuova
 * generazione: `DELETE FROM pubblico.consiglio_cache WHERE ...` oppure
 * cambia il prompt (PROMPT_VERSION si aggiorna da solo).
 *
 * Uso:
 *   docker compose run --rm node pnpm --filter @checaldo/agents test-consulente
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import "dotenv/config";
import postgres from "postgres";
import { generaConsiglio, PROMPT_VERSION } from "../src/consulente";

const COMUNE_ISTAT = "034027";
const QUARTIERI = ["Cittadella", "San Lazzaro", "Vigatto"];

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    process.stderr.write("DATABASE_URL non impostata.\n");
    process.exit(1);
  }
  const sql = postgres(url, { idle_timeout: 5 });

  process.stderr.write(`prompt_version = ${PROMPT_VERSION}\n\n`);

  try {
    for (const q of QUARTIERI) {
      process.stderr.write(`\n=== ${q} ===\n`);
      const t0 = Date.now();
      const testo = await generaConsiglio(sql, COMUNE_ISTAT, q);
      const ms = Date.now() - t0;
      if (testo === null) {
        process.stderr.write(`(fallback silenzioso, ${ms} ms)\n`);
        continue;
      }
      // Tutto su stderr per non intercalare stdout/stderr nella cattura.
      process.stderr.write(`(${ms} ms)\n---\n${testo}\n---\n`);
    }
  } finally {
    await sql.end();
  }
}

main().catch((e: unknown) => {
  process.stderr.write(String(e) + "\n");
  process.exit(1);
});
