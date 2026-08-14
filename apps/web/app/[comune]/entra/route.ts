/**
 * §12aaaaaa (2026-08-12) — Redirect handler per il form `<GET>` della
 * pagina login. La route path-segment `/[comune]/entra/[id]` (vedi
 * `[id]/route.ts`) è la fonte di verità per l'ingresso volontario, ma
 * un `<form method="GET" action="/{slug}/entra">` con `<input
 * name="id">` produce URL `/{slug}/entra?id=N`, che quella route non
 * matcha (Next.js richiede la corrispondenza dei segmenti path). Questa
 * route intercetta la querystring e reindirizza a `/{slug}/entra/{id}`:
 * l'id passa dal path, la verifica di appartenenza all'organizzazione
 * vive lì e non è duplicata qui.
 *
 * Difesa: id non numerico o mancante → redirect al login (mantiene
 * l'invariante che la route path-segment poi ricontrolla di nuovo).
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
  return NextResponse.redirect(new URL(`/${slug}/entra/${id}`, base));
}
