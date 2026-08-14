"use client";

/**
 * Filtri per categoria dei punti freschi (§12aa + §12gg restyle).
 * 5 card-pill sopra la mappa: acqua, farmacie, parchi, luoghi al chiuso,
 * chiese. Corrispondenza col DB (colonne `tipo` e `categoria` di
 * `pubblico.punto_fresco`):
 *
 *   acqua       → categoria='acqua'         (fontanella + casetta_iren)
 *   farmacie    → tipo='farmacia'           (categoria='sosta_fresca')
 *   parchi      → tipo='parco'              (categoria='ombra_aperta')
 *   chiuso      → categoria='rifugio'       (biblioteca + centro_commerciale + centro_sociale)
 *   chiese      → tipo='chiesa'             (categoria='ripiego')
 *
 * §12gg: aspetto card-piccola con bordo e icona colorata a sinistra.
 * I colori delle icone coincidono con quelli dei pin sulla mappa
 * (`COLORE_CATEGORIA` in `mappa-pubblica.tsx`) — così i filtri fanno
 * anche da legenda: chi vede un pin blu-scuro in mappa capisce che è
 * un "luogo al chiuso" dallo stesso colore del filtro.
 *
 * Stato attivo: bordo 2px + sfondo tenue nel colore della categoria.
 * Con 5 card affiancate serve capire a colpo d'occhio quali sono
 * accese.
 *
 * Mobile: flex-wrap va a capo su più righe, non scroll orizzontale
 * (`flex-wrap` senza `overflow-x-auto`).
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import clsx from "clsx";

export type Categoria = "acqua" | "farmacie" | "parchi" | "chiuso" | "chiese";

type Icona = React.FC<{ className?: string; style?: React.CSSProperties }>;

const IconaAcqua: Icona = ({ className, style }) => (
  <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden
       fill="none" stroke="currentColor" strokeWidth="1.75"
       strokeLinecap="round" strokeLinejoin="round"
       className={className} style={style}>
    <path d="M12 2 C 12 2 6 10 6 15 A 6 6 0 0 0 18 15 C 18 10 12 2 12 2 z" />
  </svg>
);

const IconaFarmacia: Icona = ({ className, style }) => (
  <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden
       fill="none" stroke="currentColor" strokeWidth="1.75"
       strokeLinecap="round" strokeLinejoin="round"
       className={className} style={style}>
    {/* Croce medica */}
    <path d="M9 3h6v6h6v6h-6v6H9v-6H3V9h6z" />
  </svg>
);

const IconaAlbero: Icona = ({ className, style }) => (
  <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden
       fill="none" stroke="currentColor" strokeWidth="1.75"
       strokeLinecap="round" strokeLinejoin="round"
       className={className} style={style}>
    {/* Chioma triangolare stilizzata + tronco */}
    <path d="M12 2 L5 12 h4 L4 20 h16 l-5-8 h4 z" />
    <line x1="12" y1="20" x2="12" y2="22" />
  </svg>
);

const IconaFiocco: Icona = ({ className, style }) => (
  <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden
       fill="none" stroke="currentColor" strokeWidth="1.75"
       strokeLinecap="round" strokeLinejoin="round"
       className={className} style={style}>
    {/* Snowflake: 3 assi ruotati 60° con piccole punte */}
    <line x1="12" y1="2" x2="12" y2="22" />
    <line x1="4.2" y1="6.5" x2="19.8" y2="17.5" />
    <line x1="4.2" y1="17.5" x2="19.8" y2="6.5" />
    <path d="M12 6 l-1.5 -1.5 M12 6 l1.5 -1.5 M12 18 l-1.5 1.5 M12 18 l1.5 1.5" />
  </svg>
);

const IconaChiesa: Icona = ({ className, style }) => (
  <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden
       fill="none" stroke="currentColor" strokeWidth="1.75"
       strokeLinecap="round" strokeLinejoin="round"
       className={className} style={style}>
    {/* Chiesa stilizzata: croce sopra, tetto triangolare, corpo con porta */}
    <line x1="12" y1="2" x2="12" y2="6" />
    <line x1="10" y1="4" x2="14" y2="4" />
    <path d="M4 20 V11 L12 6 L20 11 V20 z" />
    <path d="M10 20 v-4 a2 2 0 0 1 4 0 v4" />
  </svg>
);

/**
 * Colore per categoria — allineato a `COLORE_CATEGORIA` in
 * `mappa-pubblica.tsx`. Serve sia per l'icona sia per bordo/sfondo
 * dello stato attivo. Se si cambia la palette dei pin sulla mappa,
 * cambia anche qui.
 */
const COLORE: Record<Categoria, string> = {
  acqua:    "#0284c7", // azzurro
  farmacie: "#059669", // verde
  parchi:   "#65a30d", // verde chartreuse
  chiuso:   "#1e3a8a", // blu scuro
  chiese:   "#78716c", // grigio
};

