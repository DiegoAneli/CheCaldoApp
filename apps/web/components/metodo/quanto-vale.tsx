// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Sezione "Quanto vale il metodo" della pagina /[comune]/metodo.
 * Backtest su Bologna estate 2025: tabella per orizzonte + nota su
 * tetto vs accuratezza + campione ridotto per 48/72h + nota
 * aggiornamento 4 agosto 2026.
 *
 * Montata solo sul ramo `stima` (§12vv). Sul ramo bollettino queste
 * percentuali non riguardano il livello del comune (viene dal
 * Ministero, non stimato) — mostrarle diventava disinformazione.
 * §12ll è la sessione in cui i numeri sono stati fissati e
 * dichiarati con le cautele di scala.
 */

export const TITOLO_QUANTO_VALE = "Quanto vale il metodo";

export function MetodoQuantoVale() {
  return (
    <>
      <p>
        Abbiamo verificato la stima confrontandola con il{" "}
        <b>bollettino ufficiale di Bologna</b> (una delle 27 città
        coperte) per <b>tutta l&apos;estate 2025</b>, dal 1° giugno al
        15 settembre. Il bollettino esce a tre orizzonti — il giorno
        stesso, domani, dopodomani — e abbiamo misurato ciascuno
        separatamente.
      </p>

      <table className="w-full text-[14px] mt-4 border-collapse">
        <thead>
          <tr>
            <th className="text-left font-display font-semibold text-[12px] tracking-label uppercase text-muted py-2 border-b border-rule">
              Orizzonte
            </th>
            <th className="text-right font-display font-semibold text-[12px] tracking-label uppercase text-muted py-2 border-b border-rule">
              Giorni
            </th>
            <th className="text-right font-display font-semibold text-[12px] tracking-label uppercase text-muted py-2 border-b border-rule">
              Esatti
            </th>
            <th className="text-right font-display font-semibold text-[12px] tracking-label uppercase text-muted py-2 border-b border-rule">
              Entro uno
            </th>
            <th className="text-right font-display font-semibold text-[12px] tracking-label uppercase text-muted py-2 border-b border-rule">
              Sottostime
            </th>
            <th className="text-left font-display font-semibold text-[12px] tracking-label uppercase text-muted py-2 border-b border-rule pl-4">
              Cosa vale
            </th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td className="py-2 border-b border-rule">Oggi (24 ore)</td>
            <td className="py-2 border-b border-rule text-right font-mono">70</td>
            <td className="py-2 border-b border-rule text-right font-mono">74,3%</td>
            <td className="py-2 border-b border-rule text-right font-mono">92,9%</td>
            <td className="py-2 border-b border-rule text-right font-mono">4,3%</td>
            <td className="py-2 border-b border-rule pl-4 text-[12.5px] text-slate">
              misurato
            </td>
          </tr>
          <tr>
            <td className="py-2 border-b border-rule">Domani (48 ore)</td>
            <td className="py-2 border-b border-rule text-right font-mono">15</td>
            <td className="py-2 border-b border-rule text-right font-mono">≤ 73,3%</td>
            <td className="py-2 border-b border-rule text-right font-mono">≤ 93,3%</td>
            <td className="py-2 border-b border-rule text-right font-mono">≥ 6,7%</td>
            <td className="py-2 border-b border-rule pl-4 text-[12.5px] text-slate">
              <b>tetto</b> — con forecast meteo perfetta
            </td>
          </tr>
          <tr>
            <td className="py-2 border-b border-rule">Dopodomani (72 ore)</td>
            <td className="py-2 border-b border-rule text-right font-mono">14</td>
            <td className="py-2 border-b border-rule text-right font-mono">≤ 64,3%</td>
            <td className="py-2 border-b border-rule text-right font-mono">≤ 85,7%</td>
            <td className="py-2 border-b border-rule text-right font-mono">≥ 7,1%</td>
            <td className="py-2 border-b border-rule pl-4 text-[12.5px] text-slate">
              <b>tetto</b> — con forecast meteo perfetta
            </td>
          </tr>
        </tbody>
      </table>

      <p className="mt-4">
        <b>I numeri di domani e dopodomani sono un tetto massimo,
        non l&apos;accuratezza reale.</b> Il nostro backtest usa la
        temperatura effettivamente osservata di quel giorno — come se
        la previsione meteo di allora fosse stata perfetta. In
        produzione, invece, la nostra stima parte dalle previsioni
        Open-Meteo, che hanno un errore loro; quell&apos;errore si
        somma al nostro. Il valore reale a 48 e 72 ore è più basso
        di quanto la tabella indica; di quanto, non lo sappiamo, e
        non lo scriviamo.
      </p>
      <p className="mt-3 text-slate">
        A due giorni il tetto tiene, a tre giorni cala visibilmente.
        È il comportamento normale di qualunque previsione
        meteorologica: più ci si spinge in avanti, meno si sa. La
        pagina mostra tutti e tre gli orizzonti, e va detto insieme.
      </p>
      <p className="mt-3 text-slate">
        Il campione di 15 e 14 giornate per domani/dopodomani è più
        piccolo di quello a 24 ore perché il bollettino{" "}
        <a
          href="https://www.salute.gov.it/new/it/tema/ondate-di-calore/"
          className="underline hover:text-ink"
          target="_blank"
          rel="noopener noreferrer"
        >
          ministeriale
        </a>
        {" "}esce dal lunedì al venerdì; le previsioni a 48 e 72 ore
        escono solo quando una singola pubblicazione copre più
        giorni — tipicamente il venerdì che copre il weekend.
      </p>
    </>
  );
}
