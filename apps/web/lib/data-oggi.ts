/**
 * Data di oggi come stringa ISO YYYY-MM-DD, in Europe/Rome.
 *
 * §12zzzz — completamento di §12yyyy (opzione A del fuso): prima
 * `isoOggi()` usava `new Date().toISOString().slice(0,10)` che è UTC
 * per specifica ECMAScript e restava "ieri" per l'utente italiano
 * dalle 00:00 alle 02:00 (01:00 in inverno). Ora delega a `oggiRome()`
 * di `@checaldo/db`, unica fonte per il monorepo. Il container
 * postgis gira con `-c timezone=Europe/Rome`, i chiamanti passano
 * quindi la stessa nozione di "oggi" del DB.
 *
 * La funzione precedente `isoOggiEuropeRome()` è stata rimossa —
 * era ridondante con la nuova `isoOggi()`. Un solo callsite
 * (`coordinatore/page.tsx:126`) aggiornato per riusare la variabile
 * `oggi` già in scope. Vedi §12zzzz.
 *
 * `CHECALDO_OGGI` (override per demo/test): rimane il primo controllo,
 * non tocca il ramo Rome.
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

// Import diretto del file, NON dall'index di @checaldo/db: quest'ultimo
// riesporta anche `adattatore.ts` che usa `node:fs` (per il CSV
// dell'anagrafe). Se il client bundle di Next tira `data-oggi.ts` (via
// componenti "use client" come `segnali-aperti.tsx`), l'intero index
// finisce nel grafo e webpack cade su `UnhandledSchemeError: node:fs`.
// L'import specifico fa entrare SOLO `data-oggi.ts` — file puro TS
// senza dep Node. Vedi §12zzzz per il caso.
import { oggiRome } from "@checaldo/db/src/data-oggi";

export function isoOggi(): string {
  const forzato = process.env.CHECALDO_OGGI;
  if (forzato && /^\d{4}-\d{2}-\d{2}$/.test(forzato)) return forzato;
  return oggiRome();
}

export function formatoUmano(iso: string): string {
  const d = new Date(iso + "T00:00:00Z");
  const g = ["domenica", "lunedì", "martedì", "mercoledì", "giovedì", "venerdì", "sabato"][d.getUTCDay()];
  const m = ["gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno", "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre"][d.getUTCMonth()];
  return `${g} ${d.getUTCDate()} ${m} ${d.getUTCFullYear()}`;
}

/**
 * Variante di `formatoUmano` con la sola iniziale del giorno della
 * settimana in maiuscolo: "Giovedì 13 agosto 2026". Usata come titolo
 * di pagina nella vista volontario. Il mese resta minuscolo (in
 * italiano i mesi non hanno maiuscola).
 */
export function formatoUmanoTitolo(iso: string): string {
  const s = formatoUmano(iso);
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Data formattata senza giorno della settimana: "5 giugno 2026".
 * Usata dove serve compattezza (es. riga di contesto scheda persona
 * a 360px). `formatoUmano` aggiunge il giorno della settimana che è
 * rumore per un dato di anagrafe di N giorni fa — nessuno pensa
 * "ah, era giovedì".
 */
export function formatoDataBreve(iso: string): string {
  const d = new Date(iso + "T00:00:00Z");
  const m = ["gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno", "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre"][d.getUTCMonth()];
  return `${d.getUTCDate()} ${m} ${d.getUTCFullYear()}`;
}

/**
 * Data formattata giorno + mese senza anno: "15 agosto". Usata nella
 * card segnalazioni aperte (§12qqq) per "scade il 15 agosto" e
 * "richiamata il 6 agosto" — in dashboard tutti i dati sono
 * contestualmente recenti, l'anno è ridondante. Non troncare il mese
 * ("ago"): il troncamento risparmia tre caratteri e fa sembrare
 * l'interfaccia frettolosa.
 *
 * Accetta sia una data pura `YYYY-MM-DD` sia un timestamp ISO
 * (usa solo i primi 10 caratteri per costruire la date). Zone
 * horaria: interpretata come UTC (coerente con formatoDataBreve).
 */
export function formatoGiornoMese(iso: string): string {
  const dateOnly = iso.slice(0, 10);
  const d = new Date(dateOnly + "T00:00:00Z");
  const m = ["gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno", "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre"][d.getUTCMonth()];
  return `${d.getUTCDate()} ${m}`;
}
