// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * `POST /api/tts/consiglio` — sintesi vocale del testo del
 * consulente di quartiere (blocco `ConsiglioLocale` sulla pagina
 * pubblica). §12ggggg.
 *
 * Pubblico. Body (JSON): `{ comuneIstat: string; quartiereNome: string }`.
 * La chiave della cache (quartiere_slug, livello, ora_finestra,
 * prompt_version) si ricostruisce lato server: slug via
 * `slugQuartiere(nome)`, livello dall'allerta corrente, finestra
 * dall'ora corrente Rome (taglio 6-18). È la stessa logica che
 * `generaConsiglio` usa nel lookup.
 *
 * Se non c'è una riga di testo (audio richiesto prima che il testo
 * apparisse), 404. Servizio tts giù → 503 → fallback Web Speech nel
 * client.
 */

import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { allertaCorrente, slugQuartiere } from "@checaldo/db";
import { PROMPT_VERSION as PROMPT_VERSION_CONSIGLIO } from "@checaldo/agents";
import { ottieniAudio, type CachedRow } from "@/lib/tts";

/** Fascia oraria di cache — stessa formula di
 * `consulente.ts:fasciaOrariaCache`. Duplicata qui perché
 * `consulente.ts` non la esporta (private module helper): estrarla
 * dal package agents sarebbe un cambio più grande di questa route. */
function fasciaOrariaCache(ora: Date): "diurna" | "serale" {
  const h = ora.getHours();
  return h >= 6 && h < 18 ? "diurna" : "serale";
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as
    | { comuneIstat?: unknown; quartiereNome?: unknown }
    | null;
  const comuneIstat =
    body && typeof body.comuneIstat === "string" && body.comuneIstat.length > 0
      ? body.comuneIstat
      : null;
  const quartiereNome =
    body && typeof body.quartiereNome === "string" && body.quartiereNome.length > 0
      ? body.quartiereNome
      : null;
  if (!comuneIstat || !quartiereNome) {
    return new NextResponse(
      "comuneIstat and quartiereNome required",
      { status: 400 },
    );
  }

  const allerta = await allertaCorrente(sql, comuneIstat);
  if (!allerta) {
    return new NextResponse("no allerta oggi", { status: 404 });
  }

  const slug = slugQuartiere(quartiereNome);
  const livello = allerta.livello;
  // `new Date()` con TZ container Europe/Rome (§12yyyy) → ora
  // italiana corretta. `getHours()` legge il fuso locale.
  const finestra = fasciaOrariaCache(new Date());

  const risultato = await ottieniAudio(
    async (): Promise<CachedRow | null> => {
      const rows = await sql<Array<{ testo: string; audio: Buffer | null }>>`
        SELECT testo, audio
          FROM pubblico.consiglio_cache
         WHERE quartiere_slug = ${slug}
           AND livello = ${livello}
           AND ora_finestra = ${finestra}
           AND prompt_version = ${PROMPT_VERSION_CONSIGLIO}
         LIMIT 1
      `;
      if (rows.length === 0) return null;
      return { testo: rows[0]!.testo, audio: rows[0]!.audio };
    },
    async (audio: Buffer) => {
      await sql`
        UPDATE pubblico.consiglio_cache
           SET audio = ${audio}, audio_generato_il = now()
         WHERE quartiere_slug = ${slug}
           AND livello = ${livello}
           AND ora_finestra = ${finestra}
           AND prompt_version = ${PROMPT_VERSION_CONSIGLIO}
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
