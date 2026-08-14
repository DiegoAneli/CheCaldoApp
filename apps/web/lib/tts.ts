// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Helper server-side condiviso dalle 3 route TTS (`/api/tts/riassunto`,
 * `/api/tts/citta`, `/api/tts/consiglio`). §12ggggg.
 *
 * Ciascuna route conosce la propria chiave (colonne PK della sua cache
 * table) e passa qui il pacchetto `{ query, setQuery }`:
 *   - `query` recupera testo + audio dalla riga di cache; se la riga
 *     non esiste, tornerà null;
 *   - `setQuery` scrive il bytea audio nella stessa riga.
 * L'orchestrazione (chiama tts service, converti, cache, ritorna) è
 * qui, così le 3 route restano piccole e coerenti.
 *
 * Fallback: se `TTS_URL` non è definito, o il servizio ritorna un
 * errore, o il fetch scade, ritorna `{ ok: false, motivo }`. Il
 * client-side (`pulsante-ascolto.tsx`) riconosce lo status 503 e
 * cade sul Web Speech API — l'utente non vede mai il pulsante
 * sparire.
 *
 * NON generiamo audio in anticipo: solo a richiesta. Il primo click
 * paga la sintesi (~1-2 s a modello caldo per l'allerta città, fino
 * a ~15 s per un riassunto lungo), tutti i click successivi ricevono
 * l'MP3 cachato in ms.
 */

import type postgres from "postgres";

const TTS_URL = process.env.TTS_URL;

// Timeout generoso: un riassunto lungo (60 s di audio) sintetizza
// in ~10-15 s a modello caldo — se scattano 60 s c'è qualcosa che
// non va (modello cold-load ancora in corso, ffmpeg bloccato, VM
// overloaded). Meglio 503 con fallback che appeso.
const TTS_TIMEOUT_MS = 60_000;

// Buffer (Node) invece di Uint8Array plain: TS 5.6+ è strict su
// ArrayBuffer vs SharedArrayBuffer nel generic di Uint8Array, e
// `Uint8Array<ArrayBufferLike>` non è assegnabile a BlobPart che
// vuole `ArrayBufferView<ArrayBuffer>`. Buffer estende
// `Uint8Array<ArrayBuffer>` in Node → soddisfa BlobPart senza cast.
export type RisultatoTts =
  | { ok: true; audio: Buffer; mime: string; daCache: boolean }
  | { ok: false; status: number; motivo: string };

export interface CachedRow {
  testo: string;
  audio: Buffer | null;
}

/**
 * Recupera l'audio cachato se presente, altrimenti sintetizza dal
 * testo, salva, ritorna.
 *
 * @param sql  connessione postgres (usata per il salvataggio audio).
 * @param loadCached  callback che ritorna { testo, audio } o null.
 * @param saveAudio  callback che salva audio bytea nella stessa riga.
 */
export async function ottieniAudio(
  loadCached: () => Promise<CachedRow | null>,
  saveAudio: (audio: Buffer) => Promise<void>,
): Promise<RisultatoTts> {
  const riga = await loadCached();
  if (!riga) {
    // La riga di testo non esiste: la route deve dire "genera prima il
    // testo". In pratica arriva solo se il client chiama /api/tts prima
    // che il testo sia in cache — non dovrebbe capitare col nostro
    // client, che chiama solo dopo aver visto il testo.
    return { ok: false, status: 404, motivo: "testo non in cache" };
  }
  if (riga.audio && riga.audio.length > 0) {
    return { ok: true, audio: riga.audio, mime: "audio/mpeg", daCache: true };
  }

  // Miss: chiedi al servizio tts.
  if (!TTS_URL) {
    // Non configurato: il client cadrà su Web Speech.
    return { ok: false, status: 503, motivo: "servizio tts non configurato" };
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TTS_TIMEOUT_MS);
  let resp: Response;
  try {
    resp = await fetch(`${TTS_URL}/synth`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: riga.testo }),
      signal: controller.signal,
    });
  } catch (e) {
    clearTimeout(timeoutId);
    const msg = e instanceof Error ? e.message : String(e);
    console.warn("[tts] servizio non raggiungibile:", msg);
    return { ok: false, status: 503, motivo: "servizio tts non raggiungibile" };
  }
  clearTimeout(timeoutId);

  if (!resp.ok) {
    console.warn(`[tts] servizio ha risposto ${resp.status}`);
    return { ok: false, status: 503, motivo: `tts risponde ${resp.status}` };
  }

  const buffer = Buffer.from(await resp.arrayBuffer());
  if (buffer.length === 0) {
    return { ok: false, status: 503, motivo: "tts risponde vuoto" };
  }

  // Salva best-effort: se il salvataggio fallisce, l'utente riceve
  // comunque l'audio; la prossima richiesta ricalcola. Non è ideale
  // ma non blocca la risposta.
  try {
    await saveAudio(buffer);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn("[tts] salvataggio audio fallito (best-effort):", msg);
  }

  return { ok: true, audio: buffer, mime: "audio/mpeg", daCache: false };
}
