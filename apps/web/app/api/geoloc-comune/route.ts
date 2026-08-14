/**
 * GET /api/geoloc-comune?lat=&lon=
 *
 * Risolve lo slug del **comune** che contiene il punto. Usato dalla
 * radice `/` per il progressive enhancement geoloc: l'utente clicca
 * "usa la mia posizione" e il browser lo porta a /{slug}.
 *
 * Distinta dalla `/api/{comune}/quartiere?lat=&lon=` che risolve il
 * quartiere DENTRO un comune noto. Qui non conosciamo ancora il comune:
 * ST_Contains su tutte le sezioni non-fittizie della lookup `COMUNI`.
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { COMUNI, slugPerIstat } from "@/lib/comuni";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const lat = Number(url.searchParams.get("lat"));
  const lon = Number(url.searchParams.get("lon"));
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return NextResponse.json({ errore: "lat/lon mancanti o non numerici" }, { status: 400 });
  }

  // Limito la ricerca ai comuni della lookup — un punto che cade in un
  // comune non servito da questa istanza deve dare 404, non "trovato".
  const codiciServiti = COMUNI.map((c) => c.istat);

  const rows = await sql<Array<{ comuneIstat: string }>>`
    SELECT DISTINCT comune_istat AS "comuneIstat"
      FROM pubblico.sezione
     WHERE comune_istat = ANY(${codiciServiti})
       AND NOT fittizia
       AND ST_Contains(geom, ST_SetSRID(ST_MakePoint(${lon}, ${lat}), 4326))
     LIMIT 1
  `;
  const istat = rows[0]?.comuneIstat;
  if (!istat) {
    return NextResponse.json(
      { errore: "punto fuori dai comuni serviti da questa istanza" },
      { status: 404 },
    );
  }
  const slug = slugPerIstat(istat);
  if (!slug) {
    return NextResponse.json({ errore: "comune trovato ma slug mancante nella lookup" }, { status: 500 });
  }
  return NextResponse.json({ slug, istat });
}
