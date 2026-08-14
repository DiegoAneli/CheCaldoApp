// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Ripiego per verifica §12ffff dal form vero. Il POST della server
 * action Next.js richiede l'header opaco `Next-Action` derivato dal
 * build, non riproducibile via curl in modo stabile. Questo script
 * invoca `registraContatto` con gli STESSI argomenti che il form
 * comporrebbe per la risposta "Non funziona" alla domanda
 * climatizzazione (`d.id === "climatizzazione"`, opzione con
 * `value === "rotto"`, `segnale === "ventilatore_rotto"`), più esito
 * "sta_bene".
 *
 * `possiede` della domanda climatizzazione:
 *   ["nessuna_climatizzazione", "ventilatore_rotto"]
 * `opzione.segnale` scelta: "ventilatore_rotto"
 * Quindi:
 *   segnaliNuovi     = [{tipo: "ventilatore_rotto", origine: "volontario"}]
 *   segnaliDaChiudere = ["nessuna_climatizzazione"]
 *
 * Uso: docker compose run --rm node npx tsx scripts/one-shot/conferma-ventilatore.ts <personaId>
 * Volontario id 3 (Volontario 2), organizzazione 1 (Parma) hardcoded.
 * Scrittura reale sul DB — non è un test.
 */

import postgres from "postgres";
import { registraContatto } from "../src/index";

const personaId = Number(process.argv[2]);
const volontarioIdArg = Number(process.argv[3] ?? 3);
if (!Number.isFinite(personaId) || !Number.isFinite(volontarioIdArg)) {
  process.stderr.write("uso: tsx conferma-ventilatore.ts <personaId> [volontarioId]\n");
  process.exit(2);
}

const url = process.env.DATABASE_URL;
if (!url) {
  process.stderr.write("DATABASE_URL non impostata\n");
  process.exit(2);
}

async function main() {
  const sql = postgres(url!, { max: 1 });
  try {
    await registraContatto(sql, {
      organizzazioneSessione: 1,
      volontarioId: volontarioIdArg,
      personaId,
      esito: "sta_bene",
      segnaliNuovi: [{ tipo: "ventilatore_rotto", origine: "volontario" }],
      segnaliDaChiudere: ["nessuna_climatizzazione"],
    });
    process.stdout.write(`OK registraContatto persona=${personaId}\n`);
  } finally {
    await sql.end();
  }
}

main().catch((e) => {
  process.stderr.write(`ERRORE: ${(e as Error).message}\n`);
  process.exit(1);
});
