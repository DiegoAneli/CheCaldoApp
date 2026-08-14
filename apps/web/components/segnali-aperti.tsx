"use client";

/**
 * Card "Segnalazioni aperte" della dashboard coordinatore (§12qqq,
 * ridotta in §12rrr, ristretta ancora in §12sss, con distinzione
 * attive/scadute in §12ttt). Mostra i due tipi osservativi che un
 * percorso dell'app può effettivamente produrre:
 *   - `sintomi_riferiti`   (emesso dal modulo volontario)
 *   - `ventilatore_rotto`  (emesso dal modulo volontario)
 * Il filtro concreto vive in `TIPI_OSSERVATIVI` (query.ts:1063).
 *
 * Layout: **raggruppate per persona** — query lineare + raggruppamento
 * client-side preservando l'ordine di query. Ordinamento query:
 * non-scaduto DESC → in-lista-oggi DESC → urgenza tipo → creato_il DESC.
 * Il gruppo persona compare dove compare il suo primo segnale.
 *
 * Segnali scaduti: `s.scaduto === true` significa `valido_fino < oggi`
 * — il motore non li conta più (`scoring/src/index.ts:187-190`) ma
 * restano visibili in fondo con badge "· scaduto il D mese · non
 * pesa più sul punteggio". Il coordinatore può chiuderli formalmente
 * per rimuoverli dalla card. Il flag è calcolato server-side; il
 * client non deve conoscere `dataOggi` per determinarlo.
 *
 * Ogni segnale mostra:
 * - Etichetta del tipo (es. "Ventilatore rotto")
 * - Indicatore scadenza: "resta finché chiuso" o "scade il 15 agosto"
 * - Origine se ≠ 'volontario' (regola default implicito + eccezioni
 *   dichiarate, coerente col paragone in §12eee)
 * - Ultimo contatto DOPO la data del segnale, con esito — dato che
 *   permette al coordinatore di decidere se chiudere o mandare un
 *   volontario
 * - Pulsante "Chiudi" (§12qqq: era "Chiuso", corretto — compie
 *   un'azione, non descrive uno stato)
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import Link from "next/link";
import { useTransition } from "react";
import clsx from "clsx";
import type { SegnaleAperto } from "@checaldo/db";
import { formatoGiornoMese } from "@/lib/data-oggi";

interface Props {
  righe: SegnaleAperto[];
  chiudi: (segnaleId: number) => Promise<void>;
}

/**
 * Etichetta user-facing del tipo di segnale (schema.sql:154-157).
 * Il coordinatore non legge `sintomi_riferiti` o `ventilatore_rotto`
 * — quelle sono chiavi enum del DB. Traduzione italiana leggibile.
 */
function etichettaTipo(t: string): string {
  switch (t) {
    case "sintomi_riferiti":  return "Sintomi riferiti";
    case "ventilatore_rotto": return "Ventilatore rotto";
    default: return t;  // fallback difensivo se il filtro `TIPI_OSSERVATIVI` in query.ts si allarga
  }
}

/**
 * Etichetta user-facing dell'origine, mostrata SOLO quando ≠
 * 'volontario' (regola default implicito, coerente con la stessa
 * decisione presa in §12eee sul canone). L'aggiunta della card
 * generalizzata a tutti i tipi (§12qqq) porta origini più varie —
 * `mmg` e `coordinatore` esistono nell'enum (schema.sql:158) anche
 * se il canone attuale li produce di rado.
 */
function etichettaOrigine(o: string): string | null {
  switch (o) {
    case "volontario":   return null;
    case "cittadino":    return "segnalato da un cittadino";
    case "mmg":          return "segnalato dal medico di famiglia";
    case "coordinatore": return "segnalato dal coordinatore";
    default:             return `origine ${o}`;
  }
}

/** Testo di contesto sull'ultimo contatto dopo la segnalazione. */
function testoUltimoContatto(s: SegnaleAperto): {
  testo: string;
  richiedeAzione: boolean;
} {
  if (!s.ultimoContattoDopo) {
    // §12qqq: il caso più importante — il coordinatore che chiude
    // senza sapere che nessuno ha richiamato "chiude alla cieca".
    return {
      testo: "Nessun contatto dopo la segnalazione — meglio richiamare prima di chiudere.",
      richiedeAzione: true,
    };
  }
  const q = formatoGiornoMese(s.ultimoContattoDopo);
  switch (s.ultimoEsitoDopo) {
    case "sta_bene":
      return { testo: `Richiamata il ${q}: sta bene.`, richiedeAzione: false };
    case "ha_bisogno":
      return { testo: `Richiamata il ${q}: ha detto di aver bisogno.`, richiedeAzione: false };
    case "non_risponde":
      return { testo: `Ritentata il ${q} senza risposta.`, richiedeAzione: false };
    default:
      return { testo: `Contattata il ${q}.`, richiedeAzione: false };
  }
}

// ------------------------------------------------------ raggruppamento

interface GruppoPersona {
  personaId: number;
  idEsterno: string;
  quartiere: string | null;
  inListaOggi: boolean;
  segnali: SegnaleAperto[];
}

