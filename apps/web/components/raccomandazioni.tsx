/**
 * Raccomandazioni per il cittadino. Base sempre presente a ogni livello
 * (anche 0): la pagina non dice mai che sei al sicuro. A partire dal
 * livello 2 (arancione, effetti sui suscettibili) si aggiungono due
 * raccomandazioni sui comportamenti diurni. Testi presi dal prototipo
 * (`web/prototipo.html`, riga 350-352); il testo non cambia — sono
 * raccomandazioni sanitarie.
 *
 * §12ff: tipografia a due livelli per ogni raccomandazione (titolo
 * grassetto + dettaglio grigio piccolo), separatori sottili fra le
 * voci, icone più grandi in colore d'accento (lv2 arancione).
 * `h-full flex flex-col` per stretching verticale nel grid affiancato
 * col Selettore. Testo INVARIATO — spezzato per virgola o parola
 * pivot mantenendo tutte le parole originali; nessun nuovo contenuto.
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import type { Livello } from "@/lib/livelli";

type Icona = React.FC<{ className?: string }>;

interface Raccomandazione {
  /** Grassetto — azione breve o soggetto. */
  titolo: string;
  /** Grigio piccolo — condizione, tempo, dettaglio. */
  dettaglio: string;
  Icona: Icona;
}

const IconaAcqua: Icona = ({ className }) => (
  <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden
       fill="none" stroke="currentColor" strokeWidth="1.75"
       strokeLinecap="round" strokeLinejoin="round" className={className}>
    <path d="M12 2 C 12 2 6 10 6 15 A 6 6 0 0 0 18 15 C 18 10 12 2 12 2 z" />
  </svg>
);

const IconaPersiane: Icona = ({ className }) => (
  <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden
       fill="none" stroke="currentColor" strokeWidth="1.75"
       strokeLinecap="round" strokeLinejoin="round" className={className}>
    <rect x="3.5" y="4" width="17" height="16" rx="1" />
    <line x1="3.5" y1="8.5" x2="20.5" y2="8.5" />
    <line x1="3.5" y1="12" x2="20.5" y2="12" />
    <line x1="3.5" y1="15.5" x2="20.5" y2="15.5" />
  </svg>
);

const IconaTelefono: Icona = ({ className }) => (
  <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden
       fill="none" stroke="currentColor" strokeWidth="1.75"
       strokeLinecap="round" strokeLinejoin="round" className={className}>
    <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
  </svg>
);

const IconaOrologio: Icona = ({ className }) => (
  <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden
       fill="none" stroke="currentColor" strokeWidth="1.75"
       strokeLinecap="round" strokeLinejoin="round" className={className}>
    <circle cx="12" cy="12" r="9" />
    <polyline points="12 7 12 12 15.5 14" />
  </svg>
);

const IconaVentilatore: Icona = ({ className }) => (
  <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden
       fill="none" stroke="currentColor" strokeWidth="1.75"
       strokeLinecap="round" strokeLinejoin="round" className={className}>
    <path d="M10.83 16.38a6.08 6.08 0 0 1-8.62-7l5.41 1.45a6.08 6.08 0 0 1 7-8.62l-1.45 5.41a6.08 6.08 0 0 1 8.62 7l-5.41-1.45a6.08 6.08 0 0 1-7 8.62l1.45-5.41" />
    <circle cx="12" cy="12" r="1.5" />
  </svg>
);

// Testi spezzati per virgola/pivot. Grassetto = azione o soggetto;
// dettaglio = condizione/tempo. Concatenandoli si ottiene la frase
// originale del prototipo — nessuna parola aggiunta o tolta.
//   "Bevi acqua"                    +  ", a temperatura ambiente, anche senza sete."
//   "Tieni le persiane chiuse"      +  ", nelle ore centrali."
//   "Chiama un vicino o un parente" +  ", una volta al giorno."
//   "Evita di uscire"               +  ", tra le 11 e le 18."
//   "Se hai un ventilatore"         +  ", non puntarlo direttamente addosso."
const BASE: Raccomandazione[] = [
  { titolo: "Bevi acqua",
    dettaglio: "a temperatura ambiente, anche senza sete.",
    Icona: IconaAcqua },
  { titolo: "Tieni le persiane chiuse",
    dettaglio: "nelle ore centrali.",
    Icona: IconaPersiane },
  { titolo: "Chiama un vicino o un parente",
    dettaglio: "una volta al giorno.",
    Icona: IconaTelefono },
];

const EXTRA_LV2: Raccomandazione[] = [
  { titolo: "Evita di uscire",
    dettaglio: "tra le 11 e le 18.",
    Icona: IconaOrologio },
  { titolo: "Se hai un ventilatore",
    dettaglio: "non puntarlo direttamente addosso.",
    Icona: IconaVentilatore },
];

interface Props {
  livello: Livello | null;
}

export function Raccomandazioni({ livello }: Props) {
  const lv = livello ?? 0;
  const raccomandazioni = lv >= 2 ? [...BASE, ...EXTRA_LV2] : BASE;

  return (
    <div className="border border-gray-400 rounded-card bg-card h-full flex flex-col">
      <div className="px-5 pt-5 pb-3">
        <div className="font-display font-semibold text-[11.5px] tracking-label uppercase text-muted">
          Cosa conviene fare oggi
        </div>
      </div>
      <ul className="list-none flex-1 divide-y divide-rule">
        {raccomandazioni.map(({ titolo, dettaglio, Icona }, i) => (
          <li key={i} className="flex items-start gap-4 px-5 py-3">
            <Icona className="text-lv2 shrink-0 mt-0.5" />
            <div className="min-w-0 flex-1">
              <div className="text-[14.5px] font-semibold text-ink leading-snug">
                {titolo}
              </div>
              <div className="text-[13px] text-slate mt-0.5 leading-normal">
                {dettaglio}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
