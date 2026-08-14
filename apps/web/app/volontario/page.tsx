// SPDX-License-Identifier: AGPL-3.0-or-later
import { redirect } from "next/navigation";
import Link from "next/link";
import { sql } from "@/lib/db";
import {
  allertaCorrente,
  assegnazioniDelVolontarioOggi,
  comuneDellOrganizzazione,
  esistonoAssegnazioniOggi,
  esitiDelVolontarioOggi,
  utentePerId,
  volontarioInPausaOggi,
} from "@checaldo/db";
import { volontarioIdCorrente } from "@/lib/auth-demo";
import { isoOggi, formatoUmanoTitolo } from "@/lib/data-oggi";
import { Navbar } from "@/components/navbar";
import { comunePerIstat } from "@/lib/comuni";
import { BadgeLivello } from "@/components/badge-livello";
import { BandaDemo } from "@/components/banda-demo";
import { RigaAssegnazione } from "@/components/riga-assegnazione";

export default async function GiroDiOggi() {
  const volontarioId = await volontarioIdCorrente();
  if (!volontarioId) redirect("/");

  const utente = await utentePerId(sql, volontarioId);
  if (!utente) redirect("/");

  const oggi = isoOggi();
  const comuneIstat = await comuneDellOrganizzazione(sql, utente.organizzazioneId);
  // Due lookup aggiuntivi in parallelo (`inPausa`, `giroPerOrgEsiste`)
  // per distinguere gli stati vuoti (`assegnazioni.length === 0`).
  // Il perché di ogni ramo è nel commento sotto la Map.
  const [assegnazioni, esiti, allerta, inPausa, giroPerOrgEsiste] = await Promise.all([
    assegnazioniDelVolontarioOggi(sql, volontarioId, oggi),
    esitiDelVolontarioOggi(sql, volontarioId, oggi),
    comuneIstat ? allertaCorrente(sql, comuneIstat) : Promise.resolve(null),
    volontarioInPausaOggi(sql, volontarioId, oggi),
    esistonoAssegnazioniOggi(sql, utente.organizzazioneId, oggi),
  ]);
  const esitoPer = new Map(esiti.map((e) => [e.personaId, e]));
  const comuneOrg = comunePerIstat(comuneIstat);

  // Tre stati vuoti distinti, calcolati solo se `assegnazioni.length === 0`.
  //   1. `inPausa` → il coordinatore ha messo in pausa il volontario per
  //      oggi (`riservato.pausa_volontario`): dichiara la ragione e la
  //      via d'uscita.
  //   2. `!inPausa && !giroPerOrgEsiste` → per l'organizzazione non
  //      esiste alcuna assegnazione per oggi. Copre tre cause a monte
  //      indistinguibili fra loro (cron non partito, cron partito ma
  //      fallito prima del commit, cron partito ma ha saltato l'org per
  //      allerta mancante), tutte con lo stesso rimedio: avvisare chi
  //      amministra l'istanza. Questo è l'unico ramo che rende visibile
  //      un cron fallito sul VPS a un utente umano — altrimenti resta
  //      silenzioso finché non lo scopre chi legge `genera-giri.log`.
  //   3. `!inPausa && giroPerOrgEsiste` → il giro c'è per altri, non per
  //      lui (soglia bassa, capienza corta, o entrambe). Nessuna azione
  //      da suggerire, "torna domani" resta la risposta onesta.
  const messaggioStatoVuoto = inPausa
    ? "Oggi sei in pausa. Il tuo giro riprende quando il coordinatore ti rimette in turno."
    : !giroPerOrgEsiste
    ? "Il giro di oggi non è stato ancora preparato. Se la situazione non cambia entro la mattina, avvisa il coordinatore."
    : "Nessuna persona da chiamare oggi. Torna domani.";

  return (
    <>
      <Navbar
        ruolo="volontario"
        nomeComune={comuneOrg?.nome ?? "—"}
        slugComune={comuneOrg?.slug ?? ""}
        nomeUtente={utente.nome}
      />
      <div className="max-w-lg mx-auto py-6 px-4">
        {/* Riga di intestazione: nome comune in arancione a sinistra
            (dimensione contenuta — accompagna la data, non la domina),
            data in grassetto con iniziale maiuscola. Centrata come
            gruppo (`justify-center`) per mantenere la disposizione
            del prototipo. */}
        <div className="flex items-baseline justify-center gap-2 text-[13px]">
          {comuneOrg && (
            <span className="text-lv2 font-display font-semibold">
              {comuneOrg.nome}
            </span>
          )}
          <p className="font-semibold text-ink">
            {formatoUmanoTitolo(oggi)}
          </p>
        </div>

      {/* Livello di allerta: appare sempre, anche a lista vuota — "nessuno da
          contattare" con allerta 3 e allerta 0 non sono la stessa cosa. */}
      <div className="mt-4">
        {allerta ? (
          <BadgeLivello
            livello={allerta.livello}
            provenienza={allerta.provenienza}
            motivoProvenienza={allerta.motivoProvenienza}
          />
        ) : (
          <div className="border border-rule rounded-card bg-card p-4 text-sm text-slate">
            Livello di allerta non ancora calcolato per il comune. In
            attesa del prossimo aggiornamento del poller; se la
            situazione persiste, avvisa il coordinatore.
          </div>
        )}
      </div>

      {/* MOD07-microcopy 3b: rimossi due paragrafi esplicativi.
          Il primo (sopra la card, "I nomi del giro di oggi, in ordine,
          con il motivo accanto. L'ordine non cambia col livello di
          allerta: cambia quante persone entrano nel giro.") e il
          secondo (sotto la card, "Chi non risponde resta in lista e
          viene riproposta…"). Motivo: la vista volontario è mobile-
          first e chi sta per telefonare a una persona fragile vuole
          la lista, non un paragrafo sul funzionamento. Il contenuto
          resta in CHECALDO-PROGETTO.md e finirà nel README. */}

      <div className="mt-4 border border-rule rounded-card bg-card overflow-hidden border-gray-400">
        <BandaDemo />
        <div className="px-4 pt-4 pb-3 border-b border-rule text-center">
          <h2 className="text-h2">Il tuo giro di oggi</h2>
          <p className="text-[12.5px] text-slate mt-0.5">
            {assegnazioni.length}{" "}
            {assegnazioni.length === 1 ? "persona assegnata" : "persone assegnate"}
            {" · "}
            {esiti.length} già{" "}
            {esiti.length === 1 ? "contattata" : "contattate"}
          </p>
        </div>

        {assegnazioni.length === 0 ? (
          <div className="px-4 py-10 text-center text-slate text-sm leading-relaxed">
            {messaggioStatoVuoto}
          </div>
        ) : (
          <ul className="list-none">
            {assegnazioni.map((a, i) => {
              const esito = esitoPer.get(a.personaId);
              const breve = esito
                ? esito.esito === "sta_bene"
                  ? "Contattata — sta bene."
                  : esito.esito === "ha_bisogno"
                  ? "Contattata — ha bisogno." +
                    (esito.vaAlCoordinatore ? " Va al coordinatore." : "")
                  : "Non risponde."
                : undefined;
              return (
                <RigaAssegnazione
                  key={a.personaId}
                  a={a}
                  posizioneNelGiro={i + 1}
                  giaContattato={!!esito}
                  esitoBreve={breve}
                />
              );
            })}
          </ul>
        )}

        {assegnazioni.length > 0 && (
          <div className="px-4 py-4 border-t border-rule">
            <Link
              href="/volontario/fine-giro"
              className="block text-center bg-ink text-white py-3 rounded-btn font-display font-semibold text-[13px] no-underline"
            >
              Fine giro
            </Link>
          </div>
        )}
      </div>
      </div>
    </>
  );
}
