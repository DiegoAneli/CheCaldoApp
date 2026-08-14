// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Card allerta della pagina pubblica (§12cc). Blocco unico che
 * raccoglie badge, testo agente e ultimo aggiornamento in una sola
 * card (§12uuuu: sostituisce l'accoppiata `BadgeLivello` + il
 * componente separato `AllertaCitta` — quest'ultimo ora rimosso
 * perché codice morto, era rimasto in components/ senza essere più
 * importato da nessuna parte). Contiene:
 *
 *   - bordo colore del livello + sfondo tenue;
 *   - a sinistra: icona sole, "Livello N", parola del livello in
 *     maiuscolo (dal campo `parola` di `lib/livelli.ts`), badge
 *     provenienza ("livello stimato · non ufficiale" o "bollettino
 *     del Ministero"), testo dell'agente città quando presente, riga
 *     "Ultimo aggiornamento" con la data di estrazione;
 *   - a destra su desktop: numero grande dentro cerchio pieno nel
 *     colore del livello + immagine dello skyline del comune;
 *   - su mobile: skyline nascosto, il numero cerchio resta in alto a
 *     destra come da mockup.
 *
 * **Split sync + async per il rendering non bloccante**. `CardAllerta`
 * è sincrona: renderizza subito badge + parola + numero + skyline +
 * "ultimo aggiornamento" senza aspettare il modello. Il testo
 * dell'agente città è dentro `<TestoAgente>` (server component async
 * qui sotto) avvolto in `<Suspense fallback={null}>` — quando pronto
 * appare in modo streamato, se null (fallback silenzioso: freshness
 * stale, tetto miss, o eccezione) semplicemente non compare. Senza
 * questo split la card bloccherebbe l'intera pagina in attesa
 * dell'LLM.
 *
 * Skyline: file in `public/skyline-{slug}.png`. Se manca (utente li
 * carica in tempi diversi, o non ha uno skyline per un comune nuovo),
 * `assetPubblicoEsiste` fa saltare il tag <img>: la card resta
 * completa a sinistra, il cerchio numero occupa lo spazio in modo
 * comunque leggibile.
 */

import { Suspense } from "react";
import { sql } from "@/lib/db";
import { generaAllertaCitta } from "@checaldo/agents";
import type { AllertaRiga } from "@checaldo/db";
import { LIVELLI, type Livello } from "@/lib/livelli";
import { assetPubblicoEsiste } from "@/lib/asset-esistente";
import { PulsanteAscolto } from "@/components/pulsante-ascolto";
import clsx from "clsx";

interface Props {
  allerta: AllertaRiga | null;
  nomeComune: string;
  slugComune: string;
}

const IconaSole = ({ className = "" }: { className?: string }) => (
  <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden
       fill="none" stroke="currentColor" strokeWidth="1.75"
       strokeLinecap="round" strokeLinejoin="round" className={className}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
  </svg>
);

/** "4 agosto 2026" da una data ISO YYYY-MM-DD. */
function formatoDataIt(iso: string): string {
  const d = new Date(iso + "T00:00:00");
  return new Intl.DateTimeFormat("it-IT", {
    day: "numeric", month: "long", year: "numeric",
  }).format(d);
}

/**
 * Solo il paragrafo del testo agente città. Renderizzato dentro
 * Suspense nella CardAllerta principale. Se `generaAllertaCitta`
 * ritorna null (fallback silenzioso), NON renderizza nulla — la card
 * mantiene layout senza sezione testo.
 */
