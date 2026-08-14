/**
 * Placeholder di /[comune]/faq (§12cc). La rotta esiste così i link
 * nella Navbar non sono morti; il contenuto vero l'utente lo riempie
 * in un'altra sessione.
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { notFound } from "next/navigation";
import Link from "next/link";
import { risolviComune } from "@/lib/comuni";
import { Navbar } from "@/components/navbar";

export default async function FaqPage({
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
        voceCorrente="faq"
      />
      <div className="max-w-lg sm:max-w-2xl lg:max-w-3xl mx-auto px-4 sm:px-6 py-8">
        <h1 className="font-display font-bold text-h2 text-ink mb-3">
          Domande frequenti
        </h1>
        <p className="text-slate leading-relaxed mb-3">
          Questa pagina è in preparazione. Risponderà alle domande più
          comuni su CheCaldo! ({comune.nome}): come nasce il livello
          stimato, cosa succede se il bollettino non c&apos;è, chi vede
          la lista degli assistiti, dove finiscono i dati caricati.
        </p>
        <p className="text-slate leading-relaxed">
          Per il dettaglio metodologico c&apos;è già{" "}
          <Link href={`/${comune.slug}/metodo`} className="underline text-slate hover:text-ink">
            /metodo
          </Link>
          . Per la pagina pubblica del comune, il{" "}
          <Link href={`/${comune.slug}`} className="underline text-slate hover:text-ink">
            livello di allerta di oggi
          </Link>
          .
        </p>
      </div>
    </>
  );
}
