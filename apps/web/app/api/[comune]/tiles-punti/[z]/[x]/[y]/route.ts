/**
 * GET /api/{comune}/tiles-punti/{z}/{x}/{y}
 *
 * Vector tile con i punti freschi del comune (§12t routing per path).
 * Filtro `comune_istat` risolto da `params.comune`; slug sconosciuto
 * → 404.
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { notFound } from "next/navigation";
import { sql } from "@/lib/db";
import { mvtPuntiFreschi } from "@checaldo/db";
import { risolviComune } from "@/lib/comuni";

const Z_MIN = 0;
const Z_MAX = 22;

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ comune: string; z: string; x: string; y: string }> },
) {
  const { comune: comuneSlug, z: zRaw, x: xRaw, y: yRaw } = await params;
  const comune = risolviComune(comuneSlug);
  if (!comune) notFound();

  const z = Number(zRaw);
  const x = Number(xRaw);
  const y = Number(yRaw);
  if (!Number.isInteger(z) || !Number.isInteger(x) || !Number.isInteger(y)
      || z < Z_MIN || z > Z_MAX
      || x < 0 || y < 0
      || x >= 2 ** z || y >= 2 ** z) {
    return new Response("bad tile coords", { status: 400 });
  }

  const mvt = await mvtPuntiFreschi(sql, comune.istat, z, x, y);
  if (mvt.byteLength === 0) {
    return new Response(null, { status: 204 });
  }
  return new Response(mvt.buffer.slice(mvt.byteOffset, mvt.byteOffset + mvt.byteLength) as ArrayBuffer, {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.mapbox-vector-tile",
      "Cache-Control": "public, max-age=300",
    },
  });
}
