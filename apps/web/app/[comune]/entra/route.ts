/**
 * Login volontario per-comune: POST /{comune}/entra imposta il cookie
 * volontario e reindirizza a /volontario.
 *
 * L'id del volontario arriva dal body del form (`FormData.get("id")`),
 * non più dal path segment o dalla querystring. Motivo: le vecchie
 * varianti GET (`/{comune}/entra?id=N` con redirect a
 * `/{comune}/entra/{id}`, poi cookie set) erano prefetchabili — il
 * Link "Entra come volontario" della pagina login (IngressoDiretto,
 * caso comune con un solo volontario) veniva prefetchato al hover e
 * il cookie veniva impostato senza click. Con POST il form submit è
 * l'unico modo di raggiungere l'handler; nessun prefetcher/crawler
 * fa POST. Dopo il consolidamento questa è l'unica route: la vecchia
 * `/{comune}/entra/[id]/route.ts` è stata rimossa (id nel path non
 * serve più — sta nel body).
 *
 * **Difesa d'appartenenza (invariante §12u).** L'id nel body è
 * manipolabile quanto lo era nel path o nella querystring: nessuna
 * differenza per un attaccante. La verifica resta identica —
 * `volontariDellOrganizzazione(sql, org.id)` risolve l'organizzazione
 * dallo slug URL, poi confronta l'id: se non è fra gli ammessi
 * dell'org di quel comune, redirect al login senza impostare cookie.
 * Un id di un volontario di Parma postato sul form di Bologna finisce
 * sul login di Bologna, non entra.
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

  // Difesa d'appartenenza: solo id di volontari dell'organizzazione
  // risolta dallo slug del path. Un id valido di un'altra org non
  // setta cookie e rimbalza sul login (senza dichiarare se l'id
  // esistesse altrove — vedi §12jjjj per la stessa logica sui
  // read di scheda persona).
  const ammessi = await volontariDellOrganizzazione(sql, org.id);
  if (!ammessi.some((v) => v.id === id)) {
    return NextResponse.redirect(new URL(`/${slug}/login`, base), { status: 303 });
  }

  await impostaVolontario(id);
  // 303 See Other: POST → GET sulla destinazione. NextResponse.redirect
  // default è 307 che preserverebbe il metodo, e /volontario non
  // accetta POST.
  return NextResponse.redirect(new URL("/volontario", base), { status: 303 });
}
