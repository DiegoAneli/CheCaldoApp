/**
 * Classifica di oggi per la dashboard coordinatore: tutte le persone in
 * lista, con volontario assegnato, ordinate per rango globale. La colonna
 * "condizionatore" segna con un badge le prime `nComodati` (proxy della
 * "colonna comodato in evidenza" del prototipo).
 *
 * `nComodati` è costante nel codice per BLOCCO 2 (10). Renderla
 * configurabile è materia successiva: nuova colonna in `pubblico.organizzazione`
 * o in `riservato.soglia_giorno`, con slider nella dashboard.
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import Link from "next/link";
import type { PersonaInClassifica } from "@checaldo/db";

interface Props {
  righe: PersonaInClassifica[];
  /**
   * Insieme delle personaId che ricevono il condizionatore in comodato
   * oggi. Calcolato dalla page.tsx come le prime N in graduatoria fra
   * chi ha `statoCondizionatore !== 'presente'`. Prima di §12dddd la
   * decisione era fatta dal componente sul rango (r.rangoGlobale <=
   * nComodati) ignorando lo stato reale del condizionatore.
   */
  idsConComodato: Set<number>;
}

const ORA = new Date().getUTCFullYear();

// Etichette dello stato contatto di oggi (§12aaaa). Volutamente diverse
// dalle parole delle chip dashboard ("Tentate", "Senza risposta"): la
// chip "Tentate" include anche i non_risponde, qui invece tre gruppi
// disgiunti. Coincidono con la semantica di fine giro volontario
// (Raggiunte / Non risponde / Resta) — riusare quelle parole avrebbe
// confuso i due lessici.
function statoContatto(
  esito: "sta_bene" | "ha_bisogno" | "non_risponde" | null,
): { testo: string; classe: string } {
  if (esito === null) return { testo: "Non ancora", classe: "text-muted" };
  if (esito === "non_risponde")
    return { testo: "Non risponde", classe: "text-red-700 font-medium" };
  return { testo: "Raggiunta", classe: "text-slate" };
}

// Etichette dello stato condizionatore. Il colore marca l'eccezione,
// non la maggioranza: sul canone attuale 19/25 sono "Assente" — se
// fossero rosse, il colore forte marcherebbe la regola invece
// dell'eccezione e smetterebbe di segnalare qualcosa. "Assente"
// resta quindi in text-slate come il resto delle celle stative;
// "Rotto" è raro e tiene l'ambra; "Presente" resta muted.
function statoClima(
  stato: "assente" | "rotto" | "presente",
): { testo: string; classe: string } {
  if (stato === "assente") return { testo: "Assente", classe: "text-slate" };
  if (stato === "rotto")   return { testo: "Rotto",   classe: "text-amber-700 font-medium" };
  return { testo: "Presente", classe: "text-muted" };
}

