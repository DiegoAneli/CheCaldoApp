// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Chiavi `fixture_id` per righe fixture in `riservato.segnale`.
 *
 * Sul DB c'e' un vincolo globale:
 *   CREATE UNIQUE INDEX ON riservato.segnale (fixture_id) WHERE fixture_id IS NOT NULL;
 * Perche' due organizzazioni sulla stessa istanza possano avere segnali
 * fixture indipendenti la chiave DEVE includere l'organizzazione: il
 * generatore emette `id_esterno` da "Persona 0000" a "Persona 0499" per
 * *ogni* comune, quindi due org caricate sulla stessa istanza collidono
 * su (id_esterno, tipo) se manca l'organizzazione nella chiave.
 *
 * Bug osservato prima del 2026-08-14: caricando Bologna dopo Parma, la
 * seconda org finiva in DB con zero segnali. Il carica non falliva —
 * `ON CONFLICT (fixture_id) DO NOTHING` di riservato.segnale sopprimeva
 * ogni scontro. Il DELETE preliminare del carica e' scopato per
 * `organizzazione_id`, quindi non ripuliva le righe della prima org:
 * asimmetria non prevista fra DELETE per-org e unique index globale.
 * Il fix e' incluso l'org nella chiave; il DELETE resta invariato.
 */
export function fixtureIdSegnale(
  orgId: number,
  idEsterno: string,
  tipo: string,
): string {
  return `s-${orgId}-${idEsterno}-${tipo}`;
}
