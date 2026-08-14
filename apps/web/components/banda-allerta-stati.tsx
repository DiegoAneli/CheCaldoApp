// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Prima fascia della dashboard coordinatore: una sola banda che
 * raccoglie livello di allerta + badge provenienza + tre contatori
 * (In lista oggi / Tentate / Senza risposta).
 *
 * Prima esisteva come DUE elementi separati: `BadgeLivello` a tutta
 * larghezza sopra + una griglia 3 colonne di contatori dentro
 * `FasciaStatiLive` a destra del grid "Volontari e soglia". La banda
 * unica li fonde in un blocco solo, coerente in visual e più stretto
 * in verticale.
 *
 * ATTENZIONE AL POLLING (§12gggg). Il `setInterval → router.refresh()`
 * vive in `FasciaStatiLive` (client component). Spostando i tre
 * contatori qui — server component che riceve `stato` dal
 * `Promise.all` della page — il polling continua a funzionare perché:
 *   (1) `router.refresh()` rigenera l'intero server component
 *       `Coordinatore`, incluse tutte le sue query;
 *   (2) `FasciaStatiLive` resta montato con la sola card
 *       "Segnalazioni aperte" — il timer vive lì;
 *   (3) ad ogni refresh questa banda riceve `stato` aggiornato e i
 *       tre numeri seguono.
 *
 * NIENTE SKYLINE (§12mmmm addendum). La prima versione della banda
 * usava `/skyline-{slug}.png` in absolute + veletta `bg-white/60`
 * come la home pubblica (`card-allerta.tsx`). A ~80 px di altezza il
 * ritaglio `object-cover` prendeva una striscia centrale arbitraria
 * dell'immagine — facciate senza cielo né base, texture non skyline.
 * Lo skyline funziona nella home dove ha spazio verticale generoso;
 * qui no. Fondo `bg-card` come le altre card della dashboard. Non
 * toccare `card-allerta.tsx` — questa rimozione riguarda solo la
 * banda dashboard. Il **border colorato del livello resta** (`border-2`
 * con `borderColor: info.hex`): unico elemento che qualifica
 * visivamente la banda oltre al testo.
 *
 * NUMERI DOMINANTI. I tre contatori sono ciò che il coordinatore
 * guarda per primo ogni mattina — devono essere l'elemento più
 * forte della banda, sopra "Livello N" (`text-lg` ≈ 18 px) e sopra
 * il badge (`text-[11.5px]`). Impostati a `text-[44px]` con
 * `font-mono tabular-nums`. Le etichette sopra i numeri restano
 * `text-[11px]` (didascalie, non contenuto).
 */

import clsx from "clsx";
import type { AllertaRiga, StatoLiveDashboard } from "@checaldo/db";
import { LIVELLI, type Livello } from "@/lib/livelli";

interface Props {
  /** `null` quando la riga in `pubblico.allerta` per oggi manca. */
  allerta: AllertaRiga | null;
  /** Contatori giornata dal `Promise.all` della page. */
  stato: StatoLiveDashboard;
}