async function TestoAgente({
  comuneIstat, nomeComune,
}: { comuneIstat: string; nomeComune: string }) {
  const testo = await generaAllertaCitta(sql, comuneIstat, nomeComune);
  if (!testo) return null;
  return (
    <>
      <p className="text-[14px] text-ink mt-3 leading-relaxed whitespace-pre-line">
        {testo}
      </p>
      {/* Etichetta IA (§12ee, richiesta dell'art. 50 dell'AI Act:
          testi generati che informano il pubblico su questioni di
          interesse pubblico devono essere dichiarati chiaramente e in
          modo contestuale, non solo in una pagina legale). Rendered
          solo QUI, sotto il testo effettivo: se `testo` è null la
          label non compare (non c'è nulla di generato da dichiarare).
          Pulsante ascolto: audio Piper via /api/tts/citta con fallback
          alla sintesi del browser se il servizio tts è giù (§12ggggg
          + §12fffff). */}
      <div className="mt-1.5 flex items-center gap-3 flex-wrap">
        <PulsanteAscolto
          testo={testo}
          etichetta="testo di allerta"
          sorgente={{ url: "/api/tts/citta", body: { comuneIstat } }}
        />
        <p className="text-[11px] text-muted italic leading-normal">
          Testo e audio generato con il supporto di intelligenza artificiale
        </p>
      </div>
    </>
  );
}

