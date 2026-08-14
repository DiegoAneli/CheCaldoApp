/**
 * Pagina /metodo per un comune. Path: /{slug}/metodo.
 *
 * Contenuto condizionale al ramo di allerta (§12vv):
 *   - ramo `stima` (Parma e altri comuni fuori dalle 27 città):
 *     "Perché serve una stima" + le 5 sezioni della stima
 *     (come-funziona, cosa-non-e, quanto-vale, anticipo-livello-3,
 *     perche-sottostima) + dove-llm + fonti.
 *   - ramo `bollettino` (Bologna e altre 26 città): "Come funziona
 *     il bollettino ministeriale" (sostituisce sia il vecchio banner
 *     in cima sia le 5 sezioni della stima, che non si applicano al
 *     livello di quel comune) + dove-llm + fonti.
 *
 * Il refactor di §12vv ha estratto tutte le sezioni verbatim
 * identiche in `apps/web/components/metodo/*.tsx` per evitare che il
 * ramo bollettino renderizzasse contenuti sulla stima (percentuali
 * di backtest, "perché dichiariamo la sottostima" — non pertinenti
 * al livello ministeriale del comune). Gli attributi per-comune
 * (fonti specifiche + nota ARPA-ER) stanno in
 * `lib/comuni-metodo.tsx`, non condizionali sparsi nel JSX.
 *
 * Il wrapper `<Sezione>` resta qui in page.tsx: se serve altrove lo
 * estrarremo allora.
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import Link from "next/link";
import { notFound } from "next/navigation";
import { Masthead } from "@/components/masthead";
import { sql } from "@/lib/db";
import { risolviComune } from "@/lib/comuni";
import { attributiMetodo } from "@/lib/comuni-metodo";
import { allertaCorrente } from "@checaldo/db";
import {
  MetodoComeFunzionaLaStima,
  TITOLO_COME_FUNZIONA_LA_STIMA,
} from "@/components/metodo/come-funziona-la-stima";
import {
  MetodoCosaNonE,
  TITOLO_COSA_NON_E,
} from "@/components/metodo/cosa-non-e";
import {
  MetodoQuantoVale,
  TITOLO_QUANTO_VALE,
} from "@/components/metodo/quanto-vale";
import {
  MetodoAnticipoLivello3,
  TITOLO_ANTICIPO_LIVELLO_3,
} from "@/components/metodo/anticipo-livello-3";
import {
  MetodoPercheSottostima,
  TITOLO_PERCHE_SOTTOSTIMA,
} from "@/components/metodo/perche-sottostima";
import {
  MetodoDoveLLM,
  TITOLO_DOVE_LLM,
} from "@/components/metodo/dove-llm";
import {
  MetodoFonti,
  TITOLO_FONTI,
} from "@/components/metodo/fonti";
import {
  MetodoComeFunzionaIlBollettino,
  TITOLO_COME_FUNZIONA_IL_BOLLETTINO,
} from "@/components/metodo/come-funziona-il-bollettino";

export const metadata = {
  title: "Metodo — CheCaldo!",
  description:
    "Come è calcolato il livello di allerta caldo per il tuo comune.",
};

export default async function Metodo({
  params,
}: {
  params: Promise<{ comune: string }>;
}) {
  const { comune: comuneSlug } = await params;
  const comune = risolviComune(comuneSlug);
  if (!comune) notFound();

  const { istat: comuneIstat, nome: nomeComune, slug: slugComune } = comune;
  const allerta = await allertaCorrente(sql, comuneIstat);
  const ramo: "bollettino" | "stima" = allerta?.provenienza ?? "stima";
  const {
    fontiSpecifiche,
    notaMetodoBollettino,
    fontiPuntiFreschi,
  } = attributiMetodo(slugComune);

  // §12xx: il bullet "il livello di allerta" in MetodoDoveLLM ha
  // formulazioni diverse sui due rami — non solo il rimando finale,
  // ma tutta la descrizione dopo i due punti. La versione precedente
  // ("viene dal Ministero (se X è nel bollettino) o dal calcolo
  // statistico") aveva un condizionale che stonava su entrambi i
  // rami (Bologna È nel bollettino, Parma NON è nelle 27 — la pagina
  // lo ha appena spiegato in entrambi i casi). Ora simmetriche:
  // ogni ramo apre col caso della pagina, poi accenna all'altro.
  // Sul ramo stima si usa il default del componente; sul ramo
  // bollettino si passa la formulazione affermativa con link a
  // /parma/metodo (dove le sezioni della stima sono documentate).
  const descrizioneLivelloAllerta =
    ramo === "bollettino" ? (
      <>
        viene direttamente dal Ministero della Salute; per i comuni
        fuori dalle 27 città è calcolato statisticamente su
        Open-Meteo, documentato in{" "}
        <Link href="/parma/metodo" className="underline hover:text-ink">
          /parma/metodo
        </Link>
      </>
    ) : undefined;

  return (
    <div className="max-w-3xl mx-auto py-8 px-4">
      <Masthead sottotitolo="Come calcoliamo il livello di allerta" />

      <p className="mt-5 text-[14px] leading-relaxed text-ink max-w-prose">
        <Link
          href={`/${slugComune}`}
          className="underline text-slate hover:text-ink"
        >
          Torna alla pagina pubblica di {nomeComune}
        </Link>
      </p>

      {ramo === "bollettino" ? (
        // RAMO BOLLETTINO: sostituisce sia il vecchio banner sia
        // TUTTE le sezioni della stima. La sezione unificata dice
        // da dove arriva il livello di questo comune, come funziona
        // il bollettino, cosa succede quando non arriva, e rimanda
        // a /parma/metodo per il metodo di stima.
        <Sezione titolo={TITOLO_COME_FUNZIONA_IL_BOLLETTINO}>
          <MetodoComeFunzionaIlBollettino
            nomeComune={nomeComune}
            notaComune={notaMetodoBollettino}
          />
        </Sezione>
      ) : (
        // RAMO STIMA: "Perché serve una stima" (inline — contiene
        // ramificazioni condizionali specifiche a questo ramo) +
        // le 5 sezioni della stima come componenti estratti.
        <>
          <Sezione titolo="Perché serve una stima">
            <p>
              Il Ministero della Salute pubblica ogni giorno un{" "}
              <b>bollettino di allerta caldo</b> per{" "}
              <b>27 città italiane</b>: i <b>capoluoghi di regione</b>{" "}
              più i <b>comuni sopra 200.000 abitanti</b>.{" "}
              {nomeComune} <b>non</b> è tra queste. Non è un caso
              singolare: Parma ha circa <b>198.000 abitanti</b>, sotto
              la soglia per poche migliaia, e con lei la maggior parte
              dei comuni italiani. CheCaldo! è pensato per loro —
              comuni &laquo;grandi ma non abbastanza&raquo; per il
              perimetro ministeriale, dove chi si prende cura di
              persone fragili deve comunque decidere ogni mattina chi
              contattare.
            </p>
            <p>
              <b>Le soglie del bollettino ministeriale sono calibrate
              sulla mortalità storica di ciascuna città</b>:
              vent&apos;anni di dati epidemiologici che collegano
              temperatura, ricoveri e decessi. Le soglie della nostra
              stima invece sono <b>percentili statistici</b> della
              temperatura apparente locale (85° / 95° / 98° della
              climatologia). È la differenza che spiega perché una
              stima non è un bollettino, e perché ovunque nella pagina
              pubblica il livello stimato è dichiarato tale. Per{" "}
              {nomeComune} il bollettino ministeriale non esiste,
              quindi la stima è quello che abbiamo.
            </p>
            <p>
              Per rispondere lo stesso alla domanda &laquo;oggi a{" "}
              {nomeComune} quanto fa caldo davvero per una persona
              anziana?&raquo; ci siamo costruiti una <b>stima
              locale</b>, che viene calcolata ogni giorno
              automaticamente. Il livello che vedi in cima alla pagina
              pubblica &mdash; quando dice &laquo;livello stimato, non
              ufficiale&raquo; &mdash; è il risultato di questa stima.
            </p>
          </Sezione>

          <Sezione titolo={TITOLO_COME_FUNZIONA_LA_STIMA}>
            <MetodoComeFunzionaLaStima />
          </Sezione>

          <Sezione titolo={TITOLO_COSA_NON_E}>
            <MetodoCosaNonE />
          </Sezione>

          <Sezione titolo={TITOLO_QUANTO_VALE}>
            <MetodoQuantoVale />
          </Sezione>

          <Sezione titolo={TITOLO_ANTICIPO_LIVELLO_3}>
            <MetodoAnticipoLivello3 />
          </Sezione>

          <Sezione titolo={TITOLO_PERCHE_SOTTOSTIMA}>
            <MetodoPercheSottostima />
          </Sezione>
        </>
      )}

      {/* Sezioni comuni ai due rami: dove il modello di linguaggio
          si usa e dove no + fonti dei dati (con voci specifiche
          del comune dai `fontiSpecifiche` di lib/comuni-metodo.tsx). */}
      <Sezione titolo={TITOLO_DOVE_LLM}>
        <MetodoDoveLLM
          nomeComune={nomeComune}
          descrizioneLivelloAllerta={descrizioneLivelloAllerta}
          fontiPuntiFreschi={fontiPuntiFreschi}
        />
      </Sezione>

      <Sezione titolo={TITOLO_FONTI}>
        <MetodoFonti fontiSpecifiche={fontiSpecifiche} />
      </Sezione>

      <p className="mt-8 text-[14px] leading-relaxed text-slate max-w-prose">
        <Link
          href={`/${slugComune}`}
          className="underline hover:text-ink"
        >
          ← Torna alla pagina pubblica di {nomeComune}
        </Link>
      </p>
    </div>
  );
}

function Sezione({
  titolo,
  children,
}: {
  titolo: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-8">
      <h2 className="font-display font-semibold text-[18px] mb-3">{titolo}</h2>
      <div className="space-y-3 text-[14.5px] leading-relaxed text-ink max-w-prose">
        {children}
      </div>
    </section>
  );
}
