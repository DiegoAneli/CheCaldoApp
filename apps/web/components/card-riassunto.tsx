"use client";

/**
 * Card "Riassunto della giornata" — output dell'agente MOD06
 * `generaRiassunto` (§12ddddd), UI applicata in §12fffff.
 *
 * Vive sotto la BandaAllertaStati e sopra "Volontari e soglia". È
 * SEMPRE presente: mai condizionale, mai a comparsa. Un blocco che
 * appare e scompare non lo si impara mai — la card resta a schermo
 * anche quando i contatti sono zero, con testo che spiega perché il
 * riassunto non è disponibile e pulsante disattivato.
 *
 * Tre stati visibili + due "annunci onesti" post-click:
 *   (1) `contattatiOggi === 0` → messaggio "nessun contatto ancora
 *       oggi", pulsante disabilitato. L'agente non viene chiamato
 *       (fallback esplicito lato server con motivo="vuoto"), ma
 *       preveniamo comunque il click.
 *   (2) contattatiOggi > 0 e nessun riassunto ancora generato →
 *       pulsante attivo con una riga che dice cosa il coordinatore
 *       ci troverà dentro ("chi ha bisogno, chi non risponde, cosa
 *       hanno fatto i volontari").
 *   (3) Riassunto generato → il testo occupa la card. Il pulsante
 *       resta disponibile per rigenerare (con la cache a scaglioni
 *       il ripremere è gratis se non sono arrivati contatti nuovi).
 *   (4) Loading esplicito durante la chiamata: label del pulsante
 *       cambia + un breve testo dice "sto componendo il riassunto".
 *   (5) Se l'agente torna null dopo la pressione, banda esplicita
 *       col motivo (`"tetto"` → limite giornaliero raggiunto,
 *       `"errore"` → agente giù, `"vuoto"` → il coord ha premuto
 *       comunque ma i contatti sono ancora zero): niente silenzio.
 *
 * **Perché client component e stato locale**: FasciaStatiLive chiama
 * `router.refresh()` ogni 20 s (§12gggg). Un server component che
 * riceve il testo come prop da un'action lo perderebbe ad ogni
 * refresh — la card lampeggerebbe "riassunto assente" ogni 20 s
 * anche se il coord l'aveva appena generato. Con useState client il
 * componente resta montato tra i refresh, React lo riconcilia per
 * posizione/tipo e lo stato sopravvive. La riconciliazione della
 * banda sopra + delle altre card sotto continua a funzionare
 * regolarmente perché sono server components separati.
 *
 * **Disclosure AI Act (art. 50)**: stessa formula standardizzata di
 * `card-allerta.tsx` e `consiglio-locale.tsx`, mostrata SOLO quando
 * c'è un testo generato da dichiarare (non compare in stato 1 o 2 o
 * in loading).
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { useState, useTransition } from "react";
import type {
  RisultatoRiassunto,
  MotivoRiassuntoAssente,
} from "@checaldo/agents";
import { PulsanteAscolto } from "@/components/pulsante-ascolto";

interface Props {
  /** Numero di persone distinte contattate oggi (`statoLive.contattatiOggi`). */
  contattatiOggi: number;
  /** Server action che invoca `generaRiassunto`. */
  genera: () => Promise<RisultatoRiassunto>;
}

interface StatoLocale {
  /** Testo generato se presente. */
  testo: string | null;
  /** Motivo del ritorno null, quando esiste. */
  motivo: MotivoRiassuntoAssente | null;
  /** Quanti contatti aveva conteggiato l'ultima chiamata (per il footer). */
  contattiTotali: number;
  /** Scaglione della chiave di cache — serve al PulsanteAscolto per
   *  identificare la riga in `pubblico.riassunto_cache` a cui è legato
   *  l'audio (§12ggggg). Cambia ogni 5 contatti nuovi. */
  scaglione: number;
  /** Se l'ultimo risultato veniva dalla cache (per il footer). */
  daCache: boolean;
  /** Almeno una chiamata al server è stata fatta in questa sessione. */
  premuto: boolean;
}

const INIZIALE: StatoLocale = {
  testo: null,
  motivo: null,
  contattiTotali: 0,
  scaglione: 0,
  daCache: false,
  premuto: false,
};

