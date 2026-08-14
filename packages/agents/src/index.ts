/**
 * CheCaldo! — @checaldo/agents: gli agenti che stanno **sopra** il motore
 * deterministico.
 *
 * Stato corrente:
 *   - `client.ts` — wrapper unico Anthropic (`chiamaModello`, `ErroreModello`).
 *     Ogni chiamata al modello del progetto passa da qui.
 *   - `consulente.ts` — agente consulente cittadino della pagina pubblica
 *     (MOD06 Parte 4). Genera 4-6 righe di consigli locali con fallback
 *     silenzioso (`generaConsiglio → null` invece di lanciare).
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

export * from "./client";
export * from "./consulente";
export * from "./allerta-citta";
export * from "./riassunto";
