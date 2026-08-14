"use client";

/**
 * Corpo della card "Volontari e soglia" della dashboard coordinatore
 * (§12pppp). Card full-width con grid a due colonne 3fr:2fr:
 *
 *   ┌─ Volontari e soglia ─────────────────────────────┐
 *   │ helper text          │  [Salva]  [Genera]        │
 *   │ ▸ Come funziona      │                           │
 *   │ Sintesi vol + link   │  (bande condizionali)     │
 *   │ ────●───────────     │                           │
 *   │ soglia: prime N ...  │                           │
 *   └──────────────────────────────────────────────────┘
 *
 * Motivo del refactor. Fino a §12llll la card aveva `max-w-2xl`
 * interno per non far diventare lo slider una barra da 1088 px. In
 * §12pppp la card è tornata full-width e gli elementi sono stati
 * disposti in orizzontale: lo slider occupa ~600 px della colonna
 * sinistra (3fr su 6xl), i bottoni [Salva] + [Genera] stanno
 * affiancati nella colonna destra (2fr), le bande condizionali
 * scorrono sotto di essi.
 *
 * §12jjjjj addendum (2026-08-12) — la card non contiene più gli
 * interruttori per mettere in pausa i volontari uno per uno: quelli
 * vivono solo in /coordinatore/volontari. Qui resta la sintesi di
 * chi c'è oggi (conteggio di turno + nomi in pausa) con un link
 * alla pagina di gestione. Motivo: lo stato informa, l'azione sta
 * in un posto solo — vedere lo stato in dashboard senza cambiare
 * pagina resta possibile; cambiarlo richiede un click in più.
 *
 * Perché tiene lo stato del `valore`. Il salvataggio ha bisogno del
 * valore corrente dello slider; il bottone Salva è in una colonna
 * separata dal componente `<SliderSoglia>`. Alzo lo state qui,
 * `SliderSoglia` diventa controlled (props `valore` + `onCambia`).
 * Il vecchio `<form>` interno a SliderSoglia è ora qui.
 *
 * Sync col DB dopo mutazioni server (Riallinea, o un altro Salva
 * in parallelo): `useEffect([iniziale])` — invariato rispetto a
 * pre-§12pppp. Senza questo lo slider resterebbe sul valore che
 * l'utente aveva a schermo prima del re-render, dando l'illusione
 * che Riallinea non abbia fatto nulla.
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { useEffect, useState, useTransition, type ReactNode } from "react";
import Link from "next/link";
import clsx from "clsx";
import { SliderSoglia } from "@/components/slider-soglia";
import type { VolontarioConPresenza } from "@checaldo/db";

interface Props {
  iniziale: number;
  min: number;
  max: number;
  /** Elenco vol dell'org (attivi) con stato pausa + carico oggi. §12jjjjj. */
  volontari: VolontarioConPresenza[];
  capienzaSuggerita: number;
  chiHaImpostato: string;
  salva: (valore: number) => Promise<void>;
  /** Testo helper sopra il slider (colonna sinistra). */
  helperText: string;
  /** Blocco `<details>` "Come funziona" (colonna sinistra). */
  aiuto: ReactNode;
  /** `PulsanteGenera` renderizzato accanto al bottone Salva. */
  slotBottoneGenera: ReactNode;
  /** Bande condizionali (divergenza soglia/livello, ignoto, ecc.). */
  slotBande: ReactNode;
}

