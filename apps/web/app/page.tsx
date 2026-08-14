/**
 * Radice `/` — landing di presentazione.
 *
 * Destinatario: chi valuta il progetto. Il cittadino arriva
 * direttamente su /parma o /bologna dal Piano Caldo del suo comune.
 * Ma il selettore resta in alto, così anche un cittadino che approda
 * qui può entrare senza scorrere.
 *
 * Struttura:
 *   1. NavbarLanding — logo + payoff, niente voci sezione (§12mm).
 *   2. Apertura — una frase grande, "quando arriva la prossima" in
 *      italic arancione (§12qq).
 *   3. Scelta del comune — colonna singola centrata `max-w-4xl`, due
 *      card affiancate da sm: in su, impilate sotto (§12qq). Prima
 *      c'era una cartina inline a sinistra (§12mm) ma è stata
 *      rimossa perché su desktop dominava l'attenzione dalle card
 *      stesse. Se serve rimetterla, il componente
 *      `cartina-province.tsx` e l'SVG in `public/` sono intatti.
 *   4. Sezioni di spiegazione — 4 blocchi in griglia 2×2 (§12pp).
 *   5. Footer — full-width bg-card (§12nn) + credito autore.
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import Link from "next/link";
import { COMUNI } from "@/lib/comuni";
import { NavbarLanding } from "@/components/navbar-landing";
import { PulsanteGeolocComune } from "@/components/pulsante-geoloc-comune";
import { IconaSole } from "@/components/icona-sole";

export default function Radice() {
  return (
    <>
      <NavbarLanding />

      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-8 sm:py-10 lg:py-12">
        {/* 2. Apertura — una frase, dimensione da titolo di pagina.
            Corsivo su "quando arriva la prossima" via Archivo
            700-italic (import esplicito in globals.css — senza
            quello il browser sintetizza inclinando le lettere,
            brutto a corpi grandi).

            Icona sole (§MOD07-microcopy 1d): un <IconaSole> inline
            a fine frase, dimensione 0.85em (h-[0.85em] w-[0.85em])
            così scala col font-size responsive senza fissare pixel,
            colore text-lv2 come "quando arriva la prossima" a cui è
            legata. Sta dentro lo stesso <span> del testo, con
            leading nbsp per non separarsi se la frase va a capo. */}
       <h1 className="font-display font-bold text-ink text-[30px] sm:text-[40px] lg:text-[52px] leading-tight tracking-display max-w-4xl">
        <span className="block">
          Chi contattare per primo
        </span>

        <span className="block">
          durante un&apos;ondata di calore,
        </span>

        <span className="block">
          <span className="text-ink">e </span>
          <span className="text-lv2 italic">
            quando arriva la prossima
          </span>
          <span className="text-ink">.</span>
        </span>
      </h1>

        {/* 3. Scelta del comune (§12qq).
            Container `max-w-4xl` (~896px) centrato per non stirare le
            card a 1088px del container esterno max-w-6xl ma dando
            loro larghezza sufficiente (~440px cadauna) per contenere
            la skyline PNG che ha edifici concentrati a destra.
            Card affiancate da sm: in su, impilate sotto sm.
            Nessuna cartina — vedi docstring modulo per la scelta. */}
        <section className="mt-10 lg:mt-12 max-w-4xl mx-auto">

          {/* Card comune, target primario. */}
          <div className="space-y-4">
            <div className="font-display font-bold text-[11.5px] tracking-label uppercase text-muted">
              Scegli il comune
            </div>

            {/* §12pp: "Usa la mia posizione" spostato QUI, sopra le
                due card, come alternativa immediata alla scelta
                manuale. Prima era in fondo alla colonna dopo due card
                alte, a quel punto della pagina non lo vede nessuno. */}
            <PulsanteGeolocComune />

            {/* Card affiancate da sm: (grid-cols-2), impilate sotto.
                Container esterno max-w-4xl con gap-4 → card ~440px
                cadauna da sm in su, full-width sotto sm.

                Skyline (§12ss/§12tt): SFONDO della card con
                backgroundSize `contain` — immagine INTERA, non
                ritagliata, allineata in basso al centro. La
                `<article>` porta il backgroundImage inline.

                Velo (§12tt, poi rimosso in §12cccccc, poi
                RIMESSO in §12cccccc addendum): gradient bianco
                che copre la parte alta dove sta il testo e si
                esaurisce PRIMA di raggiungere il sole disegnato
                nelle due PNG. Numeri:
                  0-30%   opacità 0.85 pieno
                  30-40%  sfuma linearmente a 0
                  40-100% trasparente (sole + edifici a piena
                          opacità)
                Su card min-h-340: fine velo a y=136. Sole (top
                raggi) a y≈154 su Parma e y≈160 su Bologna — 18-24
                px di margine di sicurezza. Se la card cresce
                (paragrafo che wrappa su mobile) il velo scala col
                percent e il sole resta ancorato al bottom
                dell'immagine: il margine cresce, non peggiora.
                Il vecchio velo di §12tt (0.85 fino al 45%, sfuma
                a 0 al 75%) copriva il sole a ~75% di opacità —
                per questo era stato tolto in §12cccccc. Ora la
                copertura si esaurisce ai 40% e il sole resta
                pulito.

                CTA `mt-auto self-start mb-24` (§12cccccc
                addendum): mt-auto ancora al bottom → allineamento
                fra le due card (entrambe min-h-340 → identico
                offset dal fondo). mb-24 aggiunge 96 px di
                margine sotto → sposta il pulsante ~96 px in alto
                rispetto al fondo. Nuova y del bottone: 182-224
                su card 340, invece del 278-320 precedente.
                Punto medio bottone ~203, ~15 px sotto la metà
                esatta della card (170) — accettabile per "circa
                a metà". Il bottone (x=20-200, self-start a
                sinistra) NON copre il sole (x=330-380, metà
                destra della PNG): stessa altezza y ma colonne
                diverse.

                min-h-[340px] (§12tt): la card resta alta
                abbastanza perché il pulsante a metà altezza
                lasci spazio sopra al testo (fine paragrafo a
                ~130, bottone top a 182 → 52 px di respiro) e
                sotto agli edifici (fondo bottone a 224, edifici
                partono da ~180 ma solo a destra dove il bottone
                non arriva).

                PNG identici 1774×887 (rapporto 2:1). Su card 438
                netti (padding-box) l'immagine `contain` è
                438×219; su card 341 netti (mobile) 341×170.

                Altezze uguali fra le due card: grid `sm:grid-cols-2`
                default `align-items: stretch` + `flex flex-col
                flex-1` nel contenuto. */}
            <div className="grid gap-4 sm:grid-cols-2">
            <article
              className="relative overflow-hidden border border-gray-400 rounded-card p-5 min-h-[340px] flex flex-col"
              style={{
                backgroundImage: "url(/skyline-parma.png)",
                backgroundSize: "contain",
                backgroundPosition: "bottom center",
                backgroundRepeat: "no-repeat",
              }}
            >
              <div
                aria-hidden
                className="absolute inset-0 pointer-events-none"
                style={{
                  background:
                    "linear-gradient(to bottom, rgba(255,255,255,0.85) 0%, rgba(255,255,255,0.85) 30%, rgba(255,255,255,0) 80%)",
                }}
              />
              <div className="relative z-10 flex flex-col flex-1">
                <div className="flex items-baseline justify-between gap-3">
                  <h2 className="font-display font-bold text-[22px] text-ink leading-none">
                    Parma
                  </h2>
                  <span className="text-[11px] font-display font-semibold tracking-label uppercase text-slate">
                    livello stimato
                  </span>
                </div>
                <p className="mt-3 text-[14px] text-slate leading-relaxed">
                  Parma non è fra le 27 città del bollettino ministeriale.
                  Il livello è stimato dai dati meteo locali col metodo
                  descritto in{" "}
                  <Link href="/parma/metodo" className="underline hover:text-ink">
                    /metodo
                  </Link>
                  .
                </p>
                <Link
                  href="/parma"
                  className="mt-auto mb-24 self-start bg-ink text-white px-4 py-2.5 rounded-btn font-display font-semibold text-[14px] no-underline hover:opacity-90"
                >
                  Vai alla pagina di Parma
                </Link>
              </div>
            </article>

            {/* Bologna — stessa struttura. */}
            <article
              className="relative overflow-hidden border border-gray-400 rounded-card p-5 min-h-[340px] flex flex-col"
              style={{
                backgroundImage: "url(/skyline-bologna.png)",
                backgroundSize: "contain",
                backgroundPosition: "bottom center",
                backgroundRepeat: "no-repeat",
              }}
            >
              <div
                aria-hidden
                className="absolute inset-0 pointer-events-none"
                style={{
                  background:
                    "linear-gradient(to bottom, rgba(255,255,255,0.85) 0%, rgba(255,255,255,0.85) 30%, rgba(255,255,255,0) 80%)",
                }}
              />
              <div className="relative z-10 flex flex-col flex-1">
                <div className="flex items-baseline justify-between gap-3">
                  <h2 className="font-display font-bold text-[22px] text-ink leading-none">
                    Bologna
                  </h2>
                  <span className="text-[11px] font-display font-semibold tracking-label uppercase text-slate">
                    bollettino ministeriale
                  </span>
                </div>
                <p className="mt-3 text-[14px] text-slate leading-relaxed">
                  Bologna è fra le 27 città del bollettino ondate di calore
                  del{" "}
                  <a
                    href="https://www.salute.gov.it/new/it/tema/ondate-di-calore/"
                    className="underline hover:text-ink"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <b>Ministero della Salute</b>
                  </a>
                  . Il livello arriva direttamente da lì, ogni giorno
                  feriale.
                </p>
                <Link
                  href="/bologna"
                  className="mt-auto mb-24 self-start bg-ink text-white px-4 py-2.5 rounded-btn font-display font-semibold text-[14px] no-underline hover:opacity-90"
                >
                  Vai alla pagina di Bologna
                </Link>
              </div>
            </article>
            </div>
          </div>
        </section>

        {/* 4. Sezioni di spiegazione (§12pp): fascia a piena larghezza
            SOTTO la scelta comune. Chi valuta vede prima dove entrare,
            poi scorre per capire.

            Grid 2×2 su desktop (lg:grid-cols-2), impilato mobile.
            Motivo: 4 colonne a max-w-6xl darebbero ~35ch per blocco,
            sotto la soglia leggibile (65ch). Con 2 colonne ognuno
            ~65ch, il blocco (b) — quello sull'escalation, "il cuore
            del prodotto" — ha lo spazio che merita senza diventare
            una colonna alta di testo stretto.

            Testi presi da CHECALDO-PROGETTO.md §1/§5.3/§7,
            README.md § "Dove il progetto NON usa il modello" +
            § "Come installarlo altrove", con revisione utente. */}
        <section
          aria-label="Cos'è CheCaldo!"
          className="mt-16 lg:mt-20 border-t border-rule pt-10 lg:pt-12"
        >
          <div className="grid gap-8 lg:grid-cols-2 lg:gap-10">

            {/* Testo rifatto — la versione precedente conteneva
                quattro affermazioni false rispetto al codice:
                punteggio "in SQL" (è TypeScript in `packages/scoring`),
                modello in "due punti" (i prompt versionati sono tre —
                `citta.md`, `consulente.md`, `riassunto.md`), aggiunta
                comune "poche ore" (README dichiara che il tempo non è
                stato misurato — nessuno ha ancora aggiunto un terzo
                comune), "uno o più comuni per istanza" — sotto-
                iterazione: l'errore era nel README, non nel footer.
                Multi-organizzazione è di design: schema (`schema.sql`
                `pubblico.organizzazione` con FK verso essa in tutte
                le tabelle di `riservato`, UNIQUE(nome, comune_istat)
                che ammette più org sullo stesso comune), primitiva
                `assertAppartiene()` in `packages/db/src/autorizzazione.ts`,
                seed che carica 2 organizzazioni, `allerta.py --tutti`
                che itera su `pubblico.organizzazione`, login per
                comune che deriva l'org dal cookie utente. README
                corretto in "Cos'è, in una riga" e "Limiti dichiarati";
                formula vera: un'organizzazione serve un comune,
                un'istanza può ospitare più organizzazioni isolate fra
                loro.
                La sezione iniziale è stata sdoppiata: "Il problema"
                introduce, "Chi decide cosa" separa il ruolo del
                sistema da quello di coordinatore/volontario. */}

            {/* (a) Il problema — copertura del bollettino e stato di
                fatto per gli altri comuni. */}
            <article>
              <h2 className="font-display font-bold text-[18px] text-ink leading-tight">
                Il problema
              </h2>
              <p className="mt-3 text-[14.5px] text-slate leading-relaxed">
                Il bollettino del Ministero della Salute copre
                ventisette città italiane. Tutti gli altri comuni — la
                stragrande maggioranza, Parma inclusa per poche migliaia
                di abitanti — non hanno un livello di allerta ufficiale.
              </p>
              <p className="mt-3 text-[14.5px] text-slate leading-relaxed">
                Ma le persone fragili ci sono lo stesso, e qualcuno le
                assiste. Ogni mattina d&apos;estate un centro anziani,
                una cooperativa sociale, un gruppo di volontari deve
                decidere chi chiamare per primo. Le liste sono lunghe e
                i volontari aiutano queste persone, ma la scelta si fa
                a intuito o per ordine alfabetico.
              </p>
              <p className="mt-3 text-[14.5px] text-slate leading-relaxed">
                CheCaldo! risponde a una domanda:{" "}
                <b>&laquo;Oggi, chi per primo?&raquo;</b>
              </p>
            </article>

            {/* (b) Chi decide cosa — divisione del lavoro fra sistema
                e persone. */}
            <article>
              <h2 className="font-display font-bold text-[18px] text-ink leading-tight">
                Chi decide cosa
              </h2>
              <p className="mt-3 text-[14.5px] text-slate leading-relaxed">
                Il sistema ordina e distribuisce. Il coordinatore sposta
                la soglia — dove tagliare la lista di oggi — su un
                numero che il sistema suggerisce in base ai volontari
                presenti e al livello di allerta, e decide chi è di
                turno. L&apos;assegnazione ai volontari è automatica,
                con il criterio che una persona torna al volontario che
                l&apos;ha già chiamata.
              </p>
              <p className="mt-3 text-[14.5px] text-slate leading-relaxed">
                Il volontario chiama, e quello che scopre — un
                condizionatore rotto, nessuno in casa, un sintomo —
                rientra nel calcolo del giorno dopo.
              </p>
              <p className="mt-3 text-[14.5px] text-slate leading-relaxed">
                Nessuna decisione automatica su una persona: il sistema
                propone un ordine e una prima azione, le persone
                scelgono.
              </p>
            </article>

            {/* (c) Come si costruisce la priorità. */}
            <article>
              <h2 className="font-display font-bold text-[18px] text-ink leading-tight">
                Come si costruisce la priorità
              </h2>
              <p className="mt-3 text-[14.5px] text-slate leading-relaxed">
                Il punteggio è deterministico e ispezionabile: a parità
                di dati, stesso risultato. Parte dal profilo strutturale
                del quartiere — isolamento familiare, densità edilizia,
                distanza dal verde più vicino, da dati aperti ISTAT — e
                lo moltiplica per quello che si sa della persona: età,
                se vive sola, condizioni segnalate, tentativi di
                contatto andati a vuoto.
              </p>
              <p className="mt-3 text-[14.5px] text-slate leading-relaxed">
                Chi è stata contattata di recente scende un po&apos;:
                non perché conti meno, ma perché di lei sappiamo già
                come sta.
              </p>
              <p className="mt-3 text-[14.5px] text-slate leading-relaxed">
                Chi non risponde non esce dalla lista. Torna il giorno
                dopo con un&apos;azione diversa — seconda chiamata, poi
                un familiare o un vicino, poi la visita a domicilio.
                Cambia l&apos;azione, non la priorità. Il dettaglio in{" "}
                <Link href="/parma/metodo" className="underline hover:text-ink">
                  /parma/metodo
                </Link>
                .
              </p>
            </article>

            {/* (d) Dove il modello non entra. Tre agenti: prompt in
                `packages/agents/prompts/{citta,consulente,riassunto}.md`. */}
            <article>
              <h2 className="font-display font-bold text-[18px] text-ink leading-tight">
                Dove il modello non entra
              </h2>
              <p className="mt-3 text-[14.5px] text-slate leading-relaxed">
                Il modello di linguaggio scrive tre testi: un consiglio
                su dove stare al fresco nel proprio quartiere, una
                frase sull&apos;allerta della città, e il riassunto
                della giornata per il coordinatore. Descrivono numeri
                già calcolati, non li producono e non riordinano
                niente.
              </p>
              <p className="mt-3 text-[14.5px] text-slate leading-relaxed">
                Tutto il resto è deterministico: il punteggio, il
                bollettino, le distanze. Nessun dato personale nel
                repository, nemmeno nei test.
              </p>
            </article>

            {/* (e) Replicabilità. `lg:col-span-2` per non lasciare
                un blocco corto solo in ultima riga della griglia 2×N:
                l'invariante visiva della sezione era 2 colonne piene,
                col 5° articolo aggiunto qui si preserva a piena
                larghezza in ultima riga. */}
            <article className="lg:col-span-2">
              <h2 className="font-display font-bold text-[18px] text-ink leading-tight">
                Replicabilità
              </h2>
              <p className="mt-3 text-[14.5px] text-slate leading-relaxed">
                Un&apos;organizzazione serve un comune. Una stessa
                istanza può ospitare più organizzazioni, ciascuna
                titolare dei propri dati e isolata dalle altre.
                L&apos;infrastruttura è Docker. Codice e metodo sono
                pubblici, licenza <b>AGPL-3.0</b>.
              </p>
            </article>

          </div>
        </section>
      </main>

      {/* 5. Footer full-width bg-card, contenuto centrato in max-w-6xl
          come il main. Desktop: testo sull'istanza a sinistra + fonti
          e licenza a destra, ognuno max-w-prose (non stirato a 1088px
          — ~65ch è la soglia leggibile). Mobile impilato.
          §12nn: prima il contenuto era in max-w-3xl centrato, la
          fascia bianca full-width col contenuto stretto in mezzo. */}
      <footer className="mt-10 border-t border-rule bg-card">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 pt-6 pb-4 text-[12px] text-muted leading-relaxed flex flex-col gap-4 lg:flex-row lg:justify-between lg:items-start lg:gap-10">
          <div className="max-w-prose">
            Un&apos;organizzazione serve un comune. Una stessa istanza
            di CheCaldo! può ospitare <b>più organizzazioni</b>,
            ciascuna titolare dei propri dati e isolata dalle altre.
            Questa istanza serve {COMUNI.length} comuni. Ogni comune ha
            il proprio livello di allerta (bollettino ministeriale
            dove disponibile, stima locale altrimenti) e i propri dati
            aperti sui punti freschi.
          </div>
          <div className="max-w-prose">
            La cartina delle province viene da ISTAT — Basi territoriali
            2021 (CC-BY 4.0). Codice sorgente e metodo sono pubblici,
            licenza AGPL-3.0.
          </div>
        </div>
        {/* Credito autore: riga a sé, testo più piccolo delle fonti
            (11px vs 12px) e più tenue (muted/70) per non competere.
            Forma "Autore:" coerente col README.md § "Contatti".
            Centrata orizzontalmente (§12uu) — il blocco fonti sopra
            resta a due colonne. */}
        <div className="max-w-6xl mx-auto px-4 sm:px-6 pb-6 text-[11px] text-muted/70 text-center">
          Contact:{" "}
          <a
            href="https://diegoaneli.it"
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-slate"
          >
            Diego Aneli
          </a>
        </div>
      </footer>
    </>
  );
}
