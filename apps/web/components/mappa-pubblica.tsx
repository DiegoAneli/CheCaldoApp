"use client";

/**
 * Mappa pubblica MapLibre — MOD05 BLOCCO 4 + MOD06 layer punti freschi.
 *
 * Basemap CartoCDN Positron (no key, licenza permissiva, toni chiari che
 * lasciano leggere la coropleta sopra). Il blocco visto in fase §12i era
 * legato alla versione v6 di maplibre-gl: dopo downgrade a v4 lo style
 * carica normalmente — pin duro in `apps/web/package.json`. Etichette
 * del basemap (symbol layer) sopra la coropleta grazie all'ancoraggio
 * `primaEtichetta`.
 *
 * Layer coropleta da `/api/tiles/{z}/{x}/{y}` (MVT da `pubblico.v_mappa`,
 * §12e). Layer punti freschi da `/api/tiles-punti/{z}/{x}/{y}` (MVT da
 * `pubblico.punto_fresco`, §12k Parte 3): tre layer circle sovrapposti
 * con visibilità per zoom differenziata perché a zoom cittadino 343
 * punti diventano una macchia che copre la coropleta.
 *
 * Due scale, due domande: a scala cittadina "dove il rischio si
 * concentra" (coropleta), a scala di via "dove vado adesso" (punti).
 * Convivono con curve opposte su fill-opacity e circle-radius/opacity:
 * la coropleta perde peso 12.5→14 (0.62 → 0.15, non a zero — un'ombra
 * di colore aiuta a orientarsi), i punti crescono 11→15 (raggio ~4→8,
 * opacity 0.6→0.95). MaxZoom della mappa 15 (era 12.9): oltre non ha
 * senso zoomare per il livello di dettaglio dei dati.
 *
 * Soglie di visibilità per uso ("livello di sosta"):
 *   - rifugi (biblioteca, CC, centro sociale) — dove si sta ore:
 *     minzoom = 10 (sempre visibili). ~68 punti, la sola classe che
 *     ha senso in vista comunale.
 *   - sosta breve (farmacia, parco, fontanella, casetta Iren):
 *     minzoom = 11.5 (zoom quartiere).
 *   - chiese: minzoom = 12 (111 punti, ripiego, appaiono a zoom via).
 * Sopra zoom 13 sono tutti visibili come conseguenza delle soglie.
 * Colore per categoria semantica (rifugio blu, sosta_fresca verde,
 * ombra_aperta verde chartreuse, acqua azzurro, ripiego grigio).
 *
 * Deroga alla decisione "mappa read-only" (§12i, che riguardava le
 * sezioni): sui punti freschi il singolo oggetto è il dato — clic apre
 * popup con nome, tipo, orari o "verifica gli orari" quando mancano,
 * accessibilità carrozzina se dichiarata, fonte OSM o Iren.
 *
 * Attribuzione: Positron include "© OpenStreetMap contributors, © CARTO"
 * nella style JSON e MapLibre la mostra automaticamente. `customAttribution`
 * aggiunge "Sezioni: ISTAT CC-BY 4.0" per la coropleta e "Casette d'acqua:
 * Iren via Comune di Parma" per le 5 casette gestite.
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { useEffect, useRef } from "react";
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { MAPLIBRE_FILL_COLOR } from "@/lib/mappa-colori";
import type { LayerSpecification, ExpressionSpecification, FilterSpecification } from "maplibre-gl";
import { tipiVisibili, type Categoria } from "@/components/filtri-categoria";

// `centro`, `boundsComune` e `minZoom` arrivano come prop dal server —
// `metadatiCartografici(sql, comune)` in `packages/db` li calcola dal
// centroide/envelope di `pubblico.sezione`. Refactor multi-comune (§12n,
// MOD07 BLOCCO 2): erano hardcoded `CENTRO_PARMA` / `MAX_BOUNDS_PARMA`
// / `MIN_ZOOM_PARMA`. La formula del `minZoom` sulla viewport 734×600 è
// nella query lato server; se cambia l'altezza del container (`h-[600px]`)
// va ricalcolata lì.

// `maxZoom = 15` copre due domande a scale diverse: a scala cittadina
// "dove il rischio si concentra" (coropleta), a scala di via "dove
// vado adesso" (punti). Il vecchio limite 12.9 esisteva per non
// mostrare la coropleta sfaldata; ora la coropleta svanisce con lo
// zoom (fill-opacity interpolate 0.62→0.15 fra zoom 12.5 e 14): a
// 14+ i buchi dei parchi/servizi non sono più un problema visivo
// perché tutto lo strato è quasi trasparente — resta un'ombra di
// colore per orientarsi. Costante generica (non "Parma"): a Bologna
// vale lo stesso — la formula z_fit del comune sta lato server e
// resta sotto 15 per ogni comune realistico d'Italia.
const MAX_ZOOM = 15;

// Tipi OSM (colonna `tipo`) per layer. Usati sia dal filtro base che
// dal reset filtri utente (§12aa punto 2). Se cambiassero i tipi in
// `pubblico.punto_fresco`, va aggiornata questa mappa insieme a
// `TIPI_PER_CATEGORIA` in `filtri-categoria.tsx`.
const TIPI_BASE_LAYER = {
  "punti-rifugi":      ["biblioteca", "centro_commerciale", "centro_sociale"],
  "punti-sosta-breve": ["farmacia", "parco", "fontanella", "casetta_iren"],
  "punti-chiese":      ["chiesa"],
} as const;
const MINZOOM_BASE_LAYER = {
  "punti-rifugi":      10,
  "punti-sosta-breve": 11.5,
  "punti-chiese":      12,
} as const;
type IdLayerPunti = keyof typeof TIPI_BASE_LAYER;

// Palette semantica per categoria dei punti freschi. Coerente con la
// tassonomia in schema.sql (colonna `categoria` GENERATED):
//   rifugio      blu scuro    - chiuso e climatizzato, si sta ore
//   sosta_fresca verde        - chiuso, sosta breve
//   ombra_aperta verde chartreuse - parco
//   acqua        azzurro      - bere
//   ripiego      grigio       - chiesa
// Scelta cromatica: tutti in gamma cool-neutra per non collidere con la
// coropleta rossa/gialla (YlOrRd) sotto. Stroke bianco = pop out.
const COLORE_CATEGORIA: ExpressionSpecification = [
  "match",
  ["get", "categoria"],
  "rifugio",      "#1e3a8a",
  "sosta_fresca", "#059669",
  "ombra_aperta", "#65a30d",
  "acqua",        "#0284c7",
  "ripiego",      "#78716c",
  "#555555",
];

// Etichette italiane per il popup — indipendenti da uno slug OSM.
const TIPO_LABEL: Record<string, string> = {
  biblioteca:         "Biblioteca",
  farmacia:           "Farmacia",
  centro_commerciale: "Centro commerciale",
  centro_sociale:     "Centro sociale",
  chiesa:             "Chiesa",
  fontanella:         "Fontanella",
  parco:              "Parco",
  casetta_iren:       "Casetta dell'acqua (Iren)",
};

function esc(s: unknown): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]!));
}

interface Props {
  /** Nome del comune (es. "Parma", "Bologna"), per aria-label. */
  nomeComune: string;
  /**
   * Slug URL del comune. Determina il path delle rotte MVT
   * (`/api/${slugComune}/tiles/…` e `/api/${slugComune}/tiles-punti/…`)
   * dopo il refactor routing per path (§12t).
   */
  slugComune: string;
  /** Centro geometrico del comune servito, [lng, lat]. Dal server, per-comune. */
  centro: [number, number];
  /** Bounds SW/NE del comune + buffer 300 m, per `maxBounds`. Dal server. */
  boundsComune: [[number, number], [number, number]];
  /** Zoom minimo che inquadra il comune intero, calcolato lato server. */
  minZoom: number;
  /**
   * Attribuzioni aggiuntive per i dati specifici del comune (oltre
   * ISTAT/OSM che sono standard). Esempi:
   *   - Parma: `["Casette d'acqua: Iren via Comune di Parma"]`
   *   - Bologna: `["Dati punti: Comune di Bologna CC-BY 4.0"]`
   * L'attribuzione standard (ISTAT, OSM) è aggiunta dal componente.
   */
  attribuzioniExtra?: string[];
  /**
   * Extent SW/NE lng-lat del quartiere selezionato. Se presente, il
   * componente chiama `fitBounds(fitBoundsQuartiere, { padding: 40 })`
   * dentro `map.on("load")`. Se `null`, resta la vista comunale
   * (`centro` + zoom di partenza). Un quartiere che copre quasi tutto
   * il comune spinge il fit sotto `minZoom`: MapLibre clampa e si vede
   * l'intero comune — comportamento atteso, non un errore.
   */
  fitBoundsQuartiere?: [[number, number], [number, number]] | null;
  /**
   * Nome (raw, non slug) del quartiere da evidenziare col contorno
   * scuro. Deve combaciare con la property `quartiere` esposta nel MVT
   * (`packages/db/src/query.ts` `mvtSezioni`). Se `null`, il layer di
   * evidenza resta filtrato su un valore che non matcha nulla.
   */
  quartiereEvidenziato?: string | null;
  /**
   * Filtri categoria attivi (§12aa). Set vuoto = mostra tutti i punti
   * con i minzoom stratificati di default (10/11.5/12). Set con ≥ 1
   * categoria = mostra solo i tipi di quelle categorie E abbassa il
   * minzoom di TUTTI i layer visibili a `minZoom` della mappa — filtro
   * esplicito prevale su minzoom (l'utente ha chiesto attivamente
   * quella categoria, non ha senso nasconderla per una regola
   * anti-affollamento pensata per la vista non-filtrata).
   */
  filtri?: Set<Categoria>;
}

