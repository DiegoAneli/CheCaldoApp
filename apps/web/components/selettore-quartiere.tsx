/**
 * Selettore quartiere via form GET puro. Nessun JS richiesto: submit
 * ricarica `/${slug}?q=<slug>` e la pagina server component legge
 * searchParams. Il pulsante di geolocalizzazione (progressive
 * enhancement) è un componente client separato — se JS è spento,
 * resta questo select.
 *
 * §12ff: card ripensata per stare affiancata a Raccomandazioni con
 * altezze uguali. Header "Il tuo quartiere" in stile card (uguale a
 * "Cosa conviene fare oggi"), select con label sr-only per
 * accessibilità, **pulsante full-width sotto il select nel colore
 * d'accento** (lv2 arancione) — non più affiancato al select.
 * Sotto un divisore sottile e il PulsanteGeoloc con più aria — è il
 * link "usa la mia posizione", progressive enhancement.
 * `h-full flex flex-col` per il grid affiancato.
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import type { QuartiereBase } from "@checaldo/db";
import { PulsanteGeoloc } from "./pulsante-geoloc";

interface Props {
  quartieri: QuartiereBase[];
  slugSelezionato?: string;
  /** Nome del comune, passato al PulsanteGeoloc per il messaggio d'errore. */
  nomeComune: string;
  /**
   * Slug URL del comune (`parma`, `bologna`, …). Dopo il routing per
   * path (§12t) il form GET del selettore ricarica su `/${slugComune}`
   * invece di `/`. Il PulsanteGeoloc chiama `/api/${slugComune}/quartiere`.
   */
  slugComune: string;
}

export function SelettoreQuartiere({ quartieri, slugSelezionato, nomeComune, slugComune }: Props) {
  return (
    <div className="border border-gray-400 rounded-card bg-card h-full flex flex-col">
      <div className="px-5 pt-5 pb-3">
        <div className="font-display font-semibold text-[11.5px] tracking-label uppercase text-muted">
          Il tuo quartiere
        </div>
      </div>
      <div className="px-5 pb-5 flex-1 flex flex-col">
        <form action={`/${slugComune}`} method="get" className="space-y-3">
          <label htmlFor="q" className="sr-only font-bold">
            Il tuo quartiere
          </label>
          <select
            id="q"
            name="q"
            defaultValue={slugSelezionato ?? ""}
            className="w-full border border-rule border-gray-400 rounded-btn bg-card px-3 py-2.5 text-[14px] focus:outline-none focus:ring-2 focus:ring-ink"
          >
            <option value="">Scegli il tuo quartiere...</option>
            {quartieri.map((q) => (
              <option key={q.slug} value={q.slug}>
                {q.nome}
              </option>
            ))}
          </select>
          <button
            type="submit"
            className="w-full bg-lv2 hover:bg-lv2/90 text-white px-4 py-2.5 rounded-btn font-display font-semibold text-[13px] transition-colors"
          >
            Vedi il quartiere
          </button>
        </form>

        <div className="mt-6 pt-5 border-t border-rule">
          <PulsanteGeoloc nomeComune={nomeComune} slugComune={slugComune} />
        </div>
      </div>
    </div>
  );
}
