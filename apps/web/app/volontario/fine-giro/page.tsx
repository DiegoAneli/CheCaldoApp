// SPDX-License-Identifier: AGPL-3.0-or-later
import { redirect } from "next/navigation";
import Link from "next/link";
import { sql } from "@/lib/db";
import {
  assegnazioniDelVolontarioOggi,
  comuneDellOrganizzazione,
  esitiDelVolontarioOggi,
  utentePerId,
} from "@checaldo/db";
import { volontarioIdCorrente } from "@/lib/auth-demo";
import { isoOggi, formatoUmano } from "@/lib/data-oggi";
import { BandaDemo } from "@/components/banda-demo";
import { Navbar } from "@/components/navbar";
import { comunePerIstat } from "@/lib/comuni";

export default async function FineGiro() {
  const volontarioId = await volontarioIdCorrente();
  if (!volontarioId) redirect("/");
  const utente = await utentePerId(sql, volontarioId);
  if (!utente) redirect("/");

  const oggi = isoOggi();
  const [assegnazioni, esiti, comuneIstat] = await Promise.all([
    assegnazioniDelVolontarioOggi(sql, volontarioId, oggi),
    esitiDelVolontarioOggi(sql, volontarioId, oggi),
    comuneDellOrganizzazione(sql, utente.organizzazioneId),
  ]);
  const comuneOrg = comunePerIstat(comuneIstat);

  const esitoPer = new Map(esiti.map((e) => [e.personaId, e]));
  const contattate = assegnazioni.filter((a) => {
    const e = esitoPer.get(a.personaId);
    return e && e.esito !== "non_risponde";
  });
  const nonRaggiunte = assegnazioni.filter((a) => {
    const e = esitoPer.get(a.personaId);
    return e && e.esito === "non_risponde";
  });
  const resta = assegnazioni.filter((a) => !esitoPer.get(a.personaId));

  return (
    <>
      <Navbar
        ruolo="volontario"
        nomeComune={comuneOrg?.nome ?? "—"}
        slugComune={comuneOrg?.slug ?? ""}
        nomeUtente={utente.nome}
      />
      <div className="max-w-lg mx-auto py-6 px-4">
        <div className="mt-4 border border-rule rounded-card bg-card overflow-hidden">
        <BandaDemo />

        <div className="px-4 pt-4 pb-4 border-b border-rule">
          <Link
            href="/volontario"
            className="inline-block bg-ink text-white px-4 py-2 rounded-btn font-display font-semibold text-[13px] no-underline"
          >
            ← Il giro di oggi
          </Link>
          <h2 className="text-h2 mt-4">Fine giro</h2>
          <p className="font-mono text-[12.5px] text-slate mt-0.5">
            {formatoUmano(oggi)}
          </p>
        </div>

        {/* Stat a 3 colonne (§12lll). Semantica dei conteggi:
              - Raggiunte: esito != non_risponde (sta_bene, ha_bisogno)
              - Non risponde: esito == non_risponde (§12mmm: era
                "Senza risposta", accorciato per allinearsi al lessico
                del bottone della scheda e per evitare wrap a 360px)
              - Resta: nessun esito registrato (da chiamare)
            Diversa dalla dashboard, che ha "Tentate" (include
            non_risponde) e "Senza risposta" (ultimo esito
            non_risponde). Le due pagine servono momenti diversi e
            utenti diversi — vedi §12lll per la ragione di non
            unificare. */}
        <div className="grid grid-cols-3 border-b border-rule">
          <Stat k="Raggiunte" v={contattate.length} />
          <Stat k="Non risponde" v={nonRaggiunte.length} />
          <Stat k="Resta" v={resta.length} />
        </div>

        <Sezione titolo="Raggiunte">
          {contattate.length === 0 ? (
            <RigaVuota testo="Nessuna ancora." />
          ) : (
            contattate.map((a) => {
              const e = esitoPer.get(a.personaId)!;
              const dett =
                e.esito === "sta_bene"
                  ? "sta bene"
                  : "ha bisogno" + (e.vaAlCoordinatore ? " — va al coordinatore" : "");
              return (
                <Riga
                  key={a.personaId}
                  icona="✓"
                  iconaClasse="text-emerald-700"
                  nome={a.idEsterno}
                  dettaglio={dett}
                />
              );
            })
          )}
        </Sezione>

        <Sezione titolo="Non risponde">
          {nonRaggiunte.length === 0 ? (
            <RigaVuota testo="Nessuna." />
          ) : (
            nonRaggiunte.map((a) => {
              const tent = a.tentativiOggi;
              // §12ooooo: rimosso il suffisso "— segnalata al coordinatore"
              // che scattava a tent > 2. Prometteva un passaggio di stato
              // che nel codice non esiste — `azionePer` in
              // packages/scoring/src/index.ts:232-241 manda a
              // `valutazione_coordinatore` SOLO con `sintomi_riferiti`.
              // Sui tentativi falliti cambia solo l'azione suggerita
              // (prima → seconda → contatto_familiare → visita_domiciliare),
              // la persona resta assegnata allo stesso volontario.
              const dettaglio = `${tent}° tentativo fallito`;
              return (
                <Riga
                  key={a.personaId}
                  icona="○"
                  iconaClasse="text-muted"
                  nome={a.idEsterno}
                  dettaglio={dettaglio}
                />
              );
            })
          )}
        </Sezione>

        <Sezione titolo="Resta">
          {resta.length === 0 ? (
            <RigaVuota testo="Niente da chiudere." />
          ) : (
            resta.map((a) => (
              <Riga
                key={a.personaId}
                icona="⋯"
                iconaClasse="text-muted"
                nome={a.idEsterno}
                dettaglio="Non aperta oggi: nessun tentativo registrato."
              />
            ))
          )}
        </Sezione>
        {/* §12ppppp: rimosso il pulsante "Chiudi giornata" che era
            qui in fondo. Era un `<Link href="/volontario">` che non
            scriveva nulla nel DB e non esisteva alcun "stato di
            giornata chiusa" corrispondente. Il ritorno al giro
            avviene dal pulsante "← Il giro di oggi" in cima alla
            card. La riflessione su una vera chiusura giornata è in
            CHECALDO-PROGETTO.md §12ppppp: richiederebbe una tabella
            separata, non `pausa_volontario` (che ha già una sua
            semantica per il calcolo di `capienzaSuggerita`). */}
      </div>
      </div>
    </>
  );
}

