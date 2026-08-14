/**
 * Tabella "usciti dalla lista rispetto a ieri" per la dashboard
 * coordinatore. È la scena principale del video (Persona 0193):
 * il sistema toglie priorità quando una persona sta meglio, non solo
 * la accumula.
 *
 * Microcopy: dice il fatto, non il giudizio. "Stava peggio ieri" con
 * la prova sotto (segnali scaduti, contatto sta_bene). Mai "risolta",
 * mai "meno grave" (giudizio clinico che qui non abbiamo).
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import Link from "next/link";
import type { UscitoDallaLista } from "@checaldo/db";

interface Props {
  usciti: UscitoDallaLista[];
}

export function TabellaUsciti({ usciti }: Props) {
  if (usciti.length === 0) {
    return (
      <div className="px-4 py-6 text-[13px] text-slate">
        Nessuno è uscito dalla lista rispetto a ieri. Non è un
        dato pubblicabile — dipende da quanti eventi (segnali scaduti,
        contatti risolutivi) sono passati nella notte.
      </div>
    );
  }

  return (
    // Larghezze delle colonne (§12pppp ter): hint sui Th di sinistra
    // (`w-[10rem]` Persona, `w-[9rem]` Quartiere) e sulle due colonne
    // di rango (`w-20`, 80 px). Motivo senza width: assorbe il resto
    // della card. Prima della fix, il vecchio Motivo senza hint e
    // Quartiere senza `whitespace-nowrap` lasciavano il browser
    // comprimere Quartiere fino a spezzare "Parma Centro" quando i
    // motivi nel canone erano brevi ("ricalcolo del giorno").
    // Header "Ieri" / "Oggi" invece di "Rango ieri" / "Rango oggi":
    // il contesto è nel titolo della card ("Usciti dalla lista
    // rispetto a ieri") e i numeri sono già incolonnati fra loro.
    // Etichette lunghe richiedono w-32 per stare su una riga sola —
    // contraddice "colonne strette e incolonnate".
    <div className="max-h-72 overflow-y-auto border-t border-rule">
      <table className="w-full text-[13px] border-collapse">
        <thead className="sticky top-0 bg-card z-10">
          <tr>
            <Th className="text-left whitespace-nowrap w-[10rem]">Persona</Th>
            <Th className="text-left whitespace-nowrap w-[9rem]">Quartiere</Th>
            <Th className="text-center whitespace-nowrap w-20">Ieri</Th>
            <Th className="text-center whitespace-nowrap w-20">Oggi</Th>
            <Th className="text-left">Motivo</Th>
          </tr>
        </thead>
        <tbody>
          {usciti.map((u) => (
            // `even:bg-foot` — stessa alternanza di ClassificaOggi
            // (token `foot` = #F7F9FA dal tema). Applicato anche qui
            // dopo estensione da §12pppp bis. `border-b border-rule/60`
            // sulle Td resta per gli stessi motivi: la differenza di
            // luminanza bg-card→bg-foot è ~2%, la border è il segno
            // di separazione principale, l'alternanza aiuta lo
            // scorrimento orizzontale sulle 5 colonne.
            <tr key={u.personaId} className="even:bg-foot">
              <td className="py-2 px-3 border-b border-rule/60 font-medium whitespace-nowrap">
                {/* MOD07-microcopy 2c: nome persona come link alla scheda
                    coordinatore, stessa destinazione e stile della
                    Classifica di oggi e delle Segnalazioni aperte. */}
                <Link
                  href={`/coordinatore/persona/${u.personaId}`}
                  className="text-ink no-underline hover:underline"
                >
                  {u.idEsterno}
                </Link>
              </td>
              <td className="py-2 px-3 border-b border-rule/60 text-slate whitespace-nowrap">
                {u.quartiere ?? "—"}
              </td>
              {/* Pattern §12ooooo: `inline-block w-6 text-right` +
                  tabular-nums dentro cella `text-center`. Numeri a 1
                  e 2 cifre si incolonnano (ultima cifra sempre alla
                  stessa x) e la colonna resta centrata come header.
                  `w-6` copre 2 cifre a 13 px mono; se in futuro la
                  soglia superasse 99, passare a `w-8` come indicato
                  per Rango in ClassificaOggi. */}
              <td className="py-2 px-3 border-b border-rule/60 text-center">
                <span className="inline-block w-6 text-right font-mono tabular-nums">
                  {u.rangoIeri ?? "—"}
                </span>
              </td>
              <td className="py-2 px-3 border-b border-rule/60 text-center">
                <span className="inline-block w-6 text-right font-mono tabular-nums">
                  {u.rangoOggi ?? "—"}
                </span>
              </td>
              <td className="py-2 px-3 border-b border-rule/60 text-slate">
                {motivo(u)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Th({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  // Nessun `text-left` di default (stessa ragione documentata in
  // ClassificaOggi §Th): sovrasterebbe il `text-center` passato dalle
  // colonne Ieri/Oggi. Chi vuole allineamento a sinistra lo dichiara
  // esplicito nel className.
  // Padding `px-3` (non `pr-3`): serve il padding a sinistra per non
  // attaccare il primo carattere al bordo quando la cella è centrata.
  return (
    <th
      className={
        // MOD07-microcopy 2b: intestazioni colonna scurite da `text-muted`
        // a `text-slate` per coerenza col trattamento di ClassificaOggi
        // e delle intestazioni card.
        "font-display font-semibold text-[11px] tracking-label uppercase text-slate py-2 px-3 border-b border-rule bg-card " +
        className
      }
    >
      {children}
    </th>
  );
}

function motivo(u: UscitoDallaLista): string {
  // Priorità delle regole (§12kkk):
  // 1. Cambio soglia: se la persona sarebbe rimasta in lista con la
  //    soglia di ieri (rango_oggi ≤ soglia_ieri), il taglio della
  //    lista domina qualunque altro motivo. Le regole 2-4 si
  //    applicherebbero anche a persone che con la soglia di ieri
  //    resterebbero dentro nonostante il segnale scaduto —
  //    dichiarare "sintomo passato nella notte · stava peggio ieri"
  //    per quelle suggerisce miglioramento non dimostrato. La regola
  //    soglia vince quando applicabile.
  // 2. Sintomi passati nella notte (segnale sintomi_riferiti scaduto)
  // 3. Segnale scaduto (non sintomi)
  // 4. Raggiunta ieri, sta bene (contatto con esito 'sta_bene')
  // 5. Fallback: "ricalcolo del giorno" — onesto quando il rango è
  //    scivolato oltre entrambe le soglie e non abbiamo diagnostica
  //    per persona.
  const sogliaScesa =
    u.sogliaIeri !== null && u.sogliaOggi !== null &&
    u.rangoOggi !== null &&
    u.sogliaIeri > u.sogliaOggi &&
    u.rangoOggi <= u.sogliaIeri;

  if (sogliaScesa) {
    return `sarebbe rimasta in lista con la soglia di ieri (ieri ${u.sogliaIeri}, oggi ${u.sogliaOggi})`;
  }

  const parti: string[] = [];
  if (u.scadutiIncludonoSintomi) {
    const n = u.segnaliScaduti;
    // "sintomi passati nella notte" = valido_fino=ieri, oggi fuori.
    // Non è un giudizio ("guarita"): è la scadenza del segnale che
    // il volontario o l'agente avevano registrato ieri.
    parti.push(
      n > 1
        ? `${n} sintomi passati nella notte`
        : "sintomo passato nella notte"
    );
    parti.push("stava peggio ieri");
  } else if (u.segnaliScaduti > 0) {
    const n = u.segnaliScaduti;
    parti.push(
      n > 1 ? `${n} segnali scaduti nella notte` : "segnale scaduto nella notte"
    );
    parti.push("stava peggio ieri");
  } else if (u.contattataStaBene) {
    parti.push("raggiunta ieri, sta bene");
  } else {
    // Nessuna prova specifica: rumore proporzionale (cambi di ranghi
    // vicini). Non affermiamo "stava peggio".
    parti.push("ricalcolo del giorno");
  }
  return parti.join(" · ");
}