export function BandaAllertaStati({ allerta, stato }: Props) {
  // Border colorato dal livello quando disponibile (pastiglia oversize
  // integrata nel contenitore); border-rule neutro quando l'allerta
  // manca — non inventiamo un colore, lo dichiariamo come dato mancante.
  const livello = allerta ? (allerta.livello as Livello) : null;
  const info = livello !== null ? LIVELLI[livello]! : null;

  const bollettino = allerta?.provenienza === "bollettino";
  const cittaNonNelBollettino = allerta?.motivoProvenienza === "citta_non_nel_bollettino";

  return (
    <div
      className="rounded-card overflow-hidden bg-card border-2"
      style={info ? { borderColor: info.hex } : undefined}
    >
      <div className="px-5 py-4 flex flex-wrap items-center justify-between gap-x-8 gap-y-3">
        {/* SINISTRA — pastiglia + livello + parola + badge attaccato.
            Il badge è annotazione sul livello, non elemento autonomo:
            sta nello stesso gruppo. `flex-wrap` gestisce breakpoint
            intermedi (600-900 px) senza far cadere il badge sotto i
            numeri: se la larghezza si stringe, tutto il gruppo destra
            va sotto il gruppo sinistra grazie al `gap-y-3` del padre. */}
        <div className="flex items-center gap-3 flex-wrap min-w-0">
          {info ? (
            <>
              <span
                aria-hidden
                className="inline-block w-4 h-4 rounded shrink-0"
                style={{ background: info.hex }}
              />
              {/* §12aaaaaa — scala dichiarata a schermo. Sulla banda
                  lo spazio è stretto (livello + parola + badge + tre
                  contatori tutti su una riga a desktop): il "di 3" ci
                  sta, il "· il massimo" resta compatto in text-slate.
                  Livello 0 mostra solo la parola: la scala tacerebbe
                  informazione utile per lo 0 in dashboard, dove la
                  parola "Nessun rischio" è più efficiente del
                  "Livello 0 di 3" (decisione brief 2026-08-12). */}
              <div className="flex items-baseline gap-2 flex-wrap">
                {livello === 0 ? (
                  <span className="font-display font-bold text-lg text-ink leading-none">
                    {info.parola}
                  </span>
                ) : (
                  <>
                    <span className="font-display font-bold text-lg text-ink leading-none">
                      Livello {info.n} di 3
                      {livello === 3 && (
                        <span className="text-slate font-normal text-sm">
                          {" · il massimo"}
                        </span>
                      )}
                    </span>
                    <span className="font-display text-slate text-sm leading-none">
                      {info.parola}
                    </span>
                  </>
                )}
              </div>
              <span
                className={clsx(
                  "inline-flex items-center gap-1.5 text-[11.5px] font-display font-semibold tracking-wide uppercase px-2.5 py-1 rounded-btn border shadow-sm",
                  bollettino
                    ? "bg-officialbg text-officialink border-officialrule"
                    : "bg-demoband text-demoink border-demorule"
                )}
              >
                {bollettino ? "bollettino del Ministero" : "livello stimato · non ufficiale"}
              </span>
            </>
          ) : (
            // allerta assente: nota discreta al posto di livello+badge.
            // Semantica identica al ramo `!allerta` del vecchio
            // BadgeLivello in `page.tsx`; i tre stat restano visibili
            // perché stato.inLista/contattate/nonRaggiunte esistono
            // indipendentemente dall'allerta.
            <div className="text-sm text-slate max-w-prose">
              Livello di allerta non ancora calcolato per il comune. La
              capienza suggerita usa livello 2 come default,{" "}
              <span className="italic">non autoritativo</span>.
            </div>
          )}
        </div>

        {/* DESTRA — tre stat inline, distinti dalla spaziatura non da
            bordi verticali. Numeri dominanti (`text-[44px]`); label
            piccola sopra come didascalia. */}
        <div className="flex items-end gap-7 sm:gap-10 shrink-0">
          <StatInline k="In lista oggi" v={stato.inLista} />
          <StatInline k="Tentate" v={stato.contattate} />
          <StatInline k="Senza risposta" v={stato.nonRaggiunte} />
        </div>
      </div>

      {cittaNonNelBollettino && (
        // Nota "città non nel bollettino": occupa la larghezza piena
        // sotto la riga principale. Copia del testo verbatim da
        // `card-allerta.tsx` e `badge-livello.tsx` — se cambia la
        // formula divulgativa aggiornare anche queste due.
        <div className="px-5 pb-3 -mt-1">
          <p className="text-[12.5px] text-slate leading-normal">
            Il bollettino ministeriale <b>non riporta questa città
            oggi</b>: succede fuori dal periodo di pubblicazione (da
            maggio a settembre) o in un giorno di mancata pubblicazione.
            Nel frattempo il livello è stimato con lo stesso metodo
            usato per i comuni fuori dalle 27 città coperte dal
            Ministero (Open-Meteo + climatologia locale).
          </p>
        </div>
      )}
    </div>
  );
}

function StatInline({ k, v }: { k: string; v: number }) {
  return (
    <div className="text-right">
      <div className="text-[11px] font-display font-semibold tracking-label uppercase text-slate leading-tight">
        {k}
      </div>
      <div className="font-display font-bold text-[44px] font-mono tabular-nums tracking-stat text-ink leading-none mt-1">
        {v}
      </div>
    </div>
  );
}
