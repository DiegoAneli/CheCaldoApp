// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Blocco "Situazione già nota" per la scheda del volontario
 * (§12vvv). Elenca le condizioni attive della persona in una
 * riga per tipo, con la data di comparsa e — solo se ≠
 * 'volontario' — l'origine.
 *
 * Se non ci sono condizioni note, **il blocco non compare**: non
 * scriviamo "Nessuna condizione registrata". L'assenza non è
 * un'affermazione — stesso principio della pagina pubblica (mai
 * dichiarare "nessun rischio") e del fattore
 * `giorni_da_ultimo_contatto` in §12jjj (NULL neutro).
 *
 * Precede la falla dei duplicati: mostrare le condizioni note
 * senza il vincolo di unicità di §12uuu (unique index parziale su
 * `(persona_id, tipo) WHERE chiuso_il IS NULL`) peggiorerebbe il
 * sistema — il volontario che risponde alla stessa domanda dopo
 * aver visto il blocco produrrebbe un duplicato. Con §12uuu + il
 * `ON CONFLICT DO NOTHING` di `registraContatto`, la ripetizione
 * è silenziosamente idempotente.
 */

import type { SegnaleAttivo, TipoSegnale } from "@checaldo/scoring";
import { formatoGiornoMese } from "@/lib/data-oggi";

interface Props {
  righe: SegnaleAttivo[];
}

/**
 * Ordinamento del blocco (§12www): osservativi prima, strutturali dopo.
 * Dentro ciascun gruppo, più recenti (creatoIl DESC) in cima. Motivo:
 * le condizioni osservative (sintomi_riferiti, ventilatore_rotto) sono
 * quelle su cui il volontario può agire oggi — un ventilatore rotto si
 * può segnalare per riparazione, un sintomo cambia l'azione. Le
 * strutturali sono profilo permanente della persona: contesto, non
 * evento. Recenza DESC dentro il gruppo perché la condizione appena
 * comparsa è quella che il volontario di ieri ha appena registrato,
 * meritoria di priorità visiva rispetto a una condizione di due
 * settimane fa.
 *
 * L'insieme "osservativi" qui coincide con `TIPI_OSSERVATIVI` di
 * `packages/db/src/query.ts:1067` (definizione §12sss dopo l'esclusione
 * di nessun_contatto_riferito), duplicato localmente per non introdurre
 * una dipendenza cross-package su una costante di due elementi.
 */
const OSSERVATIVI = new Set<TipoSegnale>(["sintomi_riferiti", "ventilatore_rotto"]);

function ordina(righe: SegnaleAttivo[]): SegnaleAttivo[] {
  return [...righe].sort((a, b) => {
    const ga = OSSERVATIVI.has(a.tipo) ? 0 : 1;
    const gb = OSSERVATIVI.has(b.tipo) ? 0 : 1;
    if (ga !== gb) return ga - gb;
    // Dentro il gruppo: creatoIl DESC (più recente prima). Confronto
    // lessicografico su ISO 'YYYY-MM-DDTHH:MM:SSZ' è cronologicamente
    // corretto. Assenza di creatoIl → in fondo al proprio gruppo.
    const ta = a.creatoIl ?? "";
    const tb = b.creatoIl ?? "";
    if (ta === tb) return 0;
    return tb.localeCompare(ta);
  });
}

/**
 * Testi approvati in CHECALDO-PROGETTO §12uuu (coda). Sono
 * condizioni **stative** della persona, non azioni: presente
 * indicativo, seconda persona formale non necessaria (non ci si
 * rivolge alla persona). "Ha riferito sintomi" senza la seconda
 * parte sulla scheda che va al coordinatore — quello lo dice già
 * il badge azione dell'intestazione.
 */
function etichettaTipo(t: TipoSegnale): string {
  switch (t) {
    case "nessuna_climatizzazione":  return "Non ha condizionatore né ventilatore";
    case "ventilatore_rotto":        return "Ventilatore rotto";
    case "rete_familiare_assente":   return "Non ha nessuno che possa aiutare";
    case "difficolta_mobilita":      return "Ha difficoltà a muoversi";
    case "nessun_contatto_riferito": return "Non sente nessuno da tempo";
    case "sintomi_riferiti":         return "Ha riferito sintomi";
  }
}

/**
 * Origine mostrata solo quando ≠ 'volontario' — regola default-
 * implicito + eccezioni-dichiarate, coerente con `etichettaOrigine`
 * di `segnali-aperti.tsx:66-74` sulla card del coordinatore. Se il
 * volontario di oggi rilegge, l'origine 'volontario' non aggiunge
 * (è stato lui o un collega); le altre tre sì.
 */
function etichettaOrigine(o: SegnaleAttivo["origine"]): string | null {
  switch (o) {
    case "volontario":   return null;
    case "cittadino":    return "segnalata da un cittadino";
    case "mmg":          return "segnalata dal medico di famiglia";
    case "coordinatore": return "segnalata dal coordinatore";
  }
}

export function CondizioniNote({ righe }: Props) {
  if (righe.length === 0) return null;
  const ordinate = ordina(righe);

  return (
    <div className="px-4 pt-4 pb-3 border-t border-rule">
      <div className="text-[13px] font-display font-semibold tracking-label uppercase text-slate">
        Situazione già nota
      </div>
      <ul className="mt-2 space-y-1.5">
        {ordinate.map((s) => (
          <RigaCondizione key={s.tipo} s={s} />
        ))}
      </ul>
    </div>
  );
}

function RigaCondizione({ s }: { s: SegnaleAttivo }) {
  const testo = etichettaTipo(s.tipo);
  const dal = s.creatoIl ? `dal ${formatoGiornoMese(s.creatoIl)}` : null;
  const origine = etichettaOrigine(s.origine);

  return (
    <li className="text-[12.5px] leading-snug">
      <span className="text-ink">{testo}</span>
      {dal && <span className="text-muted"> · {dal}</span>}
      {origine && <span className="text-muted"> · {origine}</span>}
    </li>
  );
}
