"use client";

/**
 * Pulsante "Chiudi condizione" con conferma esplicita sulla scheda
 * persona coordinatore (§12jjjj).
 *
 * Perché la conferma non è secca: chiudere `nessuna_climatizzazione`
 * dalla scrivania dichiara che la persona ha il condizionatore senza
 * averle parlato, e cambia il punteggio della persona (il segnale
 * smette di moltiplicare per 1.25 al prossimo giro). Semantica
 * diversa dalla chiusura per smentita del volontario di §12xxx, che
 * porta l'evidenza del contatto sul posto.
 *
 * `chiuso_da` popolato con l'id del coordinatore — l'audit trail dice
 * chi ha chiuso, ma la scheda deve dire al coordinatore cosa sta per
 * dichiarare prima di premere.
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { useState, useTransition } from "react";
import clsx from "clsx";

interface Props {
  segnaleId: number;
  etichettaTipo: string;
  chiudi: (segnaleId: number) => Promise<void>;
}

export function PulsanteChiudiCondizione({ segnaleId, etichettaTipo, chiudi }: Props) {
  const [aperto, setAperto] = useState(false);
  const [pending, startTransition] = useTransition();

  const onConferma = () =>
    startTransition(async () => {
      await chiudi(segnaleId);
      setAperto(false);
    });

  return (
    <>
      <button
        type="button"
        onClick={() => setAperto(true)}
        disabled={pending}
        className={clsx(
          "px-2.5 py-1 rounded-btn font-display font-semibold text-[11.5px] tracking-chip",
          "bg-card text-ink border border-rule hover:bg-foot",
          pending && "opacity-45 cursor-not-allowed",
        )}
      >
        {pending ? "Chiudo…" : "Chiudi"}
      </button>

      {aperto && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby={`titolo-chiudi-${segnaleId}`}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={(e) => { if (e.target === e.currentTarget && !pending) setAperto(false); }}
        >
          <div className="bg-card border border-rule rounded-card max-w-md w-full p-5 shadow-lg">
            <h3
              id={`titolo-chiudi-${segnaleId}`}
              className="font-display font-semibold text-[15px] text-ink mb-3"
            >
              Chiudere «{etichettaTipo}»?
            </h3>
            <p className="text-[13px] text-slate leading-normal mb-4">
              Dichiara che questa condizione non è più presente. La riga
              resta nello storico chiusa a tuo nome; la condizione smette
              di pesare sul punteggio della persona dalla prossima
              generazione del giro. Nessun volontario parla con la
              persona: la chiusura è tua responsabilità.
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setAperto(false)}
                disabled={pending}
                className={clsx(
                  "px-3 py-2 rounded-btn font-display font-semibold text-[12.5px]",
                  "border border-rule bg-card text-ink hover:bg-foot",
                  pending && "opacity-45 cursor-not-allowed",
                )}
              >
                Annulla
              </button>
              <button
                type="button"
                onClick={onConferma}
                disabled={pending}
                className={clsx(
                  "px-3 py-2 rounded-btn font-display font-semibold text-[12.5px]",
                  "bg-ink text-white hover:bg-ink/85",
                  pending && "opacity-45 cursor-not-allowed",
                )}
              >
                {pending ? "Chiudo…" : "Chiudi la condizione"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
