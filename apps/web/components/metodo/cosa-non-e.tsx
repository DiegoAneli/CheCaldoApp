// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Sezione "Cosa questo metodo NON è" della pagina /[comune]/metodo.
 * Contenuto indipendente dal comune — spiega perché le soglie
 * 85/95/98 sono scelta statistica non calibrata su dati sanitari,
 * contrapposte alle soglie epidemiologiche del bollettino ministeriale.
 *
 * Montata solo sul ramo `stima` (§12vv): dice cosa la stima NON è,
 * quindi ha senso solo dove è la stima ad essere in gioco. Sul ramo
 * bollettino l'informazione è già nella sezione "Come funziona il
 * bollettino ministeriale" per il verso opposto (le soglie
 * ministeriali sono calibrate epidemiologicamente).
 */

export const TITOLO_COSA_NON_E = "Cosa questo metodo NON è";

export function MetodoCosaNonE() {
  return (
    <>
      <p>
        Le soglie <b>85 / 95 / 98</b> sono una <b>scelta statistica</b>:
        descrivono &laquo;giorni statisticamente molto sopra la media
        locale del periodo&raquo;. Non sono state <b>calibrate su dati
        sanitari</b> — cioè non sono state ricavate confrontando
        temperature e ricoveri, accessi al pronto soccorso, decessi.
      </p>
      <p>
        Le soglie del bollettino ministeriale, per le 27 città che
        copre, invece <b>lo sono</b>: derivano da vent&apos;anni di
        studi epidemiologici che collegano temperatura ed effetti sulla
        salute. È una differenza importante, e la scriviamo per prima:
        il livello che leggi qui è un&apos;<b>indicazione utile ma non
        equivalente al bollettino ufficiale</b>, e ogni volta che lo
        mostriamo lo dichiariamo (&laquo;livello stimato, non
        ufficiale&raquo;).
      </p>
    </>
  );
}
