// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Navbar minimale per la landing page `/`.
 *
 * Solo logo "CheCaldo!" col payoff. Niente "Comune di {nome}" (qui
 * non c'è un comune scelto), niente voci sezione (puntano a
 * /[comune]/metodo|servizi|faq — inutili senza comune), niente
 * pulsante login.
 *
 * Componente separato dalla `Navbar` di `/[comune]/*` perché quella
 * ha `nomeComune`/`slugComune` obbligatori e la logica di render è
 * costruita attorno a "siamo dentro un comune". Adattarla a "senza
 * comune" richiedeva rendere 4 rami condizionali e prop opzionali —
 * contorsione (§12mm). Il markup del logo è riprodotto verbatim per
 * avere la stessa identità visiva della Navbar principale.
 */

import Link from "next/link";
import { IconaSole } from "@/components/icona-sole";

export function NavbarLanding() {
  return (
    <header className="border-b border-rule bg-card">
      {/* justify-between (§12yy): logo agli estremi sinistro, payoff
          all'estremo destro. Prima erano affiancati con gap-4. */}
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between gap-4">
        <Link
          href="/"
          className="flex items-center gap-2.5 no-underline shrink-0"
          aria-label="CheCaldo!"
        >
          <IconaSole className="text-lv2 w-7 h-7" />
          <span className="font-display font-bold text-logo tracking-logo leading-none">
            Che<span className="text-lv2">Caldo!</span>
          </span>
        </Link>
        {/* Payoff (§12yy): "Sistema open source per i Piani Caldo".
            Dice cos'è la piattaforma (sistema open source) + a chi
            serve (Piani Caldo). "Piano Caldo" è il termine
            istituzionale (CHECALDO-PROGETTO §1-§2, README §2). Allineato
            a destra dal parent flex, `text-right` sul testo per
            garantire allineamento anche se in futuro un breakpoint
            più largo dovesse comunque wrappare.

            `hidden sm:inline`: nascosto sotto 640 px. A 375 il payoff
            (~240 px) più il logo (~183 px) più gap 16 supera i 343 px
            di area interna (eccesso ~96 px) e finirebbe su 3 righe
            brevi allineate a destra — squilibrio visivo col logo
            grande a sinistra. Scelta utente §12yy: navbar più pulita
            su mobile stretti a costo di non mostrare il payoff a chi
            entra da lì. Da sm in su ci sta senza problemi. */}
        <span className="hidden sm:inline text-[14px] text-slate leading-tight text-right">
          Sistema open source per i Piani Caldo cittadini
        </span>
      </div>
    </header>
  );
}
