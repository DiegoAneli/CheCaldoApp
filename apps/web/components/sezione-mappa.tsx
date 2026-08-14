"use client";

/**
 * Container client che orchestra la sezione mappa della pagina pubblica.
 * Stato dei filtri locale al componente; sia la mappa (via prop
 * `filtri`) sia l'elenco (via prop `filtri`) reagiscono allo stesso
 * Set — punti visualizzati in mappa e nell'elenco restano coerenti.
 *
 * §12gg: card unificata che contiene titolo, filtri, mappa e legenda.
 * Prima erano quattro elementi separati (filtri floating, mappa con
 * bordo proprio, legenda sotto, ecc.). Ora un solo bordo attorno a
 * tutto, per corrispondenza col mockup: "Trova servizi vicino a te" +
 * fila filtri + mappa + legenda dentro un contenitore bianco unico.
 * L'Avviso 112 e l'ElencoPuntiVicini restano card separate SOTTO,
 * come pezzi autonomi.
 *
 * §12aa/§12gg: la mappa non è più bounded a `lg:max-w-4xl`. Il
 * container esterno (page.tsx `max-w-6xl` → row 2 dei riquadri = 1088
 * di larghezza totale) è ora anche la larghezza della card mappa,
 * per matchare visivamente row 2. **Attenzione minZoom** (§12aa):
 * `metadatiCartografici` calcola su viewport 734×600 hardcoded. Su
 * Parma il vincolo è verticale (zV≈11.29 < zH≈12.07), quindi il
 * minZoom non cambia allargando; ma la viewport ha più larghezza
 * rispetto al comune → margini vuoti ~200px per lato. Su Bologna
 * il vincolo può essere orizzontale (spanLng > spanLat corretto),
 * in quel caso allargando la viewport zH si riduce ma zV no →
 * mappa aperta con margini verticali. In entrambi i casi la mappa
 * funziona, l'estetica ha margini attorno al comune. Fix vero:
 * parametrizzare VIEWPORT_W in `metadatiCartografici` (sessione a
 * sé, va verificato in browser per entrambe le città).
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { useState } from "react";
import type { PuntoFrescoConCoord } from "@checaldo/db";
import { MappaPubblica } from "@/components/mappa-pubblica";
import { LegendaMappa } from "@/components/legenda-mappa";
import { ElencoPuntiVicini } from "@/components/elenco-punti-vicini";
import {
  FiltriCategoria,
  type Categoria,
} from "@/components/filtri-categoria";

interface Props {
  nomeComune: string;
  slugComune: string;
  centro: [number, number];
  boundsComune: [[number, number], [number, number]];
  minZoom: number;
  attribuzioniExtra?: string[];
  fitBoundsQuartiere: [[number, number], [number, number]] | null;
  quartiereEvidenziato: string | null;
  /**
   * Lista completa dei punti da mostrare nell'elenco sotto la mappa.
   * Top-N (default 20) già ordinati per distanza dal contesto rilevante.
   * Il client filtra localmente e taglia a `nMax` (default 8) dopo il
   * filtro. Se vuoto o assente, l'elenco non compare.
   */
  puntiElenco: PuntoFrescoConCoord[];
  modoElenco: "coordinate" | "quartiere";
  latUtente?: number;
  lonUtente?: number;
  nomeQuartiere?: string;
  /**
   * Slot React opzionale renderizzato fra l'elenco punti e la card
   * mappa. Usato oggi per far entrare "Dove andare adesso"
   * (`ConsiglioLocale`) a piena larghezza fra i due, con lo stato
   * filtri che resta co-localizzato con i suoi consumer.
   */
  slotSopraCardMappa?: React.ReactNode;
  /**
   * Slot React opzionale renderizzato subito sotto la card mappa.
   * Usato oggi per l'Avviso 112.
   */
  slotSottoMappa?: React.ReactNode;
}

export function SezioneMappa({
  nomeComune, slugComune, centro, boundsComune, minZoom,
  attribuzioniExtra, fitBoundsQuartiere, quartiereEvidenziato,
  puntiElenco, modoElenco, latUtente, lonUtente, nomeQuartiere,
  slotSopraCardMappa, slotSottoMappa,
}: Props) {
  const [filtri, setFiltri] = useState<Set<Categoria>>(new Set());

  function toggle(c: Categoria) {
    setFiltri((prev) => {
      const next = new Set(prev);
      if (next.has(c)) next.delete(c);
      else next.add(c);
      return next;
    });
  }

  return (
    // `space-y-5` fra i figli renderizzati: null/undefined non generano
    // nodi DOM, quindi lo slot vuoto non lascia spazio fantasma.
    <div className="space-y-5">
      {/* Elenco punti in cima: sale dal fondo per rispondere prima alla
          domanda "cosa c'è vicino" senza far scorrere fino alla mappa.
          Lo stato filtri (locale a questo client component) resta
          condiviso col FiltriCategoria dentro la card mappa qui sotto. */}
      {puntiElenco.length > 0 && (
        <ElencoPuntiVicini
          punti={puntiElenco}
          filtri={filtri}
          modo={modoElenco}
          lat={latUtente}
          lon={lonUtente}
          nomeQuartiere={nomeQuartiere}
        />
      )}

      {slotSopraCardMappa}

      {/* Card unificata "Trova servizi vicino a te": titolo, filtri,
          mappa, legenda in un unico contenitore bianco (§12gg). */}
      <div className="border border-gray-400 rounded-card bg-card overflow-hidden">
        <div className="px-5 pt-5 pb-3">
          <h2 className="font-display font-bold text-[18px] text-ink text-center">
            Trova servizi vicino a te
          </h2>
        </div>
        <div className="px-5 pb-4">
          <FiltriCategoria attivi={filtri} onToggle={toggle} />
        </div>
        <MappaPubblica
          nomeComune={nomeComune}
          slugComune={slugComune}
          centro={centro}
          boundsComune={boundsComune}
          minZoom={minZoom}
          attribuzioniExtra={attribuzioniExtra}
          fitBoundsQuartiere={fitBoundsQuartiere}
          quartiereEvidenziato={quartiereEvidenziato}
          filtri={filtri}
        />
        <div className="px-5 pt-4 pb-5">
          <LegendaMappa nomeComune={nomeComune} />
        </div>
      </div>

      {slotSottoMappa}
    </div>
  );
}
