// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Cartina delle province dell'Emilia-Romagna, inline nella home `/`.
 * Selettore visivo di comune: Parma e Bologna cliccabili, il resto
 * della regione grigio decorativo.
 *
 * Server component: `fs.readFileSync` legge il file SVG statico
 * generato da `packages/ingest/svg_province_emiliaromagna.py`
 * (output in `apps/web/public/emilia-romagna-province.svg`, 11.77 KB,
 * 3 path + 2 centroidi come data-cx/data-cy — vedi §12ll/§12mm).
 *
 * Perché inline invece di <img src=".../emilia-romagna-province.svg">:
 * dentro un <img> le regioni non sono cliccabili, non si può wrappare
 * un <path> con un link. Inline restituisce controllo su ogni <path>
 * (hover, focus, link a /parma o /bologna via <a> SVG-native).
 *
 * Perché <a href> SVG-native invece di <Link> di Next:
 *   - <Link> genera un <a> HTML che non è un contenitore SVG valido
 *     e non può wrappare un <path>;
 *   - <a href> SVG (SVGAElement) è supportato in tutti i browser
 *     moderni, wrappa correttamente i <path>, e — vantaggio non
 *     secondario — funziona SENZA JavaScript. Coerente con il resto
 *     della pagina pubblica (form GET puro, hamburger via <details>).
 * Costo: navigazione full-page invece di client-side. Su una landing
 *   accettabile.
 *
 * Perché il parser è una regex e non un vero XML parser: il file lo
 * generiamo noi, il formato è fisso (tre <path> con class regione,
 * parma, bologna in quest'ordine). Se un giorno lo script cambia il
 * formato e la regex non trova un dato, viene lanciata un'eccezione
 * chiara — meglio errore a build/render time che una cartina muta.
 *
 * Nascosto sotto lg (§12mm): `hidden lg:block`, che è `display: none`
 * — così il markup NON è nel DOM per lettori di schermo su mobile
 * (evita duplicazione dei link Parma/Bologna già presenti nelle card).
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

interface Estrazione {
  viewBox: string;
  dRegione: string;
  parma: { d: string; cx: number; cy: number };
  bologna: { d: string; cx: number; cy: number };
}

function estraiDaSvg(svg: string): Estrazione {
  const viewBox = svg.match(/viewBox="([^"]+)"/)?.[1];
  if (!viewBox) {
    throw new Error(
      "cartina-province: viewBox non trovato in emilia-romagna-province.svg — " +
      "controllare che lo script python emetta l'attributo, oppure che il file non sia stato editato a mano.",
    );
  }

  const dRegione = svg.match(/class="regione"\s+d="([^"]+)"/)?.[1];
  if (!dRegione) {
    throw new Error(
      "cartina-province: path class=\"regione\" non trovato in emilia-romagna-province.svg — " +
      "regex non allineata al formato dell'output di packages/ingest/svg_province_emiliaromagna.py.",
    );
  }

  const provincia = (cls: "parma" | "bologna") => {
    const re = new RegExp(
      `class="${cls}"\\s+d="([^"]+)"\\s+data-cx="([^"]+)"\\s+data-cy="([^"]+)"`,
    );
    const m = svg.match(re);
    const d = m?.[1];
    const cxRaw = m?.[2];
    const cyRaw = m?.[3];
    if (d === undefined || cxRaw === undefined || cyRaw === undefined) {
      throw new Error(
        `cartina-province: path class="${cls}" con data-cx/data-cy non trovato ` +
        "in emilia-romagna-province.svg — lo script python deve emettere i centroidi " +
        "come attributi data-* sui path Parma e Bologna.",
      );
    }
    return { d, cx: Number(cxRaw), cy: Number(cyRaw) };
  };

  return {
    viewBox,
    dRegione,
    parma: provincia("parma"),
    bologna: provincia("bologna"),
  };
}

// Il file viene letto una sola volta al build/primo render — la
// costante di modulo è cachata da Next per tutta la vita del processo.
const CARTINA = estraiDaSvg(
  readFileSync(
    join(process.cwd(), "public", "emilia-romagna-province.svg"),
    "utf-8",
  ),
);

// Fill / hover / focus definiti dentro <style> scoped dell'SVG:
// - Non hardcoded nel file SVG generato (l'utente lo controlla qui).
// - Vale anche senza JavaScript.
// - I selettori .parma:hover / :focus-visible danno il feedback UI
//   richiesto (variazione di TINTA, non di dimensione, come da brief).
const STILE = `
  /* Regione: slate-300 come fill (era slate-200, troppo vicino allo
     sfondo pagina) + stroke slate-500 sottile per staccare la sagoma
     dallo sfondo senza scendere ulteriormente sul fill. Non più scuro
     del fill: oltre slate-300 il contrasto con l'arancione delle
     province cala invece di aumentare. */
  .regione {
    fill: #cbd5e1;
    stroke: #64748b;
    stroke-width: 1;
  }
  .parma, .bologna {
    fill: #FF7F02;             /* lv2 dal tailwind config = colore d'accento */
    transition: fill 120ms ease-out;
  }
  a:hover .parma, a:hover .bologna { fill: #E56A00; }
  a:focus-visible .parma, a:focus-visible .bologna {
    outline: none;
    fill: #E56A00;
    stroke: #16202B;
    stroke-width: 3;
    paint-order: stroke fill;
  }
  .label {
    fill: #FFFFFF;
    font-family: Archivo, system-ui, sans-serif;
    font-weight: 700;
    font-size: 22px;
    pointer-events: none;
    text-anchor: middle;
    dominant-baseline: middle;
    /* Halo scuro sottile per contrasto sull'arancione. Prima:
       rgba(22,32,43,0.35) stroke-width 3 — troppo trasparente per
       essere visibile a schermo (segnalato dall'utente su
       screenshot). Ora: ink pieno con stroke sottile.
       paint-order: stroke fill mette lo stroke SOTTO al fill, così
       il testo bianco resta pulito al centro. Dimensione e posizione
       invariate. */
    paint-order: stroke fill;
    stroke: #16202B;
    stroke-width: 2;
  }
`;

export function CartinaProvince() {
  const { viewBox, dRegione, parma, bologna } = CARTINA;
  return (
    <svg
      viewBox={viewBox}
      role="img"
      aria-label="Cartina dell'Emilia-Romagna con Parma e Bologna cliccabili"
      className="w-full h-auto"
    >
      <title>Scegli il comune sulla cartina</title>
      <style>{STILE}</style>
      <path className="regione" d={dRegione} />
      <a href="/parma">
        <title>Vai alla pagina pubblica di Parma</title>
        <path className="parma" d={parma.d} />
        <text className="label" x={parma.cx} y={parma.cy}>
          Parma
        </text>
      </a>
      <a href="/bologna">
        <title>Vai alla pagina pubblica di Bologna</title>
        <path className="bologna" d={bologna.d} />
        <text className="label" x={bologna.cx} y={bologna.cy}>
          Bologna
        </text>
      </a>
    </svg>
  );
}
