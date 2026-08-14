// SPDX-License-Identifier: AGPL-3.0-or-later
import { LIVELLI, type Livello } from "@/lib/livelli";
import clsx from "clsx";

interface Props {
  livello: Livello;
  provenienza: "bollettino" | "stima";
  /**
   * Motivo strutturale per cui la provenienza non è quella prevista di
   * default per il comune. `'citta_non_nel_bollettino'` = città delle 27
   * ministeriali per cui, oggi, il file `latest.csv` di onData non
   * contiene una riga — condizione osservabile che copre sia "fuori
   * dalla finestra annuale di pubblicazione" sia "giorno di mancata
   * pubblicazione dentro la finestra". Cade su stima con etichetta
   * esplicita, così il coordinatore non legge il cambio di colore
   * come guasto (§12x).
   *
   * Nota sulla finestra: il testo user-facing sotto usa la formula
   * "da maggio a settembre", coerente con la comunicazione divulgativa
   * del Ministero. La finestra reale cambia ogni anno — per il 2026 è
   * 25 maggio - 20 settembre secondo la pagina bollettini
   * (https://www.salute.gov.it/new/it/tema/ondate-di-calore/
   *  bollettini-sulle-ondate-di-calore-0/, verificato 2026-08-07).
   */
  motivoProvenienza?: string | null;
}

/**
 * Badge del livello di allerta con la provenienza sempre visibile.
 * Bug 2 del prototipo (righe 306-308: ternario identico): qui distinto.
 * Blu (.srcflag.official) per bollettino ufficiale del Ministero, arancio
 * (default .srcflag) per stima locale non ufficiale. Se `motivoProvenienza`
 * è `'citta_non_nel_bollettino'`, sotto il badge appare la nota che
 * spiega perché — è l'unico punto del progetto in cui una fonte cambia,
 * e non deve mai cambiare in silenzio.
 */
export function BadgeLivello({ livello, provenienza, motivoProvenienza }: Props) {
  const l = LIVELLI[livello]!;
  const bollettino = provenienza === "bollettino";
  const cittaNonNelBollettino = motivoProvenienza === "citta_non_nel_bollettino";
  return (
    // p-3 sm:p-4 (§12lll): a 360px il badge era alto ~100px perché il
    // wrap del chip "livello stimato · non ufficiale" a destra creava
    // spazio vuoto e il padding p-4 sopra/sotto aggiungeva altezza.
    // Sotto sm il layout va in colonna (chip sotto il livello, non a
    // destra wrappato) e il padding scende di 8px sopra/sotto —
    // guadagno ~15-20px senza sacrificare informazione o leggibilità.
    <div className="border border-rule rounded-card bg-card p-3 sm:p-4 border-gray-400">
      {/* §12aaaaaa — scala dichiarata a schermo: `Livello N di 3` (con
          `· il massimo` sul 3). Livello 0 non porta numero né scala:
          la parola già dice tutto e "Livello 0 di 3" in una scheda
          volontario, dove il primo colpo d'occhio serve a decidere,
          sarebbe informazione inutile (decisione brief 2026-08-12).
          Nel ramo livello 0 mostro solo pallino + parola. */}
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-end gap-2 sm:gap-4 mb-3">
        <div className="flex items-center gap-3 flex-wrap">
          <span
            aria-hidden
            className="inline-block w-4 h-4 rounded"
            style={{ background: l.hex }}
          />
          {livello === 0 ? (
            <span className="font-display font-bold text-lg">{l.parola}</span>
          ) : (
            <>
              <span className="font-display font-bold text-lg">
                Livello {l.n} di 3
                {livello === 3 && (
                  <span className="text-slate font-normal">
                    {" · il massimo"}
                  </span>
                )}
              </span>
              <span className="text-slate text-sm">{l.desc}</span>
            </>
          )}
        </div>
        <span
          className={clsx(
            "self-start sm:self-auto inline-flex items-center gap-1.5 text-[11.5px] font-display font-semibold tracking-wide uppercase px-2.5 py-1 rounded-btn border",
            bollettino
              ? "bg-officialbg text-officialink border-officialrule"
              : "bg-demoband text-demoink border-demorule"
          )}
        >
          {bollettino ? "bollettino del Ministero" : "livello stimato · non ufficiale"}
        </span>
      </div>
      {cittaNonNelBollettino && (
        <p className="text-[12.5px] text-slate mt-1 leading-normal">
          Il bollettino ministeriale <b>non riporta questa città
          oggi</b>: succede fuori dal periodo di pubblicazione (da
          maggio a settembre) o in un giorno di mancata pubblicazione.
          Nel frattempo il livello è stimato con lo stesso metodo
          usato per i comuni fuori dalle 27 città coperte dal
          Ministero (Open-Meteo + climatologia locale).
        </p>
      )}
    </div>
  );
}
