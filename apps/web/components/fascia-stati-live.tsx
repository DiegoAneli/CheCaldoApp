"use client";

/**
 * Client wrapper del polling live della dashboard coordinatore
 * (§12ooo). Contiene la card "Segnalazioni aperte" (§12qqq,
 * ristretta ai tipi osservativi in §12rrr/§12sss, distinzione
 * attive/scadute in §12ttt) con l'elenco raggruppato per persona.
 *
 * Fino a §12llll il componente conteneva anche i tre contatori
 * "In lista / Tentate / Senza risposta". Sono stati spostati nella
 * `<BandaAllertaStati>` in cima alla dashboard (§12mmmm): il polling
 * continua a funzionare perché `router.refresh()` rigenera l'intero
 * server component `Coordinatore` incluso il child banda, che
 * riceve `stato` fresco dal Promise.all della page. Qui resta lo
 * `stato` come prop solo per la card segnalazioni.
 *
 * Design (§12gggg, revisione post-§12aaaa):
 * - Il polling **non** fa più fetch di `/api/coordinatore/stato` +
 *   stato locale. Chiama `router.refresh()` di next/navigation:
 *   Next rigenera l'intero server component `Coordinatore` (le sei
 *   query del `Promise.all`) e riconcilia il tree — chip, card
 *   segnalazioni, tabella classifica, usciti, banda divergenza
 *   soglia e badge allerta si aggiornano **insieme**.
 * - Motivo del cambio: il polling via fetch aggiornava solo la
 *   fascia superiore + card segnalazioni (`stato` locale) e
 *   lasciava congelati classifica, usciti, capienza, badge. Con
 *   `router.refresh()` la rottura dell'invariante chip↔classifica
 *   di §12aaaa a schermo — le chip dicevano "Tentate 2" mentre la
 *   classifica diceva "Non ancora" sulle stesse persone — sparisce.
 *   Costo: sei query DB per ciclo invece di quattro; RSC payload
 *   ~231 KB per ciclo (misurato) invece di ~10 KB del JSON polling.
 *   Trascurabile in banda (~700 KB/min), il polling si ferma comunque
 *   quando la tab è in background.
 * - Il componente riceve i dati come **prop dal server component**
 *   e li rende come qualunque altro server-child. Nessun `useState`
 *   sui contatori.
 * - Page Visibility API invariata: tab nascosta → timer fermo, ritorno
 *   focus → `router.refresh()` immediato + timer riparte.
 * - Bottone "Chiudi" sul segnale: server action → `router.refresh()`
 *   immediato per riflettere subito la chiusura senza aspettare
 *   il ciclo di 20s.
 * - Banda "Aggiornamento automatico fermo dalle HH:MM" di §12ppp
 *   **rimossa**: `router.refresh()` non espone success/fail in modo
 *   trasparente al client (è fire-and-forget rispetto al codice
 *   userland). Un heartbeat esplicito per rilevare "server morto"
 *   richiederebbe una route diagnostica separata, fuori scope di
 *   §12gggg. La regressione informativa è modesta — se il server è
 *   fermo il coordinatore vede numeri costanti e può ricaricare a
 *   mano; in caso di errore di rendering, l'error boundary di Next
 *   compare.
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { startTransition, useEffect, useRef, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { StatoLiveDashboard } from "@checaldo/db";
import { SegnaliAperti } from "@/components/segnali-aperti";

const INTERVALLO_MS = 20_000;

interface Props {
  stato: StatoLiveDashboard;
  chiudi: (segnaleId: number) => Promise<void>;
}

export function FasciaStatiLive({ stato, chiudi }: Props) {
  const router = useRouter();

  // Riferimento al timer: serve per cancellarlo in visibilitychange
  // e negli effetti di cleanup senza race condition.
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    function aggiorna() {
      // Un refresh periodico è per definizione non-urgente:
      // startTransition rappresenta correttamente la priorità e
      // lascia a React margine per prepararlo in background. Stessa
      // ragione per cui `onChiudi` (sotto) è già in `startChiusura`.
      // NON è la difesa contro il flash osservato in dev prima della
      // rettifica di §12hhhh: quel flash era un artefatto di
      // `next dev` (href stylesheet con `?v=<timestamp>` che cambiava
      // a ogni compilazione, dedupe di React fallita, CSS riscaricato,
      // fallback visibile con `font-display: swap`), assente in build
      // di produzione. Vedi §12hhhh per la ricostruzione.
      startTransition(() => {
        router.refresh();
      });
    }
    function avviaTimer() {
      if (timerRef.current) return;
      timerRef.current = setInterval(aggiorna, INTERVALLO_MS);
    }
    function fermaTimer() {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }
    function onVisibilityChange() {
      if (document.hidden) {
        fermaTimer();
      } else {
        // Al ritorno del focus: refresh immediato + riavvia il ciclo.
        // Passa da `aggiorna()`, quindi eredita startTransition sopra.
        aggiorna();
        avviaTimer();
      }
    }
    document.addEventListener("visibilitychange", onVisibilityChange);
    if (!document.hidden) avviaTimer();
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      fermaTimer();
    };
  }, [router]);

  const [pendingChiusura, startChiusura] = useTransition();
  function onChiudi(segnaleId: number): Promise<void> {
    // Ritorna la Promise che il figlio SintomiAperti attende: dopo la
    // chiusura, router.refresh() immediato per riflettere la lista
    // aggiornata senza aspettare il ciclo di polling di 20s.
    return new Promise<void>((resolve) => {
      startChiusura(async () => {
        try {
          await chiudi(segnaleId);
          router.refresh();
        } finally {
          resolve();
        }
      });
    });
  }

  const { segnaliAperti, segnaliAttive, segnaliScadute } = stato;
  const segnaliTotale = segnaliAttive + segnaliScadute;
  const nPersoneConSegnali = new Set(segnaliAperti.map((s) => s.personaId)).size;

  return (
    <>
      {/* Card "Segnalazioni aperte" (§12qqq, ristretta in §12sss ai
          due tipi che l'app produce). Attivi in cima, scaduti in
          fondo con badge esplicito (§12ttt). Il bottone "Chiudi"
          funziona su tutti: server action → router.refresh() → re-render.
          I tre contatori vivevano sopra questa card fino a §12llll —
          spostati in `<BandaAllertaStati>` in cima alla pagina. */}
      <div className="border  border-gray-400 rounded-card bg-card">
        <h3 className="font-display font-semibold text-[13px] tracking-label uppercase text-slate px-5 pt-4 pb-3">
          {`Segnalazioni aperte · ${segnaliAttive} ${segnaliAttive === 1 ? "attiva" : "attive"}`}
          {segnaliScadute > 0 && (
            <>
              {" + "}
              {segnaliScadute} {segnaliScadute === 1 ? "scaduta" : "scadute"}
            </>
          )}
          {nPersoneConSegnali > 0 && (
            <>
              {" · "}
              {nPersoneConSegnali} {nPersoneConSegnali === 1 ? "persona" : "persone"}
            </>
          )}
        </h3>
        <p className="text-[12.5px] text-slate px-5 pb-2 max-w-prose">
          Condizioni segnalate e ancora aperte, raggruppate per persona.
        </p>
        <details className="text-[12px] text-muted px-5 pb-3">
          <summary className="cursor-pointer hover:text-slate">
            Come funziona
          </summary>
          <p className="mt-2 max-w-prose">
            Ogni riga è una condizione registrata da chi ha visto o
            parlato con la persona. Chiudere una segnalazione dichiara
            che la condizione descritta non c&apos;è più: quel fattore
            smette di pesare sul punteggio e alla prossima generazione
            del giro la persona scende in classifica.
          </p>
        </details>
        {segnaliTotale > segnaliAperti.length && (
          <p className="text-[11.5px] text-muted px-5 pb-2 text-right">
            Mostrati i primi {segnaliAperti.length} di {segnaliTotale}.
          </p>
        )}
        <SegnaliAperti righe={segnaliAperti} chiudi={onChiudi} />
        {pendingChiusura && (
          <div className="px-5 pb-2 text-[11.5px] text-muted">
            aggiornamento in corso…
          </div>
        )}
      </div>
    </>
  );
}

