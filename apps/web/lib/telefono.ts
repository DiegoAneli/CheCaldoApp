/**
 * Il numero di telefono NON deve mai comparire nel DOM renderizzato.
 * L'unica esposizione ammessa è l'attributo `href="tel:..."` del link Chiama.
 *
 * MAI usare cifre dell'identificativo (`persona.idEsterno`) travestite da
 * telefono: era il bug del prototipo (`p.id.slice(-4)`), corretto qui.
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

/** Placeholder testuale sempre uguale, indipendente dal numero reale. */
export const NUMERO_MASCHERATO = "••• ••• ••••";

/** Prepara l'href tel: nel formato E.164 dove possibile. */
export function hrefTel(telefono: string | null | undefined): string | null {
  if (!telefono) return null;
  const pulito = telefono.replace(/[^\d+]/g, "");
  return pulito.length > 0 ? `tel:${pulito}` : null;
}
