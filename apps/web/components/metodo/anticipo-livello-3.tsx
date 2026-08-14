// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Sezione "Quando il livello sale a 3, ce ne accorgiamo prima?" della
 * pagina /[comune]/metodo. Osservazione qualitativa sull'anticipo
 * del criterio percentile rispetto al bollettino di Bologna nei due
 * casi di transizione a livello 3 dell'estate 2025.
 *
 * Montata solo sul ramo `stima` (§12vv). Sul ramo bollettino il
 * livello arriva dal Ministero — l'anticipo del criterio interno
 * non è pertinente.
 *
 * Testo scritto con cautela (§12ll fine sessione): "due casi non
 * fanno una misura statistica", avvertenza sull'assunzione della
 * previsione meteo perfetta.
 */

export const TITOLO_ANTICIPO_LIVELLO_3 =
  "Quando il livello sale a 3, ce ne accorgiamo prima?";

export function MetodoAnticipoLivello3() {
  return (
    <>
      <p>
        Le percentuali qui sopra dicono &laquo;quanto ricalchiamo il
        bollettino&raquo;. Ma la domanda vera per un&apos;organizzazione
        che gestisce una lista di persone da chiamare è un&apos;altra:{" "}
        <b>quando la situazione si fa seria, ce ne accorgiamo prima?</b>{" "}
        Un pomeriggio di anticipo permette di chiamare più volontari.
      </p>
      <p className="mt-3">
        Nell&apos;estate 2025 il bollettino di Bologna è salito a{" "}
        <b>livello 3</b> due volte — il <b>26 giugno</b> e l&apos;<b>11
        agosto</b>. In entrambi i casi il nostro criterio, applicato
        ai dati del giorno, ci era già arrivato.
      </p>
      <p className="mt-3 text-slate">
        Due casi in una stagione non fanno una misura statistica:
        serve almeno un&apos;altra estate, o due o tre città con climi
        diversi, per dire qualcosa di solido sull&apos;anticipo del
        criterio. E vale la stessa avvertenza di sopra — la misura
        usa la temperatura osservata del giorno, come se la
        previsione meteo di due giorni prima fosse stata perfetta;
        l&apos;anticipo reale in produzione è più basso.
      </p>
    </>
  );
}