export function CardRiassunto({ contattatiOggi, genera }: Props) {
  const [stato, setStato] = useState<StatoLocale>(INIZIALE);
  const [pending, startTransition] = useTransition();

  const vuoto = contattatiOggi === 0;
  const disabilitato = pending || vuoto;

  function onClick() {
    if (disabilitato) return;
    startTransition(async () => {
      try {
        const r = await genera();
        setStato({
          testo: r.testo,
          motivo: r.motivo ?? null,
          contattiTotali: r.contattiTotali,
          scaglione: r.scaglione,
          daCache: r.daCache,
          premuto: true,
        });
      } catch {
        // Errore di rete o server action fallita: mostrala come "errore".
        // Il server action non dovrebbe throw perché generaRiassunto ha già
        // il proprio try/catch e ritorna motivo="errore". Ma difesa in più.
        setStato({
          testo: null,
          motivo: "errore",
          contattiTotali: 0,
          scaglione: 0,
          daCache: false,
          premuto: true,
        });
      }
    });
  }

  const label = pending
    ? "Sto componendo il riassunto…"
    : stato.testo
    ? "Rigenera il riassunto"
    : "Genera il riassunto della giornata";

  return (
    <div className="border rounded-card bg-card border-gray-400">
      <div className="px-5 pt-4 pb-3 flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <h3 className="font-display font-semibold text-[13px] tracking-label uppercase text-slate">
            Riassunto della giornata
          </h3>
          <p className="text-[12.5px] text-slate mt-1 max-w-prose">
            {vuoto
              ? "Ancora nessun contatto oggi: non c'è materia da riassumere. Torna qui appena i primi volontari cominciano a registrare gli esiti."
              : stato.testo
              ? "Prosa di 6-12 righe su chi ha bisogno, chi non risponde e cosa hanno fatto i volontari fino ad ora. Rigenerare non chiama il modello se non ci sono contatti nuovi (cache a scaglioni di cinque)."
              : "Il riassunto racconta cosa hanno fatto i volontari finora: quanti contatti, chi ha bisogno, chi non risponde, chi ha chiesto cosa. Premi per generarlo — usa la cache se qualcuno lo aveva già chiesto."}
          </p>
        </div>
        <button
          type="button"
          onClick={onClick}
          disabled={disabilitato}
          className="rounded-btn bg-ink text-white font-display font-semibold text-[13px] px-4 py-2 shadow-sm hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
          aria-busy={pending || undefined}
        >
          {label}
        </button>
      </div>

      {/* Loading esplicito: microcopy piccolo per non gridare "sto lavorando"
          nella dashboard. Il aria-busy sul bottone lo dice agli screen reader. */}
      {pending && (
        <div className="px-5 pb-3 text-[12px] text-muted italic">
          Sto interrogando il modello… questo può richiedere fino a una decina di secondi.
        </div>
      )}

      {/* Testo generato + disclosure IA + pulsante ascolto (BLOCCO B).
          Whitespace pre-line preserva le andate a capo del modello. */}
      {stato.testo && !pending && (
        <div className="px-5 pb-4">
          <div className="text-[14px] text-ink whitespace-pre-line leading-relaxed">
            {stato.testo}
          </div>
          <div className="mt-3 flex items-center gap-3 flex-wrap">
            {/* §12ggggg: sorgente server-side che pesca l'audio Piper
                dal DB (o lo sintetizza al primo click). Se il servizio
                tts non risponde, PulsanteAscolto cade automaticamente
                sulla sintesi del browser (§12fffff). Il scaglione è
                lo stesso ritornato da generaRiassunto — chiave
                naturale insieme a data corrente e org da cookie. */}
            <PulsanteAscolto
              testo={stato.testo}
              etichetta="riassunto"
              sorgente={{
                url: "/api/tts/riassunto",
                body: { scaglione: stato.scaglione },
              }}
            />
            <p className="text-[11px] text-muted italic leading-normal">
              Testo e audio generati con il supporto di intelligenza artificiale
            </p>
          </div>
          {/* Footer diagnostico: dice quanti contatti aveva il testo e
              se veniva dalla cache. Utile per capire se ripremere ha
              chiamato il modello o no. Piccolo, non intrusivo. */}
          <p className="text-[11px] text-muted mt-2 font-mono">
            {stato.contattiTotali}{" "}
            {stato.contattiTotali === 1 ? "contatto" : "contatti"} · {" "}
            {stato.daCache ? "da cache" : "generato ora"}
          </p>
        </div>
      )}

      {/* Il coord ha premuto e l'agente ha risposto null: dichiarazione
          onesta invece del silenzio. Motivo mappato a un messaggio
          leggibile — la banda usa lo stesso pattern demo-band del resto
          della dashboard così non sembra un errore fatale. */}
      {stato.premuto && !stato.testo && !pending && stato.motivo && (
        <div className="px-5 pb-4">
          <div className="border border-demorule bg-demoband text-demoink rounded-btn px-3 py-2 text-[13px] leading-normal">
            {messaggioPerMotivo(stato.motivo)}
          </div>
        </div>
      )}
    </div>
  );
}

function messaggioPerMotivo(m: MotivoRiassuntoAssente): string {
  if (m === "vuoto") {
    return "Ancora nessun contatto oggi: non c'è nulla da riassumere. Riprova più tardi.";
  }
  if (m === "tetto") {
    return "Limite giornaliero raggiunto per il riassunto (venti generazioni). Il riassunto tornerà disponibile domani; se serve prima, contatta chi ha installato CheCaldo! per la tua organizzazione.";
  }
  // "errore"
  return "Il modello non ha risposto. Riprova fra un minuto: se il problema continua, il servizio è probabilmente giù.";
}
