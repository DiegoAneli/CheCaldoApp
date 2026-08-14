/**
 * Pagina pubblica per un comune. Path: /{slug} (es. /parma, /bologna).
 *
 * Slug del comune preso da `params.comune` — validato via
 * `risolviComune()` da `apps/web/lib/comuni.ts`. Se sconosciuto,
 * `notFound()` (Next.js risponde 404). Il comune determina i dati
 * (`comune.istat` → tutte le query DB) e il testo di pagina
 * (`comune.nome` → Navbar, PulsanteGeoloc, ProfiloQuartiere,
 * LegendaMappa, MappaPubblica aria-label, /metodo).
 *
 * Layout responsive (§12bb, riordinato dopo il primo ciclo di uso reale).
 *   - mobile (<640px) e tablet (640-1023px): colonna singola. Ordine:
 *     CardAllerta → Raccomandazioni → Selettore → Vicini al centro del
 *     quartiere (elenco) → Dove andare adesso (consiglio agente) →
 *     Mappa (card unificata: filtri+mappa+legenda) → Avviso 112 →
 *     Profilo del quartiere → footer. L'elenco dei punti sale sopra
 *     la mappa perché è la risposta più diretta a "cosa c'è vicino";
 *     il profilo scende in fondo perché è materiale di contesto.
 *   - desktop (>=1024px): container `lg:max-w-6xl`, singola row a
 *     2 colonne (`lg:grid-cols-[3fr_2fr]`) per Raccomandazioni +
 *     Selettore — sono card corte, a piena larghezza diventerebbero
 *     strisce vuote. Sotto tutto full-width nell'ordine del mobile.
 *
 * Vincolo mappa bounded (§12aa): la mappa non si allarga oltre
 * `max-w-4xl` (896px) neanche a desktop 6xl, perché il `minZoom` è
 * calcolato server-side su viewport 734×600 in `metadatiCartografici`
 * (packages/db). Allargarla oltre richiederebbe ricalibrare quella
 * formula per entrambe le città — fuori scope del layout responsive.
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { Suspense } from "react";
import { notFound } from "next/navigation";
import { sql } from "@/lib/db";
import { risolviComune } from "@/lib/comuni";
import {
  allertaCorrente,
  boundsQuartiere,
  elencoQuartieri,
  metadatiCartografici,
  profiloQuartiere,
  puntiFreschiPerCentroQuartiere,
  puntiFreschiPerCoordinate,
} from "@checaldo/db";
import { Navbar } from "@/components/navbar";
import { CardAllerta } from "@/components/card-allerta";
import { SelettoreQuartiere } from "@/components/selettore-quartiere";
import { ProfiloQuartiere } from "@/components/profilo-quartiere";
import { Raccomandazioni } from "@/components/raccomandazioni";
import { ConsiglioLocale } from "@/components/consiglio-locale";
import { AvvisoEmrg } from "@/components/avviso-112";
import { SezioneMappa } from "@/components/sezione-mappa";

export default async function PaginaComune({
  params,
  searchParams,
}: {
  params: Promise<{ comune: string }>;
  searchParams: Promise<{ q?: string; lat?: string; lon?: string }>;
}) {
  const { comune: comuneSlug } = await params;
  const comune = risolviComune(comuneSlug);
  if (!comune) notFound();

  const { istat: COMUNE_ISTAT, nome: NOME_COMUNE, slug: SLUG_COMUNE } = comune;
  const { q, lat: latRaw, lon: lonRaw } = await searchParams;
  const slug = typeof q === "string" && q.length > 0 ? q : undefined;

  // Coordinate opzionali dal PulsanteGeoloc (progressive enhancement).
  const latNum = typeof latRaw === "string" ? Number(latRaw) : NaN;
  const lonNum = typeof lonRaw === "string" ? Number(lonRaw) : NaN;
  const coord =
    Number.isFinite(latNum) && Number.isFinite(lonNum)
      ? { lat: latNum, lon: lonNum }
      : null;

  const [allerta, quartieri, profilo, boundsQ, mappa] = await Promise.all([
    allertaCorrente(sql, COMUNE_ISTAT),
    elencoQuartieri(sql, COMUNE_ISTAT),
    slug ? profiloQuartiere(sql, COMUNE_ISTAT, slug) : Promise.resolve(null),
    slug ? boundsQuartiere(sql, COMUNE_ISTAT, slug) : Promise.resolve(null),
    metadatiCartografici(sql, COMUNE_ISTAT),
  ]);

  const slugValido = slug !== undefined && profilo !== null;
  const slugNonTrovato = slug !== undefined && profilo === null;

  // Elenco punti sotto la mappa. Due sorgenti mutuamente esclusive
  // (§12aa punto 3): coordinate utente hanno la precedenza (distanza
  // reale > distanza dal centroide). N=20 così il filtro categoria
  // lato client ha margine di scelta anche dopo lo scarto delle
  // categorie non selezionate.
  const puntiElenco = coord
    ? await puntiFreschiPerCoordinate(sql, COMUNE_ISTAT, coord.lat, coord.lon, 20)
    : slugValido && profilo
    ? await puntiFreschiPerCentroQuartiere(sql, COMUNE_ISTAT, profilo.nome, 20)
    : [];
  const modoElenco: "coordinate" | "quartiere" = coord ? "coordinate" : "quartiere";

  // Frammenti riusati sia in mobile (in ordine sequenziale) sia in
  // desktop (nelle due colonne del grid). Estratti per non duplicare
  // il markup e per rendere il layout leggibile in una vista sola.
  //
  // CardAllerta (§12cc) ingloba badge + testo agente città + skyline
  // in un solo blocco. Il Suspense fallback resta perché la generazione
  // del testo agente è async: senza Suspense la card blocca la pagina.
  // Fallback ⇒ stessa CardAllerta ma senza il paragrafo dell'agente
  // (che vive dentro un `<Suspense fallback={null}>` interno alla card,
  // vedi `TestoAgente` in card-allerta.tsx).
  const cardAllertaBlocco = (
    <Suspense
      fallback={
        <CardAllerta
          allerta={allerta}
          nomeComune={NOME_COMUNE}
          slugComune={SLUG_COMUNE}
          key="fallback"
        />
      }
    >
      <CardAllerta
        allerta={allerta}
        nomeComune={NOME_COMUNE}
        slugComune={SLUG_COMUNE}
      />
    </Suspense>
  );

  const selettoreBlocco = (
    <>
      <SelettoreQuartiere
        quartieri={quartieri}
        slugSelezionato={slugValido ? slug : undefined}
        nomeComune={NOME_COMUNE}
        slugComune={SLUG_COMUNE}
      />
      {slugNonTrovato && (
        <div className="mt-4 border border-emergrule bg-emergbg text-emergink rounded-btn px-4 py-3 text-[13px]">
          Quartiere <span className="font-mono">{slug}</span> non trovato.
          Scegli dal menu qui sopra.
        </div>
      )}
    </>
  );

  const profiloBlocco = profilo && (
    <ProfiloQuartiere profilo={profilo} nomeComune={NOME_COMUNE} />
  );

  // §12ii: Suspense NON qui — sta attorno alla colonna sinistra della
  // griglia desktop (row 3) e attorno all'elemento nel tree mobile. La
  // variabile è il contenuto puro, così ogni consumer decide l'ambito
  // dell'attesa. Se consiglio va in fallback silenzioso (null da
  // generaConsiglio), il chunk resta vuoto; su desktop la colonna
  // sinistra esiste comunque a mantenere il profilo alla sua larghezza.
  const consiglioLocaleBlocco = slugValido && profilo && (
    <ConsiglioLocale
      key={profilo.slug}
      comuneIstat={COMUNE_ISTAT}
      quartiereNome={profilo.nome}
    />
  );

  const raccomandazioniBlocco = (
    <Raccomandazioni livello={allerta?.livello ?? null} />
  );

  return (
    <>
      <Navbar
        ruolo="pubblica"
        nomeComune={NOME_COMUNE}
        slugComune={SLUG_COMUNE}
        voceCorrente="pubblica"
      />
      <div className="max-w-lg sm:max-w-2xl lg:max-w-6xl mx-auto py-6 sm:py-8 px-4 sm:px-6">
        {/* §1 — H1 di corpo pagina con solo il nome del comune in colore
            d'accento. La navbar contiene già "Comune di {nome}" in
            piccolo: qui il nome sta come titolo grande. Nessun H1
            altrove nella pagina (navbar usa <span>, non <h1>). */}
        <h1 className="font-display font-bold text-lv2 text-4xl sm:text-5xl tracking-display leading-none">
          {NOME_COMUNE}
        </h1>
        <p className="mt-3 text-[15px] text-slate max-w-prose leading-relaxed">
          Avvisi allerta sul comune, scegli il quartiere e guarda la mappa per trovare servizi vicino a te.
        </p>

        {/* ========================================================
            DUE TREE DUPLICATI (mobile+tablet vs desktop)
            ========================================================
            Solo tre blocchi convivono con questa duplicazione:
            cardAllerta, raccomandazioni, selettore. Tutto il resto
            (SezioneMappa con al suo interno "Vicini al centro",
            "Dove andare adesso" via slot, mappa e Avviso 112) e il
            profilo del quartiere sono renderizzati UNA SOLA VOLTA
            sotto entrambi i tree, perché sono full-width in tutte le
            larghezze e non hanno bisogno di riarrangiamento in
            colonne.

            Differenza fra i due tree: sul desktop Raccomandazioni e
            Selettore stanno in una row a 3fr:2fr (sono card corte,
            a piena larghezza diventerebbero strisce vuote); sul
            mobile stanno impilate.

            REGOLE PER MODIFICARE:
            - I frammenti (`cardAllertaBlocco`, ecc.) sono estratti in
              variabili sopra: **modifica QUELLE**, non il JSX qui.
            - Se aggiungi/rimuovi uno dei tre blocchi duplicati,
              **fallo in entrambi i tree** — nessun test protegge da
              questa dimenticanza.
            - Se l'ordine deve cambiare, applica la modifica a
              entrambi i tree per l'ordine mobile; solo al desktop
              se cambia solo la disposizione in colonne.
            - `space-y-5` fra i figli renderizzati: null/undefined
              non producono nodi DOM, quindi i blocchi condizionali
              vuoti non lasciano spazio fantasma. */}
        <div className="mt-5 space-y-5 lg:hidden">
          {cardAllertaBlocco}
          {raccomandazioniBlocco}
          {selettoreBlocco}
        </div>
        <div className="mt-5 space-y-5 hidden lg:block">
          {cardAllertaBlocco}
          {/* Row 2 — le due card affiancate. `items-stretch` (default
              del grid, esplicito per chiarezza) allinea le altezze;
              le card interne hanno `h-full flex flex-col` per
              riempire lo spazio verticale del proprio cell (§12ff). */}
          <div className="grid grid-cols-[3fr_2fr] gap-6 items-stretch">
            <div className="min-w-0">{raccomandazioniBlocco}</div>
            <div className="min-w-0">{selettoreBlocco}</div>
          </div>
        </div>

      {/* Sezione mappa: elenco "Vicini al centro" in cima, poi lo slot
          per "Dove andare adesso" (ConsiglioLocale in Suspense), poi
          la card unificata "Trova servizi vicino a te" (filtri +
          mappa + legenda), poi lo slot per l'Avviso 112 subito
          sotto la mappa. Il Suspense sul consiglio evita che l'attesa
          del modello blocchi la pagina: se `generaConsiglio` va in
          fallback silenzioso (null), lo slot rende null e non c'è
          spazio vuoto perché `space-y-5` interno usa il selettore
          fra siblings DOM. `key` sulla SezioneMappa rimonta il
          componente al cambio di contesto (geoloc o quartiere) e
          azzera i filtri categoria — semantica coerente. */}
      <div className="mt-5">
        {mappa && (
          <SezioneMappa
            key={coord ? "coord" : slugValido ? slug : "comune"}
            nomeComune={NOME_COMUNE}
            slugComune={SLUG_COMUNE}
            centro={mappa.centro}
            boundsComune={mappa.bounds}
            minZoom={mappa.minZoom}
            attribuzioniExtra={[`Dati punti: ${NOME_COMUNE} + OSM`]}
            fitBoundsQuartiere={slugValido ? boundsQ : null}
            quartiereEvidenziato={slugValido && profilo ? profilo.nome : null}
            puntiElenco={puntiElenco}
            modoElenco={modoElenco}
            latUtente={coord?.lat}
            lonUtente={coord?.lon}
            nomeQuartiere={slugValido && profilo ? profilo.nome : undefined}
            // `key` sui due slot: dentro `SezioneMappa` finiscono in un
            // array di figli statici del `<div className="space-y-5">`,
            // insieme all'elenco punti e alla card mappa. React scandisce
            // quell'array come una lista e chiede una key per ogni voce
            // creata fuori dal componente che la ospita (owner diverso).
            // Non li avvolgiamo in un `<div>` proprio in SezioneMappa
            // perché lo slot sopra collassa a null in due casi (nessun
            // quartiere selezionato, o consiglio agente in fallback
            // silenzioso): un wrapper resterebbe come `<div></div>` e
            // `space-y-5` gli aggiungerebbe il margine, comparendo come
            // spazio fantasma. La key è la risposta pulita al vincolo
            // React, non un tappabuchi — non toglierla "perché non
            // sembra una lista".
            slotSopraCardMappa={
              <Suspense key="consiglio" fallback={null}>{consiglioLocaleBlocco}</Suspense>
            }
            slotSottoMappa={<AvvisoEmrg key="avviso" />}
          />
        )}
      </div>

      {/* Profilo del quartiere in fondo: è materiale di contesto
          (persone per famiglia, abitazioni per edificio, distanza
          dal parco). Reso una sola volta perché è full-width in
          tutte le larghezze — nessun bisogno di duplicazione nei
          due tree. Assente quando non c'è un quartiere scelto. */}
      {profiloBlocco && (
        <div className="mt-5">{profiloBlocco}</div>
      )}

      </div>
      {/* §4 — Footer full-width con fondo bianco (come la navbar), contenuto
          centrato in max-w-6xl. Su desktop due colonne: link a sinistra,
          Fonti a destra su max-w-prose per leggibilità (non stirato a
          1088px). Su mobile impilati. Restyling in-place, NO componente
          condiviso: la home ha contenuto diverso e ha il suo footer. */}
      <footer className="mt-10 border-t border-rule bg-card">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 text-[12px] text-muted leading-relaxed flex flex-col gap-6 lg:flex-row lg:justify-between lg:items-start lg:gap-10">
          <div className="space-y-2 max-w-prose lg:max-w-sm lg:shrink-0">
            <div>
              <a href={`/${SLUG_COMUNE}/metodo`} className="underline text-slate hover:text-ink font-semibold">
                Metodo
              </a>
              {" — "}come è costruito il punteggio, cosa entra e cosa no,
              dove il sistema non usa un modello di linguaggio.
            </div>
            <div>
              <span className="text-slate font-semibold">Istanza dimostrativa</span>
              {" — "}i dati delle persone sono sintetici, non riguardano
              persone reali. La dashboard del coordinatore e la vista del
              volontario sono ad accesso libero, raggiungibili dalla
              pagina di accesso{" "}
              <a href={`/${SLUG_COMUNE}/login`} className="underline hover:text-slate">
                /{SLUG_COMUNE}/login
              </a>
              . Un'installazione operativa deve proteggere queste rotte.
            </div>
          </div>
          <div className="max-w-prose">
            <span className="text-slate font-semibold">Fonti:</span>{" "}
            livello di allerta dal bollettino ondate di calore del
            Ministero della Salute (via il repository{" "}
            <a
              href="https://github.com/ondata/ondate-calore"
              className="underline hover:text-slate"
              target="_blank"
              rel="noopener noreferrer"
            >
              onData
            </a>
            ). Profilo del quartiere e cartina delle province da
            ISTAT — Basi territoriali 2021, comune {COMUNE_ISTAT}.
            Distanze da{" "}
            <a
              href="https://www.openstreetmap.org/copyright"
              className="underline hover:text-slate"
              target="_blank"
              rel="noopener noreferrer"
            >
              OpenStreetMap contributors
            </a>
            . Temperature storiche da{" "}
            <a
              href="https://open-meteo.com/"
              className="underline hover:text-slate"
              target="_blank"
              rel="noopener noreferrer"
            >
              Open-Meteo
            </a>
            .
          </div>
        </div>
      </footer>
    </>
  );
}
