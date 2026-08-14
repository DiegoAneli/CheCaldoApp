// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Navbar unica per tutte le pagine dell'app.
 *
 * Prima esisteva solo per la pagina pubblica `/[comune]`. Ora è
 * parametrizzata per ruolo, così login, dashboard coordinatore, scheda
 * coordinatore, giro volontario e scheda volontario hanno la stessa
 * intestazione — coerente in visual e comportamento, e futuro-proof:
 * modifiche a una copia sola non divergono fra tutte.
 *
 * Prop `ruolo`:
 *   - "pubblica"       — voci Metodo/Servizi/FAQ + icona utente
 *                        (link a /{slug}/login). Come prima. Su mobile
 *                        le voci vanno in un hamburger <details> senza
 *                        JS. `voceCorrente` evidenzia quella attiva.
 *   - "login"          — solo logo + badge comune. L'utente non è
 *                        ancora autenticato: niente da navigare.
 *   - "coordinatore"   — link "Dashboard" + "Esci" (→ /logout). Nessun
 *                        nome utente in navbar: il coordinatore lavora
 *                        da postazione, il nome sta nella riga
 *                        contesto sotto la navbar.
 *   - "volontario"     — solo nome utente sulla destra, `truncate` per
 *                        stare in larghezza su schermi da 320-360px.
 *                        Nessuna voce di navigazione: il ritorno al
 *                        giro esiste come "← Il giro di oggi" nelle
 *                        schermate volontario dove serve, e in mobile
 *                        ogni elemento in più toglie spazio alla lista
 *                        delle persone (il contenuto per cui il
 *                        volontario apre l'app).
 *
 * Logo — destinazione per ruolo (non hardcoded /{slug}):
 *   pubblica    → /{slug}
 *   coordinatore→ /coordinatore
 *   volontario  → /volontario
 *   login       → nessun link (è un <div>, non un <Link>)
 * Motivo: un logo cliccabile che porta fuori dall'area di lavoro fa
 * peggio di un logo non cliccabile. Sul login non esiste un posto
 * giusto: l'utente è già lì. Le destinazioni vivono nella stessa
 * mappa `PER_RUOLO`, non sparse nel JSX.
 *
 * Contenitore — larghezza per ruolo (o override con
 * `contenitoreClasse`):
 *   pubblica    — max-w-lg sm:max-w-2xl lg:max-w-6xl px-4 sm:px-6
 *   login       — max-w-lg px-4 sm:px-6
 *   coordinatore— max-w-6xl px-6      (allineato alla dashboard)
 *   volontario  — max-w-lg px-4       (allineato al giro mobile)
 * La scheda persona coordinatore usa max-w-4xl in pagina, e passa il
 * suo override così la navbar non si allarga oltre il contenuto.
 *
 * Server component per default: `voceCorrente` arriva come prop dalla
 * pagina, non da `usePathname` — così nessun "use client", nessun
 * flash del primo render.
 */

import Link from "next/link";
import clsx from "clsx";
import { IconaSole } from "@/components/icona-sole";

export type RuoloNavbar = "pubblica" | "login" | "coordinatore" | "volontario";
export type VocePubblica = "pubblica" | "metodo" | "servizi" | "faq" | "login";

interface Props {
  ruolo: RuoloNavbar;
  /** Nome umano del comune (es. "Parma", "Bologna"). Mostrato sotto "CheCaldo!". */
  nomeComune: string;
  /** Slug del comune, usato per costruire link (login per pubblica). */
  slugComune: string;
  /** Solo per `ruolo === "pubblica"`: quale voce evidenziare. */
  voceCorrente?: VocePubblica;
  /** Solo per `ruolo === "volontario"`: nome mostrato sulla destra. */
  nomeUtente?: string;
  /**
   * Riga di contesto opzionale mostrata accanto al logo (es.
   * "Coordinatore demo — mercoledì 12 agosto 2026"). Usata dalla
   * dashboard coordinatore per non tenere una banda sotto la navbar
   * (MOD07-microcopy 2d). Nascosta sotto sm: (per non schiacciare le
   * voci a destra su schermi stretti); il coord lavora da desktop.
   */
  contesto?: string;
  /**
   * Override della classe del contenitore interno. La scheda persona
   * coordinatore la usa per allineare la navbar al proprio `max-w-4xl`.
   * Se assente, la Navbar deduce la larghezza da `ruolo` (vedi mappa
   * `PER_RUOLO.contenitore` nel body).
   */
  contenitoreClasse?: string;
}

const PER_RUOLO = {
  pubblica: {
    contenitore: "max-w-lg sm:max-w-2xl lg:max-w-6xl mx-auto px-4 sm:px-6",
    hrefLogo: (slug: string) => `/${slug}`,
  },
  login: {
    contenitore: "max-w-lg mx-auto px-4 sm:px-6",
    hrefLogo: null,
  },
  coordinatore: {
    contenitore: "max-w-6xl mx-auto px-6",
    hrefLogo: () => "/coordinatore",
  },
  volontario: {
    contenitore: "max-w-lg mx-auto px-4",
    hrefLogo: () => "/volontario",
  },
} as const;

const IconaUtente = ({ className = "" }: { className?: string }) => (
  <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden
       fill="none" stroke="currentColor" strokeWidth="1.75"
       strokeLinecap="round" strokeLinejoin="round" className={className}>
    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
    <circle cx="12" cy="7" r="4" />
  </svg>
);

const IconaHamburger = ({ className = "" }: { className?: string }) => (
  <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden
       fill="none" stroke="currentColor" strokeWidth="2"
       strokeLinecap="round" strokeLinejoin="round" className={className}>
    <line x1="3" y1="6" x2="21" y2="6" />
    <line x1="3" y1="12" x2="21" y2="12" />
    <line x1="3" y1="18" x2="21" y2="18" />
  </svg>
);

function VoceLink({
  href, corrente, children,
}: { href: string; corrente: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      aria-current={corrente ? "page" : undefined}
      className={clsx(
        "px-3 py-1.5 rounded-btn text-[13.5px] font-display font-semibold no-underline transition-colors",
        corrente
          ? "text-ink bg-foot"
          : "text-slate hover:text-ink hover:bg-foot/60",
      )}
    >
      {children}
    </Link>
  );
}

function Logo({
  nomeComune,
  href,
}: {
  nomeComune: string;
  href: string | null;
}) {
  const contenuto = (
    <>
      <IconaSole className="text-lv2 w-7 h-7" />
      <div className="flex flex-col">
        <span className="font-display font-bold text-logo tracking-logo leading-none">
          Che<span className="text-lv2">Caldo!</span>
        </span>
        <span className="text-[11px] text-slate font-mono leading-tight mt-0.5">
          Comune di {nomeComune}
        </span>
      </div>
    </>
  );
  if (href == null) {
    // Login: logo non-cliccabile. L'utente è già dove deve essere.
    return (
      <div className="flex items-center gap-2.5 shrink-0" aria-label="CheCaldo!">
        {contenuto}
      </div>
    );
  }
  return (
    <Link href={href} className="flex items-center gap-2.5 no-underline shrink-0">
      {contenuto}
    </Link>
  );
}

/** Voci desktop + hamburger mobile per il ruolo pubblica. Estratta per
 *  non ingombrare il render principale con 60 righe di menu. */
function VociPubbliche({
  slugComune,
  voceCorrente,
}: {
  slugComune: string;
  voceCorrente: VocePubblica | undefined;
}) {
  const voci = [
    { id: "metodo",  href: `/${slugComune}/metodo`,  label: "Metodo"  },
    { id: "servizi", href: `/${slugComune}/servizi`, label: "Servizi" },
    { id: "faq",     href: `/${slugComune}/faq`,     label: "FAQ"     },
  ] as const;
  const hrefLogin = `/${slugComune}/login`;
  return (
    <>
      <nav
        aria-label="Navigazione principale"
        className="hidden lg:flex items-center gap-1 ml-auto"
      >
        {voci.map((v) => (
          <VoceLink key={v.id} href={v.href} corrente={voceCorrente === v.id}>
            {v.label}
          </VoceLink>
        ))}
        <Link
          href={hrefLogin}
          aria-label="Accedi"
          aria-current={voceCorrente === "login" ? "page" : undefined}
          className={clsx(
            "ml-2 p-2 rounded-btn transition-colors",
            voceCorrente === "login"
              ? "text-ink bg-foot"
              : "text-slate hover:text-ink hover:bg-foot/60",
          )}
        >
          <IconaUtente />
        </Link>
      </nav>

      {/* Hamburger mobile+tablet — <details> senza JS. Sul lg: nascosto. */}
      <details className="ml-auto lg:hidden relative">
        <summary
          aria-label="Apri menu"
          className="list-none cursor-pointer p-2 rounded-btn text-slate hover:text-ink hover:bg-foot/60 marker:hidden"
        >
          <IconaHamburger />
        </summary>
        <nav
          aria-label="Menu"
          className="absolute right-0 top-full mt-1 min-w-[180px] bg-card border border-rule rounded-card shadow-lg py-2 z-40"
        >
          {voci.map((v) => (
            <Link
              key={v.id}
              href={v.href}
              aria-current={voceCorrente === v.id ? "page" : undefined}
              className={clsx(
                "block px-4 py-2 text-[14px] font-display font-semibold no-underline",
                voceCorrente === v.id
                  ? "text-ink bg-foot"
                  : "text-slate hover:text-ink hover:bg-foot/60",
              )}
            >
              {v.label}
            </Link>
          ))}
          <Link
            href={hrefLogin}
            aria-current={voceCorrente === "login" ? "page" : undefined}
            className={clsx(
              "block px-4 py-2 text-[14px] font-display font-semibold no-underline border-t border-rule mt-1 flex items-center gap-2",
              voceCorrente === "login"
                ? "text-ink bg-foot"
                : "text-slate hover:text-ink hover:bg-foot/60",
            )}
          >
            <IconaUtente />
            Accedi
          </Link>
        </nav>
      </details>
    </>
  );
}

/** Link ruolo coordinatore: Dashboard + Volontari + Esci (§12jjjjj). */
function VociCoordinatore() {
  return (
    <nav aria-label="Azioni coordinatore" className="ml-auto flex items-center gap-1">
      <VoceLink href="/coordinatore" corrente={false}>
        Dashboard
      </VoceLink>
      {/* §12jjjjj — pagina di gestione volontari. Non è nella
          dashboard perché è un'azione rara (non quotidiana come
          fissare la soglia); sta accanto nella navbar. */}
      <VoceLink href="/coordinatore/volontari" corrente={false}>
        Volontari
      </VoceLink>
      {/* /logout è POST, non GET: il prefetch di Next.js (e di ogni
          crawler o link preview) su un <Link href="/logout"> eseguiva
          l'handler e cancellava i cookie al passaggio del mouse.
          Il <form> nativo non è prefetchabile; il <button> stilato
          come le altre voci mantiene aspetto e comportamento della
          navbar. Vedi apps/web/app/logout/route.ts. */}
      <form action="/logout" method="POST">
        <button
          type="submit"
          className={clsx(
            "px-3 py-1.5 rounded-btn text-[13.5px] font-display font-semibold no-underline transition-colors",
            "text-slate hover:text-ink hover:bg-foot/60",
          )}
        >
          Esci
        </button>
      </form>
    </nav>
  );
}

/** Nome del volontario allineato a destra, `truncate` su schermi
 *  stretti. `min-w-0 flex-1` lo lascia restringere invece di forzare
 *  il logo a wrappare. */
function NomeVolontario({ nome }: { nome: string }) {
  return (
    <span
      className="ml-auto min-w-0 text-slate text-[13px] font-medium truncate"
      title={nome}
    >
      {nome}
    </span>
  );
}

export function Navbar({
  ruolo,
  nomeComune,
  slugComune,
  voceCorrente,
  nomeUtente,
  contesto,
  contenitoreClasse,
}: Props) {
  const cfg = PER_RUOLO[ruolo];
  const hrefLogo =
    cfg.hrefLogo === null ? null : cfg.hrefLogo(slugComune);
  const classContenitore = contenitoreClasse ?? cfg.contenitore;

  return (
    <header className="border-b border-rule bg-card">
      <div className={clsx(classContenitore, "py-3 flex items-center gap-4")}>
        <Logo nomeComune={nomeComune} href={hrefLogo} />

        {/* Contesto opzionale (MOD07-microcopy 2d): un `<span>` fra
            logo e voci di navigazione. `hidden sm:inline`: sotto 640 px
            (schermi stretti) sparisce per lasciare spazio all'hamburger
            o alle voci a destra; il coord lavora da desktop, il costo
            informativo è basso. `min-w-0 truncate` evita che una data
            insolitamente lunga forzi il layout a wrappare. */}
        {contesto && (
          <span className="hidden sm:inline text-[12.5px] text-slate leading-tight min-w-0 truncate">
            {contesto}
          </span>
        )}

        {ruolo === "pubblica" && (
          <VociPubbliche slugComune={slugComune} voceCorrente={voceCorrente} />
        )}
        {ruolo === "coordinatore" && <VociCoordinatore />}
        {ruolo === "volontario" && nomeUtente && (
          <NomeVolontario nome={nomeUtente} />
        )}
        {/* ruolo === "login": nessun elemento sulla destra. */}
      </div>
    </header>
  );
}
