/**
 * Data di oggi in Europe/Rome, formato ISO YYYY-MM-DD.
 *
 * Sorgente unica per tutto il monorepo (§12yyyy: opzione A del fuso —
 * tutti i container in Europe/Rome, DB con `-c timezone=Europe/Rome`).
 * Prima esistevano tre copie identiche di questa logica:
 *   - `apps/web/lib/data-oggi.ts:isoOggi()` (UTC via `toISOString`,
 *     scorretta rispetto alla data italiana per 2 h/notte);
 *   - `apps/web/lib/data-oggi.ts:isoOggiEuropeRome()` (Rome, corretta);
 *   - `packages/agents/src/allerta-citta.ts:dataOggiEuropeRome()` (Rome).
 *
 * Con §12zzzz `isoOggi()` chiama questa funzione e le altre due sono
 * state rimosse. `packages/db` è importato sia da `apps/web` sia da
 * `packages/agents` sia da `packages/fixtures`: viverci qui evita
 * duplicati fra package boundary.
 *
 * `Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Rome" })`:
 * lo svedese ISO restituisce `YYYY-MM-DD` senza dover comporre a mano;
 * `timeZone` esplicito è la difesa contro un container senza `TZ`
 * (Alpine base senza `tzdata` ignora `TZ` — vedi §12yyyy). La funzione
 * ritorna la data corretta indipendentemente dal TZ di sistema.
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
export function oggiRome(ora: Date = new Date()): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Rome" }).format(ora);
}

/**
 * Aggiunge `n` giorni di calendario a una data ISO `YYYY-MM-DD` e
 * ritorna la stringa risultante. `n` può essere negativo (per «ieri»).
 *
 * Metodo: interpreta la stringa come UTC-mezzanotte, somma `n*86_400_000`
 * millisecondi, riformatta con `toISOString().slice(0,10)`. UTC non ha
 * DST, quindi l'aritmetica è deterministica e non salta ore anche
 * quando la data di partenza è quella di transizione (ultima domenica
 * di marzo o ottobre in Europa). Rispetto a `oggiRome(new Date(Date.now()
 * + n*86_400_000))`, che formatta in Rome un istante spostato di N ore
 * dall'adesso, questa via non dipende dall'ora corrente e non salta un
 * giorno se sta transitando l'ora legale.
 *
 * Convenzione: la funzione lavora su calendario, non su fuso. Se
 * l'input è la data Rome di oggi (via `oggiRome()`), l'output è la
 * data Rome di oggi+n — perché l'aritmetica giornaliera è la stessa
 * indipendentemente dal fuso, purché non si mischino due fusi diversi.
 */
export function aggiungiGiorniIso(iso: string, n: number): string {
  const ms = Date.parse(iso + "T00:00:00Z");
  if (Number.isNaN(ms)) throw new Error(`aggiungiGiorniIso: data ISO non valida: ${iso}`);
  return new Date(ms + n * 86_400_000).toISOString().slice(0, 10);
}