export function CardAllerta({ allerta, nomeComune, slugComune }: Props) {
  // Se non c'è allerta in DB, la card diventa una nota discreta —
  // stesso branch del vecchio `!allerta` in page.tsx, adattato.
  if (!allerta) {
    return (
      <div className="border border-rule rounded-card bg-card p-4 text-sm text-slate">
        Livello di allerta non ancora calcolato per oggi.
      </div>
    );
  }

  const livello = allerta.livello as Livello;
  const info = LIVELLI[livello]!;
  const bollettino = allerta.provenienza === "bollettino";
  const cittaNonNelBollettino = allerta.motivoProvenienza === "citta_non_nel_bollettino";

  const skylinePath = `/skyline-${slugComune}.png`;
  const skylineEsiste = assetPubblicoEsiste(skylinePath);

  return (
    <div
      className="rounded-card overflow-hidden bg-card relative"
      style={{
        border: `2px solid ${info.hex}`,
        background: "linear-gradient(180deg, rgba(0,0,0,0.02), transparent)",
      }}
    >
      {/* SKYLINE — background assoluto, occupa la metà destra della
          card a piena altezza. Solo desktop. Anchored destra-basso
          + `object-cover` così lo skyline resta leggibile anche se la
          card cresce col testo dell'agente. Gradient mask
          sinistra→destra sfuma i primi 45% così il testo a sinistra
          resta leggibile.

          §12ee: `transform: scale(1.35) origin-bottom-right` zooma
          l'immagine oltre `object-cover` — così gli edifici riempiono
          la fascia destra invece di galleggiarci dentro. Con solo
          `object-cover` un'immagine wide-aspect (tipo skyline 1200×400)
          scalata a un contenitore 576×250 mostra edifici piccoli e
          distanti; il scale 1.35 aggiuntivo li porta a dimensione da
          skyline vero. L'origine bottom-right tiene la linea
          dell'orizzonte ancorata alla base della card.

          `pointer-events-none select-none` — decorativa, i clic
          passano sotto. `aria-hidden` — livello e parola già
          dichiarati per screen reader.
          Non `next/image`: asset in `public/`, il transform CSS non è
          compatibile col loader di ottimizzazione automatica. */}
      {skylineEsiste && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={skylinePath}
          alt=""
          aria-hidden
          className="hidden lg:block absolute inset-y-0 right-0 w-1/2 h-full object-cover pointer-events-none select-none z-0"
          style={{
            objectPosition: "right bottom",
            transform: "scale(1.24)",
            transformOrigin: "right bottom",
            WebkitMaskImage: "linear-gradient(to right, transparent 0%, black 45%)",
            maskImage: "linear-gradient(to right, transparent 0%, black 45%)",
            opacity: 0.85,
          }}
        />
      )}

      {/* CONTENUTO — `relative z-10` per stare sopra allo skyline.
          `lg:pr-[45%]` tiene il testo dentro la metà sinistra: il
          gradient mask attenua l'immagine dove sfuma, ma il pr
          esplicito garantisce che testo lungo non finisca sotto la
          parte leggibile dello skyline. */}
      <div className="relative z-10 p-4 sm:p-5 lg:pr-[45%]">
        {/* Header: cerchio numero A SINISTRA del blocco Livello +
            PAROLA, non più absolute top-right (§12ee). Ancoraggio
            visivo: il numero appartiene al livello, non fluttua in
            mezzo alla card. Su ogni breakpoint.

            §12aaaaaa — scala del livello dichiarata a schermo:
            `Livello N di 3` per i livelli 1-3, con `· il massimo`
            aggiunto al 3. Livello 0 non porta numero né scala: la
            parola "Nessun rischio" comunica già da sola quello che il
            numero dovrebbe dire e la scala 0/3 sarebbe rumore in una
            card che deve rassicurare (decisione brief 2026-08-12).
            Il cerchio col numero grande sparisce al livello 0 per lo
            stesso motivo. */}
        <div className="flex items-start gap-3 sm:gap-4">
          {livello !== 0 && (
            <div
              aria-hidden
              className="rounded-full flex items-center justify-center font-display font-bold text-white shadow-md shrink-0"
              style={{
                background: info.hex,
                width: "clamp(56px, 11vw, 80px)",
                height: "clamp(56px, 11vw, 80px)",
                fontSize: "clamp(28px, 5.5vw, 40px)",
                lineHeight: 1,
              }}
            >
              {info.n}
            </div>
          )}
          <div className="min-w-0 flex-1">
            {livello !== 0 && (
              <div className="flex items-center gap-2 text-slate">
                <IconaSole className="text-lv2 shrink-0" />
                <span className="font-display font-bold text-[15px] text-ink">
                  Livello {info.n} di 3
                </span>
                {livello === 3 && (
                  <span className="text-slate text-[13.5px]">
                    &middot; il massimo
                  </span>
                )}
              </div>
            )}
            <div
              className={clsx(
                "font-display font-bold text-[20px] sm:text-[22px] tracking-wide uppercase leading-tight",
                livello === 0 ? "mt-0" : "mt-1",
              )}
              style={{ color: info.hex }}
            >
              {info.parola}
            </div>
          </div>
        </div>

        {/* Badge provenienza: dichiarazione autoritativa. Blu per
            bollettino, arancio per stima. */}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span
            className={clsx(
              "inline-flex items-center gap-1.5 text-[11px] font-display font-semibold tracking-wide uppercase px-2 py-0.5 rounded-btn border",
              bollettino
                ? "bg-officialbg text-officialink border-officialrule"
                : "bg-demoband text-demoink border-demorule"
            )}
          >
            {bollettino ? "bollettino del Ministero" : "livello stimato · non ufficiale"}
          </span>
        </div>

        {cittaNonNelBollettino && (
          // Formula generica "da maggio a settembre" — la stessa che
          // il Ministero usa nelle sue pagine divulgative. Fonte
          // primaria e finestra 2026 esatta documentate nel JSDoc di
          // `badge-livello.tsx` e in `come-funziona-il-bollettino.tsx`
          // (§12ccc, Opzione B: link fuori dal microcopy).
          <p className="text-[12.5px] text-slate mt-2 leading-normal">
            Il bollettino ministeriale <b>non riporta questa città
            oggi</b>: succede fuori dal periodo di pubblicazione (da
            maggio a settembre) o in un giorno di mancata pubblicazione.
            Nel frattempo il livello è stimato con lo stesso metodo
            usato per i comuni fuori dalle 27 città coperte dal
            Ministero (Open-Meteo + climatologia locale).
          </p>
        )}

        {/* Testo agente in Suspense interno: la card non blocca la
            pagina in attesa dell'LLM. Fallback silenzioso a null: se
            il testo non c'è, NON compare né il paragrafo né
            l'etichetta AI (§12ee: la dichiarazione IA è chiara e
            contestuale — deve stare accanto al testo generato, non
            comparire quando non c'è nulla di generato). */}
        <Suspense fallback={null}>
          <TestoAgente
            comuneIstat={allerta.comuneIstat}
            nomeComune={nomeComune}
          />
        </Suspense>

        <div className="text-[11.5px] text-muted mt-3 font-mono">
          Ultimo aggiornamento: {formatoDataIt(allerta.dataEstrazione)}
          {" · "}
          <span className="uppercase tracking-chip">{allerta.provenienza}</span>
        </div>
      </div>
    </div>
  );
}
