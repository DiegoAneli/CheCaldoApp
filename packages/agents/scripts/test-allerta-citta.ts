/**
 * Test manuale dell'agente città (MOD06 BLOCCO B, §12l): tre uscite
 * su tre scenari — uno reale, due sintetici — per verificare che il
 * prompt regga le condizioni previste dal brief.
 *
 * Scenario A: reale, via `generaAllertaCitta` sul DB attuale di Parma
 *   (passa dalla cache DB; se cache è calda restituisce il testo già
 *   salvato senza chiamata).
 * Scenario B: livello 0 su tutti e tre gli orizzonti, 1 notte tropicale.
 *   Bypasso di `generaAllertaCitta` e chiamata diretta al modello con
 *   input costruito — non entra in cache DB.
 * Scenario C: livello 2 oggi, domani e dopodomani null (bollettino non
 *   copre quei giorni), 4 notti tropicali. Idem, chiamata diretta.
 *
 * Uso:
 *   docker compose run --rm node pnpm --filter @checaldo/agents \
 *     test-allerta-citta
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import "dotenv/config";
import postgres from "postgres";
import {
  generaAllertaCitta,
  chiamaModello,
  PROMPT_VERSION_CITTA,
} from "../src";
import { PROMPT_MARKDOWN } from "../src/citta-prompt.generated";

const COMUNE_ISTAT = "034027";
const NOME_COMUNE = "Parma";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    process.stderr.write("DATABASE_URL non impostata.\n");
    process.exit(1);
  }
  const sql = postgres(url, { idle_timeout: 5 });

  process.stderr.write(`prompt_version = ${PROMPT_VERSION_CITTA}\n\n`);

  try {
    // === A: reale sul DB ===
    process.stderr.write("=== A. Scenario reale (Parma, DB attuale) ===\n");
    const tA = Date.now();
    const testoA = await generaAllertaCitta(sql, COMUNE_ISTAT, NOME_COMUNE);
    const msA = Date.now() - tA;
    if (testoA === null) {
      process.stderr.write(`(fallback silenzioso, ${msA} ms)\n---\n`);
    } else {
      process.stderr.write(`(${msA} ms)\n---\n${testoA}\n---\n`);
    }

    // === B: sintetico, livello 0 su tutti e 3 gli orizzonti ===
    process.stderr.write("\n=== B. Sintetico: 0/0/0, bollettino, 1 notte tropicale ===\n");
    const msgB = [
      `comune: ${NOME_COMUNE}`,
      `allerta_oggi: livello 0, bollettino, notti_tropicali 1`,
      `allerta_domani: livello 0, bollettino`,
      `allerta_dopodomani: livello 0, bollettino`,
      `livelli_previsti_disponibili: true`,
    ].join("\n");
    const tB = Date.now();
    const testoB = await chiamaModello(PROMPT_MARKDOWN, msgB, {
      agente: "allerta-citta-test-B",
      sql,
      maxTokens: 250,
    });
    process.stderr.write(`(${Date.now() - tB} ms)\n---\n${testoB.trim()}\n---\n`);

    // === C: sintetico, previsioni non disponibili ===
    process.stderr.write("\n=== C. Sintetico: 2/null/null, stima, 4 notti tropicali ===\n");
    const msgC = [
      `comune: ${NOME_COMUNE}`,
      `allerta_oggi: livello 2, stima, notti_tropicali 4`,
      `allerta_domani: null`,
      `allerta_dopodomani: null`,
      `livelli_previsti_disponibili: false`,
    ].join("\n");
    const tC = Date.now();
    const testoC = await chiamaModello(PROMPT_MARKDOWN, msgC, {
      agente: "allerta-citta-test-C",
      sql,
      maxTokens: 250,
    });
    process.stderr.write(`(${Date.now() - tC} ms)\n---\n${testoC.trim()}\n---\n`);
  } finally {
    await sql.end();
  }
}

main().catch((e: unknown) => {
  process.stderr.write(String(e) + "\n");
  process.exit(1);
});
