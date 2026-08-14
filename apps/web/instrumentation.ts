// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Instrumentation hook di Next.js: `register()` viene chiamata una volta
 * all'avvio del server (non a build-time), prima che il primo request
 * arrivi. È l'unico punto giusto per validare l'ambiente in modo che
 * l'errore sia visibile subito nei log del container e non scoperto al
 * primo login utente.
 *
 * **Guard APP_URL in produzione.** Le rotte di login e logout
 * (`apps/web/app/[comune]/entra*[/[id]]/route.ts` e
 * `apps/web/app/logout/route.ts`) costruiscono i redirect con
 * `process.env.APP_URL ?? "http://localhost:3000"`. In produzione il
 * fallback silenzioso è dannoso: il browser dell'utente finirebbe su
 * `http://localhost:3000/volontario` o `/coordinatore` — cioè sul
 * localhost del VPS, che non è raggiungibile dal suo dispositivo. Il
 * sito sembrerebbe rotto solo dopo il click di login, non all'avvio.
 * Meglio fallire subito qui.
 *
 * In sviluppo (`NODE_ENV !== "production"`) la variabile resta
 * opzionale: il fallback a `http://localhost:3000` è esattamente ciò
 * che vuoi in locale, l'avvio non deve richiedere `.env` completo.
 *
 * **Perché solo APP_URL e non le altre variabili sensibili.**
 * `DATABASE_URL` è già coperta: `apps/web/lib/db.ts` fa `throw` a
 * load-time con messaggio esplicito, il server non parte nemmeno.
 * `ANTHROPIC_API_KEY` è per progetto lazy — manca solo agli agenti,
 * che hanno un fallback silenzioso a `null` (Suspense con
 * `fallback={null}` in pagina); bloccare l'avvio del sito perché
 * mancano i testi generati sarebbe sproporzionato rispetto al danno.
 * Se domani serve estendere questa guard, farlo qui.
 */

export function register() {
  if (process.env.NODE_ENV === "production" && !process.env.APP_URL) {
    // `process.exit(1)` invece di `throw`. Next.js cattura le
    // eccezioni sollevate in `register()` come `unhandledRejection`
    // e le logga, ma NON killa il processo: il container di Docker
    // resterebbe `Up` con il server che risponde 500 a tutto. Verificato
    // sul compose di produzione — vedi §12oooooo (da scrivere) o
    // riprova con `.env` senza APP_URL. `process.exit(1)` fa morire
    // il processo Node subito, Docker vede il container failed e
    // (con `restart: unless-stopped`) entra in restart loop visibile
    // in `docker compose ps`.
    console.error(
      "APP_URL non impostata. In produzione i redirect di login " +
        "(/{comune}/entra, /{comune}/entra-coordinatore) e di logout " +
        "(/logout) cadono sul fallback http://localhost:3000: il browser " +
        "dell'utente finirebbe sul localhost del VPS invece che sul " +
        "dominio pubblico e vedrebbe la pagina rotta subito dopo il login. " +
        "Imposta APP_URL nel .env di produzione (es. " +
        "APP_URL=https://checaldo-parma.duckdns.org) e riavvia il servizio web.",
    );
    process.exit(1);
  }
}
