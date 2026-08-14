/**
 * Blocco "Consiglio per il tuo quartiere" — output dell'agente MOD06.
 *
 * Server Component **async** avvolto in `<Suspense fallback={null}>` a
 * livello di `page.tsx`: la pagina esce dallo streaming SENZA aspettare
 * il modello. Quando `generaConsiglio` risponde, il chunk si popola.
 *
 * **Fallback silenzioso**: se `generaConsiglio` ritorna `null` (DB giù,
 * modello giù, chiave API mancante, prompt corrotto, allerta assente),
 * questo componente rende `null` e il blocco non compare. Nessun
 * messaggio d'errore in pagina: le raccomandazioni sanitarie sopra sono
 * già la risposta di base.
 *
 * Il consiglio è **complementare**, non sostitutivo: dice DOVE andare
 * in questo quartiere adesso. Le raccomandazioni sanitarie (cosa fare)
 * restano nel blocco `Raccomandazioni` sopra.
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { sql } from "@/lib/db";
import { generaConsiglio } from "@checaldo/agents";
import { PulsanteAscolto } from "@/components/pulsante-ascolto";

interface Props {
  comuneIstat: string;
  quartiereNome: string;
}

export async function ConsiglioLocale({ comuneIstat, quartiereNome }: Props) {
  const testo = await generaConsiglio(sql, comuneIstat, quartiereNome);
  if (!testo) return null;

  return (
    <div className="border border-gray-400 rounded-card bg-card p-5">
      <div className="font-display font-bold text-[24px] mb-2">
        Dove andare adesso — {quartiereNome}
      </div>
      <div className="text-[14px] text-ink whitespace-pre-line leading-relaxed">
        {testo}
      </div>
      {/* Etichetta IA standardizzata (§12ee, art. 50 AI Act).
          Identica formulazione della card allerta città — è la stessa
          affermazione fatta in contesti diversi: quando il testo è
          generato, va detto qui, non solo in /metodo. La nota estesa
          precedente ("Testo generato da un modello di linguaggio a
          partire dal livello... Non sostituisce le raccomandazioni
          sanitarie...") viveva qui: il primo pezzo è sostituito dalla
          label standard, il secondo (non sostituisce raccomandazioni)
          è ridondante — l'ordine visivo sulla pagina già lo dice
          (raccomandazioni sanitarie sono sempre a schermo come blocco
          separato, sopra o accanto).
          Pulsante ascolto: audio Piper via /api/tts/consiglio con
          fallback alla sintesi del browser se il servizio tts è giù
          (§12ggggg + §12fffff). */}
      <div className="mt-3 flex items-center gap-3 flex-wrap">
        <PulsanteAscolto
          testo={testo}
          etichetta="consiglio"
          sorgente={{
            url: "/api/tts/consiglio",
            body: { comuneIstat, quartiereNome },
          }}
        />
        <p className="text-[11px] text-muted italic leading-normal">
          Testo e audio generati con il supporto di intelligenza artificiale
        </p>
      </div>
    </div>
  );
}
