/**
 * Motivazione deterministica dai fattori di PersonaValutata.
 *
 * Traduzione di `why(p, i)` di web/prototipo.html (righe 292-302) sui fattori
 * reali di @checaldo/scoring: il microcopy resta identico parola per parola,
 * la logica passa dai dati finti del prototipo (p.eta, p.solo, p.q, p.gg,
 * p.ieri) ai `FattoreSpiegabile[]` dell'assegnazione + `posizioneIeri`.
 *
 * L'agente redattore (MOD06) sostituirà questo template senza cambiare il
 * componente che lo consuma.
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import type { FattoreSpiegabile } from "@checaldo/scoring";

export interface DatiMotivazione {
  fattori: FattoreSpiegabile[];
  quartiere: string | null;
  // Rango globale nella classifica del giorno (1..N fra tutte le persone in
  // lista in città). Confrontato con `posizioneIeri` per accendere il ramo
  // "era Nª ieri". `posizione` nel giro del volontario è 1..6 e non ha
  // risoluzione per la soglia — vedi carica-nel-db.ts.
  rangoGlobale: number | null;
  posizioneIeri: number | null;
  annoNascita: number | null;
  viveSolo: boolean | null;
}

const ORA = new Date().getUTCFullYear();

export function motivazione(d: DatiMotivazione): string {
  const parti: string[] = [];

  // Ramo 1: rango globale sceso di almeno 10 posizioni rispetto a ieri
  // (prototipo: p.ieri > i+9, dove i era la posizione globale nel prototipo).
  // Confronto rango_globale-ieri > rango_globale-oggi + 9. Silente se ieri
  // non era in lista (posizioneIeri = NULL) o se oggi manca rangoGlobale
  // (riga scritta prima dell'introduzione della colonna).
  if (
    d.posizioneIeri !== null
    && d.rangoGlobale !== null
    && d.posizioneIeri > d.rangoGlobale + 9
  ) {
    parti.push(`era ${d.posizioneIeri}ª ieri`);
  }

  // Ramo 2: età + vive_solo — microcopy identico "87 anni, vive sola"
  const eta = d.annoNascita ? ORA - d.annoNascita : null;
  if (eta !== null) {
    parti.push(`${eta} anni${d.viveSolo ? ", vive sola" : ""}`);
  } else if (d.viveSolo) {
    parti.push("vive sola");
  }

  // Ramo 3: quartiere con caratterizzazione da fattori.
  // Prototipo (why(), righe 296-299): "tra i quartieri con più persone sole"
  // (rIso ≥ 0.65) OPPURE "edifici densi" (rDen ≥ 0.7), mutuamente esclusivi
  // — la prima ha priorità. Il ramo "edifici densi" era caduto in
  // motivazione.ts perché @checaldo/scoring non esponeva densita_costruita
  // per persona; ora che il fattore `abitazioni_per_edificio` c'è (vedi §7.1
  // 2026-07-31), il ramo torna completo.
  const fIso = d.fattori.find((f) => f.chiave === "persone_per_famiglia");
  const fDen = d.fattori.find((f) => f.chiave === "abitazioni_per_edificio");
  if (d.quartiere) {
    if (fIso && fIso.contributo >= 0.65) {
      parti.push(`${d.quartiere}, tra i quartieri con più persone sole`);
    } else if (fDen && fDen.contributo >= 0.7) {
      parti.push(`${d.quartiere}, edifici densi`);
    } else {
      parti.push(d.quartiere);
    }
  }

  // Ramo 4 (giorni_da_ultimo_contatto): RIMOSSO in §12jjj revisione.
  // Col verso invertito del fattore (0.75-1.00, penalità per contatto
  // recente e neutro per NULL/lontano), "nessun contatto da N giorni"
  // non è più il motivo per cui la persona è in cima — è solo un
  // dato d'anagrafe. Mostrare l'info come "motivo" del rango sarebbe
  // presentare come causa qualcosa che non lo è, esattamente ciò che
  // evitiamo ovunque. Il dato resta utile al volontario prima di
  // suonare: mostrato sulla scheda persona come riga di contesto
  // separata, non fra i motivi.

  // Ramo 5: metri_da_punto_fresco — compare solo quando lontananza dal parco
  // È alta (≥ 0.75) E la densità costruita è sopra la mediana (≥ 0.5). Senza
  // la seconda condizione la frase si accendeva in campagna, dove ci sono
  // giardini privati e la distanza dal parco urbano non spiega il rischio.
  // Con la seconda condizione fotografa alloggi densi senza verde privato
  // e con parco lontano — proxy corretto. Vedi analisi in §12d di
  // CHECALDO-PROGETTO.md.
  const fresco = d.fattori.find((f) => f.chiave === "metri_da_punto_fresco");
  if (
    fresco
    && typeof fresco.valore === "number"
    && fresco.contributo >= 0.75
    && fDen && fDen.contributo >= 0.5
  ) {
    parti.push(`a ${fresco.valore} metri dal parco più vicino`);
  }

  return parti.join(" · ") + ".";
}
