// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Sezione "Dove il progetto usa un modello di linguaggio e dove no"
 * della pagina /[comune]/metodo. Struttura identica sui due rami
 * (stima e bollettino) — l'architettura dei componenti che
 * usano/non usano modello non dipende da come il livello arriva —
 * ma con due parametrizzazioni che ora vengono dall'esterno:
 *
 *   - `descrizioneLivelloAllerta` (§12xx, riformulata da §12ww): il
 *     bullet "il livello di allerta" spiega da dove arriva. La
 *     versione precedente diceva "viene dal Ministero della Salute
 *     (se {nomeComune} è nel bollettino) o dal calcolo statistico
 *     su Open-Meteo (per i comuni fuori dalle 27)" — il
 *     condizionale "se {nomeComune} è nel bollettino" stonava su
 *     ENTRAMBE le pagine: su Bologna la pagina ha appena spiegato
 *     che Bologna È nel bollettino (segnalato da utente su
 *     /bologna/metodo); su Parma la pagina apre dicendo che Parma
 *     NON è tra le 27 città. Il condizionale ipotetico
 *     contraddiceva un fatto già dichiarato in entrambi i casi.
 *
 *     Ora simmetriche: default = ramo stima ("è calcolato
 *     statisticamente su Open-Meteo, descritto in dettaglio più
 *     sopra; per le 27 città del bollettino arriva direttamente
 *     dal Ministero"). Override su ramo bollettino ("viene
 *     direttamente dal Ministero; per i comuni fuori dalle 27 è
 *     calcolato statisticamente su Open-Meteo, documentato in
 *     /parma/metodo"). Ogni ramo apre col caso della pagina, poi
 *     accenna all'altro per contesto.
 *
 *   - `fontiPuntiFreschi` (§12ww): il bullet "i punti freschi e le
 *     distanze" nomina la fonte dei dati punti. Prima diceva
 *     "OpenStreetMap + Iren" fisso — Iren è il gestore idrico di
 *     Parma, a Bologna il gestore è Hera e non ci sono casette
 *     Iren nel DB. Ora la stringa arriva come prop dai
 *     `AttributiMetodo` del comune (in `lib/comuni-metodo.tsx`),
 *     default "OpenStreetMap". Stessa lezione della legenda mappa
 *     in §12hh e delle fonti in §12vv: no condizionali su
 *     slugComune nel JSX.
 *
 * Interpolazione `{nomeComune}` con `{" "}` esplicito (§12ww fix):
 * prima "In {nomeComune}\nl'intelligenza…" poteva compilare a
 * "In Parmal'intelligenza" senza spazio in alcune modalità di
 * rendering. `{" "}` risolve garantendo lo spazio.
 *
 * Include anche la nota sul clic ("verifica gli orari") spostata
 * qui da §12jj + il paragrafo sull'AI Act art. 50.
 */

import type { ReactNode } from "react";

interface Props {
  nomeComune: string;
  /**
   * Descrizione dopo i due punti del bullet "il livello di allerta".
   * Default: formulazione ramo stima (Parma è fuori dalle 27,
   * livello calcolato statisticamente + accenno al bollettino per
   * le 27 città). Override sul ramo bollettino con la
   * formulazione affermativa + link a `/parma/metodo`.
   */
  descrizioneLivelloAllerta?: ReactNode;
  /**
   * Fonti dei punti freschi per il comune corrente, es.
   * "OpenStreetMap + Iren" per Parma. Default "OpenStreetMap"
   * (comune generico senza fonti aggiuntive).
   */
  fontiPuntiFreschi?: string;
}

export const TITOLO_DOVE_LLM =
  "Dove il progetto usa un modello di linguaggio e dove no";

const DESCRIZIONE_RAMO_STIMA_DEFAULT: ReactNode = (
  <>
    è calcolato statisticamente su Open-Meteo, descritto in dettaglio
    più sopra; per le 27 città del bollettino arriva direttamente dal
    Ministero della Salute
  </>
);

export function MetodoDoveLLM({
  nomeComune,
  descrizioneLivelloAllerta = DESCRIZIONE_RAMO_STIMA_DEFAULT,
  fontiPuntiFreschi = "OpenStreetMap",
}: Props) {
  return (
    <>
      <p>
        Un&apos;architettura che sa dove fermarsi è più credibile di
        una che mette l&apos;LLM ovunque. In {nomeComune}{" "}
        l&apos;intelligenza artificiale interviene <b>in tre punti</b>:
        due sulla pagina pubblica, uno sulla dashboard del
        coordinatore. Tutti e tre con fallback silenzioso — se il
        modello non risponde, il blocco semplicemente sparisce e il
        resto della pagina resta.
      </p>
      <div className="text-[13.5px] leading-relaxed mt-3">
        <b>Dove usiamo un modello</b> (dichiarato accanto al testo,
        come vuole l&apos;art. 50 dell&apos;AI Act, oltre che qui):
      </div>
      <ul className="list-disc pl-5 space-y-1 mt-2 text-[13.5px] leading-relaxed">
        <li>
          <b>La frase &laquo;allerta città&raquo;</b> in cima alla
          pagina pubblica, dentro la card colorata del livello. Parla
          della città intera — livello di oggi, previsioni a 48 e 72
          ore quando ci sono, notti tropicali consecutive.
        </li>
        <li>
          <b>Il consulente locale</b> quando scegli un quartiere sulla
          pagina pubblica. Dice dove andare per stare al fresco —
          nome, distanza, orari dei punti che il codice ha già scelto
          per quel quartiere. Non ordina, non inventa numeri, non
          attribuisce orari che non gli abbiamo passato.
        </li>
        <li>
          <b>Il riassunto della giornata</b> sulla dashboard del
          coordinatore (non visibile sulla pagina pubblica). In poche
          righe racconta cosa è successo oggi — contatti fatti, esiti,
          sintomi rilevati. Descrive numeri già calcolati, non li
          produce.
        </li>
        <li>
          <b>La sintesi vocale</b> accanto ai tre testi qui sopra: un
          pulsante di ascolto legge il testo con una voce sintetica.
          Il motore è <a
            href="https://github.com/OHF-Voice/piper1-gpl"
            className="underline hover:text-slate"
            target="_blank"
            rel="noopener noreferrer"
          >Piper</a> (voce <code className="font-mono text-[12.5px]">it_IT-paola-medium</code>),
          modello neurale che gira sul server della stessa istanza:
          nessun testo viene inviato a servizi esterni per essere
          letto. È un modello, ma locale — e la differenza è il
          punto.
        </li>
      </ul>
      <div className="text-[13.5px] leading-relaxed mt-4">
        <b>Dove NON usiamo un modello</b> (deterministico, senza
        chiamate API, dove l&apos;affidabilità conta):
      </div>
      <ul className="list-disc pl-5 space-y-1 mt-2 text-[13.5px] leading-relaxed">
        <li>
          <b>Il livello di allerta</b>:{" "}
          {descrizioneLivelloAllerta}. Un modello non stima un
          livello di allerta meglio di questi metodi.
        </li>
        <li>
          <b>Il profilo del quartiere</b> (persone per famiglia,
          abitazioni per edificio, distanza dal parco): sono aggregati
          del censimento ISTAT 2021 e distanze calcolate da PostGIS
          su geometrie OpenStreetMap. Dati fissi, non generati.
        </li>
        <li>
          <b>Le raccomandazioni sanitarie</b> (bevi acqua, chiudi le
          persiane, ecc.): testo fisso preso dalle indicazioni
          ufficiali. Se un modello le riscrivesse ogni volta, prima o
          poi ne ometterebbe una e nessuno lo intercetterebbe.
        </li>
        <li>
          <b>I punti freschi e le distanze</b> nella mappa e
          nell&apos;elenco: elenco {fontiPuntiFreschi}, distanze in
          linea d&apos;aria calcolate da PostGIS. Il modello non
          sceglie <i>quali</i> punti mostrare — quello è codice.
        </li>
      </ul>
      {/* Nota sul clic (spostata dalla card mappa a §12hh, poi qui
          in §12jj): serve per spiegare "verifica gli orari" che
          compare nei popup e nell'elenco. Testo invariato. */}
      <p className="mt-4 text-[13.5px]">
        Clic su un pallino: nome, tipo, orari se noti. Dove gli orari non
        sono nel dato è scritto &ldquo;verifica gli orari&rdquo; — meglio
        che presumere un&apos;apertura che non c&apos;è.
      </p>
      <p className="mt-4 text-[13.5px]">
        Ogni testo generato porta accanto la dichiarazione{" "}
        <i>&laquo;Testo generato con il supporto di intelligenza
        artificiale&raquo;</i>, sotto il testo stesso. È una scelta
        coerente con l&apos;art. 50 dell&apos;AI Act (Regolamento UE
        2024/1689): i testi generati che informano il pubblico su
        questioni di interesse pubblico devono essere dichiarati in
        modo chiaro e contestuale, non nascosto in una pagina legale.
        L&apos;etichetta compare accanto al testo perché è lì che il
        cittadino la incontra.
      </p>
    </>
  );
}
