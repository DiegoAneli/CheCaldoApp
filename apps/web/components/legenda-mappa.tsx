/**
 * Legenda della mappa pubblica: SOLO la scala di colore della coropleta
 * ("Colore delle sezioni") e i due paragrafi esplicativi.
 *
 * §12hh: il blocco "Punti freschi" con la costante GRUPPI è stato
 * cancellato — le card di FiltriCategoria sopra la mappa hanno già
 * icona + colore per ogni categoria e fanno da chiave visiva. Il vecchio
 * blocco era ridondante, occupava più spazio della mappa, conteneva
 * soglie di zoom a parole scollegate dai minzoom reali in
 * `mappa-pubblica.tsx`, e su /bologna descriveva una casetta Iren
 * inesistente (a Bologna il gestore idrico è Hera, `fonte='iren'` è
 * specifica Parma). La distinzione sulla durata di sosta ("ci si sta
 * ore" vs "sosta breve" vs "mattina e sera" ecc.) — utile e non
 * derivabile dai filtri di categoria da soli — è ora sui sottotitoli
 * delle card FiltriCategoria.
 *
 * La nota "Clic su un pallino..." era anche dentro qui e riguarda la
 * mappa, non la scala dei colori: spostata in `sezione-mappa.tsx`
 * subito sotto la mappa, dentro la stessa card.
 *
 * Sincronizzata con `lib/mappa-colori.ts` per la coropleta (fonte unica
 * `COLORI`).
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { COLORI } from "@/lib/mappa-colori";

interface Props {
  /** Nome del comune (es. "Parma", "Bologna") per il microcopy. */
  nomeComune: string;
}

export function LegendaMappa({ nomeComune }: Props) {
  return (
    // §12hh: `max-w-prose` NON sul root (senza vincolo, la scala e i
    // paragrafi andrebbero a 1048px per riga a desktop). Vincolo
    // spostato sui due <p>: ognuno resta leggibile a ~65ch; la scala
    // ha il suo `lg:max-w-[560px]` sotto.
    <div className="mt-3 text-[12.5px] leading-normal text-slate space-y-4">
      <div className="lg:max-w-[560px] w-full mx-auto mb-8">
        <div className="font-display font-semibold text-[11px] tracking-chip uppercase text-muted mb-1.5 text-center">
          Colore delle sezioni
        </div>

        <div className="flex items-center gap-1 mb-1.5" aria-hidden>
          {COLORI.map((c, i) => (
            <span
              key={i}
              className="inline-block h-3 flex-1 first:rounded-l last:rounded-r"
              style={{ background: c }}
            />
          ))}
        </div>

        <div className="flex items-baseline justify-between text-[11px] font-display font-semibold tracking-chip uppercase text-muted">
          <span>meno concentrato</span>
          <span>più concentrato</span>
        </div>
      </div>


      {/* Due paragrafi affiancati a desktop, impilati a tablet/mobile.
          `max-w-prose` sul singolo <p> per non stirare oltre ~65ch
          quando la colonna del grid è ampia. */}
      <div className="lg:grid lg:grid-cols-2 lg:gap-6 space-y-3 lg:space-y-0">
        <p className="max-w-prose">
          Il colore mostra <b>dove il rischio del caldo è più concentrato</b>{" "}
          a {nomeComune}, sezione per sezione. Non è una temperatura misurata: è la
          composizione di fattori strutturali (età media, famiglie di una
          persona sola, densità edilizia, distanza dai parchi) messi in
          rango sul comune. Le sezioni più scure sono quelle dove la
          combinazione di questi fattori è più critica; le più chiare quelle
          dove è meno.
        </p>
        <p className="max-w-prose text-muted">
          Le aree senza colore non sono a rischio zero: sono parchi, servizi
          e sezioni senza residenti in città, e case sparse in campagna, che
          il censimento non classifica come zone residenziali compatte. Chi
          ci vive resta nella lista dei contatti dell&apos;organizzazione.
        </p>
      </div>
    </div>
  );
}