function Stat({ k, v }: { k: string; v: number }) {
  return (
    // Allineamento numeri (§12nnn): la label ha altezza fissa `h-10`
    // (40px, spazio comodo per 2 righe di text-[11px] con leading
    // normal ~33px + buffer descender) e `flex items-end` ancora il
    // contenuto al basso del contenitore. L'ULTIMA riga di testo di
    // ogni label è sempre a y=40 dal top del label div — se la label
    // è 1 riga sta sola in fondo con 23px vuoti sopra, se è 2 righe
    // riempie il contenitore. Il numero sotto, con mt-1 fisso, parte
    // sempre dalla stessa y-position in tutte e tre le celle.
    //
    // Precedenti tentativi falliti (§12lll e §12mmm): `min-h-[2.5em]`
    // riservava spazio ma non capping-ava la label; `flex-col +
    // mt-auto` dipendeva dallo stretch del grid che non è garantito
    // sui flex container annidati. Solo l'altezza fissa risolve.
    <div className="p-4 border-r border-rule last:border-r-0">
      <div className="h-10 flex items-end text-[11px] font-display font-semibold tracking-label uppercase text-muted">
        <span>{k}</span>
      </div>
      <div className="font-display font-bold text-[27px] tracking-stat font-mono mt-1">
        {v}
      </div>
    </div>
  );
}

function Sezione({ titolo, children }: { titolo: string; children: React.ReactNode }) {
  // Intestazione con lo stesso trattamento delle Card della dashboard
  // (`text-[13px] text-slate` invece di `text-[11px] text-muted`) —
  // le tre sezioni Raggiunte/Non risponde/Resta sono i tre ancoraggi
  // di questa pagina, meritano peso visivo.
  return (
    <section className="border-b border-rule">
      <div className="px-4 pt-4 pb-2 text-[13px] font-display font-semibold tracking-label uppercase text-slate">
        {titolo}
      </div>
      <div className="pb-1">{children}</div>
    </section>
  );
}

function Riga({
  icona, iconaClasse, nome, dettaglio,
}: {
  icona: string; iconaClasse: string; nome: string; dettaglio: string;
}) {
  return (
    <div className="px-4 py-2.5 flex gap-3">
      <span aria-hidden className={`${iconaClasse} shrink-0 w-4 text-center`}>
        {icona}
      </span>
      <div className="flex-1 min-w-0 text-sm">
        <div className="font-medium">{nome}</div>
        <div className="text-[12.5px] text-slate">{dettaglio}</div>
      </div>
    </div>
  );
}

function RigaVuota({ testo }: { testo: string }) {
  return <div className="px-4 py-3 text-[12.5px] text-muted">{testo}</div>;
}
