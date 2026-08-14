// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Sezione "Perché dichiariamo la sottostima" della pagina
 * /[comune]/metodo. Registro delle sottostime del criterio
 * percentile rispetto al bollettino ufficiale di Bologna
 * (3 giorni su 70) e principio che le motiva: la promessa del
 * sistema è aiutare a decidere quando fa caldo davvero, sbagliare
 * per difetto lascia fuori qualcuno.
 *
 * Montata solo sul ramo `stima` (§12vv). Sul ramo bollettino non
 * c'è sottostima da dichiarare: il livello viene dal Ministero.
 */

export const TITOLO_PERCHE_SOTTOSTIMA = "Perché dichiariamo la sottostima";

export function MetodoPercheSottostima() {
  return (
    <>
      <p>
        Quando la nostra stima dice &laquo;livello 1&raquo; e il
        bollettino ufficiale dice &laquo;livello 2&raquo; siamo <b>più
        rilassati del reale</b>. È l&apos;errore che conta di più: la
        promessa di questo sistema è aiutare a decidere chi contattare
        quando fa caldo davvero, e sbagliare per difetto vuol dire
        lasciar fuori qualcuno che ne aveva bisogno.
      </p>
      <p>
        Per questo lo scriviamo qui, in chiaro: <b>3 giorni su 70</b>{" "}
        nel confronto con Bologna. Se lo tenessimo nascosto in fondo a
        una nota tecnica, dichiareremmo un metodo migliore di quello
        che è. Per lo stesso principio, quando la stima è <b>più cauta
        del bollettino</b> — cioè sovrastima — ci va bene: il costo di
        un giro di telefonate in più è basso, quello di uno in meno può
        essere alto.
      </p>
    </>
  );
}
