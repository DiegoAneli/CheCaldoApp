/**
 * Login-stub per-comune (§12u audit isolamento 2026-08-03).
 *
 * Sostituisce la vecchia `/login` che leggeva sempre organizzazione id=1.
 * Ora l'organizzazione si deriva dallo slug URL:
 *   - `/parma/login`   → org di Parma
 *   - `/bologna/login` → org di Bologna
 *
 * L'utente Bologna può finalmente autenticarsi via UI.
 *
 * Come prima, non è autenticazione: è un selettore utente per la demo che
 * scrive un cookie. Anche il reverse proxy davanti a queste rotte è
 * aperto: l'istanza dimostrativa è ad accesso libero per scelta (dati
 * sintetici, vedi README §"Limiti dichiarati"). Un'installazione
 * operativa reale deve reintrodurre auth applicativa (OIDC) e/o
 * proxy (basic auth in Caddyfile).
 *
 * §12aaaaaa (2026-08-12) — sostituiti gli elenchi verticali di link con
 * due `<form>` che puntano alle route `entra`/`entra-coordinatore`
 * esistenti, ciascuno con un `<select>` + `<button>` submit. Motivi
 * (dal brief): con 12 volontari l'elenco a riquadri occupava tutta la
 * pagina e costringeva a scorrere; il coordinatore resta separato
 * ma segue lo stesso pattern per coerenza. L'ordinamento naturale
 * ("Volontario 1..12" invece di V1, V10, V11, V12, V2…) vive nella
 * query (`packages/db/src/query.ts`) — vedi commento sopra
 * `volontariDellOrganizzazione`.
 *
 * Perché `<form method="POST">` senza JavaScript. Le route
 * `entra`/`entra-coordinatore` sono POST-only: il vecchio GET era
 * prefetchabile e in `IngressoDiretto` — dove il pulsante era un
 * `<Link>` diretto a `.../{id}` — il cookie veniva impostato al
 * passaggio del mouse. La variante `/[id]` è stata rimossa: l'id
 * arriva sempre nel body (`<select name="id">` per SceltaUtente,
 * `<input type="hidden" name="id">` per IngressoDiretto), un solo
 * handler POST per ruolo. La difesa d'appartenenza sull'id vive lì
 * (verifica contro `volontari/coordinatoriDellOrganizzazione`
 * dell'org risolta dallo slug), invariante §12u preservata.
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { notFound } from "next/navigation";
import Link from "next/link";
import { sql } from "@/lib/db";
import {
  coordinatoriDellOrganizzazione,
  organizzazionePerComuneIstat,
  volontariDellOrganizzazione,
} from "@checaldo/db";
import { Navbar } from "@/components/navbar";
import { risolviComune } from "@/lib/comuni";

export default async function LoginPerComune({
  params,
}: {
  params: Promise<{ comune: string }>;
}) {
  const { comune: slug } = await params;
  const comune = risolviComune(slug);
  if (!comune) notFound();

  const org = await organizzazionePerComuneIstat(sql, comune.istat);
  if (!org) notFound();

  const [volontari, coordinatori] = await Promise.all([
    volontariDellOrganizzazione(sql, org.id),
    coordinatoriDellOrganizzazione(sql, org.id),
  ]);
  const vuoto = volontari.length === 0 && coordinatori.length === 0;

  return (
    <>
      <Navbar
        ruolo="login"
        nomeComune={comune.nome}
        slugComune={comune.slug}
      />
      <div className="max-w-lg mx-auto p-6">
        <h1 className="font-display font-bold text-h2 text-ink mt-2">
          Login demo
        </h1>
        <p className="mt-2 text-sm text-slate">
          Selettore utente per la demo. In produzione questa pagina è un flusso
          OIDC vero, non un elenco pubblico.
        </p>

      {vuoto ? (
        <div className="mt-6 border border-rule rounded-card bg-card p-5">
          <p className="text-sm">
            Nessun utente per {comune.nome} nel DB. Carica il seed
            dell&apos;organizzazione:{" "}
            <code className="font-mono text-[12.5px] bg-foot px-1.5 py-0.5 rounded">
              psql -f packages/db/seed-organizzazione.sql
            </code>
          </p>
        </div>
      ) : (
        <>
          {coordinatori.length === 1 && coordinatori[0] ? (
            <IngressoDiretto
              titolo="Coordinatore"
              nome={coordinatori[0].nome}
              action={`/${slug}/entra-coordinatore`}
              id={coordinatori[0].id}
              testoBottone="Entra come coordinatore"
            />
          ) : coordinatori.length > 1 ? (
            <SceltaUtente
              titolo="Coordinatore"
              utenti={coordinatori}
              action={`/${slug}/entra-coordinatore`}
              testoBottone="Entra come coordinatore"
            />
          ) : null}

          {volontari.length > 0 && (
            <SceltaUtente
              titolo="Volontari"
              utenti={volontari}
              action={`/${slug}/entra`}
              testoBottone="Entra come volontario"
            />
          )}
        </>
      )}

      <div className="mt-6">
        <Link
          href="/"
          className="inline-block bg-white text-ink border border-gray-400 px-4 py-2 rounded-btn font-display font-semibold text-[13px] no-underline text-center"
        >
          ← Cambia comune
        </Link>
      </div>
      </div>
    </>
  );
}

/**
 * Ingresso diretto quando c'è un solo utente in una categoria (tipico
 * per il coordinatore: uno per organizzazione — vedi seed). Form POST
 * con id in `<input type="hidden">`. Nessun `<select>` intermedio.
 * Il `<form>` non è prefetchabile — la scelta strutturale che
 * distingue questa versione da quella pre-POST, dove un <Link href>
 * al path con id veniva prefetchato al hover e impostava il cookie
 * senza click. Il pulsante mantiene aspetto identico.
 */