export function VolontariSogliaAzioni({
  iniziale, min, max, volontari, capienzaSuggerita, chiHaImpostato,
  salva, helperText, aiuto, slotBottoneGenera, slotBande,
}: Props) {
  const diTurno = volontari.filter((v) => !v.inPausa).length;
  const inPausa = volontari.filter((v) => v.inPausa);
  const [valore, setValore] = useState(iniziale);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    setValore(iniziale);
  }, [iniziale]);

  const modificato = valore !== iniziale;

  return (
    <div className="px-5 pb-4 grid md:grid-cols-[3fr_2fr] gap-6">
      {/* Colonna sinistra: helper + details + sintesi vol + slider.
          §12jjjjj addendum — la sintesi ha sostituito l'elenco con
          interruttori (che duplicava la pagina /coordinatore/volontari).
          Riempie lo spazio prima occupato dall'elenco senza lasciare
          la colonna vuota fra il details e lo slider. */}
      <div>
        <p className="text-[12.5px] text-slate max-w-prose mb-3">
          {helperText}
        </p>
        {aiuto}
        <SintesiVolontari
          totale={volontari.length}
          diTurno={diTurno}
          inPausa={inPausa}
        />
        <SliderSoglia
          valore={valore}
          onCambia={setValore}
          min={min}
          max={max}
          volontariAttivi={diTurno}
          capienzaSuggerita={capienzaSuggerita}
          chiHaImpostato={chiHaImpostato}
        />
      </div>

      {/* Colonna destra: [Salva] [Rigenera] + testo "giro attuale"
          allineati a destra + bande sotto.

          MOD07-microcopy 2e: `justify-end` sulla riga bottoni allinea
          i due pulsanti (e il testo "giro attuale: N persone" che il
          PulsanteGenera aggiunge come <span> subito dopo) al bordo
          destro della card. Questo li mette sulla stessa verticale del
          pulsante "Genera il riassunto della giornata" della card
          sopra, che è già all'estremo destro via `justify-between`. */}
      <div className="flex flex-col gap-3 items-end">
        <div className="flex flex-wrap items-center gap-2 justify-end">
          <form
            action={(fd) => {
              const v = Number(fd.get("valore"));
              if (Number.isFinite(v)) {
                startTransition(async () => { await salva(v); });
              }
            }}
          >
            <input type="hidden" name="valore" value={valore} />
            <button
              type="submit"
              disabled={!modificato || pending}
              className={clsx(
                "bg-ink text-white px-4 py-2 rounded-btn font-display font-semibold text-[12.5px]",
                (!modificato || pending) && "opacity-45 cursor-not-allowed",
              )}
            >
              {pending ? "Salvo…" : "Salva soglia"}
            </button>
          </form>
          {slotBottoneGenera}
        </div>
        {modificato && !pending && (
          // Nota: prima di §12pppp il bottone Salva era sopra Genera
          // e la nota diceva "premi 'Genera il giro' sotto". Ora i due
          // bottoni sono affiancati sulla stessa riga: la parola
          // "accanto" riflette la nuova disposizione (cambio di
          // presentazione, non di contenuto informativo).
          // MOD07-microcopy 2e: aggiunto `text-right` perché il
          // container è ora `items-end`; senza, la nota sarebbe
          // allineata a sinistra dentro un blocco spinto a destra.
          <span className="text-[12.5px] text-slate max-w-prose text-right">
            Salvarla non genera il giro. Per formare la lista con
            questo valore, premi &laquo;Genera il giro&raquo; accanto.
          </span>
        )}
        {/* Le bande condizionali restano allineate a sinistra
            all'interno del proprio blocco (perché `items-end` sul
            padre fa sì che ogni figlio si dimensioni al suo contenuto).
            Il wrap `w-full` sotto le riporta a piena larghezza della
            colonna così i messaggi lunghi hanno spazio per scorrere. */}
        <div className="w-full flex flex-col gap-2">
          {slotBande}
        </div>
      </div>
    </div>
  );
}

/**
 * §12jjjjj addendum (2026-08-12) — Sintesi di chi c'è oggi. Sostituisce
 * l'elenco con interruttori di pre-2026-08-12 nella card dashboard:
 * conteggio dei di turno + nomi di chi è in pausa oggi + link alla
 * pagina di gestione. Se nessuno è in pausa, la seconda riga scompare
 * (nulla da dire).
 */
function SintesiVolontari({
  totale, diTurno, inPausa,
}: {
  totale: number;
  diTurno: number;
  inPausa: VolontarioConPresenza[];
}) {
  return (
    <div className="mb-4 border border-rule rounded-btn bg-foot px-3 py-2 text-[12.5px] text-slate leading-normal">
      <div>
        Volontari di turno oggi:{" "}
        <span className="font-mono">{diTurno}</span> di{" "}
        <span className="font-mono">{totale}</span> attivi
      </div>
      {inPausa.length > 0 && (
        <div className="mt-1 text-muted">
          In pausa oggi:{" "}
          <span className="text-slate">
            {inPausa.map((v) => v.nome).join(", ")}
          </span>
        </div>
      )}
      <div className="mt-1">
        <Link
          href="/coordinatore/volontari"
          className="text-ink underline underline-offset-2 hover:text-slate"
        >
          Gestisci volontari &rarr;
        </Link>
      </div>
    </div>
  );
}
