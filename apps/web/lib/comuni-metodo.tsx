// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Attributi per-comune usati SOLO nella pagina /[comune]/metodo:
 *   - fonti dei dati specifiche del comune (casette Iren per Parma,
 *     open data comunale per Bologna) da elencare in "Fonti dei dati";
 *   - nota metodologica specifica mostrata nella sezione "Come
 *     funziona il bollettino ministeriale" (solo comuni sul ramo
 *     bollettino — es. Bologna che rimanda ad ARPA-ER).
 *
 * File separato da `lib/comuni.ts` per due motivi:
 *   1) contiene JSX (ReactNode), `comuni.ts` è data pura importata
 *      da tanti punti del codice — evita di trasformarlo in .tsx e
 *      di trascinare React nei consumer che non lo hanno mai visto;
 *   2) questi attributi servono a un solo consumatore (/metodo):
 *      isolarli qui rende esplicito lo scope.
 *
 * **Aggiungere un comune** = aggiungere una riga a `COMUNI` in
 * `lib/comuni.ts` E una entry a `ATTRIBUTI_METODO_PER_COMUNE` qui
 * sotto (opzionale: se un comune non ha attributi specifici, non
 * serve la entry). La correzione di §12vv al bug ARPA-ER e
 * all'elenco fonti mescolato è nata dall'aver messo condizionali
 * `slugComune === "..."` sparsi nel JSX di page.tsx: qui i valori
 * stanno vicini all'attributo del comune, non lontani dentro una
 * pagina da 500 righe.
 */

import type { ReactNode } from "react";

export interface FonteSpecificaComune {
  /** Titolo bold della voce, es. "Casette dell'acqua Iren". */
  titolo: string;
  /** Descrizione della voce dopo i due punti: testo con eventuali link. */
  descrizione: ReactNode;
}

export interface AttributiMetodo {
  /**
   * Nota metodologica specifica del comune, mostrata nella sezione
   * "Come funziona il bollettino ministeriale". Solo comuni sul ramo
   * bollettino la avranno; per gli altri resta undefined.
   */
  notaMetodoBollettino?: ReactNode;
  /**
   * Voci in "Fonti dei dati" specifiche del comune, in aggiunta a
   * quelle comuni (ISTAT, Open-Meteo, onData, OSM).
   */
  fontiSpecifiche?: FonteSpecificaComune[];
  /**
   * Etichetta della fonte dei punti freschi usata nel bullet di
   * `MetodoDoveLLM`, es. "OpenStreetMap + Iren" per Parma dove il
   * gestore idrico contribuisce le casette dell'acqua. Se assente,
   * `MetodoDoveLLM` cade sul default "OpenStreetMap" (§12ww: prima
   * era hardcoded "OpenStreetMap + Iren" nel testo condiviso,
   * mostrato anche su Bologna dove Iren non è pertinente).
   */
  fontiPuntiFreschi?: string;
}

/**
 * Lookup per slug del comune. Se lo slug non è presente, la pagina
 * mostra solo il contenuto comune — è compatibile con un nuovo
 * comune che non ha ancora attributi specifici.
 */
export const ATTRIBUTI_METODO_PER_COMUNE: Record<string, AttributiMetodo> = {
  parma: {
    fontiPuntiFreschi: "OpenStreetMap + Iren",
    fontiSpecifiche: [
      {
        titolo: "Casette dell'acqua Iren",
        descrizione: (
          <>
            elenco pubblicato dal{" "}
            <a
              className="underline hover:text-slate"
              href="https://www.comune.parma.it/"
              target="_blank"
              rel="noreferrer"
            >
              Comune di Parma
            </a>
            . Erogazione gratuita.
          </>
        ),
      },
    ],
  },

  bologna: {
    // Nota ARPA rimossa: la frase "il Ministero, come per Torino,
    // rimanda al bollettino locale di ARPA Emilia-Romagna" non era
    // sostenuta da nessuna fonte citata nel repo (grep 2026-08-13).
    // È un'affermazione su cosa fa il Ministero di terzi: senza un
    // link a documento ministeriale che lo dichiari, non possiamo
    // sostenerla in pagina. Se un giorno la verifichiamo alla fonte,
    // si rimette qui come `notaMetodoBollettino`.
    fontiPuntiFreschi: "OpenStreetMap + Comune di Bologna (biblioteche)",
    fontiSpecifiche: [
      {
        titolo: "Biblioteche comunali e aree statistiche di Bologna",
        descrizione: (
          <>
            portale open data del{" "}
            <a
              className="underline hover:text-slate"
              href="https://opendata.comune.bologna.it/"
              target="_blank"
              rel="noreferrer"
            >
              Comune di Bologna
            </a>
            {" "}(licenza CC-BY 4.0).
          </>
        ),
      },
    ],
  },
};

/** Helper: attributi del comune per slug, oggetto vuoto se non presente. */
export function attributiMetodo(slug: string): AttributiMetodo {
  return ATTRIBUTI_METODO_PER_COMUNE[slug] ?? {};
}
