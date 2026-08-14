// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Sezione "Come funziona il bollettino ministeriale" della pagina
 * /[comune]/metodo, montata SOLO sul ramo `bollettino` (§12vv).
 * Sostituisce il vecchio banner in cima alla pagina (che era il
 * solo pezzo comune-specifico su ramo bollettino) e le 5 sezioni
 * della stima (che parlavano del metodo di stima, non pertinente
 * al comune del bollettino).
 *
 * Contenuto dai documenti verificati:
 *   - CHECALDO-PROGETTO.md §1-§3 e §12x (poller);
 *   - README.md § "Chi c'è dentro il bollettino ministeriale";
 *   - vecchio banner del file `[comune]/metodo/page.tsx` (righe
 *     52-99 prima del refactor).
 *
 * Ordine dei 6 paragrafi (§12vv, revisione utente):
 *   1. Chi lo pubblica, chi copre.
 *   2. Calibratura sanitaria delle soglie.
 *   3. Cadenza e orizzonti.
 *   4. Fallback quando il bollettino non arriva — spostato subito
 *      dopo la cadenza perché è il punto che rende onesta la
 *      sezione (dice che anche su un comune del bollettino può
 *      comparire un livello non ministeriale).
 *   5. Fonte tecnica (onData su GitHub).
 *   6. Nota comune-specifica opzionale (ARPA-ER per Bologna),
 *      arriva come prop `notaComune` da lib/comuni-metodo.tsx.
 *   Riga finale: rimando a /parma/metodo per chi vuole vedere il
 *   metodo di stima. Ridotto a una riga (revisione utente):
 *   il disclaimer sulle percentuali del backtest non ha senso qui
 *   perché quelle percentuali il lettore non le vede più.
 */

import Link from "next/link";
import type { ReactNode } from "react";

interface Props {
  nomeComune: string;
  /** Nota metodologica specifica del comune (es. ARPA-ER per Bologna). */
  notaComune?: ReactNode;
}

export const TITOLO_COME_FUNZIONA_IL_BOLLETTINO =
  "Come funziona il bollettino ministeriale";

export function MetodoComeFunzionaIlBollettino({
  nomeComune,
  notaComune,
}: Props) {
  return (
    <>
      {/* 1. Chi lo pubblica, chi copre. */}
      <p>
        {nomeComune} è tra le <b>27 città italiane</b> — capoluoghi di
        regione e comuni sopra 200.000 abitanti — per le quali il{" "}
        <b>Ministero della Salute</b> pubblica ogni giorno un
        bollettino di allerta ondate di calore. Il livello che vedi
        nella pagina pubblica di {nomeComune} è quello ministeriale:{" "}
        <b>non lo stimiamo noi</b>.
      </p>

      {/* 2. Calibratura sanitaria. */}
      <p>
        Le soglie del bollettino sono calibrate sulla <b>mortalità
        storica di ciascuna città</b>: vent&apos;anni di dati
        epidemiologici che collegano temperatura, ricoveri e decessi.
        È la differenza che fa di questo un <b>bollettino sanitario</b>,
        non una lettura statistica del meteo.
      </p>

      {/* 3. Cadenza e orizzonti. Fonte primaria per lun-ven / ore 11 /
          orizzonti 24-48-72:
            https://www.salute.gov.it/new/it/tema/ondate-di-calore/
          Finestra annuale 2026 (25 maggio - 20 settembre) sulla pagina
          bollettini del Ministero:
            https://www.salute.gov.it/new/it/tema/ondate-di-calore/
            bollettini-sulle-ondate-di-calore-0/
          Verificato 2026-08-07. La finestra cambia ogni anno — nel
          testo cittadino sotto teniamo "da maggio a settembre" (formula
          divulgativa usata anche dal Ministero), l'anno specifico è
          citato come esempio in corsivo. */}
      <p>
        Il bollettino esce <b>dal lunedì al venerdì dalle ore 11</b>,
        per tre orizzonti: <b>il giorno stesso, domani e dopodomani</b>.
        Il bollettino di venerdì copre il weekend con gli orizzonti a
        48 e 72 ore. È pubblicato <b>da maggio a settembre</b> (nel
        2026 la finestra dichiarata dal{" "}
        <a
          href="https://www.salute.gov.it/new/it/tema/ondate-di-calore/bollettini-sulle-ondate-di-calore-0/"
          className="underline hover:text-slate"
          target="_blank"
          rel="noopener noreferrer"
        >
          Ministero
        </a>
        {" "}è dal 25 maggio al 20 settembre; le date esatte cambiano
        ogni anno).
      </p>

      {/* 4. Fallback quando il bollettino non c'è — spostato subito
          dopo la cadenza (§12vv): è il punto che rende onesta la
          sezione. Anche su un comune del bollettino può comparire un
          livello non ministeriale, e il badge lo dichiara.
          §12iiiiii: riformulato per dare il PERCHÉ (il bollettino
          non esce tutti i giorni) prima del COSA (ripiego a stima).
          Chiusa cambiata da "la fonte cambia solo dopo averlo
          detto" (oracolare) a "la fonte non cambia mai in silenzio"
          (piana). §12jjjjjj: rimosso "un weekend" dalla lista dei
          giorni scoperti — il weekend è coperto dal bollettino di
          venerdì con orizzonti 48/72h (paragrafo precedente).
          Rimangono i due casi in cui il fallback scatta davvero:
          mancata pubblicazione lun-ven, e fuori stagione. */}
      <p>
        Il bollettino non esce tutti i giorni: solo{" "}
        <b>dal lunedì al venerdì</b>, e solo nella stagione di
        pubblicazione. Nei giorni scoperti — una mancata pubblicazione,
        i mesi fuori stagione — {nomeComune} resterebbe senza livello.
        Per questo il sistema ripiega sulla <b>stima statistica</b>,
        la stessa che usa per i comuni fuori dalle 27 città.
      </p>
      <p>
        Quando succede, il badge lo dice: da{" "}
        <b>&laquo;bollettino del Ministero&raquo;</b> diventa{" "}
        <b>&laquo;livello stimato · non ufficiale&raquo;</b>. La
        fonte non cambia mai in silenzio.
      </p>

      {/* 5. Fonte tecnica. */}
      <p>
        Il file sorgente è pubblicato in formato aperto dal collettivo
        civico{" "}
        <a
          href="https://github.com/ondata/ondate-calore"
          className="underline hover:text-slate"
          target="_blank"
          rel="noopener noreferrer"
        >
          onData
        </a>
        {" "}su GitHub. Il nostro cron lo scarica e lo legge ogni giorno.
      </p>

      {/* 6. Nota comune-specifica (ARPA-ER per Bologna). Arriva come
          prop da lib/comuni-metodo.tsx: se il comune non ha nota
          specifica non compare nulla. */}
      {notaComune && <p className="text-slate text-[13.5px]">{notaComune}</p>}

      {/* Rimando a /parma/metodo. Ridotto a una riga (§12vv,
          revisione utente): il disclaimer originale sulle percentuali
          del backtest è stato tolto perché quelle percentuali qui non
          si vedono più — le sezioni della stima non sono montate. */}
      <p>
        Il metodo di stima, usato dove il bollettino non arriva, è
        documentato in{" "}
        <Link href="/parma/metodo" className="underline hover:text-ink">
          /parma/metodo
        </Link>
        .
      </p>
    </>
  );
}
