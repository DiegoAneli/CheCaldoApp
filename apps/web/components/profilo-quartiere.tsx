/**
 * Profilo del quartiere per la pagina pubblica.
 *
 * Aggregazioni per sezione secondo §12e (MOD05):
 * - persone_per_famiglia: SUM(pop)/SUM(fam), rapporto degli aggregati
 * - abitazioni_per_edificio: SUM(abi)/SUM(edi), rapporto degli aggregati
 * - distanza dal parco: SUM(dist*pop)/SUM(pop), media pesata sulla
 *   popolazione (per la persona media del quartiere, non per la sezione
 *   mediana)
 * - posizione isolamento: rango del quartiere fra i 13, sul valore
 *   aggregato di persone_per_famiglia (più basso = più famiglie sole)
 *
 * Microcopy: dice il fatto, non la classifica. La distanza dal parco è
 * mostrata sempre come dato ma con nota di contesto — dopo l'analisi
 * MOD01 (§12c) quel numero descrive rischio solo dove non c'è verde
 * privato.
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import type { ProfiloQuartiere as ProfiloQuartiereDati } from "@checaldo/db";
import { IntestazioneQuartiere } from "@/components/intestazione-quartiere";

interface Props {
  profilo: ProfiloQuartiereDati;
  /** Nome del comune per il microcopy dell'isolamento ("...a Bologna"). */
  nomeComune: string;
}

export function ProfiloQuartiere({ profilo, nomeComune }: Props) {
  const { nome, sezioniAbitate, popolazione, famiglie,
          personePerFamiglia, abitazioniPerEdificio,
          distanzaParcoMediaPesata, posizioneIsolamento, totaleQuartieri } = profilo;

  return (
    <div className="border border-gray-400 rounded-card bg-card">
      <IntestazioneQuartiere
        sopratitolo="Il quartiere"
        nome={nome}
        meta={
          <>
            {sezioniAbitate} {sezioniAbitate === 1 ? "sezione" : "sezioni"} ·{" "}
            {formatoIt(popolazione)} {popolazione === 1 ? "abitante" : "abitanti"} ·{" "}
            {formatoIt(famiglie)} {famiglie === 1 ? "famiglia" : "famiglie"}
          </>
        }
      />

      <dl className="divide-y divide-rule">
        <RigaFatto
          etichetta="Persone per famiglia"
          valore={personePerFamiglia.toFixed(2).replace(".", ",")}
        >
          {microcopyIsolamento(nome, posizioneIsolamento, totaleQuartieri, nomeComune)}
        </RigaFatto>

        <RigaFatto
          etichetta="Abitazioni per edificio"
          valore={abitazioniPerEdificio.toFixed(2).replace(".", ",")}
        >
          Rapporto degli aggregati sulle {sezioniAbitate}{" "}
          {sezioniAbitate === 1 ? "sezione residenziale abitata" : "sezioni residenziali abitate"}.
          Numeri più alti indicano edifici più densi (palazzine invece di
          case singole).
        </RigaFatto>

        <RigaFatto
          etichetta="Distanza dal parco più vicino"
          valore={
            distanzaParcoMediaPesata === null
              ? "n.d."
              : `${formatoIt(Math.round(distanzaParcoMediaPesata))} m`
          }
        >
          Media pesata sulla popolazione delle sezioni. Questo numero conta
          soprattutto in zone dense: dove ci sono giardini privati o case
          basse, la distanza dal parco descrive meno del rischio caloroso.
        </RigaFatto>
      </dl>

      <div className="px-5 pt-3 pb-3 text-[12px] text-muted leading-normal max-w-prose border-t border-rule">
        Questi numeri descrivono il quartiere, non chi ci vive. Servono a
        capire dove il rischio del caldo è più concentrato in città, non a
        dire come sta una singola persona.
      </div>

      <div className="px-5 py-3 bg-foot text-[11.5px] text-muted">
        Dati ISTAT — Basi territoriali 2021, comune 034027. Distanze
        calcolate su OpenStreetMap. Vedi{" "}
        <a href="/metodo" className="underline hover:text-slate">metodo</a>.
      </div>
    </div>
  );
}

function RigaFatto({
  etichetta,
  valore,
  children,
}: {
  etichetta: string;
  valore: string;
  children: React.ReactNode;
}) {
  return (
    <div className="px-5 py-3">
      <div className="flex items-baseline justify-between gap-4">
        <dt className="text-[13px] text-slate">{etichetta}</dt>
        <dd className="font-display font-semibold text-[16px] font-mono tabular-nums">
          {valore}
        </dd>
      </div>
      <div className="text-[12px] text-muted mt-1 leading-normal max-w-prose">
        {children}
      </div>
    </div>
  );
}

/**
 * Microcopy per la posizione di isolamento: il fatto nel verso giusto,
 * non la classifica in astratto. Vedi MOD05 discussione microcopy.
 */
function microcopyIsolamento(nome: string, pos: number, tot: number, nomeComune: string): string {
  if (pos === 1) {
    return `${nome} è il quartiere con più famiglie di una persona sola a ${nomeComune} (1° su ${tot}).`;
  }
  if (pos === tot) {
    return `${nome} è il quartiere con meno famiglie di una persona sola a ${nomeComune} (${pos}° su ${tot}).`;
  }
  return `${nome} è il ${pos}° su ${tot} per famiglie di una persona sola a ${nomeComune}.`;
}

function formatoIt(n: number): string {
  // Intl.NumberFormat("it-IT") non funziona nel container Node senza
  // full-icu: cade su formato ASCII senza separatore migliaia (1461
  // invece di 1.461). Formatter manuale: punto ogni tre cifre.
  const s = String(Math.abs(Math.round(n)));
  const con_punti = s.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return n < 0 ? "-" + con_punti : con_punti;
}