function IngressoDiretto({
  titolo, nome, action, id, testoBottone,
}: {
  titolo: string;
  nome: string;
  action: string;
  id: number;
  testoBottone: string;
}) {
  return (
    <section className="mt-6">
      <h2 className="font-display font-semibold text-[11.5px] tracking-label uppercase text-muted mb-2">
        {titolo}
      </h2>
      <form
        method="POST"
        action={action}
        className="border border-rule rounded-card bg-card p-4 flex flex-col sm:flex-row sm:items-center gap-3  border-gray-400"
      >
        <div className="flex-1 min-w-0 text-[14px] text-ink">{nome}</div>
        <input type="hidden" name="id" value={id} />
        <button
          type="submit"
          className="bg-ink text-white px-4 py-2 rounded-btn font-display font-semibold text-[13px] shrink-0 no-underline text-center"
        >
          {testoBottone}
        </button>
      </form>
    </section>
  );
}

/**
 * Blocco `<form POST>` con `<select>` + `<button>` submit. La route
 * `action` legge l'id da `FormData`. Ordine delle opzioni come
 * restituito dalla query (naturale, non lessicografico). `required`
 * previene l'invio senza selezione; il `defaultValue=""` con opzione
 * disabled iniziale evita che la prima voce sia preselezionata a caso.
 */
function SceltaUtente({
  titolo, utenti, action, testoBottone,
}: {
  titolo: string;
  utenti: Array<{ id: number; nome: string }>;
  action: string;
  testoBottone: string;
}) {
  return (
    <section className="mt-6">
      <h2 className="font-display font-semibold text-[11.5px] tracking-label uppercase text-muted mb-2">
        {titolo}
      </h2>
      <form
        method="POST"
        action={action}
        className="border border-rule rounded-card bg-card p-4 flex flex-col sm:flex-row sm:items-center gap-3  border-gray-400"
      >
        <label className="sr-only" htmlFor={`sel-${titolo}`}>
          Scegli {titolo.toLowerCase()}
        </label>
        <select
          id={`sel-${titolo}`}
          name="id"
          required
          defaultValue=""
          className="flex-1 min-w-0 border border-rule rounded-btn bg-white text-ink text-[14px] px-3 py-2 focus:outline-none focus:ring-2 focus:ring-ink/20  border-gray-200"
        >
          <option value="" disabled>
            Seleziona...
          </option>
          {utenti.map((u) => (
            <option key={u.id} value={u.id}>
              {u.nome}
            </option>
          ))}
        </select>
        <button
          type="submit"
          className="bg-ink text-white px-4 py-2 rounded-btn font-display font-semibold text-[13px] shrink-0"
        >
          {testoBottone}
        </button>
      </form>
    </section>
  );
}
