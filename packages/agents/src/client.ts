/**
 * Wrapper unico per le chiamate al modello Anthropic (MOD06).
 *
 * Regola: **nessun altro punto del codice importa `@anthropic-ai/sdk`
 * direttamente** — tutte le chiamate passano da qui. Motivi:
 *
 * - **Contatore** giornaliero in `pubblico.uso_modello`, solo per
 *   osservabilità. **Non è un tetto**: il limite di spesa vive sulla
 *   console Anthropic, dove è più affidabile. Un cap hardcoded nel
 *   codice fallirebbe in silenzio nel momento peggiore — un'ondata di
 *   caldo con picco di segnalazioni è esattamente quando serve che il
 *   sistema funzioni (§13.1). Le due strozzature reali contro il consumo
 *   incontrollato sono: (a) rate limit per IP del form pubblico (§12g,
 *   5/h), (b) triage manuale on-demand dalla dashboard coordinatore
 *   (§13.1, vincolo 2 — l'agente non decide, un umano legge il testo
 *   prima di lanciare l'estrazione).
 * - Incremento del contatore prima della chiamata: una chiamata che va
 *   in errore dopo aver raggiunto l'API conta comunque perché l'API può
 *   aver già consumato il costo lato provider.
 * - Fonte unica di modello e chiave: se domani si cambia provider, si
 *   cambia solo qui.
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import Anthropic, { APIError } from "@anthropic-ai/sdk";
import type { Sql } from "postgres";

const MODELLO_DEFAULT = "claude-sonnet-4-6";

// `maxRetries: 3` (default SDK = 2). Il retry si applica su 408/409/429/5xx
// con exponential backoff interno; alza il tetto per assorbire rate limit
// intermittenti su account nuovi.
const MAX_RETRIES = 3;

// Client Anthropic pigro: creato alla prima chiamata, così un processo che
// non fa mai triage (es. il web server pubblico) non richiede la chiave.
let clientCache: Anthropic | null = null;
function getClient(): Anthropic {
  const chiave = process.env.ANTHROPIC_API_KEY;
  if (!chiave || chiave.length === 0) {
    throw new Error(
      "ANTHROPIC_API_KEY vuota: valorizza .env prima di chiamare l'agente",
    );
  }
  if (!clientCache) {
    clientCache = new Anthropic({ apiKey: chiave, maxRetries: MAX_RETRIES });
  }
  return clientCache;
}

/**
 * Errore di chiamata al modello che espone status HTTP e body — così i
 * chiamanti (batch triage, script manuali) possono distinguere 429 da
 * 529 da errori di rete e non riportano "Connection error" generico.
 */
export class ErroreModello extends Error {
  constructor(
    message: string,
    public readonly status: number | undefined,
    public readonly bodyRaw: string | undefined,
  ) {
    super(message);
    this.name = "ErroreModello";
  }
}

export interface OpzioniChiamata {
  /** Etichetta dell'agente chiamante, per log e (in futuro) rate per-agente. */
  agente: string;
  /** Connessione DB (postgres.js), richiesta per contatore e cache. */
  sql: Sql;
  maxTokens?: number;
}

/**
 * Chiama il modello con un system prompt e un messaggio utente. Restituisce
 * il testo concatenato dei blocchi di risposta (i tool_use etc. non sono
 * usati qui).
 */
export async function chiamaModello(
  sistema: string,
  utente: string,
  opz: OpzioniChiamata,
): Promise<string> {
  const modello = process.env.LLM_MODEL ?? MODELLO_DEFAULT;

  // Contatore giornaliero: incremento PRIMA della chiamata reale (da_cache=false).
  // Solo osservabilità: nessun tetto in codice (§13.1). Se il DB è irraggiungibile,
  // procedo comunque — meglio una chiamata non tracciata che un servizio giù.
  try {
    await opz.sql`
      INSERT INTO pubblico.uso_modello (data, da_cache, chiamate)
      VALUES (CURRENT_DATE, false, 1)
      ON CONFLICT (data, da_cache) DO UPDATE
        SET chiamate = pubblico.uso_modello.chiamate + 1
    `;
  } catch {
    // best-effort
  }

  let risp;
  try {
    risp = await getClient().messages.create({
      model: modello,
      max_tokens: opz.maxTokens ?? 1024,
      system: sistema,
      messages: [{ role: "user", content: utente }],
    });
  } catch (e) {
    // APIError espone `status` (HTTP code) e `error` (body parsato). Un
    // "Connection error" secco dopo che i retry hanno esaurito nasconde
    // il vero 429/529 di sotto; qui lo estraiamo se c'è.
    if (e instanceof APIError) {
      const status = e.status;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const bodyRaw = (e as any).error
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ? JSON.stringify((e as any).error).slice(0, 500)
        : e.message;
      throw new ErroreModello(
        `chiamata modello fallita: HTTP ${status ?? "?"} — ${e.message}`,
        status,
        bodyRaw,
      );
    }
    // Errore di rete o simile: rilancio con contesto.
    const msg = e instanceof Error ? e.message : String(e);
    throw new ErroreModello(`chiamata modello fallita: ${msg}`, undefined, msg);
  }

  // La risposta è un array di blocchi tipizzati. Prendo solo il testo,
  // ignoro tool_use, thinking, ecc. — nessun agente qui usa tool calls.
  let testo = "";
  for (const b of risp.content) {
    if (b.type === "text") testo += b.text;
  }

  // Log usage su stderr: input/output token per chiamata. Base per il
  // budget di §13.1 e per verificare se il modello sta "sparlando" (output
  // molto più lungo del previsto significa che il prompt sta permettendo
  // troppo).
  const u = risp.usage;
  process.stderr.write(
    `[llm ${opz.agente}] modello=${modello} in=${u.input_tokens}tok out=${u.output_tokens}tok\n`,
  );

  return testo;
}