export function MappaPubblica({
  nomeComune,
  slugComune,
  centro,
  boundsComune,
  minZoom,
  attribuzioniExtra,
  fitBoundsQuartiere,
  quartiereEvidenziato,
  filtri,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  // Ref alla mappa istanziata, per applicare i filtri dinamicamente
  // senza rimontare (useEffect delle deps filtri sotto).
  const mapRef = useRef<maplibregl.Map | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json",
      center: centro,
      zoom: Math.max(minZoom + 0.8, 11),  // apre poco sopra il fit del comune
      minZoom,
      maxZoom: MAX_ZOOM,
      // `maxBounds` resta attivo anche quando fitBounds zooma su un
      // quartiere: chi trascina fuori dal comune torna dentro.
      maxBounds: boundsComune,
      attributionControl: false,
    });
    mapRef.current = map;

    // Difesa contro il silenzio: MapLibre inghiotte gli errori dei
    // source e degli style se nessuno ascolta. Mantenere anche in
    // produzione — è economico e ha già evitato due bug ciechi in §12i.
    // eslint-disable-next-line no-console
    map.on("error", (e) => console.error("maplibre error", e.error));

    const attribuzioni = [
      "Sezioni: ISTAT CC-BY 4.0",
      "Punti freschi: OpenStreetMap ODbL",
      ...(attribuzioniExtra ?? []),
    ];
    map.addControl(
      new maplibregl.AttributionControl({
        customAttribution: attribuzioni.join(" &middot; "),
        compact: false,
      }),
    );
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");

    map.on("load", () => {
      // MapLibre impone `tileSize: 512` sui source vettoriali: passare
      // 256 fa lanciare un'eccezione dentro `addSource` che uccide in
      // silenzio la coropleta. Si lascia il default. `minzoom: 0` /
      // `maxzoom: 22` = "il server serve tile a qualunque zoom"; per
      // limitare la visibilità del layer si usano `minzoom`/`maxzoom`
      // sul LAYER, non sul source.
      map.addSource("sezioni", {
        type: "vector",
        tiles: [`${window.location.origin}/api/${slugComune}/tiles/{z}/{x}/{y}`],
        minzoom: 0,
        maxzoom: 22,
      });
      // Inserisco il layer PRIMA delle label del basemap, così i nomi
      // di vie e quartieri restano leggibili sopra la coropleta.
      // Positron espone symbol layer, quindi `primaEtichetta` è
      // definito. Il ramo `else` resta come guardia: se in futuro lo
      // style non avesse symbol layer, `addLayer(spec, undefined)`
      // lancerebbe "Layer with id 'undefined' does not exist".
      const primaEtichetta = map.getStyle().layers?.find(
        (l: LayerSpecification) => l.type === "symbol",
      )?.id;
      // Opacity interpolate: piena fino a 12.5 (scala cittadina, la
      // coropleta è l'informazione principale), lineare fino a 0.15 a
      // zoom 14 (scala di via, i punti sono l'informazione principale
      // ma un'ombra di colore aiuta ancora a orientarsi). Il contorno
      // segue la stessa curva, altrimenti a zoom alto resta una griglia
      // scura di bordi su sezioni ormai invisibili.
      const specSezioni: LayerSpecification = {
        id: "sezioni-fill",
        type: "fill",
        source: "sezioni",
        "source-layer": "sezioni",
        paint: {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          "fill-color": MAPLIBRE_FILL_COLOR as any,
          "fill-opacity": [
            "interpolate", ["linear"], ["zoom"],
            12.5, 0.62,
            14, 0.15,
          ],
          "fill-outline-color": [
            "interpolate", ["linear"], ["zoom"],
            12.5, "rgba(0,0,0,0.28)",
            14, "rgba(0,0,0,0.05)",
          ],
        },
      };
      if (primaEtichetta) {
        map.addLayer(specSezioni, primaEtichetta);
      } else {
        map.addLayer(specSezioni);
      }

      // Contorno del quartiere selezionato: layer `line` sopra la
      // coropleta, filtrato sulla property `quartiere` esposta dal MVT.
      // Non tocca `fill-color` delle sezioni — nasconderebbe il dato,
      // che è la ragione per cui la mappa esiste. Se
      // `quartiereEvidenziato` è null, il filtro punta a "" e non
      // combacia con nulla, quindi il layer resta invisibile.
      const specEvidenza: LayerSpecification = {
        id: "quartiere-evidenza",
        type: "line",
        source: "sezioni",
        "source-layer": "sezioni",
        filter: ["==", ["get", "quartiere"], quartiereEvidenziato ?? ""],
        paint: {
          "line-color": "#1a2530",
          "line-width": 2,
          "line-opacity": 0.9,
        },
      };
      map.addLayer(specEvidenza);

      // ------------- Punti freschi (MOD06 Parte 3) -------------
      // Source separato: rotta MVT indipendente per tenere cache e
      // visibilità zoom disaccoppiate dalle sezioni.
      map.addSource("punti-freschi", {
        type: "vector",
        tiles: [`${window.location.origin}/api/${slugComune}/tiles-punti/{z}/{x}/{y}`],
        minzoom: 0,
        maxzoom: 22,
      });

      // Tre layer con visibilità zoom differenziata + raggio/opacity
      // interpolate su zoom. Raggruppati per uso ("livello di sosta"):
      // "dove si sta ore" (rifugio) sempre visibili, "dove si passa un
      // momento" (sosta breve) a zoom quartiere, chiese a zoom via.
      // A zoom cittadino 343 punti diventerebbero una macchia che
      // copre la coropleta; a scala di via il popup non è utilizzabile
      // se i pallini restano piccoli e trasparenti come a scala
      // cittadina. Le due esigenze convivono con l'interpolate:
      // raggio cresce ~4→8 (5.5→10 le casette Iren), opacity
      // 0.6→0.95 fra zoom 11 e 15 — inverso della coropleta.
      //
      // Ordine di addLayer: chiese prima (sotto), rifugi ultimi
      // (sopra), così un rifugio non viene coperto da una chiesa
      // vicina quando entrambi sono visibili.

      // Opacity condivise fra i 3 layer punti — solo dove NON serve
      // combinare con altre espressioni per-feature. Il raggio invece
      // sta scritto per esteso in ogni layer: MapLibre ammette un
      // solo interpolate su zoom per property, quindi non si può
      // definire una costante RAGGIO_STD e poi avvolgerla in un case
      // per feature (es. casetta_iren più grande) — la forma corretta
      // è interpolate all'esterno, case dentro ogni stop.
      const OPACITA_PUNTO: ExpressionSpecification = [
        "interpolate", ["linear"], ["zoom"],
        11, 0.6,
        15, 0.95,
      ];
      const OPACITA_STROKE: ExpressionSpecification = [
        "interpolate", ["linear"], ["zoom"],
        11, 0.75,
        15, 1,
      ];

      // Chiese: ripiego, 111 punti, minzoom 12 — sotto quel livello
      // affollerebbero. Sopra 13 sono comunque tutte visibili come
      // gli altri layer (la richiesta "sopra zoom 13 mostra tutti i
      // tipi" è già soddisfatta dalle soglie 10/11.5/12 che sono
      // tutte <13). Raggio leggermente più piccolo del layer
      // sosta-breve — segnale visivo che è ripiego, non prima scelta.
      map.addLayer({
        id: "punti-chiese",
        type: "circle",
        source: "punti-freschi",
        "source-layer": "punti_freschi",
        minzoom: 12,
        filter: ["==", ["get", "tipo"], "chiesa"],
        paint: {
          "circle-radius": [
            "interpolate", ["linear"], ["zoom"],
            12, 3.5,
            15, 7,
          ],
          "circle-color": COLORE_CATEGORIA,
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": 1,
          "circle-opacity": OPACITA_PUNTO,
          "circle-stroke-opacity": OPACITA_STROKE,
        },
      });

      // Sosta breve (farmacia, parco, fontanella, casetta Iren):
      // minzoom 11.5. Casetta Iren tenuta più grande del resto del
      // layer — impianto gestito, dato ufficiale, si nota anche
      // dentro la stessa scala.
      map.addLayer({
        id: "punti-sosta-breve",
        type: "circle",
        source: "punti-freschi",
        "source-layer": "punti_freschi",
        minzoom: 11.5,
        filter: [
          "match",
          ["get", "tipo"],
          ["farmacia", "parco", "fontanella", "casetta_iren"],
          true,
          false,
        ],
        paint: {
          // MapLibre ammette un solo interpolate su zoom per property:
          // qui devono convivere la crescita col zoom (4→8) e la
          // maggiorazione per la casetta Iren (5.5→10). Forma
          // corretta: interpolate su zoom all'esterno, `case` per
          // tipo dentro ogni stop. La costante condivisa RAGGIO_STD
          // non è utilizzabile qui (avvolgerla in un case rimette
          // due interpolate zoom-based sotto la stessa property).
          "circle-radius": [
            "interpolate", ["linear"], ["zoom"],
            11, ["case", ["==", ["get", "tipo"], "casetta_iren"], 5.5, 4],
            15, ["case", ["==", ["get", "tipo"], "casetta_iren"], 10, 8],
          ],
          "circle-color": COLORE_CATEGORIA,
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": 1.25,
          "circle-opacity": OPACITA_PUNTO,
          "circle-stroke-opacity": OPACITA_STROKE,
        },
      });

      // Rifugi (biblioteca, CC, centro sociale): sempre visibili
      // (minzoom 10 = MIN_ZOOM_PARMA 10.2 arrotondato in giù).
      // ~68 punti, unica classe che ha senso in vista comunale —
      // "dove si sta ore" è la prima domanda di chi apre la mappa.
      map.addLayer({
        id: "punti-rifugi",
        type: "circle",
        source: "punti-freschi",
        "source-layer": "punti_freschi",
        minzoom: 10,
        filter: [
          "match",
          ["get", "tipo"],
          ["biblioteca", "centro_commerciale", "centro_sociale"],
          true,
          false,
        ],
        paint: {
          "circle-radius": [
            "interpolate", ["linear"], ["zoom"],
            10, 4.5,
            15, 8.5,
          ],
          "circle-color": COLORE_CATEGORIA,
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": 1.5,
          "circle-opacity": OPACITA_PUNTO,
          "circle-stroke-opacity": OPACITA_STROKE,
        },
      });

      // Popup al clic: nome, tipo in italiano, orari (o "verifica gli
      // orari" quando manca), accessibile carrozzina se dichiarato, fonte.
      // Deroga alla decisione "read-only" (§12i): sui punti il singolo
      // oggetto È il dato. Cursor pointer sull'hover per suggerire il clic.
      const layerCliccabili = ["punti-rifugi", "punti-sosta-breve", "punti-chiese"];
      for (const layerId of layerCliccabili) {
        map.on("click", layerId, (e) => {
          if (!e.features || e.features.length === 0) return;
          const f = e.features[0];
          if (!f) return;
          const p = f.properties ?? {};
          const nome = String(p.nome ?? "").trim();
          const tipoIt = TIPO_LABEL[String(p.tipo)] ?? String(p.tipo);
          const titolo = nome.length > 0 ? nome : tipoIt;
          const orari = String(p.orari ?? "").trim();
          const indirizzo = String(p.indirizzo ?? "").trim();
          const fonte = p.fonte === "iren" ? "Iren via Comune di Parma" : "OpenStreetMap";
          const accessibile = p.accessibile === "yes"
            ? "<div style=\"font-size:11px;color:#059669;margin-top:2px\">Accessibile in carrozzina</div>"
            : "";
          const rigaIndirizzo = indirizzo.length > 0
            ? `<div style="font-size:12px;margin-top:4px;color:#555">${esc(indirizzo)}</div>`
            : "";
          const rigaOrari = orari.length > 0
            ? `<div style="font-size:12px;margin-top:4px"><b>Orari:</b> ${esc(orari)}</div>`
            : `<div style="font-size:12px;margin-top:4px;color:#c26400"><b>Orari:</b> verifica gli orari</div>`;
          const html =
            `<div style="font-family:system-ui;padding:2px 4px;font-size:13px;line-height:1.4;max-width:260px">` +
              `<div style="font-weight:600">${esc(titolo)}</div>` +
              `<div style="font-size:11.5px;color:#666;text-transform:uppercase;letter-spacing:0.04em">${esc(tipoIt)}</div>` +
              rigaIndirizzo +
              rigaOrari +
              accessibile +
              `<div style="font-size:11px;color:#999;margin-top:6px">Fonte: ${esc(fonte)}</div>` +
            `</div>`;
          new maplibregl.Popup({ closeButton: true, closeOnClick: true, maxWidth: "280px" })
            .setLngLat(e.lngLat)
            .setHTML(html)
            .addTo(map);
        });
        map.on("mouseenter", layerId, () => { map.getCanvas().style.cursor = "pointer"; });
        map.on("mouseleave", layerId, () => { map.getCanvas().style.cursor = ""; });
      }

      // Se page.tsx ha passato i bounds del quartiere, zooma. `padding: 40`
      // lascia respiro attorno; `duration: 0` evita l'animazione (il
      // componente si rimonta a ogni cambio ?q= e la transizione da
      // "vista comunale" a "vista quartiere" partirebbe comunque da
      // capo). Se il bounds richiesto porta sotto `minZoom` del comune,
      // MapLibre clampa e resta la vista del comune — comportamento
      // atteso per i quartieri più estesi.
      if (fitBoundsQuartiere) {
        map.fitBounds(fitBoundsQuartiere, { padding: 40, duration: 0, animate: false });
      }

      // Testo del basemap con alone bianco per leggibilità sopra la
      // coropleta: Positron rende le etichette in grigio chiaro, che
      // sui rossi/arancioni delle sezioni ad alta concentrazione
      // scompaiono. Halo bianco + inchiostro slate scuro = testo
      // leggibile sia sui grigi del basemap sia sopra qualunque
      // classe di colore della coropleta. Non tocca dati né palette.
      map.getStyle().layers
        .filter((l: LayerSpecification) => l.type === "symbol")
        .forEach((l: LayerSpecification) => {
          map.setPaintProperty(l.id, "text-halo-color", "#ffffff");
          map.setPaintProperty(l.id, "text-halo-width", 1.5);
          map.setPaintProperty(l.id, "text-color", "#3a4a5a");
        });
    });

    return () => {
      mapRef.current = null;
      map.remove();
    };
  }, []);

  // ------------------------------------------------ §12aa filtri categoria
  // Un secondo useEffect risponde ai cambi di `filtri` senza rimontare
  // la mappa. Per ogni layer punti calcola l'intersezione fra il tipo
  // base del layer e i tipi selezionati dai filtri; applica setFilter
  // e setLayerZoomRange di conseguenza.
  //
  // Regola sul minzoom (§12aa punto 2, decisione motivata): quando è
  // attivo ALMENO un filtro, tutti i layer visibili ignorano il minzoom
  // stratificato e appaiono già dallo zoom minimo della mappa. Motivo:
  // l'utente ha esplicitato l'intent, il minzoom serviva ad evitare il
  // puntinismo del caso non-filtrato. Se dopo un filtro il layer non
  // ha più alcun tipo da mostrare, viene nascosto (filtro impossibile).
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const applica = () => {
      const attivi = tipiVisibili(filtri ?? new Set<Categoria>());
      for (const layerId of Object.keys(TIPI_BASE_LAYER) as IdLayerPunti[]) {
        if (!map.getLayer(layerId)) continue;
        const tipiBase = TIPI_BASE_LAYER[layerId];
        if (attivi === null) {
          // Nessun filtro: ripristina il filtro base + minzoom stratificato.
          map.setFilter(layerId, [
            "match", ["get", "tipo"], [...tipiBase], true, false,
          ] as FilterSpecification);
          map.setLayerZoomRange(layerId, MINZOOM_BASE_LAYER[layerId], MAX_ZOOM);
        } else {
          const intersezione = tipiBase.filter((t) => attivi.includes(t));
          if (intersezione.length === 0) {
            // Nessun tipo del layer sopravvive al filtro: layer invisibile.
            // Filtro "impossibile" ["==", ["literal", 1], ["literal", 0]].
            map.setFilter(layerId, ["==", ["literal", 1], ["literal", 0]] as FilterSpecification);
          } else {
            map.setFilter(layerId, [
              "match", ["get", "tipo"], intersezione, true, false,
            ] as FilterSpecification);
          }
          // Filtro esplicito → ignora minzoom stratificato, usa quello mappa.
          map.setLayerZoomRange(layerId, minZoom, MAX_ZOOM);
        }
      }
    };
    if (map.isStyleLoaded()) {
      applica();
    } else {
      map.once("load", applica);
    }
  }, [filtri, minZoom]);

  return (
    // §12gg: nessun wrapper con border/rounded/max-w. La mappa vive
    // ora dentro la card unificata di `sezione-mappa.tsx` che
    // fornisce il bordo, gli angoli arrotondati e il taglio
    // (`overflow-hidden`) — inserire un secondo bordo qui creerebbe
    // un rettangolo dentro un rettangolo. Larghezza piena della card
    // esterna (che è full-width del container `max-w-6xl` di page.tsx
    // per matchare la row 2 dei riquadri sopra). Sul vincolo minZoom
    // di `metadatiCartografici` vedi commento in `sezione-mappa.tsx`.
    <div
      ref={containerRef}
      className="w-full h-[600px]"
      aria-label={`Mappa del comune di ${nomeComune} con la coropleta del rischio del caldo`}
    />
  );
}
