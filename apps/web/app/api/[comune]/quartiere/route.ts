/**
 * GET /api/{comune}/quartiere?lat=&lon=
 *
 * Risolve il quartiere che contiene il punto via `ST_Contains` sui
 * poligoni di `pubblico.sezione` del comune. Usato dal PulsanteGeoloc.
 * Slug sconosciuto → 404 (via `notFound()`), coerente col resto delle
 * rotte per-comune (§12t).
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { NextResponse } from "next/server";
import { notFound } from "next/navigation";
import { sql } from "@/lib/db";
import { quartierePerPunto } from "@checaldo/db";
import { risolviComune } from "@/lib/comuni";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ comune: string }> },
) {
  const { comune: comuneSlug } = await params;
  const comune = risolviComune(comuneSlug);
  if (!comune) notFound();

  const url = new URL(req.url);
  const lat = Number(url.searchParams.get("lat"));
  const lon = Number(url.searchParams.get("lon"));
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return NextResponse.json({ errore: "lat/lon mancanti o non numerici" }, { status: 400 });
  }
  const quartiere = await quartierePerPunto(sql, comune.istat, lat, lon);
  if (!quartiere) {
    return NextResponse.json({ errore: "punto fuori dai poligoni noti" }, { status: 404 });
  }
  return NextResponse.json(quartiere);
}
