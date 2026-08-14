/**
 * CheCaldo! — @checaldo/db: adattatore anagrafe, geocoder, rilevatore duplicati.
 *
 * Il ponte a Persona di @checaldo/scoring vive qui: la geocodifica reale
 * (indirizzo → sezioneId via ST_Contains) arriva con MOD01, quando le
 * geometrie ISTAT saranno caricate. Nel frattempo si passa via
 * `sezione_censimento` diretto o si marca `posizioneIncerta`.
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import type { Persona, SegnaleAttivo } from "@checaldo/scoring";
import type { PersonaIn } from "./adattatore";

export * from "./adattatore";
export * from "./geocoder";
export * from "./duplicati";
export * from "./query";
export * from "./autorizzazione";
export * from "./data-oggi";
export * from "./fixture-id";

/**
 * Trasformazione PersonaIn → Persona quando la sezione è già nota
 * (via colonna `sezione_censimento` diretta, o via geocoder+PIP futuro).
 * Chi ha solo indirizzo e nessuna sezione, entra con posizioneIncerta.
 */
export function aPersona(
  p: PersonaIn,
  opz: { sezioneId?: string; segnali?: SegnaleAttivo[] } = {},
): Persona {
  const sezioneId = opz.sezioneId ?? p.sezioneCensimento ?? "";
  const persona: Persona = {
    idEsterno: p.idEsterno,
    sezioneId,
  };
  if (p.annoNascita !== undefined) persona.annoNascita = p.annoNascita;
  if (p.fasciaEta !== undefined) persona.fasciaEta = p.fasciaEta;
  if (p.viveSolo !== undefined) persona.viveSolo = p.viveSolo;
  if (p.piano !== undefined) persona.piano = p.piano;
  if (p.ascensore !== undefined) persona.ascensore = p.ascensore;
  if (p.dataUltimoContatto !== undefined) persona.dataUltimoContatto = p.dataUltimoContatto;
  if (p.segnalatoDaMmg !== undefined) persona.segnalatoDaMmg = p.segnalatoDaMmg;
  if (opz.segnali && opz.segnali.length > 0) persona.segnali = opz.segnali;
  if (sezioneId === "") persona.posizioneIncerta = true;
  return persona;
}
