// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Banda "Dati sintetici — nessuna persona reale". Prima cosa che si vede
 * nel video (vincolo MOD03).
 *
 * **Fail-safe (opt-out).** La banda compare **sempre**, tranne quando
 * `DEMO_MODE === "false"` in modo esplicito. Comportamento invertito
 * rispetto alla prima versione (opt-in, `=== "true"`): dimenticare la
 * variabile nel `.env` del VPS significava mostrare i 500 assistiti
 * sintetici con nome, indirizzo ed età senza il disclaimer, con
 * lettura possibile come dati reali. Il default corretto per
 * un'istanza dimostrativa è dichiarato: la spegne solo chi ha
 * un'anagrafe vera e passa DEMO_MODE=false consapevolmente.
 */
export function BandaDemo() {
  if (process.env.DEMO_MODE === "false") return null;
  return (
    <div className=" text-center bg-demoband text-demoink border-b border-demorule px-4 py-2 text-[11.5px] font-display font-semibold tracking-wide uppercase">
      Dati sintetici — nessuna persona reale
    </div>
  );
}