export function ClassificaOggi({ righe, idsConComodato }: Props) {
  if (righe.length === 0) {
    return (
      <div className="px-5 py-6 text-[13px] text-slate">
        Nessuna assegnazione oggi. Il batch notturno non ha ancora girato
        (o non ha trovato allerta per la data corrente).
      </div>
    );
  }

  return (
    // Scroll su entrambi gli assi in un solo contenitore
    // (`overflow-auto`) — sticky thead funziona rispetto a questo div
    // (unico ancestor con overflow ≠ visible), quindi resta incollato
    // in alto durante lo scroll verticale e scorre orizzontalmente
    // insieme al body quando la tabella non entra in larghezza (mobile:
    // 8 colonne su ~360 px non ci stanno). `max-h-[480px]` mostra ~18
    // righe più header: nel canone tipico a soglia 25 servono ~7 righe
    // di scroll; con soglia 60 la card resta comunque contenuta invece
    // di far crescere l'intera pagina. Valore coerente con
    // `max-h-72`/`max-h-96` di Usciti e Segnalazioni.
    // `min-w-[720px]` sulla table: soglia sotto la quale scatta lo
    // scroll orizzontale — le 8 colonne stanno strette ma leggibili;
    // sotto quello il testo si comprimerebbe illeggibile e i numeri
    // tabular-nums perderebbero l'allineamento.
    <div className="max-h-[480px] overflow-auto border-t border-rule">
      <table className="w-full min-w-[720px] text-[13px] border-collapse">
        <thead className="sticky top-0 bg-card z-10">
          <tr>
            <Th className="text-center w-14">Rango</Th>
            <Th className="text-left whitespace-nowrap">Persona</Th>
            <Th className="text-left">Quartiere</Th>
            <Th className="text-center w-14">Età</Th>
            <Th className="text-center whitespace-nowrap">Volontario</Th>
            <Th
              className="text-left w-28"
              title="Ultimo contatto registrato oggi per questa persona. Tre gruppi disgiunti: nessun contatto ancora, tentata senza risposta, raggiunta con esito noto."
            >
              Stato contatto
            </Th>
            <Th
              className="text-center w-24"
              title="Segnalazioni osservative aperte (sintomi riferiti, ventilatore rotto). Stesso filtro della card «Segnalazioni aperte» in cima. Non conta le condizioni strutturali della scheda persona."
            >
              Segnalazioni
            </Th>
            <Th
              className="text-left w-40"
              title="Stato del condizionatore della persona derivato dai segnali aperti. «Assente» = nessuna_climatizzazione aperto; «Rotto» = ventilatore_rotto aperto senza il primo; «Presente» = nessuno dei due. La nota «in comodato» compare sulle prime persone della lista che non hanno clima presente."
            >
              Condizionatore
            </Th>
          </tr>
        </thead>
        <tbody>
          {righe.map((r) => {
            const evidenziaComodato = idsConComodato.has(r.personaId);
            const eta = r.annoNascita ? ORA - r.annoNascita : null;
            const stato = statoContatto(r.ultimoEsitoOggi);
            const clima = statoClima(r.statoCondizionatore);
            // `even:bg-foot` — righe pari con fondo tenue (`#F7F9FA`,
            // token `foot` del tema, lo stesso usato da footer e
            // hover degli item). Il border `border-b border-rule/60`
            // delle celle (Td) resta: bg-foot su bg-card è una
            // differenza di ~2% di luminanza, insufficiente da sola
            // a marcare la separazione fra righe; la border-rule fa
            // il lavoro di separatore verticale, l'alternanza aiuta
            // l'occhio a seguire orizzontalmente su righe a 8
            // colonne. Non si sommano — coesistono. La stessa
            // alternanza NON è applicata a TabellaUsciti in questo
            // giro (valutazione separata dopo osservazione d'uso).
            return (
              <tr key={r.personaId} className="even:bg-foot">
                <Td className="text-center">
                  {/* Pattern `inline-block w-6 text-right` + tabular-nums:
                      i numeri sono ancorati a destra dentro un rettangolo
                      di 24 px (larghezza fissa), poi la cella centra il
                      rettangolo. Effetto: l'ultima cifra di "1" e "15" è
                      alla stessa x — la colonna resta incolonnata anche
                      centrata, non balla fra numeri a 1 e 2 cifre.
                      `w-6` copre 2 cifre a 13 px mono (24 px cella
                      interna); se in futuro la soglia superasse 99, va
                      passato a w-8. */}
                  <span className="inline-block w-6 text-right font-mono tabular-nums">
                    {r.rangoGlobale ?? "—"}
                  </span>
                </Td>
                <Td className="font-medium whitespace-nowrap">
                  {/* Apre la scheda dettaglio della persona lato
                      coordinatore. Il resto della tabella non è
                      cliccabile per non trasformare tutta la riga in
                      un target. */}
                  <Link
                    href={`/coordinatore/persona/${r.personaId}`}
                    className="text-ink no-underline hover:underline"
                  >
                    {r.idEsterno}
                  </Link>
                </Td>
                <Td className="text-slate">{r.quartiere ?? "—"}</Td>
                <Td className="text-center text-slate">
                  <span className="inline-block w-6 text-right font-mono tabular-nums">
                    {eta ?? "—"}
                  </span>
                </Td>
                <Td className="text-center text-slate whitespace-nowrap">
                  {r.volontarioNome}
                </Td>
                <Td className={stato.classe + " whitespace-nowrap"}>{stato.testo}</Td>
                <Td className="text-center">
                  {r.nSegnaliOsservativi > 0 ? (
                    <span className="inline-block w-4 text-right font-mono tabular-nums text-red-700 font-medium">
                      {r.nSegnaliOsservativi}
                    </span>
                  ) : (
                    <span className="text-muted">—</span>
                  )}
                </Td>
                <Td>
                  {/* Stato e nota comodato sulla stessa riga: altezza
                      delle righe uniforme. Nota "in comodato"
                      alleggerita — solo la parola in ambra a peso
                      semibold, senza riquadro né fondo pieno. */}
                  <div className="flex items-baseline gap-2 whitespace-nowrap">
                    <span className={clima.classe}>{clima.testo}</span>
                    {evidenziaComodato && (
                      <span className="text-[12px] text-amber-700 font-semibold">
                        · in comodato
                      </span>
                    )}
                  </div>
                </Td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Th({
  children,
  className = "",
  title,
}: {
  children: React.ReactNode;
  className?: string;
  title?: string;
}) {
  // Nessun `text-left` di default: chi vuole un allineamento diverso
  // (right o center) lo dichiara in `className` e vince senza guerre
  // di specificità. Prima il default `text-left` sovrastava il
  // `text-right` passato dalla colonna Rango — l'intestazione
  // restava a sinistra mentre i numeri stavano a destra.
  return (
    <th
      title={title}
      className={
        // MOD07-microcopy 2b: intestazioni colonna scurite da `text-muted`
        // a `text-slate` per allinearsi al trattamento delle intestazioni
        // card. Stesso token, stesso motivo (small caps 11 px richiedono
        // colore più deciso del muted per fare da ancoraggio).
        "font-display font-semibold text-[11px] tracking-label uppercase text-slate py-2 px-3 border-b border-rule bg-card " +
        className
      }
    >
      {children}
    </th>
  );
}

function Td({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  // px-3 (invece del vecchio pr-3): il padding a sinistra è necessario
  // per non attaccare il primo carattere al bordo cella quando la
  // colonna è centrata. Il vecchio pr-3 funzionava con text-left
  // implicito che appoggiava a sinistra senza bisogno di pl.
  return (
    <td className={"py-2 px-3 border-b border-rule/60 " + className}>{children}</td>
  );
}
