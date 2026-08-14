/**
 * Route handler login coordinatore per-comune (§12u audit isolamento
 * 2026-08-03): GET /{comune}/entra-coordinatore/{id} imposta il cookie
 * coordinatore e reindirizza a /coordinatore. Verifica che l'id sia un
 * coordinatore dell'organizzazione risolta dallo slug.
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import {
  coordinatoriDellOrganizzazione,
  organizzazionePerComuneIstat,
} from "@checaldo/db";
import { impostaCoordinatore } from "@/lib/auth-demo";
import { risolviComune } from "@/lib/comuni";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ comune: string; id: string }> },
) {
  const { comune: slug, id: raw } = await params;
  const base = process.env.APP_URL ?? "http://localhost:3000";
  const comune = risolviComune(slug);
  if (!comune) return NextResponse.redirect(new URL("/", base));

  const id = Number(raw);
  if (!Number.isFinite(id) || id <= 0) {
    return NextResponse.redirect(new URL(`/${slug}/login`, base));
  }

  const org = await organizzazionePerComuneIstat(sql, comune.istat);
  if (!org) return NextResponse.redirect(new URL("/", base));

  const ammessi = await coordinatoriDellOrganizzazione(sql, org.id);
  if (!ammessi.some((c) => c.id === id)) {
    return NextResponse.redirect(new URL(`/${slug}/login`, base));
  }

  await impostaCoordinatore(id);
  return NextResponse.redirect(new URL("/coordinatore", base));
}
