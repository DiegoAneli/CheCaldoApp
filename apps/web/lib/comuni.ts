/**
 * Lookup dei comuni serviti da questa istanza.
 *
 * Un'istanza serve **più comuni** (§12t routing per path). Il selettore
 * della radice, i link navbar/footer, e la validazione dei path
 * `/[comune]` usano tutti questa lookup.
 *
 * Aggiungere un comune = aggiungere una riga a `COMUNI`. Se in futuro
 * il numero cresce oltre 3-4, migrare a una tabella `pubblico.comune`
 * (istat, nome, slug, primary) e derivare la mappa dal DB al boot.
 * Per la consegna 2026-08 due comuni sono nella mappa.
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

export interface Comune {
  slug: string;         // segmento URL (`parma`, `bologna`)
  istat: string;        // codice ISTAT 6 cifre (`034027`, `037006`)
  nome: string;         // nome umano ("Parma", "Bologna")
}

export const COMUNI: Comune[] = [
  { slug: "parma",   istat: "034027", nome: "Parma"   },
  { slug: "bologna", istat: "037006", nome: "Bologna" },
];

/**
 * Risolve uno slug URL al comune corrispondente. Restituisce `null`
 * se lo slug non è nella lookup — la pagina server component deve
 * chiamare `notFound()` in questo caso, non mostrare una pagina
 * "vuota" (comportamento richiesto dal brief routing).
 */
export function risolviComune(slug: string | undefined): Comune | null {
  if (!slug) return null;
  const s = slug.toLowerCase();
  return COMUNI.find((c) => c.slug === s) ?? null;
}

/** Lookup inversa istat → slug. Usata da `carica-nel-db.ts` e simili. */
export function slugPerIstat(istat: string): string | null {
  return COMUNI.find((c) => c.istat === istat)?.slug ?? null;
}

/**
 * Lookup inversa istat → Comune (nome+slug). Le pagine coordinatore e
 * volontario partono da un cookie con l'utente, ricavano l'ISTAT
 * dall'organizzazione (`comuneDellOrganizzazione`) e da qui derivano
 * cosa mostrare in Navbar (badge "Comune di {nome}" + href logo).
 */
export function comunePerIstat(istat: string | null | undefined): Comune | null {
  if (!istat) return null;
  return COMUNI.find((c) => c.istat === istat) ?? null;
}
