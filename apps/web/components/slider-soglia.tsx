"use client";

/**
 * Slider della soglia del giorno — parte visiva pura (info + input +
 * footer). `valore` è controlled dal padre (`VolontariSogliaAzioni`,
 * §12pppp): il salvataggio, i bottoni e le bande di stato vivono
 * fuori da qui, così possono stare in una colonna separata del grid
 * "Volontari e soglia" a piena larghezza. Il form Salva interno di
 * pre-§12pppp è stato rimosso: il chiamante lo crea sapendo il
 * `valore` corrente.
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

interface Props {
  valore: number;
  onCambia: (v: number) => void;
  min: number;
  max: number;
  /**
   * §12jjjjj — Volontari di turno oggi (attivi ∧ non in pausa). Il
   * nome del prop resta `volontariAttivi` per non rompere i chiamanti
   * esistenti; la semantica è "vol che entrano nella capienza
   * suggerita". Il conteggio anagrafico (attivi in generale) è
   * mostrato nel blocco Sintesi Volontari sopra questo componente
   * (§12jjjjj addendum 2026-08-12).
   */
  volontariAttivi: number;
  capienzaSuggerita: number;
  chiHaImpostato: string;
}

export function SliderSoglia({
  valore, onCambia, min, max, volontariAttivi, capienzaSuggerita, chiHaImpostato,
}: Props) {
  return (
    <div>
      <div className="text-[12.5px] text-slate mb-3">
        {/* §12jjjjj — la vecchia riga "Volontari attivi: N" è stata
            spostata (arricchita del conteggio anagrafico e dei nomi
            in pausa oggi) nel blocco Sintesi Volontari sopra questo
            slider. Qui resta solo la capienza suggerita: è il numero
            che "consiglia" il valore da mettere allo slider. */}
        Capienza suggerita:{" "}
        <span className="font-mono">{capienzaSuggerita}</span>
        {" "}
        <span className="text-muted">
          ({volontariAttivi} di turno × 6 telefonate)
        </span>
      </div>

      {/* MOD07-microcopy 2f: contenitore `max-w-xs` (~320 px) invece
          del vecchio `w-full` (600 px sulla colonna 3fr del grid). Lo
          slider occupava troppo spazio orizzontale per il suo peso
          informativo (un solo intero); ridotto a ~half. Le labels
          sotto (soglia: prime N + chi ha impostato) ereditano la
          stessa larghezza per restare allineate ai bordi dello
          slider. Logica, valori e comportamento invariati. */}
      <div className="max-w-xs">
        <input
          type="range"
          min={min}
          max={max}
          step={1}
          value={valore}
          onChange={(e) => onCambia(Number(e.target.value))}
          className="w-full accent-ink"
          aria-label="Soglia del giorno"
        />

        <div className="flex justify-between items-baseline text-[13px] text-slate mt-1 gap-3">
          <span>
            soglia: prime <span className="font-mono">{valore}</span>
          </span>
          <span className="font-mono text-[11.5px] text-muted truncate">
            {chiHaImpostato}
          </span>
        </div>
      </div>
    </div>
  );
}
