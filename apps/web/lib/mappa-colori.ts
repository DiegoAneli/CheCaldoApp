// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Scala di colore della coropleta per la mappa pubblica (MOD05 BLOCCO 4).
 *
 * Il `punteggio` di `pubblico.punteggio_sezione` è un percentile sul comune,
 * distribuzione verificata in §12e: min 0.017, p25 0.355, mediana 0.518,
 * p75 0.645, max 0.910 (966 valori distinti su 1039). Un gradiente lineare
 * 0-1 appiattirebbe la mediana al centro esatto della palette e sprecherebbe
 * risoluzione visiva nelle code (poche sezioni sotto 0.15 o sopra 0.85).
 *
 * Usiamo cinque classi con breakpoints tarati sui quantili osservati
 * (~p20/p40/p60/p80): la coropleta discrimina davvero nell'intervallo dove
 * vive la maggior parte delle sezioni, invece di collassare tutto al giallo
 * medio. Palette YlOrRd (ColorBrewer 5-class sequenziale), robusta per
 * daltonia.
 *
 * BREAKPOINTS ed EXPRESSION devono restare sincronizzati con la LEGENDA:
 * se cambia uno, cambia l'altra.
 */

export const BREAKPOINTS = [0.30, 0.45, 0.58, 0.70] as const;
export const COLORI = ["#fef0d9", "#fdcc8a", "#fc8d59", "#e34a33", "#b30000"] as const;
export const ETICHETTE = [
  "meno concentrato",
  "",
  "",
  "",
  "più concentrato",
] as const;

/**
 * MapLibre `step` expression sulla proprietà `punteggio` del feature MVT.
 * Un `any` esplicito perché il typing di MapLibre per le expression è
 * ricorsivo e verboso — la forma è stabile e testata sull'API v6.
 */
export const MAPLIBRE_FILL_COLOR: unknown = [
  "step",
  ["get", "punteggio"],
  COLORI[0],
  BREAKPOINTS[0], COLORI[1],
  BREAKPOINTS[1], COLORI[2],
  BREAKPOINTS[2], COLORI[3],
  BREAKPOINTS[3], COLORI[4],
];
