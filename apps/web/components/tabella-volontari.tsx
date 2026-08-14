"use client";

/**
 * §12jjjjj addendum (2026-08-12) — Tabella unica dei volontari
 * per la pagina /coordinatore/volontari. Sostituisce le due
 * tabelle separate (attivi + non attivi) di pre-2026-08-12 con
 * uno stile allineato a `ClassificaOggi`: righe alternate
 * (`even:bg-foot`), header semi-sticky, colonne fisse.
 *
 * Ordine (deciso 2026-08-12): attivi (di turno e in pausa
 * insieme) per email, poi disattivati per email — una riga di
 * stacco visivo separa i due macro-gruppi. La distinzione che
 * conta è "fa parte della squadra operativa" vs "no". Attivi e
 * in pausa sono entrambe persone su cui il coord conta oggi o
 * domani; i disattivati sono anagrafe storica da guardare di
 * rado. Una tabella sola, non due travestite.
 *
 * Coerenza con `assertAppartiene` (nel motore): un vol
 * disattivato NON deve avere il bottone "in pausa" — la pausa
 * non ha senso su chi non è candidato al giro. In tabella la
 * cella azioni mostra solo "[riattiva]" per i disattivati.
 *
 * Sopravvivenza al `revalidatePath`: nessuno stato locale sui
 * bottoni all'infuori di `useTransition`; le righe leggono le
 * prop dal server ad ogni refresh.
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { useTransition } from "react";
import clsx from "clsx";

export interface RigaVolontario {
  id: number;
  nome: string;
  email: string;
  attivo: boolean;
  /** Solo per attivi: true se ha riga in pausa_volontario per oggi. */
  inPausa: boolean;
  /** Solo per attivi: COUNT assegnazione oggi. Null per disattivati. */
  personeInCarico: number | null;
}

interface Props {
  righe: RigaVolontario[];
  onPausa: (id: number) => Promise<void>;
  onRiprendi: (id: number) => Promise<void>;
  onDisattiva: (id: number) => Promise<void>;
  onAttiva: (id: number) => Promise<void>;
}

