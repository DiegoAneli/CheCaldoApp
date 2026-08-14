/**
 * Route handler login volontario per-comune (§12u audit isolamento
 * 2026-08-03): GET /{comune}/entra/{id} imposta il cookie volontario e
 * reindirizza a /volontario. L'id ammesso è verificato contro i
 * volontari dell'organizzazione risolta dallo slug — non più contro id=1
 * hardcoded. Un utente Bologna può finalmente entrare.
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import {
  organizzazionePerComuneIstat,
  volontariDellOrganizzazione,
} from "@checaldo/db";
import { impostaVolontario } from "@/lib/auth-demo";
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

  // Difesa: solo id di volontari dell'organizzazione risolta dallo slug.
  // Un id di volontario di un'altra org non setta il cookie.
  const ammessi = await volontariDellOrganizzazione(sql, org.id);
  if (!ammessi.some((v) => v.id === id)) {
    return NextResponse.redirect(new URL(`/${slug}/login`, base));
  }

  await impostaVolontario(id);
  return NextResponse.redirect(new URL("/volontario", base));
}
