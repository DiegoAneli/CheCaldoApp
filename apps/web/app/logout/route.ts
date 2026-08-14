// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Logout: POST /logout cancella entrambi i cookie di sessione
 * (volontario + coordinatore) e reindirizza a /.
 *
 * **Perché POST e non GET.** Con GET, il prefetch di Next.js sul
 * <Link href="/logout"> della navbar coordinatore eseguiva l'handler
 * al passaggio del mouse: l'utente si trovava disconnesso senza aver
 * cliccato, e ogni pagina protetta lo rimandava a `/`. Stesso rischio
 * con crawler, link preview di Slack/WhatsApp, prefetcher del browser,
 * scanner. Il POST è la difesa strutturale: il body change vive solo
 * dietro un form submit (nessun prefetcher fa POST); l'handler GET è
 * rimosso, così una richiesta di sola lettura riceve 405 Method Not
 * Allowed da Next.js (default con solo `export async function POST`).
 *
 * `sameSite: "lax"` sul cookie (auth-demo.ts) protegge in aggiunta
 * dal CSRF cross-site su POST: un modulo di un altro dominio che
 * postasse a /logout non porterebbe con sé il cookie e l'operazione
 * (che comunque cancella cookie, non fa danni) resterebbe idempotente.
 */
import { NextResponse } from "next/server";
import { logout } from "@/lib/auth-demo";

export async function POST() {
  await logout();
  // Dopo logout, alla radice: da lì l'utente sceglie il comune e va al
  // login corretto (/{slug}/login) — vedi §12u.
  return NextResponse.redirect(
    new URL("/", process.env.APP_URL ?? "http://localhost:3000"),
    // 303 See Other: forza il browser a fare GET sulla destinazione
    // dopo il POST, come da semantica standard per POST-Redirect-GET.
    // 307 (default di NextResponse.redirect) preserverebbe il metodo,
    // e la home non accetta POST.
    { status: 303 },
  );
}
