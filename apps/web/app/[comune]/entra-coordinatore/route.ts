/**
 * §12aaaaaa (2026-08-12) — Redirect handler per il form `<GET>` della
 * pagina login (coordinatore). Vedi commento gemello in
 * `apps/web/app/[comune]/entra/route.ts`: stessa logica per il
 * coordinatore. Riceve `?id=N`, redirige a
 * `/{slug}/entra-coordinatore/{id}` dove la verifica di appartenenza
 * all'organizzazione vive.
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { NextResponse } from "next/server";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ comune: string }> },
) {
  const { comune: slug } = await params;
  const base = process.env.APP_URL ?? "http://localhost:3000";
  const url = new URL(req.url);
  const raw = url.searchParams.get("id") ?? "";
  const id = Number(raw);
  if (!Number.isFinite(id) || id <= 0) {
    return NextResponse.redirect(new URL(`/${slug}/login`, base));
  }
  return NextResponse.redirect(new URL(`/${slug}/entra-coordinatore/${id}`, base));
}