function raggruppaPerPersona(righe: SegnaleAperto[]): GruppoPersona[] {
  // Map preserva l'ordine di inserzione (ES2015): il gruppo persona
  // compare dove compare il suo primo segnale nella query — cioè
  // seguendo l'ORDER BY (in lista oggi prima, poi urgenza del tipo).
  const m = new Map<number, GruppoPersona>();
  for (const s of righe) {
    let g = m.get(s.personaId);
    if (!g) {
      g = {
        personaId: s.personaId,
        idEsterno: s.idEsterno,
        quartiere: s.quartiere,
        inListaOggi: s.inListaOggi,
        segnali: [],
      };
      m.set(s.personaId, g);
    }
    g.segnali.push(s);
  }
  return Array.from(m.values());
}

// ------------------------------------------------------ componenti

export function SegnaliAperti({ righe, chiudi }: Props) {
  if (righe.length === 0) {
    return (
      <div className="px-5 py-6 text-[13px] text-slate">
        Nessuna segnalazione aperta.
      </div>
    );
  }
  const gruppi = raggruppaPerPersona(righe);
  return (
    <div className="max-h-96 overflow-y-auto border-t border-rule">
      <div className="divide-y divide-rule">
        {gruppi.map((g) => (
          <GruppoRow key={g.personaId} g={g} chiudi={chiudi} />
        ))}
      </div>
    </div>
  );
}

function GruppoRow({
  g, chiudi,
}: {
  g: GruppoPersona;
  chiudi: (id: number) => Promise<void>;
}) {
  const n = g.segnali.length;
  return (
    <div className="px-5 py-3">
      <div className="flex items-baseline gap-2 text-[12.5px] flex-wrap">
        {/* MOD07-microcopy 2c: nome persona come link alla scheda
            coordinatore, stessa destinazione e stesso stile della
            Classifica di oggi (text-ink no-underline hover:underline). */}
        <Link
          href={`/coordinatore/persona/${g.personaId}`}
          className="font-medium text-ink no-underline hover:underline"
        >
          {g.idEsterno}
        </Link>
        <span className="text-muted">·</span>
        <span className="text-slate">{g.quartiere ?? "quartiere n.d."}</span>
        <span className="text-muted">·</span>
        <span className="text-muted">
          {n} {n === 1 ? "segnalazione aperta" : "segnalazioni aperte"}
        </span>
        {!g.inListaOggi && (
          // §12rrr: chi era in lista prima e oggi non c'è più (rango
          // scivolato, soglia scesa) resta visibile in coda alla card.
          // Piccola nota "fuori lista oggi" per rendere esplicita la
          // differenza — altrimenti il coordinatore, guardando un
          // sintomo in cima alla persona, penserebbe che il volontario
          // può passare a chiamarla oggi mentre invece non è assegnata
          // a nessuno.
          <span className="text-[11px] text-muted italic">
            · fuori dalla lista di oggi
          </span>
        )}
      </div>
      <div className="mt-2 space-y-2">
        {g.segnali.map((s) => (
          <RigaSegnale key={s.segnaleId} s={s} chiudi={chiudi} />
        ))}
      </div>
    </div>
  );
}

function RigaSegnale({
  s, chiudi,
}: {
  s: SegnaleAperto;
  chiudi: (id: number) => Promise<void>;
}) {
  const [pending, startTransition] = useTransition();
  const onClick = () => startTransition(async () => { await chiudi(s.segnaleId); });

  const origineEtichetta = etichettaOrigine(s.origine);
  // §12ttt: distinzione attivo/scaduto. Uno scaduto è `chiuso_il IS
  // NULL` ma `valido_fino < oggi` — il motore non lo conta più
  // (scoring/src/index.ts:187-190). Il badge esplicita entrambe le
  // cose: "scaduto il D mese" (data) + "non pesa più sul punteggio"
  // (conseguenza operativa), stesso stile muted del "· scade il".
  const scadenzaTesto = s.scaduto && s.validoFino
    ? `scaduto il ${formatoGiornoMese(s.validoFino)} · non pesa più sul punteggio`
    : s.validoFino
      ? `scade il ${formatoGiornoMese(s.validoFino)}`
      : "resta finché chiuso";
  const ultimo = testoUltimoContatto(s);

  return (
    <div
      className={clsx(
        "pl-3 border-l-2 border-rule",
        pending && "opacity-45 pointer-events-none",
      )}
    >
      <div className="flex items-center gap-2 flex-wrap">
        <span className={clsx("text-[13px]", s.scaduto && "text-slate")}>
          {etichettaTipo(s.tipo)}
        </span>
        <span className="text-[11px] text-muted">· {scadenzaTesto}</span>
        {origineEtichetta && (
          <span className="text-[11px] text-muted">· {origineEtichetta}</span>
        )}
        <button
          type="button"
          onClick={onClick}
          disabled={pending}
          className={clsx(
            "ml-auto shrink-0 px-2.5 py-1 rounded-btn font-display font-semibold text-[11.5px] tracking-chip border bg-card text-ink border-rule hover:bg-foot",
            pending && "cursor-not-allowed",
          )}
        >
          Chiudi
        </button>
      </div>
      <div
        className={clsx(
          "mt-1 text-[12px]",
          ultimo.richiedeAzione ? "text-ink font-medium" : "text-slate",
        )}
      >
        {ultimo.testo}
      </div>
    </div>
  );
}