export function TabellaVolontari({
  righe, onPausa, onRiprendi, onDisattiva, onAttiva,
}: Props) {
  if (righe.length === 0) {
    return (
      <div className="px-5 py-6 text-[13px] text-slate border border-rule rounded-card bg-card">
        Nessun volontario nell&apos;anagrafe. Aggiungine uno dalla
        procedura documentata in README, punto 5 (&laquo;Come
        installarlo altrove&raquo;).
      </div>
    );
  }

  const attivi = righe.filter((r) => r.attivo);
  const disattivati = righe.filter((r) => !r.attivo);
  const ordinati: RigaVolontario[] = [
    ...[...attivi].sort((a, b) => a.email.localeCompare(b.email)),
    ...[...disattivati].sort((a, b) => a.email.localeCompare(b.email)),
  ];
  // Indice del primo disattivato: la riga sopra riceve un bordo
  // marcato in basso per separare visivamente i due gruppi senza
  // usare due <tbody> (che romperebbero l'alternanza `even:bg-foot`
  // ripartendola da capo). La classe viene applicata sul <tr>
  // dell'ultimo attivo.
  const indicePrimoDisattivato =
    disattivati.length > 0 ? attivi.length : -1;

  return (
    <div className="border rounded-card bg-card overflow-hidden border-gray-400">
      <div className="overflow-auto">
        <table className="w-full min-w-[640px] text-[13px] border-collapse">
          <thead className="bg-card">
            <tr>
              <Th className="text-left whitespace-nowrap font-bold">Nome</Th>
              <Th className="text-left">Email</Th>
              <Th className="text-left w-32">Stato</Th>
              <Th className="text-center w-24">Carico oggi</Th>
              <Th className="text-right w-56">Azioni</Th>
            </tr>
          </thead>
          <tbody>
            {ordinati.map((r, i) => (
              <RigaVol
                key={r.id}
                r={r}
                separaSotto={i === indicePrimoDisattivato - 1}
                onPausa={onPausa}
                onRiprendi={onRiprendi}
                onDisattiva={onDisattiva}
                onAttiva={onAttiva}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function RigaVol({
  r, separaSotto, onPausa, onRiprendi, onDisattiva, onAttiva,
}: {
  r: RigaVolontario;
  separaSotto: boolean;
  onPausa: (id: number) => Promise<void>;
  onRiprendi: (id: number) => Promise<void>;
  onDisattiva: (id: number) => Promise<void>;
  onAttiva: (id: number) => Promise<void>;
}) {
  const [pending, startTransition] = useTransition();

  function pausa() {
    startTransition(async () => { await onPausa(r.id); });
  }
  function riprendi() {
    startTransition(async () => { await onRiprendi(r.id); });
  }
  function disattiva() {
    startTransition(async () => { await onDisattiva(r.id); });
  }
  function attiva() {
    startTransition(async () => { await onAttiva(r.id); });
  }

  const stato = statoTesto(r);
  return (
    <tr
      className={clsx(
        "even:bg-foot",
        !r.attivo && "text-muted",
        separaSotto && "[&>td]:border-b-2 [&>td]:border-b-rule",
        pending && "opacity-45",
      )}
    >
      <Td className="font-medium whitespace-nowrap">
        <span className={clsx(!r.attivo && "text-muted")}>{r.nome}</span>
      </Td>
      <Td className="text-slate">
        <span className="font-mono text-[11.5px] truncate block" title={r.email}>
          {r.email}
        </span>
      </Td>
      <Td>
        <span className={stato.classe}>{stato.testo}</span>
      </Td>
      <Td className="text-center">
        {r.personeInCarico == null ? (
          <span className="text-muted">—</span>
        ) : r.personeInCarico === 0 ? (
          <span className="text-muted">0</span>
        ) : (
          <span className="font-mono tabular-nums text-slate">
            {r.personeInCarico}
          </span>
        )}
      </Td>
      <Td className="text-right whitespace-nowrap">
        {r.attivo ? (
          <div className="inline-flex gap-1.5">
            {/* Vol attivo: due azioni (pausa/riprendi + disattiva).
                Pausa e riprendi sono la stessa cella, si scambiano
                a seconda dello stato. */}
            {r.inPausa ? (
              <Bottone onClick={riprendi} disabled={pending} kind="secondary">
                riprendi
              </Bottone>
            ) : (
              <Bottone onClick={pausa} disabled={pending} kind="secondary">
                in pausa
              </Bottone>
            )}
            <Bottone onClick={disattiva} disabled={pending} kind="danger">
              disattiva
            </Bottone>
          </div>
        ) : (
          /* Vol disattivato: solo riattiva. La pausa non ha senso
             su chi non è candidato al giro — nessun bottone morto
             (§12jjjjj addendum). */
          <Bottone onClick={attiva} disabled={pending} kind="primary">
            riattiva
          </Bottone>
        )}
      </Td>
    </tr>
  );
}

function statoTesto(r: RigaVolontario): { testo: string; classe: string } {
  if (!r.attivo) return { testo: "Disattivato", classe: "text-muted" };
  if (r.inPausa)
    return { testo: "In pausa oggi", classe: "text-amber-700 font-medium" };
  return { testo: "Di turno", classe: "text-slate" };
}

function Bottone({
  children, onClick, disabled, kind,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled: boolean;
  kind: "primary" | "secondary" | "danger";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={clsx(
        "px-2.5 py-1 rounded-btn font-display font-semibold text-[11.5px] tracking-chip border",
        kind === "primary" && "bg-ink text-white border-ink hover:bg-ink/85",
        kind === "secondary" && "bg-card text-ink border-rule hover:bg-foot",
        kind === "danger" && "bg-card text-slate border-rule hover:bg-foot",
        disabled && "cursor-not-allowed",
      )}
    >
      {children}
    </button>
  );
}

function Th({
  children, className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <th
      className={
        "font-display font-semibold text-[11px] tracking-label uppercase text-muted py-2 px-3 border-b border-rule bg-card " +
        className
      }
    >
      {children}
    </th>
  );
}

function Td({
  children, className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <td className={"py-2 px-3 border-b border-rule/60 " + className}>
      {children}
    </td>
  );
}
