/**
 * Placeholder di /[comune]/servizi (§12cc). La rotta esiste così i
 * link nella Navbar non sono morti; il contenuto vero l'utente lo
 * riempie in un'altra sessione.
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { notFound } from "next/navigation";
import Link from "next/link";
import { risolviComune } from "@/lib/comuni";
import { Navbar } from "@/components/navbar";

export default async function ServiziPage({
  params,
}: {
  params: Promise<{ comune: string }>;
}) {
  const { comune: comuneSlug } = await params;
  const comune = risolviComune(comuneSlug);
  if (!comune) notFound();

  return (
    <>
      <Navbar
        ruolo="pubblica"
        nomeComune={comune.nome}
        slugComune={comune.slug}
        voceCorrente="servizi"
      />
      <div className="max-w-lg sm:max-w-2xl lg:max-w-3xl mx-auto px-4 sm:px-6 py-8">
        <h1 className="font-display font-bold text-h2 text-ink mb-3">
          Servizi
        </h1>
        <p className="text-slate leading-relaxed mb-3">
          Questa pagina è in preparazione. Elencherà i servizi che il
          Comune di {comune.nome} attiva durante le ondate di calore
          (centri anziani, punti freschi, numeri utili non-emergenza),
          con l&apos;indicazione degli orari di apertura estiva.
        </p>
        <p className="text-slate leading-relaxed">
          Nel frattempo, torna alla{" "}
          <Link href={`/${comune.slug}`} className="underline text-slate hover:text-ink">
            pagina pubblica
          </Link>{" "}
          per il livello di allerta di oggi e la mappa dei punti freschi
          già mappati.
        </p>
      </div>
    </>
  );
}
