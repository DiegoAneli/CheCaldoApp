// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Livelli di allerta del Ministero della Salute.
 * Fonte: `livelli.csv` di onData
 * (https://github.com/ondata/ondate-calore), CC-BY-4.0.
 * Le classi Tailwind corrispondenti sono `bg-lv0..3`, definite in tailwind.config.ts
 * con gli stessi codici colore.
 */

// `parola` = etichetta breve maiuscolabile per la card allerta (§12cc).
// Distinta da `desc` (frase completa usata come sottotitolo nel badge
// legacy) — la parola sta dentro il rettangolo colorato della card e
// deve essere corta abbastanza da non andare a capo su mobile.
export const LIVELLI = [
  { n: 0 as const, hex: "#5BD601", cls: "lv0", parola: "Nessun rischio", desc: "Nessun rischio per la salute" },
  { n: 1 as const, hex: "#E4D603", cls: "lv1", parola: "Pre-allerta",    desc: "Pre-allerta" },
  { n: 2 as const, hex: "#FF7F02", cls: "lv2", parola: "Effetti sui suscettibili", desc: "Effetti negativi sui suscettibili" },
  { n: 3 as const, hex: "#DC2A17", cls: "lv3", parola: "Ondata di calore", desc: "Ondata di calore in corso" },
];

export type Livello = 0 | 1 | 2 | 3;

export function descrizione(l: Livello): string {
  return LIVELLI[l]?.desc ?? "";
}
