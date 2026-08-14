"use client";

/**
 * Pulsante "Riallinea" della soglia: aggiorna il valore salvato con
 * la capienza suggerita dall'allerta corrente. Un click, nessuna
 * conferma preventiva (§12w): l'azione è reversibile — se il
 * coordinatore si pente, rimette lo slider al vecchio valore e salva.
 *
 * L'esplicitazione della modifica arriva DOPO l'azione, non prima:
 * lo slider si aggiorna al valore nuovo (useEffect in SliderSoglia),
 * la banda di divergenza sparisce.
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { useTransition } from "react";
import clsx from "clsx";

interface Props {
  riallinea: () => Promise<void>;
}

export function PulsanteRiallinea({ riallinea }: Props) {
  const [pending, startTransition] = useTransition();

  return (
    <button
      type="button"
      onClick={() => startTransition(async () => { await riallinea(); })}
      disabled={pending}
      className={clsx(
        "shrink-0 px-3 py-1 rounded-btn font-display font-semibold text-[11.5px]",
        "border border-demorule bg-demoband text-demoink",
        "hover:bg-demoband/70 transition-colors",
        pending && "opacity-45 cursor-not-allowed"
      )}
    >
      {pending ? "Riallineo…" : "Riallinea"}
    </button>
  );
}
