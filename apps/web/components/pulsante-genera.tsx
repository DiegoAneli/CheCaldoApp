"use client";

/**
 * Pulsante "Genera il giro di oggi" con doppia conferma quando ci sono
 * uno o più motivi per fermare la mano del coordinatore prima
 * dell'esecuzione.
 *
 * Due motivi possibili, indipendenti e coesistenti:
 *
 *   1. Giro già iniziato oggi (`contattatiOggi > 0`, §12w):
 *      le assegnazioni delle persone già contattate restano invariate
 *      lato server; cambia solo la coda non lavorata.
 *   2. Allerta scaduta (`allertaScaduta` non null): il livello nel DB
 *      non è quello di oggi, la classifica viene calcolata su un valore
 *      vecchio. Il coordinatore deve saperlo prima di premere.
 *
 * Se entrambi sono attivi, il dialog mostra le due spiegazioni una sotto
 * l'altra. Se nessuno è attivo, il click esegue subito (mattina semplice).
 *
 * Il server action `genera` può ritornare un `{ok:false, motivo}` per
 * segnalare un fail applicativo (es. `pubblico.allerta` vuota per oggi):
 * il pulsante intercetta e mostra il testo restituito in una banda,
 * senza far salire lo stack trace di Next.
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { useState, useTransition } from "react";
import clsx from "clsx";

export interface AllertaScaduta {
  /** Data ISO YYYY-MM-DD della riga più recente in DB. */
  dataRiga: string;
  /** Stessa data in italiano leggibile ("giovedì 3 agosto 2026"). */
  dataLeggibile: string;
  /** Interi giorni pieni fra `dataRiga` e oggi. 1 → "ieri". */
  giorniFa: number;
}

export interface RisultatoGenera {
  ok: boolean;
  /** Testo user-facing, non tecnico. Presente solo se `ok=false`. */
  motivo?: string;
}

interface Props {
  contattatiOggi: number;
  inLista: number;
  soglia: number;
  allertaScaduta: AllertaScaduta | null;
  genera: () => Promise<RisultatoGenera>;
}

export function PulsanteGenera({
  contattatiOggi, inLista, soglia, allertaScaduta, genera,
}: Props) {
  const [aperto, setAperto] = useState(false);
  const [pending, startTransition] = useTransition();
  const [errore, setErrore] = useState<string | null>(null);

  const giroIniziato = contattatiOggi > 0;
  const richiedeConferma = giroIniziato || allertaScaduta !== null;

  const label = inLista === 0 ? "Genera il giro di oggi" : "Rigenera il giro di oggi";
  const labelConferma = inLista === 0 ? "Genera comunque" : "Rigenera comunque";

  const esegui = () =>
    startTransition(async () => {
      setErrore(null);
      const res = await genera();
      setAperto(false);
      if (!res.ok && res.motivo) setErrore(res.motivo);
    });

  const onClick = () => {
    setErrore(null);
    if (richiedeConferma) setAperto(true);
    else esegui();
  };

  return (
    <>
      <button
        type="button"
        onClick={onClick}
        disabled={pending}
        className={clsx(
          "px-4 py-2 rounded-btn font-display font-semibold text-[13px] tracking-chip",
          "bg-ink text-white hover:bg-ink/85 transition-colors",
          pending && "opacity-45 cursor-not-allowed"
        )}
      >
        {pending && !richiedeConferma ? "Genero…" : label}
      </button>
      {inLista > 0 && (
        <span className="ml-3 text-[12px] text-muted">
          giro attuale: <span className="font-mono">{inLista}</span>{" "}
          {inLista === 1 ? "persona" : "persone"}
          {soglia !== inLista && (
            <>
              {" · "}soglia salvata: <span className="font-mono">{soglia}</span>
            </>
          )}
        </span>
      )}

      {errore && (
        <div
          role="alert"
          className="mt-3 basis-full border border-red-300 bg-red-50 text-red-900 rounded-btn px-3 py-2 text-[12.5px] leading-normal"
        >
          {errore}
        </div>
      )}

      {aperto && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="titolo-conferma-genera"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={(e) => { if (e.target === e.currentTarget && !pending) setAperto(false); }}
        >
          <div className="bg-card border border-rule rounded-card max-w-md w-full p-5 shadow-lg">
            <h3
              id="titolo-conferma-genera"
              className="font-display font-semibold text-[15px] text-ink mb-3"
            >
              Prima di generare il giro
            </h3>
            <div className="text-[13px] text-slate leading-normal mb-4 space-y-3">
              {giroIniziato && (
                <p>
                  <span className="font-mono">{contattatiOggi}</span>{" "}
                  {contattatiOggi === 1 ? "persona è" : "persone sono"} già{" "}
                  {contattatiOggi === 1 ? "stata contattata" : "state contattate"}{" "}
                  oggi e {contattatiOggi === 1 ? "resta" : "restano"} nel giro con
                  il {contattatiOggi === 1 ? "suo" : "loro"} volontario. Rigenerando
                  cambia solo chi non è ancora stato chiamato: la coda si
                  ricalcola con la soglia attuale. I contatti registrati restano
                  in cronologia.
                </p>
              )}
              {allertaScaduta && (
                <p>
                  Il livello di allerta usato per formare la lista è quello di{" "}
                  <b>{allertaScaduta.dataLeggibile}</b>
                  {" "}
                  ({allertaScaduta.giorniFa === 1
                    ? "ieri"
                    : <>{allertaScaduta.giorniFa} giorni fa</>}).
                  Il livello di oggi non è ancora disponibile: la lista verrà
                  calcolata su questo valore.
                </p>
              )}
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setAperto(false)}
                disabled={pending}
                className={clsx(
                  "px-3 py-2 rounded-btn font-display font-semibold text-[12.5px]",
                  "border border-rule bg-card text-ink hover:bg-foot",
                  pending && "opacity-45 cursor-not-allowed"
                )}
              >
                Annulla
              </button>
              <button
                type="button"
                onClick={esegui}
                disabled={pending}
                className={clsx(
                  "px-3 py-2 rounded-btn font-display font-semibold text-[12.5px]",
                  "bg-ink text-white hover:bg-ink/85",
                  pending && "opacity-45 cursor-not-allowed"
                )}
              >
                {pending ? "Genero…" : labelConferma}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
