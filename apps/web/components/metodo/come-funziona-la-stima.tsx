// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Sezione "Come funziona la stima, passo per passo" della pagina
 * /[comune]/metodo. Contenuto INDIPENDENTE dal comune — descrive il
 * metodo di stima applicato ai comuni fuori dalle 27 città del
 * bollettino ministeriale.
 *
 * Montata solo sul ramo `stima`. Su ramo `bollettino` (§12vv) è
 * sostituita dalla sezione "Come funziona il bollettino ministeriale":
 * il metodo di stima non si applica al livello di quel comune.
 *
 * Il wrapper <Sezione> resta a carico di page.tsx: il componente
 * esporta contenuto + costante `TITOLO`.
 */

import Link from "next/link";

export const TITOLO_COME_FUNZIONA_LA_STIMA =
  "Come funziona la stima, passo per passo";

export function MetodoComeFunzionaLaStima() {
  return (
    <>
      <p>
        Il calcolo usa un solo dato di ingresso, e lo confronta con la
        storia meteorologica del luogo:
      </p>
      <ol className="list-decimal pl-5 space-y-2">
        <li>
          <b>Temperatura apparente</b>. Non la temperatura del
          termometro, ma quella che il corpo sente davvero — che tiene
          conto di umidità e vento. Il valore massimo della giornata
          viene preso da{" "}
          <Link
            className="underline"
            href="https://open-meteo.com/"
            target="_blank"
            rel="noreferrer"
          >
            Open-Meteo
          </Link>
          , un servizio meteo aperto e senza costi.
        </li>
        <li>
          <b>Confronto con la storia di questo periodo</b>. Per capire
          se oggi è caldo &laquo;normale&raquo; o &laquo;molto sopra la
          media&raquo;, prendiamo tutte le temperature apparenti degli
          <b> ultimi 12 anni</b> nella <b>stessa finestra di
          calendario</b> (dieci giorni prima e dieci giorni dopo la
          data di oggi). Sono circa 250 valori: la nostra
          &laquo;climatologia locale&raquo;.
        </li>
        <li>
          <b>Percentile</b>. Il valore di oggi viene collocato in questa
          distribuzione storica. Se supera l&apos;<b>85° percentile</b>{" "}
          (più caldo dell&apos;85% dei giorni storici comparabili), il
          livello passa a <b>1</b>. Sopra il <b>95°</b>: livello <b>2</b>.
          Sopra il <b>98°</b>: livello <b>3</b>.
        </li>
        <li>
          <b>Notti tropicali</b>. In parallelo contiamo le notti
          consecutive con temperatura minima sopra i 20°C — il corpo
          non si raffredda mai davvero. Compaiono accanto al livello.
        </li>
      </ol>
    </>
  );
}
