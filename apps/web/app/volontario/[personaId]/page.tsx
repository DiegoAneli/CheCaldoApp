// SPDX-License-Identifier: AGPL-3.0-or-later
import { redirect, notFound } from "next/navigation";
import { sql } from "@/lib/db";
import {
  comuneDellOrganizzazione,
  EsitoIncoerente,
  personaPerId,
  scriviAccessoScheda,
  registraContatto,
  toPersonaScoring,
  utentePerId,
} from "@checaldo/db";
import { azionePer } from "@checaldo/scoring";
import { volontarioIdCorrente } from "@/lib/auth-demo";
import { isoOggi, formatoDataBreve } from "@/lib/data-oggi";
import { Navbar } from "@/components/navbar";
import { comunePerIstat } from "@/lib/comuni";
import { BandaDemo } from "@/components/banda-demo";
import { motivazione } from "@/lib/motivazione";
import { SchedaPersonaForm, type Esito } from "@/components/scheda-persona";
import { CondizioniNote } from "@/components/condizioni-note";
import { IconaTelefono } from "@/components/icona-telefono";
import type { TipoSegnale, FattoreSpiegabile } from "@checaldo/scoring";

export default async function SchedaPersona({
  params,
}: {
  params: Promise<{ personaId: string }>;
}) {
  const volontarioId = await volontarioIdCorrente();
  if (!volontarioId) redirect("/");
  const utente = await utentePerId(sql, volontarioId);
  if (!utente) redirect("/");
  // Estraggo il valore così la closure `registra` non deve capturare il
  // narrowing di `utente` (TS non narrowa dopo un `redirect`).
  const organizzazioneSessione = utente.organizzazioneId;
  const { personaId: personaIdRaw } = await params;
  const personaId = Number(personaIdRaw);
  if (!Number.isFinite(personaId)) notFound();

  const oggi = isoOggi();
  const [a, comuneIstat] = await Promise.all([
    personaPerId(sql, volontarioId, personaId, oggi),
    comuneDellOrganizzazione(sql, organizzazioneSessione),
  ]);
  if (!a) notFound();
  const comuneOrg = comunePerIstat(comuneIstat);

  // Log accesso: fire-and-forget. La scheda si apre anche se questa
  // scrittura fallisce (correzione d MOD03). L'organizzazione della
  // sessione (utente.organizzazioneId) blocca il log-poisoning cross-org
  // (fix I audit isolamento 2026-08-03).
  scriviAccessoScheda(sql, organizzazioneSessione, volontarioId, personaId).catch((e) => {
    // eslint-disable-next-line no-console
    console.warn("log accesso_scheda fallito:", (e as Error).message);
  });

  // Azione ricalcolata live dalla persona: la colonna azione salvata
  // nell'assegnazione è solo indicativa (decisione MOD03).
  const azioneLive = azionePer(toPersonaScoring(a), new Date(oggi + "T00:00:00Z"));

  const testoMotivazione = motivazione({
    fattori: (a.fattori as FattoreSpiegabile[]) ?? [],
    quartiere: a.quartiere,
    rangoGlobale: a.rangoGlobale,
    posizioneIeri: a.posizioneIeri,
    annoNascita: a.annoNascita,
    viveSolo: a.viveSolo,
  });

  // Indirizzo: verifica esplicita in codice, non solo nel markup
  // (correzione c MOD03).
  const indirizzoVisibile =
    azioneLive === "visita_domiciliare" && a.indirizzo !== null;

  const hrefTel = a.telefono ? `tel:${a.telefono.replace(/[^\d+]/g, "")}` : null;

  async function registra(args: {
    esito: Esito;
    notaLibera: string;
    segnaliNuovi: { tipo: TipoSegnale; origine: "volontario" }[];
    segnaliDaChiudere: TipoSegnale[];
  }): Promise<{ ok: true } | { ok: false; motivo: string }> {
    "use server";
    if (!volontarioId) return { ok: false, motivo: "Sessione scaduta, ricarica la pagina." };
    // organizzazioneSessione dal cookie (utente autenticato), non da URL —
    // impedisce che un POST spedito da fuori l'app con personaId di altra
    // org registri contatti fittizi (fix B audit isolamento 2026-08-03).
    try {
      await registraContatto(sql, {
        organizzazioneSessione,
        volontarioId,
        personaId,
        esito: args.esito,
        notaLibera: args.notaLibera || undefined,
        segnaliNuovi: args.segnaliNuovi,
        segnaliDaChiudere: args.segnaliDaChiudere,
      });
      return { ok: true };
    } catch (e) {
      // EsitoIncoerente è la sola classe applicativa che vogliamo
      // tradurre in messaggio al client (motivo user-facing). Tutto il
      // resto (assertAppartiene, DB giù, bug) risale come Error e il
      // client lo mostra come "Salvataggio fallito: riprova".
      if (e instanceof EsitoIncoerente) {
        return { ok: false, motivo: e.message };
      }
      throw e;
    }
  }

  return (
    <>
      <Navbar
        ruolo="volontario"
        nomeComune={comuneOrg?.nome ?? "—"}
        slugComune={comuneOrg?.slug ?? ""}
        nomeUtente={utente.nome}
      />
      <div className="max-w-lg mx-auto py-6 px-4">
        <div className="border border-rule rounded-card bg-card overflow-hidden">
        <BandaDemo />

        <div className="px-4 pt-4 pb-4 border-b border-rule">
          <div className="flex items-baseline justify-between gap-3">
            <div>
              <div className="text-h2 font-display font-semibold">{a.idEsterno}</div>
              <div className="text-[11.5px] text-muted mt-0.5">
                {a.quartiere ?? "quartiere n.d."}
              </div>
            </div>
          </div>

          <p className="text-[12.5px] text-slate mt-3 leading-normal">{testoMotivazione}</p>

          <div className="flex items-center gap-2 mt-3">
            <span className="inline-block text-[11px] font-display font-semibold tracking-chip uppercase bg-demoband text-demoink border border-demorule rounded-btn px-2 py-1">
              Azione: {etichettaAzione(azioneLive)}
            </span>
          </div>

          {indirizzoVisibile && (
            <div className="mt-3 text-[13px] font-mono">
              <span className="text-muted">Indirizzo:</span> {a.indirizzo}
            </div>
          )}

          {/* Riga di contesto d'anagrafe (§12jjj revisione): mostra
              l'ultimo contatto documentato nell'anagrafe pre-esistente
              dell'organizzazione — distinto dai contatti CheCaldo (che
              sono più recenti se esistono). La parola "In anagrafe"
              delimita la fonte: un volontario che ha chiamato ieri
              non legge "5 giugno 2026" pensando che sia sbagliato.
              Assente quando NULL (l'assenza di riga non è
              un'affermazione, coerente con la scelta motore
              "NULL neutro"). Sotto Indirizzo perché quella è
              informazione fisica che serve per arrivare, questa è
              contesto. */}
          {a.dataUltimoContattoAnagrafe && (
            <div className="mt-3 text-[12.5px] text-slate">
              <span className="text-muted">In anagrafe:</span>{" "}
              ultimo contatto {formatoDataBreve(a.dataUltimoContattoAnagrafe)}{" "}
              ({giorniDa(a.dataUltimoContattoAnagrafe, oggi)} giorni fa)
            </div>
          )}

          {hrefTel && (
            // Icona a piena larghezza, area toccabile abbondante (`py-3`,
            // ~48px totale). aria-label + testo sr-only per screen reader
            // e per l'affordance visiva su desktop dove l'icona rischia
            // di risultare ambigua. `justify-center` centra il glifo,
            // il tap resta comodo su tutto il pulsante.
            <a
              href={hrefTel}
              aria-label="Chiama"
              className="mt-4 flex items-center justify-center bg-ink text-white py-3 rounded-btn no-underline"
            >
              <IconaTelefono size={24} />
              <span className="sr-only">Chiama</span>
            </a>
          )}
        </div>

        <CondizioniNote righe={a.segnali} />

        <SchedaPersonaForm
          personaId={personaId}
          registra={registra}
          tipiApertiOggi={a.segnali.map((s) => s.tipo)}
        />
      </div>
      </div>
    </>
  );
}

function etichettaAzione(a: string): string {
  switch (a) {
    case "prima_chiamata": return "prima chiamata";
    case "seconda_chiamata": return "seconda chiamata";
    case "contatto_familiare": return "contatto familiare";
    case "visita_domiciliare": return "visita domiciliare";
    case "valutazione_coordinatore": return "valutazione coordinatore";
    default: return a;
  }
}

// Giorni interi trascorsi da `iso` a `oggiIso`. Duplicato locale di
// `giorniDa` di scoring — dipendenza in meno per calcolare N nella
// riga di contesto anagrafe. Semantica identica: floor su base UTC
// dei millisecondi.
function giorniDa(iso: string, oggiIso: string): number {
  const t = Date.parse(iso + "T00:00:00Z");
  const o = Date.parse(oggiIso + "T00:00:00Z");
  return Math.max(0, Math.floor((o - t) / 86_400_000));
}
