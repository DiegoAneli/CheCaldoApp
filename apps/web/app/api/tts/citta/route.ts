// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * `POST /api/tts/citta` — sintesi vocale del testo dell'agente città
 * (blocco sopra il consiglio nella pagina pubblica). §12ggggg.
 *
 * Pubblico: nessuna autenticazione richiesta. Il testo non contiene
 * dati personali (parla di livello + notti tropicali + previsioni).
 *
 * Body (JSON): `{ comuneIstat: string }`. La chiave della cache si
 * ricostruisce lato server dallo stato corrente di `pubblico.allerta`
 * — è la STESSA logica che `generaAllertaCitta` usa per il lookup,
 * replicata qui perché la coppia (testo, chiave) deve restare
 * coerente e non abbiamo un helper esportato per la sola derivazione
 * di chiave.
 *
 * Se non c'è ancora una riga di testo (l'utente ha chiesto l'audio
 * prima che il testo apparisse), ritorna 404. Se il servizio tts è
 * giù, 503 → fallback Web Speech nel client.
 */

import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { allertaPrevisione } from "@checaldo/db";
import { PROMPT_VERSION_CITTA } from "@checaldo/agents";
import { ottieniAudio, type CachedRow } from "@/lib/tts";

/** Stesso mapping di `livelloOverride` in allerta-citta.ts — sentinel -1 per null. */
function livelloDaRiga(riga: { livello: number } | null): number {
  return riga ? riga.livello : -1;
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as
    | { comuneIstat?: unknown }
    | null;
  const comuneIstat =
    body && typeof body.comuneIstat === "string" && body.comuneIstat.length > 0
      ? body.comuneIstat
      : null;
  if (!comuneIstat) {
    return new NextResponse("comuneIstat required", { status: 400 });
  }

  // Ricostruisco la chiave dall'allerta corrente (stessa dell'agente).
  const previsione = await allertaPrevisione(sql, comuneIstat);
  if (!previsione.oggi) {
    return new NextResponse("no allerta oggi", { status: 404 });
  }
  const livOggi = previsione.oggi.livello;
  const livDom = livelloDaRiga(previsione.domani);
  const livDopo = livelloDaRiga(previsione.dopodomani);

  const risultato = await ottieniAudio(
    async (): Promise<CachedRow | null> => {
      const rows = await sql<Array<{ testo: string; audio: Buffer | null }>>`
        SELECT testo, audio
          FROM pubblico.allerta_citta_cache
         WHERE comune_istat = ${comuneIstat}
           AND livello_oggi = ${livOggi}
           AND livello_domani = ${livDom}
           AND livello_dopodomani = ${livDopo}
           AND prompt_version = ${PROMPT_VERSION_CITTA}
         LIMIT 1
      `;
      if (rows.length === 0) return null;
      return { testo: rows[0]!.testo, audio: rows[0]!.audio };
    },
    async (audio: Buffer) => {
      await sql`
        UPDATE pubblico.allerta_citta_cache
           SET audio = ${audio}, audio_generato_il = now()
         WHERE comune_istat = ${comuneIstat}
           AND livello_oggi = ${livOggi}
           AND livello_domani = ${livDom}
           AND livello_dopodomani = ${livDopo}
           AND prompt_version = ${PROMPT_VERSION_CITTA}
      `;
    },
  );

  if (!risultato.ok) {
    return new NextResponse(risultato.motivo, { status: risultato.status });
  }

  const bytes = new Uint8Array(risultato.audio);
  return new NextResponse(new Blob([bytes], { type: risultato.mime }), {
    status: 200,
    headers: {
      "content-type": risultato.mime,
      "cache-control": "no-store",
      "x-from-cache": risultato.daCache ? "1" : "0",
    },
  });
}