export const CATEGORIE: Array<{
  id: Categoria; label: string; sottotitolo: string; Icona: Icona;
}> = [
  // Sottotitoli (§12hh): distinzione sulla durata/tipo di sosta,
  // riusando le parole del vecchio blocco "Punti freschi" della
  // legenda (ora cancellato). I filtri fanno chiave visiva
  // (icona+colore) + informativa (durata) — sostituiscono la funzione
  // della legenda punti senza duplicare informazione. Le parole sono
  // quelle stesse, non ne inventiamo di nuove.
  { id: "acqua",    label: "Acqua",              sottotitolo: "acqua potabile",       Icona: IconaAcqua },
  { id: "farmacie", label: "Farmacie",           sottotitolo: "sosta breve",          Icona: IconaFarmacia },
  { id: "parchi",   label: "Parchi",             sottotitolo: "mattina e sera",       Icona: IconaAlbero },
  { id: "chiuso",   label: "Luoghi al chiuso",   sottotitolo: "ci si sta ore",        Icona: IconaFiocco },
  { id: "chiese",   label: "Chiese",             sottotitolo: "verifica gli orari",   Icona: IconaChiesa },
];

/**
 * Tipi OSM (colonna `tipo` di `pubblico.punto_fresco`) che appartengono
 * a ciascuna delle 5 categorie utente. Usato sia dal filtro MapLibre
 * (setFilter) sia dal filtro client dell'elenco.
 */
export const TIPI_PER_CATEGORIA: Record<Categoria, string[]> = {
  acqua:    ["fontanella", "casetta_iren"],
  farmacie: ["farmacia"],
  parchi:   ["parco"],
  chiuso:   ["biblioteca", "centro_commerciale", "centro_sociale"],
  chiese:   ["chiesa"],
};

/**
 * Unione dei tipi selezionati dai filtri attivi. Set vuoto in input =
 * ritorna null (semantica "nessun filtro, mostra tutto").
 */
export function tipiVisibili(filtri: Set<Categoria>): string[] | null {
  if (filtri.size === 0) return null;
  const tipi = new Set<string>();
  for (const c of filtri) {
    for (const t of TIPI_PER_CATEGORIA[c]) tipi.add(t);
  }
  return [...tipi];
}

interface Props {
  attivi: Set<Categoria>;
  onToggle: (c: Categoria) => void;
}

export function FiltriCategoria({ attivi, onToggle }: Props) {
  return (
    <div
      role="group"
      aria-label="Filtri per categoria dei punti freschi"
      // §12kk: layout differenziato per breakpoint.
      // - <640px (mobile): grid 2-col uniforme. Prima con
      //   `flex flex-wrap` le larghezze diverse (Acqua ~110px vs Luoghi
      //   al chiuso ~160px) rompevano la fila in modo irregolare.
      // - 640-1023px (tablet): flex-wrap left, naturale.
      // - >=1024px (desktop): flex-wrap centrato — su desktop la fila
      //   sta su una riga e centrare nella card mappa (max-w-6xl) la
      //   àncora visivamente al centro. NON applicato sotto lg perché
      //   con più righe il centraggio dell'ultima riga sotto righe
      //   piene crea uno scalino.
      className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap lg:justify-center"
    >
      {CATEGORIE.map(({ id, label, sottotitolo, Icona }) => {
        const on = attivi.has(id);
        const c = COLORE[id];
        return (
          <button
            key={id}
            type="button"
            aria-pressed={on}
            onClick={() => onToggle(id)}
            className={clsx(
              // §12kk: padding orizzontale ridotto sotto sm (`px-2`)
              // per fare stare titolo+sottotitolo dentro la cella
              // grid ~167px a 375px senza ridurre le due dimensioni
              // di testo (13px titolo, 11px sottotitolo, entrambe
              // sopra la soglia leggibile).
              "flex items-start gap-2 px-2 sm:px-3 py-2 rounded-btn transition-colors text-left",
              // Bordo/sfondo dinamici via inline style (colori non in
              // Tailwind config: gli hex della categoria sono definiti
              // in TS come COLORE_CATEGORIA lato mappa).
              on ? "border-2" : "border border-gray-400 bg-card hover:bg-foot/50",
            )}
            style={on ? {
              borderColor: c,
              // Sfondo tenue = hex + alpha ~12%. Usare colore-mix o
              // rgba esplicita richiederebbe conversione hex→rgb; il
              // modo più semplice è usare la stessa hex con opacity via
              // hex + 1F (= 12% alpha). MapLibre usa la stessa palette,
              // la coerenza è preservata.
              backgroundColor: `${c}1F`,
              // NIENTE `color` inline qui: sovrascriverebbe il
              // `text-slate` del sottotitolo (§12hh). I due livelli
              // di testo (titolo ink, sottotitolo slate) restano
              // gerarchicamente distinti anche sul background tenue.
            } : undefined}
          >
            <Icona className="shrink-0 mt-0.5" style={{ color: c }} />
            <span className="flex flex-col leading-tight">
              <span className="text-[13px] font-display font-semibold">{label}</span>
              <span className="text-[11px] font-normal text-slate mt-0.5">{sottotitolo}</span>
            </span>
          </button>
        );
      })}
      {attivi.size > 0 && (
        <button
          type="button"
          onClick={() => {
            for (const c of attivi) onToggle(c);
          }}
          // §12kk: `col-span-2` per occupare intera riga in modalità
          // grid (sotto sm); `sm:self-center` per allinearlo
          // verticalmente alle card nella modalità flex-wrap in su.
          className="px-3 py-2 text-[12.5px] text-slate underline hover:text-ink col-span-2 sm:col-span-1 sm:self-center"
        >
          Azzera filtri
        </button>
      )}
    </div>
  );
}
