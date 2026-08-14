/**
 * Configurazione dell'istanza — lettura da env con fail-hard.
 *
 * L'audit multi-comune del 2026-08-03 ha rilevato che `COMUNE_ISTAT` era
 * **dichiarato** configurabile via env (`.env.example`) ma di fatto
 * hardcoded in `apps/web/app/page.tsx:42` e in
 * `apps/web/app/api/quartiere/route.ts:23`. Questo modulo centralizza
 * la lettura per non ripetere il problema.
 *
 * Fail-hard invece di default: `getServerConfig()` lancia se la variabile
 * manca. Un web server pubblico che parte senza `COMUNE_ISTAT` mostrerebbe
 * la pagina con quartieri sbagliati (o vuota) invece di dare errore —
 * il fallback silenzioso qui è peggio dell'errore rumoroso.
 *
 * Solo per Server Components / route handler (`process.env` non è
 * definito nei componenti client): non importare da `"use client"`.
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

export interface ServerConfig {
  /** Codice ISTAT del comune servito da questa istanza (6 cifre, es. `034027`). */
  comuneIstat: string;
  /** Nome del comune per il copy delle pagine (es. `Parma`). */
  nomeComune: string;
}

function leggiVarObbligatoria(nome: string): string {
  const v = process.env[nome];
  if (!v || v.trim().length === 0) {
    throw new Error(
      `variabile d'ambiente ${nome} mancante o vuota. ` +
        `Vedi .env.example per il valore atteso.`,
    );
  }
  return v.trim();
}

/**
 * Cache di modulo — la config non cambia a runtime, la leggiamo una volta.
 * Il throw al primo import fa fallire la build o l'avvio del server, non
 * la prima richiesta.
 */
let cached: ServerConfig | null = null;
export function getServerConfig(): ServerConfig {
  if (cached) return cached;
  cached = {
    comuneIstat: leggiVarObbligatoria("COMUNE_ISTAT"),
    nomeComune: leggiVarObbligatoria("NOME_COMUNE"),
  };
  return cached;
}
