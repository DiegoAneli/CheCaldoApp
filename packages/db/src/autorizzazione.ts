/**
 * @checaldo/db — primitiva di autorizzazione multi-organizzazione.
 *
 * Ogni mutazione che accetta id di entità (persona, segnale, volontario)
 * dalla sessione utente deve chiamare `assertAppartiene()` *prima* di
 * scrivere. Se una sola delle entità nominate non appartiene
 * all'organizzazione della sessione, lancia `AppartenenzaViolata` e la
 * scrittura non parte.
 *
 * **Perché una primitiva unica invece di un `AND organizzazione_id = $x`
 * dentro ogni query.** L'audit di isolamento del 2026-08-03 ha
 * identificato tre mutazioni (registraContatto, chiudiSegnale,
 * scriviAccessoScheda) senza controllo cross-org. Aggiungere un AND
 * diverso a ciascuna le chiuderebbe tutte tre, ma la prossima mutazione
 * scritta senza pensarci sarebbe di nuovo scoperta. Un chiamante che
 * dimentica di chiamare `assertAppartiene` è più visibile in code review
 * di un `AND` che non c'è dentro un blocco SQL.
 *
 * Le mutazioni prendono un parametro `organizzazioneSessione` che il
 * chiamante deriva dal cookie (utentePerId → organizzazioneId) — non da
 * un input dell'utente e non da URL. Se il chiamante lo passa da URL, il
 * problema è a monte, non qui.
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import type { Sql } from "postgres";

export class AppartenenzaViolata extends Error {
  constructor(entita: string[]) {
    super(
      `entità non appartengono all'organizzazione della sessione: ${entita.join(", ")}`,
    );
    this.name = "AppartenenzaViolata";
  }
}

export interface EntitaDaVerificare {
  personaId?: number;
  segnaleId?: number;
  volontarioId?: number;
  // §12jjjjj — utente generico (coord o vol) verificato via `riservato.utente`
  // come volontarioId (stessa query). Distingue nel nome quando il target
  // NON è un volontario ma il coordinatore autenticato che sta scrivendo,
  // per non far mentire i call site.
  utenteId?: number;
}

/**
 * Verifica che tutte le entità nominate appartengano a
 * `organizzazioneSessione`. Un id mancante (o entità inesistente) è
 * trattato come "non appartiene" — non è una scusa per proseguire.
 *
 * Costo: un solo round-trip DB per mutazione. Le mutazioni sono
 * interattive (una alla volta dall'utente), non batch — trascurabile.
 */
export async function assertAppartiene(
  sql: Sql,
  organizzazioneSessione: number,
  entita: EntitaDaVerificare,
): Promise<void> {
  const nIds = [entita.personaId, entita.segnaleId, entita.volontarioId, entita.utenteId]
    .filter((x) => x != null).length;
  if (nIds === 0) return;

  // Un SELECT solo con 4 EXISTS in parallelo. Per ogni id null, la
  // clausola vale true e non contribuisce al fallimento (non abbiamo
  // richiesto di verificarlo).
  // volontarioId e utenteId (§12jjjjj) usano la stessa query su
  // `riservato.utente`: la primitiva verifica appartenenza, non
  // ruolo. Il nome distinto nei call site chiarisce chi è il target.
  const rows = await sql<Array<{
    personaOk: boolean; segnaleOk: boolean; volontarioOk: boolean; utenteOk: boolean;
  }>>`
    SELECT
      (${entita.personaId ?? null}::int IS NULL) OR EXISTS (
        SELECT 1 FROM riservato.persona
         WHERE id = ${entita.personaId ?? null}::int
           AND organizzazione_id = ${organizzazioneSessione}
      ) AS "personaOk",
      (${entita.segnaleId ?? null}::int IS NULL) OR EXISTS (
        SELECT 1
          FROM riservato.segnale s
          JOIN riservato.persona p ON p.id = s.persona_id
         WHERE s.id = ${entita.segnaleId ?? null}::int
           AND p.organizzazione_id = ${organizzazioneSessione}
      ) AS "segnaleOk",
      (${entita.volontarioId ?? null}::int IS NULL) OR EXISTS (
        SELECT 1 FROM riservato.utente
         WHERE id = ${entita.volontarioId ?? null}::int
           AND organizzazione_id = ${organizzazioneSessione}
      ) AS "volontarioOk",
      (${entita.utenteId ?? null}::int IS NULL) OR EXISTS (
        SELECT 1 FROM riservato.utente
         WHERE id = ${entita.utenteId ?? null}::int
           AND organizzazione_id = ${organizzazioneSessione}
      ) AS "utenteOk"
  `;
  // La SELECT senza FROM restituisce sempre esattamente una riga: se
  // arriva vuota siamo davanti a un errore infrastrutturale, non a
  // "entità non trovata" — fail-hard, non defaulting a "OK".
  const r = rows[0];
  if (!r) throw new Error("assertAppartiene: SELECT senza risultato — DB in stato incoerente");

  const cattive: string[] = [];
  if (entita.personaId != null && !r.personaOk) cattive.push(`persona ${entita.personaId}`);
  if (entita.segnaleId != null && !r.segnaleOk) cattive.push(`segnale ${entita.segnaleId}`);
  if (entita.volontarioId != null && !r.volontarioOk) cattive.push(`volontario ${entita.volontarioId}`);
  if (entita.utenteId != null && !r.utenteOk) cattive.push(`utente ${entita.utenteId}`);
  if (cattive.length > 0) throw new AppartenenzaViolata(cattive);
}
