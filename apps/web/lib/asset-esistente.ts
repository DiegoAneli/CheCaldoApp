// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Verifica sincrona se un file esiste in `apps/web/public/`. Serve alla
 * card allerta (§12cc) per decidere se rendere il tag <img> dello skyline:
 * l'utente aggiunge le immagini in tempi diversi, la card non deve
 * rompersi quando mancano. Server-only (usa `fs`).
 *
 * Cachato: `existsSync` è economica ma non gratuita, e in produzione
 * lo stato di `public/` non cambia durante l'esecuzione del processo.
 * Il Map vive nel modulo, non serve LRU: il numero di asset è nell'ordine
 * delle unità.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";

const cache = new Map<string, boolean>();

/**
 * `pathPubblico` va passato come si scriverebbe nel src del tag <img>,
 * es. `"/skyline-parma.png"`. Il leading slash è opzionale.
 */
export function assetPubblicoEsiste(pathPubblico: string): boolean {
  const pulito = pathPubblico.startsWith("/") ? pathPubblico.slice(1) : pathPubblico;
  const cached = cache.get(pulito);
  if (cached !== undefined) return cached;
  // process.cwd() = root del progetto Next in run (apps/web quando
  // `next dev`/`next start`); `public/` è relativo a quello.
  const fsPath = join(process.cwd(), "public", pulito);
  const esiste = existsSync(fsPath);
  cache.set(pulito, esiste);
  return esiste;
}
