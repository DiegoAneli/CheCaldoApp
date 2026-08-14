// SPDX-License-Identifier: AGPL-3.0-or-later
import Link from "next/link";
import clsx from "clsx";
import { motivazione } from "@/lib/motivazione";
import { IconaTelefono } from "@/components/icona-telefono";
import type { AssegnazioneDelGiorno } from "@checaldo/db";
import type { FattoreSpiegabile } from "@checaldo/scoring";

interface Props {
  a: AssegnazioneDelGiorno;
  posizioneNelGiro: number;
  giaContattato: boolean;
  esitoBreve?: string;
}

/**
 * Riga della lista "Il giro di oggi".
 * Bug 1 del prototipo (riga 317: p.id.slice(-4) come telefono): qui rimosso.
 * Non c'è NESSUNA cifra del telefono nel DOM: solo il link Chiama.
 * Storicamente accanto al nome comparivano le 12 cifre del `sezioneId`
 * (codice ISTAT della sezione censuaria: comune+progressivo) — utile
 * come debug info allo sviluppatore, ma sembra un numero di telefono
 * al volontario che legge in mobilità. Rimosso: il quartiere è già
 * dentro la motivazione sotto, il codice sezione non serve a nessuno
 * qui.
 */
export function RigaAssegnazione({ a, posizioneNelGiro, giaContattato, esitoBreve }: Props) {
  const testo = giaContattato
    ? esitoBreve ?? "contattata"
    : motivazione({
        fattori: (a.fattori as FattoreSpiegabile[]) ?? [],
        quartiere: a.quartiere,
        rangoGlobale: a.rangoGlobale,
        posizioneIeri: a.posizioneIeri,
        annoNascita: a.annoNascita,
        viveSolo: a.viveSolo,
      });

  return (
    <li className={clsx("px-4 py-3 border-b border-rule flex gap-3 even:bg-foot", giaContattato && "opacity-45")}>
      <div className="font-mono text-xs text-muted w-4 pt-0.5 shrink-0">{posizioneNelGiro}</div>
      <div className="flex-1 min-w-0">
        <div className="text-[14.5px] font-medium">
          <Link href={`/volontario/${a.personaId}`} className="hover:underline">
            {a.idEsterno}
          </Link>
        </div>
        <div className="text-[12.5px] text-slate mt-1 leading-normal">{testo}</div>
      </div>
      {giaContattato ? (
        <span className="self-center text-emerald-700 text-lg shrink-0" aria-label="contattata">
          ✓
        </span>
      ) : (
        <ChiamaLink telefono={a.telefono} />
      )}
    </li>
  );
}

function ChiamaLink({ telefono }: { telefono: string | null }) {
  const href = telefono ? `tel:${telefono.replace(/[^\d+]/g, "")}` : undefined;
  const disabilitato = !href;
  // Icona-solo: l'etichetta accessibile viene da aria-label (screen reader
  // e regola WCAG name/role/value) + <span className="sr-only"> come
  // backup. Area toccabile ~44×44 (p-2.5 su icona 22px) sopra la soglia
  // WCAG 2.5.5 Level AAA — comoda anche col telefono in mano.
  return (
    <a
      href={href}
      aria-disabled={disabilitato}
      aria-label="Chiama"
      className={clsx(
        "self-center shrink-0 bg-ink text-white p-2.5 rounded-btn no-underline inline-flex items-center justify-center",
        disabilitato && "opacity-50 pointer-events-none"
      )}
    >
      <IconaTelefono size={22} />
      <span className="sr-only">Chiama</span>
    </a>
  );
}
