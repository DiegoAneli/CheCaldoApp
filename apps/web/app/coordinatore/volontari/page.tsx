/**
 * §12jjjjj — Pagina di gestione volontari per il coordinatore.
 *
 * Non è in dashboard perché aggiungere/attivare un volontario è
 * un'azione rara. La dashboard resta focalizzata sul giro del giorno;
 * questa pagina raggruppa le azioni sui volontari.
 *
 * Contenuto (revisione 2026-08-12):
 * - Tabella unica dei volontari dell'org (attivi + disattivati)
 *   ordinata per stato + email, con azioni sulla riga (pausa/riprendi,
 *   disattiva/riattiva). Sostituisce le due tabelle separate.
 * - Nessun banner esplicativo sull'aggiunta da riga di comando: la
 *   procedura è documentata nel README (punto 5, "Come installarlo
 *   altrove") e in MOD07 §4bis. Un coord che apre questa pagina non
 *   deve leggere istruzioni di deploy.
 *
 * `assertAppartiene` protegge ogni scrittura: un coord non può
 * modificare volontari di un'altra org anche se conosce/indovina
 * l'id. Le server action passano `orgId` dal cookie, mai da URL.
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { sql } from "@/lib/db";
import {
  comuneDellOrganizzazione,
  impostaAttivo,
  metteInPausa,
  presenzaVolontariOggi,
  riprendeDallaPausa,
  utentePerId,
} from "@checaldo/db";
import { coordinatoreIdCorrente } from "@/lib/auth-demo";
import { isoOggi, formatoUmano } from "@/lib/data-oggi";
import { Navbar } from "@/components/navbar";
import { comunePerIstat } from "@/lib/comuni";
import { TabellaVolontari, type RigaVolontario } from "@/components/tabella-volontari";

export default async function GestioneVolontari() {
  const coordinatoreId = await coordinatoreIdCorrente();
  if (!coordinatoreId) redirect("/");

  const utente = await utentePerId(sql, coordinatoreId);
  if (!utente || utente.ruolo !== "coordinatore") redirect("/");

  const oggi = isoOggi();
  const orgId = utente.organizzazioneId;

  const [comuneIstat, volontariAttivi, volontariInattivi] = await Promise.all([
    comuneDellOrganizzazione(sql, orgId),
    presenzaVolontariOggi(sql, orgId, oggi),
    // Volontari con attivo=false: sono fuori dall'anagrafe operativa.
    // La query è locale a questa pagina (nessun uso altrove giustifica
    // una funzione dedicata in @checaldo/db).
    sql<Array<{ id: number; nome: string; email: string }>>`
      SELECT id, nome, email
        FROM riservato.utente
       WHERE organizzazione_id = ${orgId}
         AND ruolo = 'volontario' AND attivo = false
       ORDER BY email
    `,
  ]);
  const comuneOrg = comunePerIstat(comuneIstat);

  // §12jjjjj addendum (2026-08-12) — riga della tabella unificata.
  // `personeInCarico` è null per i disattivati: non partecipano ai
  // giri, la colonna "Carico oggi" mostrerà "—".
  const righeTabella: RigaVolontario[] = [
    ...volontariAttivi.map((v) => ({
      id: v.id,
      nome: v.nome,
      email: v.email,
      attivo: true,
      inPausa: v.inPausa,
      personeInCarico: v.personeInCarico,
    })),
    ...volontariInattivi.map((v) => ({
      id: v.id,
      nome: v.nome,
      email: v.email,
      attivo: false,
      inPausa: false,
      personeInCarico: null,
    })),
  ];

  async function metteInPausaAction(volontarioId: number) {
    "use server";
    if (!coordinatoreId) return;
    await metteInPausa(sql, orgId, volontarioId, oggi, coordinatoreId);
    revalidatePath("/coordinatore/volontari");
    revalidatePath("/coordinatore");
  }
  async function riprendeDallaPausaAction(volontarioId: number) {
    "use server";
    if (!coordinatoreId) return;
    await riprendeDallaPausa(sql, orgId, volontarioId, oggi, coordinatoreId);
    revalidatePath("/coordinatore/volontari");
    revalidatePath("/coordinatore");
  }
  async function attivaAction(volontarioId: number) {
    "use server";
    if (!coordinatoreId) return;
    await impostaAttivo(sql, orgId, volontarioId, true, coordinatoreId);
    revalidatePath("/coordinatore/volontari");
    revalidatePath("/coordinatore");
  }
  async function disattivaAction(volontarioId: number) {
    "use server";
    if (!coordinatoreId) return;
    // §12jjjjj addendum (2026-08-12) — disattivare un vol lo esclude
    // dai giri futuri ma NON toglie la pausa del giorno corrente. La
    // sequenza "in pausa oggi → disattivato" è ammessa: la riga in
    // pausa_volontario resta orfana rispetto alla presenza (u.attivo
    // = false → non compare in presenzaVolontariOggi), ma non
    // interferisce con nulla e verrà ripulita dal cron di manutenzione
    // se un giorno esisterà. Nel frattempo: nessuna operazione qui.
    await impostaAttivo(sql, orgId, volontarioId, false, coordinatoreId);
    revalidatePath("/coordinatore/volontari");
    revalidatePath("/coordinatore");
  }

  return (
    <>
      <Navbar
        ruolo="coordinatore"
        nomeComune={comuneOrg?.nome ?? "—"}
        slugComune={comuneOrg?.slug ?? ""}
        contesto={`${utente.nome} — ${formatoUmano(oggi)}`}
      />
      <div className="max-w-4xl mx-auto py-6 px-6">
        <h1 className="text-h2">Volontari</h1>
        <p className="text-[12.5px] text-slate mt-1 max-w-prose">
          Anagrafe operativa. Metti in pausa oggi chi non è
          disponibile per il giro odierno; disattiva chi ha smesso
          di collaborare (esclusione da tutti i giri futuri).
        </p>

        <div className="mt-6">
          <TabellaVolontari
            righe={righeTabella}
            onPausa={metteInPausaAction}
            onRiprendi={riprendeDallaPausaAction}
            onDisattiva={disattivaAction}
            onAttiva={attivaAction}
          />
        </div>
      </div>
    </>
  );
}
