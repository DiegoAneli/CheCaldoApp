/**
 * Login coordinatore per-comune: POST /{comune}/entra-coordinatore
 * imposta il cookie coordinatore e reindirizza a /coordinatore.
 * Gemello simmetrico di `apps/web/app/[comune]/entra/route.ts`: stessa
 * logica per il coordinatore. Vedi lì per il perché del POST e per la
 * difesa d'appartenenza.
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

export async function POST(
  req: Request,
  { params }: { params: Promise<{ comune: string }> },
) {
  const { comune: slug } = await params;
  const base = process.env.APP_URL ?? "http://localhost:3000";
  const comune = risolviComune(slug);
  if (!comune) return NextResponse.redirect(new URL("/", base), { status: 303 });

  const form = await req.formData();
  const raw = form.get("id");
  const id = Number(raw);
  if (!Number.isFinite(id) || id <= 0) {
    return NextResponse.redirect(new URL(`/${slug}/login`, base), { status: 303 });
  }

  const org = await organizzazionePerComuneIstat(sql, comune.istat);
  if (!org) return NextResponse.redirect(new URL("/", base), { status: 303 });

  const ammessi = await coordinatoriDellOrganizzazione(sql, org.id);
  if (!ammessi.some((c) => c.id === id)) {
    return NextResponse.redirect(new URL(`/${slug}/login`, base), { status: 303 });
  }

  await impostaCoordinatore(id);
  return NextResponse.redirect(new URL("/coordinatore", base), { status: 303 });
}
