/**
 * CheCaldo! — rilevatore duplicati per l'anagrafe importata.
 *
 * Segnala possibili doppioni, NON fonde: fondere significherebbe scegliere
 * quale record vince, e questa scelta è del coordinatore. L'output è una
 * lista di coppie candidate che l'interfaccia mostrerà a chi valida.
 *
 * Due criteri, non uno solo: id esterno collidente E prossimità di
 * anno_nascita/indirizzo. Un solo criterio produrrebbe troppi falsi
 * positivi (nomi comuni, indirizzi normalizzati male).
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import type { PersonaIn } from "./adattatore";

export interface CoppiaDuplicato {
  a: PersonaIn;
  b: PersonaIn;
  motivo: string;
}

/**
 * Trova possibili duplicati fra un batch in import e (opzionale) un
 * insieme di persone già esistenti nell'organizzazione. Confronto O(n²)
 * accettabile: le anagrafi tipiche sono nell'ordine di centinaia.
 */
export function trovaDuplicati(
  batch: PersonaIn[],
  esistenti: PersonaIn[] = [],
): CoppiaDuplicato[] {
  const risultato: CoppiaDuplicato[] = [];
  const universo = [...esistenti, ...batch];

  for (let i = 0; i < universo.length; i++) {
    const a = universo[i];
    if (!a) continue;
    for (let j = i + 1; j < universo.length; j++) {
      const b = universo[j];
      if (!b) continue;
      const motivo = motivoDuplicato(a, b);
      if (motivo) risultato.push({ a, b, motivo });
    }
  }
  return risultato;
}

function motivoDuplicato(a: PersonaIn, b: PersonaIn): string | null {
  if (a.idEsterno && b.idEsterno && a.idEsterno === b.idEsterno) {
    return "stesso id_esterno";
  }
  const annoVicino =
    a.annoNascita !== undefined &&
    b.annoNascita !== undefined &&
    Math.abs(a.annoNascita - b.annoNascita) <= 1;
  const indirizzoUguale =
    a.indirizzo && b.indirizzo &&
    normalizzaIndirizzo(a.indirizzo) === normalizzaIndirizzo(b.indirizzo);
  if (annoVicino && indirizzoUguale) {
    return "stesso indirizzo e anno_nascita ±1";
  }
  const sezioneUguale =
    a.sezioneCensimento && b.sezioneCensimento &&
    a.sezioneCensimento === b.sezioneCensimento;
  if (annoVicino && sezioneUguale && a.viveSolo === true && b.viveSolo === true) {
    return "stessa sezione, anno_nascita ±1, entrambi vivono soli";
  }
  return null;
}

function normalizzaIndirizzo(s: string): string {
  return s
    .toLowerCase()
    .replace(/[.,;]/g, "")
    .replace(/\s+/g, " ")
    .replace(/^(via|viale|corso|piazza|piazzale|vicolo|borgo|strada|largo)\s+/i, "")
    .trim();
}
