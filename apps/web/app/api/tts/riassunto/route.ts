// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * `POST /api/tts/riassunto` — sintesi vocale del riassunto della
 * giornata per il coordinatore. §12ggggg.
 *
 * Autorizzazione: solo un coordinatore autenticato può richiedere
 * l'audio. `organizzazioneId` viene SEMPRE dal cookie, mai dal
 * client — così un cookie di org X non può ricevere l'audio della
 * lista di persone assistite di org Y.
 *
 * Body (JSON): `{ scaglione: number }`. La `data` è sempre oggi
 * (Rome time via `isoOggi()`) — il client non la manda per non far
 * spedire l'audio di ieri per errore.
 *
 * Ritorna:
 *   - 200 audio/mpeg + `X-From-Cache: 0|1` se testo presente e
 *     audio disponibile;
 *   - 401 se manca l'auth coord;
 *   - 404 se non esiste una riga di testo per (org, data, scaglione)
 *     — il client deve aver premuto "Genera il riassunto" prima;
 *   - 503 se il servizio tts non risponde: il client cade sul
 *     Web Speech API fallback (§12fffff BLOCCO B).
 */

import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { coordinatoreIdCorrente } from "@/lib/auth-demo";
import { isoOggi } from "@/lib/data-oggi";
import { utentePerId } from "@checaldo/db";
import { PROMPT_VERSION_RIASSUNTO } from "@checaldo/agents";
import { ottieniAudio, type CachedRow } from "@/lib/tts";

export async function POST(req: Request) {
  const coordId = await coordinatoreIdCorrente();
  if (!coordId) return new NextResponse("unauthorized", { status: 401 });
  const utente = await utentePerId(sql, coordId);
  if (!utente || utente.ruolo !== "coordinatore") {
    return new NextResponse("forbidden", { status: 403 });
  }

  const body = (await req.json().catch(() => null)) as
    | { scaglione?: unknown }
    | null;
  const scaglione =
    body && typeof body.scaglione === "number" && Number.isFinite(body.scaglione)
      ? Math.floor(body.scaglione)
      : NaN;
  if (!Number.isFinite(scaglione) || scaglione < 1) {
    return new NextResponse("scaglione required (int >= 1)", { status: 400 });
  }

  const orgId = utente.organizzazioneId;
  const oggi = isoOggi();

  const risultato = await ottieniAudio(
    async (): Promise<CachedRow | null> => {
      // Esplicito su tesqo+audio: NON usiamo SELECT * (audio 300 KB
      // finirebbe in ogni query se generalizzato). Vedi audit
      // §12ggggg.
      const rows = await sql<Array<{ testo: string; audio: Buffer | null }>>`
        SELECT testo, audio
          FROM pubblico.riassunto_cache
         WHERE organizzazione_id = ${orgId}
           AND data = ${oggi}::date
           AND scaglione = ${scaglione}
           AND prompt_version = ${PROMPT_VERSION_RIASSUNTO}
         LIMIT 1
      `;
      if (rows.length === 0) return null;
      return { testo: rows[0]!.testo, audio: rows[0]!.audio };
    },
    async (audio: Buffer) => {
      await sql`
        UPDATE pubblico.riassunto_cache
           SET audio = ${audio}, audio_generato_il = now()
         WHERE organizzazione_id = ${orgId}
           AND data = ${oggi}::date
           AND scaglione = ${scaglione}
           AND prompt_version = ${PROMPT_VERSION_RIASSUNTO}
      `;
    },
  );

  if (!risultato.ok) {
    return new NextResponse(risultato.motivo, { status: risultato.status });
  }

  // NextResponse vuole BodyInit; il Buffer di postgres arriva come
  // Uint8Array<ArrayBufferLike> che TS 5.6+ non accetta come BlobPart.
  // Copia in un Uint8Array<ArrayBuffer> fresh, poi Blob.
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
