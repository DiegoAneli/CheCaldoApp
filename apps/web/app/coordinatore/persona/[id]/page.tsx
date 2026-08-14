// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Scheda dettaglio persona lato coordinatore (§12jjjj). Sola lettura
 * più una azione: chiudere una condizione.
 *
 * SICUREZZA. È la prima volta in questo progetto che
 * `assertAppartiene` viene usata su una lettura e non su una
 * mutazione. L'id della persona arriva da URL, quindi un coordinatore
 * di Parma potrebbe teoricamente cambiare il numero e provare a
 * caricare `/coordinatore/persona/<id-bologna>`. Il controllo
 * `assertAppartiene(sql, organizzazioneSessione, { personaId })`
 * PRIMA di qualunque lettura è la difesa: se la persona non
 * appartiene all'org della sessione, `notFound()` — nessuna riga
 * del DB nominativa arriva al render, e il coordinatore non ha modo
 * di capire dalla risposta se l'id esiste in un'altra org o se non
 * esiste per niente (evita anche gli enumeration attack sull'esistenza
 * di persone in altre org).
 *
 * DEROGA su telefono e indirizzo. In `packages/db/src/query.ts:70-71`
 * i commenti di `AssegnazioneDelGiorno` dicono "telefono MAI a
 * schermo" e "indirizzo rivelato solo con visita_domiciliare".
 * Quelle regole nascono dalla vista volontario, dove il rischio è
 * un telefono su uno schermo per strada. Qui il coordinatore lavora
 * da postazione, ha già accesso pieno all'anagrafe della propria
 * organizzazione tramite qualunque software gestionale, e senza
 * telefono/indirizzo la scheda perderebbe l'utilità principale
 * (poter chiamare o passare l'indirizzo a chi va sul posto). Deroga
 * esplicitamente dichiarata in §12jjjj.
 */
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { revalidatePath } from "next/cache";
import { sql } from "@/lib/db";
import {
  AppartenenzaViolata,
  assertAppartiene,
  chiudiSegnale,
  comuneDellOrganizzazione,
  contattiPersona,
  datiPersonaCoord,
  segnaliPersona,
  utentePerId,
} from "@checaldo/db";
import type { ContattoPersona, SegnalePersona } from "@checaldo/db";
import { coordinatoreIdCorrente } from "@/lib/auth-demo";
import { isoOggi, formatoUmano, formatoGiornoMese } from "@/lib/data-oggi";
import { Navbar } from "@/components/navbar";
import { comunePerIstat } from "@/lib/comuni";
import { PulsanteChiudiCondizione } from "@/components/pulsante-chiudi-condizione";

const ORA = new Date().getUTCFullYear();

// ------------------------------ etichette
// Ripetute qui e non importate da segnali-aperti/condizioni-note:
// quelle mappano un sottoinsieme dei tipi (osservativi o vice-versa),
// qui devo coprire tutti e sei. Etichette in italiano leggibile per
// header e liste, non i nomi delle chiavi SQL.
function etichettaTipoSegnale(t: string): string {
  switch (t) {
    case "nessuna_climatizzazione":  return "Non ha condizionatore né ventilatore";
    case "ventilatore_rotto":        return "Ventilatore rotto";
    case "rete_familiare_assente":   return "Non ha nessuno che possa aiutare";
    case "difficolta_mobilita":      return "Ha difficoltà a muoversi";
    case "nessun_contatto_riferito": return "Non sente nessuno da tempo";
    case "sintomi_riferiti":         return "Sintomi riferiti";
    default:                         return t;
  }
}

function etichettaOrigine(o: string): string {
  switch (o) {
    case "volontario":   return "volontario";
    case "cittadino":    return "cittadino";
    case "mmg":          return "medico di famiglia";
    case "coordinatore": return "coordinatore";
    default:             return o;
  }
}

function etichettaEsito(e: ContattoPersona["esito"]): string {
  switch (e) {
    case "sta_bene":     return "Sta bene";
    case "ha_bisogno":   return "Ha bisogno";
    case "non_risponde": return "Non risponde";
  }
}

// Fattori del jsonb → etichetta italiana leggibile. Non i nomi
// delle chiavi.
function etichettaFattore(k: string): string {
  switch (k) {
    case "punteggio_sezione":           return "Punteggio della sezione (base)";
    case "persone_per_famiglia":        return "Persone per famiglia";
    case "abitazioni_per_edificio":     return "Abitazioni per edificio";
    case "metri_da_punto_fresco":       return "Metri dal punto fresco più vicino";
    case "delta_termico":               return "Delta termico (satellite)";
    case "fascia_eta":                  return "Fascia di età";
    case "vive_solo":                   return "Vive sola";
    case "giorni_da_ultimo_contatto":   return "Giorni dall'ultimo contatto";
    case "tentativi_falliti":           return "Tentativi senza risposta";
    case "nessuna_climatizzazione":     return "Segnale: nessuna climatizzazione";
    case "ventilatore_rotto":           return "Segnale: ventilatore rotto";
    case "rete_familiare_assente":      return "Segnale: rete familiare assente";
    case "difficolta_mobilita":         return "Segnale: difficoltà motoria";
    case "nessun_contatto_riferito":    return "Segnale: nessun contatto riferito";
    case "sintomi_riferiti":            return "Segnale: sintomi riferiti";
    default:                            return k;
  }
}

interface Fattore {
  chiave: string;
  valore: number | boolean | string;
  unita?: string;
  contributo: number;
  fonte: "istat" | "organizzazione" | "segnale" | "satellite";
}

// ---------------------------------------------------------------- page

export default async function Persona({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const coordinatoreId = await coordinatoreIdCorrente();
  if (!coordinatoreId) redirect("/");

  const utente = await utentePerId(sql, coordinatoreId);
  if (!utente || utente.ruolo !== "coordinatore") redirect("/");
  const organizzazioneSessione = utente.organizzazioneId;

  const { id: idRaw } = await params;
  const personaId = Number(idRaw);
  if (!Number.isFinite(personaId)) notFound();

  // §12jjjj — assertAppartiene su una lettura, prima volta nel
  // progetto. Impedisce che un coordinatore di Parma legga la
  // scheda di una persona di Bologna cambiando l'id in URL.
  try {
    await assertAppartiene(sql, organizzazioneSessione, { personaId });
  } catch (e) {
    if (e instanceof AppartenenzaViolata) notFound();
    throw e;
  }

  const oggi = isoOggi();
  const [dati, segnali, contatti, comuneIstat] = await Promise.all([
    datiPersonaCoord(sql, personaId, oggi),
    segnaliPersona(sql, personaId),
    contattiPersona(sql, personaId),
    comuneDellOrganizzazione(sql, organizzazioneSessione),
  ]);
  if (!dati) notFound();

  // Nome+slug per la Navbar. `comuneDellOrganizzazione` gira in
  // parallelo alle tre query di scheda: nessun round-trip in più.
  const comuneOrg = comunePerIstat(comuneIstat);

  const eta = dati.annoNascita ? ORA - dati.annoNascita : null;

  async function chiudiAction(segnaleId: number): Promise<void> {
    "use server";
    if (!coordinatoreId) return;
    // La chiusura dal coordinatore ha semantica diversa da §12xxx
    // (smentita dal volontario): nessuno ha parlato con la persona.
    // `chiuso_da` popolato con l'id del coordinatore mantiene la
    // traccia; la scheda ha già mostrato al coordinatore cosa sta
    // dichiarando via PulsanteChiudiCondizione.
    await chiudiSegnale(sql, organizzazioneSessione, segnaleId, coordinatoreId);
    revalidatePath(`/coordinatore/persona/${personaId}`);
  }

  return (
    <>
      <Navbar
        ruolo="coordinatore"
        nomeComune={comuneOrg?.nome ?? "—"}
        slugComune={comuneOrg?.slug ?? ""}
        contesto={`${utente.nome} — ${formatoUmano(oggi)}`}
        contenitoreClasse="max-w-4xl mx-auto px-6"
      />
      <div className="max-w-4xl mx-auto py-6 px-6">
        <div className="mt-3">
          <Link
            href="/coordinatore"
            className="inline-block bg-ink text-white px-4 py-2 rounded-btn font-display font-semibold text-[13px] no-underline"
          >
            ← Dashboard
          </Link>
        </div>

      {/* 1. Intestazione */}
      <div className="mt-5 border border-gray-400 rounded-card bg-card">
        <div className="px-5 pt-4 pb-3 flex items-baseline justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-h2 font-display font-semibold">{dati.idEsterno}</h1>
            <div className="text-[12.5px] text-slate mt-1 flex flex-wrap gap-x-3 gap-y-1">
              {eta !== null && <span>{eta} anni</span>}
              {dati.quartiere && <span>· {dati.quartiere}</span>}
              {dati.viveSolo !== null && (
                <span>· {dati.viveSolo ? "vive sola" : "non vive sola"}</span>
              )}
              {dati.piano !== null && (
                <span>
                  · piano {dati.piano}{" "}
                  {dati.ascensore === true
                    ? "con ascensore"
                    : dati.ascensore === false
                    ? "senza ascensore"
                    : ""}
                </span>
              )}
              {dati.segnalatoDaMmg && <span>· segnalata dal medico</span>}
            </div>
          </div>
          <div className="text-right">
            {/* §12kkkk — tre stati distinti, non due. Priorità:
                 rango di OGGI se disponibile (da ultimoRangoValutato
                 se valutataOggi=true), altrimenti ultimaAssegnazione
                 (potrebbe essere di altra data), altrimenti "mai
                 valutata". Il rango di oggi da rango_giorno esiste
                 anche per chi non è in lista (fuori soglia): la
                 scomposizione del punteggio arriva comunque
                 dall'assegnazione (di altra data), il rango attuale
                 no. */}
            {dati.ultimoRangoValutato?.valutataOggi ? (
              <div className="text-[12.5px] text-slate">
                Rango:{" "}
                <span className="font-mono font-semibold text-[15px] text-ink">
                  {dati.ultimoRangoValutato.rango}
                </span>
                <span className="text-muted">
                  {" "}su {dati.ultimoRangoValutato.totaleValutati}
                </span>
                <div className="text-[11px] text-muted mt-0.5">
                  {dati.ultimaAssegnazione?.inListaOggi
                    ? "in lista oggi"
                    : "valutata oggi, fuori dalla lista"}
                </div>
              </div>
            ) : dati.ultimaAssegnazione ? (
              <div className="text-[12.5px] text-slate">
                Rango:{" "}
                <span className="font-mono font-semibold text-[15px] text-ink">
                  {dati.ultimaAssegnazione.rango ?? "—"}
                </span>
                <div className="text-[11px] text-muted mt-0.5">
                  ultima assegnazione: {formatoGiornoMese(dati.ultimaAssegnazione.dataRango)}
                </div>
              </div>
            ) : (
              <div className="text-[12.5px] text-muted">Mai valutata</div>
            )}
          </div>
        </div>

        {/* Anagrafe di contatto — deroga §12jjjj: in chiaro perché
            il coordinatore lavora da postazione e ha già accesso
            pieno all'anagrafe della propria organizzazione. */}
        <div className="px-5 pb-4 pt-2 border-t border-rule/60 text-[13px] font-mono grid grid-cols-1 sm:grid-cols-2 gap-1">
          {dati.telefono && (
            <div>
              <span className="text-muted text-[11.5px] uppercase tracking-label mr-2">Telefono</span>
              <a href={`tel:${dati.telefono.replace(/[^\d+]/g, "")}`} className="text-ink no-underline hover:underline">
                {dati.telefono}
              </a>
            </div>
          )}
          {dati.indirizzo && (
            <div>
              <span className="text-muted text-[11.5px] uppercase tracking-label mr-2">Indirizzo</span>
              <span className="text-ink">{dati.indirizzo}</span>
            </div>
          )}
          {dati.dataUltimoContattoAnagrafe && (
            <div className="sm:col-span-2 text-[12px] text-slate font-body">
              In anagrafe: ultimo contatto pre-CheCaldo{" "}
              {formatoUmano(dati.dataUltimoContattoAnagrafe)}
            </div>
          )}
        </div>
      </div>

      {/* 2. Perché sta lì — scomposizione del punteggio, tre stati (§12kkkk) */}
      <div className="mt-6 border border-gray-400 rounded-card bg-card">
        <h3 className="font-display font-semibold text-[13px] tracking-label uppercase text-muted px-5 pt-4 pb-3">
          Perché sta lì
        </h3>
        <PercheStaLi
          ultimaAssegnazione={dati.ultimaAssegnazione}
          ultimoRangoValutato={dati.ultimoRangoValutato}
        />
      </div>

      {/* 3. Condizioni */}
      <div className="mt-6 border border-gray-400 rounded-card bg-card">
        <h3 className="font-display font-semibold text-[13px] tracking-label uppercase text-muted px-5 pt-4 pb-1">
          Condizioni
        </h3>
        <p className="px-5 pb-3 text-[12.5px] text-slate max-w-prose">
          Tutte le condizioni registrate, aperte e chiuse, in ordine di
          apertura. La chiusura dal coordinatore dichiara che la
          condizione non è più presente, senza che nessuno abbia
          parlato con la persona.
        </p>
        <CondizioniLista segnali={segnali} chiudi={chiudiAction} />
      </div>

      {/* 4. Contatti */}
      <div className="mt-6 mb-8 border border-gray-400 rounded-card bg-card">
        <h3 className="font-display font-semibold text-[13px] tracking-label uppercase text-muted px-5 pt-4 pb-3">
          Contatti
        </h3>
        <ContattiLista contatti={contatti} />
      </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------- 2. scomposizione

// ---------------------------------------------------------------- 2. tre stati

/**
 * §12kkkk — dispatcher fra i tre stati della sezione "Perché sta lì".
 * L'ordine dei rami riflette la gerarchia informativa:
 *   1. mai valutata — nessuna traccia nel motore, stato vuoto onesto;
 *   2. in lista oggi — assegnazione oggi disponibile, scomposizione
 *      completa senza caveat;
 *   3. valutata fuori soglia — mostra il rango di oggi (da rango_giorno)
 *      e, se disponibile, la scomposizione dell'ultima assegnazione
 *      (di altra data), dichiarando esplicitamente che sono due
 *      istanti diversi.
 */
function PercheStaLi({
  ultimaAssegnazione,
  ultimoRangoValutato,
}: {
  ultimaAssegnazione: NonNullable<Awaited<ReturnType<typeof datiPersonaCoord>>>["ultimaAssegnazione"];
  ultimoRangoValutato: NonNullable<Awaited<ReturnType<typeof datiPersonaCoord>>>["ultimoRangoValutato"];
}) {
  // Stato 3: mai valutata (né assegnazione né rango_giorno).
  if (!ultimoRangoValutato && !ultimaAssegnazione) {
    return (
      <p className="px-5 pb-5 text-[13px] text-slate">
        Nessuna valutazione registrata: il motore non ha ancora
        considerato questa persona (probabilmente aggiunta all'anagrafe
        dopo l'ultima generazione del giro).
      </p>
    );
  }

  // Stato 1: in lista oggi — assegnazione oggi presente, contiene
  // rango + punteggio + fattori tutti dello stesso giorno.
  if (ultimaAssegnazione?.inListaOggi) {
    return <ScomposizionePunteggio ass={ultimaAssegnazione} />;
  }

  // Stato 2: valutata (oggi o in un batch precedente) ma non in lista
  // oggi. Il rango + punteggio di oggi (o della data più recente)
  // arriva da rango_giorno. La scomposizione dei fattori arriva
  // dall'ultima assegnazione se esiste — di data diversa, dichiarata.
  const rgOggi = ultimoRangoValutato?.valutataOggi ? ultimoRangoValutato : null;
  return (
    <div className="px-5 pb-4">
      {ultimoRangoValutato && (
        <div className="mb-4 text-[13px]">
          <p className="text-slate leading-normal max-w-prose">
            La persona è stata valutata dal motore
            {rgOggi ? " oggi" : ` il ${formatoGiornoMese(ultimoRangoValutato.data)}`}
            {" "}al rango{" "}
            <span className="font-mono font-semibold text-ink">
              {ultimoRangoValutato.rango}
            </span>{" "}
            su{" "}
            <span className="font-mono text-ink">
              {ultimoRangoValutato.totaleValutati}
            </span>{" "}
            persone dell'organizzazione, con punteggio{" "}
            <span className="font-mono text-ink">
              {ultimoRangoValutato.punteggio.toFixed(3)}
            </span>
            . Non è entrata nella lista perché la soglia del giorno
            taglia più in alto.
          </p>
        </div>
      )}
      {ultimaAssegnazione ? (
        <>
          <p className="text-[12px] text-muted italic mb-3 max-w-prose">
            Scomposizione dei fattori dell'ultima assegnazione (
            {formatoGiornoMese(ultimaAssegnazione.dataRango)}
            {rgOggi ? " — diversa dalla data del rango di oggi sopra" : ""}).
            Il dettaglio dei fattori è disponibile solo per chi entra
            in lista.
          </p>
          <ScomposizionePunteggio ass={ultimaAssegnazione} />
        </>
      ) : (
        <p className="text-[12.5px] text-slate max-w-prose">
          Il dettaglio dei fattori è disponibile solo per chi entra in
          lista.
        </p>
      )}
    </div>
  );
}

function ScomposizionePunteggio({
  ass,
}: {
  ass: NonNullable<Awaited<ReturnType<typeof datiPersonaCoord>>>["ultimaAssegnazione"];
}) {
  if (!ass) return null;
  const fattori = (ass.fattori as Fattore[]) ?? [];
  const base = fattori.find((f) => f.chiave === "punteggio_sezione");
  const moltiplicatori = fattori.filter(
    (f) => f.fonte === "organizzazione" || f.fonte === "segnale",
  );
  const contestoIstat = fattori.filter(
    (f) => f.fonte === "istat" && f.chiave !== "punteggio_sezione",
  );

  return (
    <div className={ass.inListaOggi ? "px-5 pb-4" : ""}>
      {/* Il preambolo "non è la valutazione di oggi" è ora responsabilità
          del dispatcher PercheStaLi (§12kkkk), che sa se la scomposizione
          va accanto a un rango di oggi diverso o è la sola informazione
          disponibile. Qui restiamo neutrali: la tabella dei fattori è la
          stessa in tutti i rami. */}
      <table className="w-full text-[13px] border-collapse">
        <thead>
          <tr>
            <th className="text-left text-[11px] font-display font-semibold tracking-label uppercase text-muted py-2 pr-3 border-b border-rule">
              Fattore
            </th>
            <th className="text-left text-[11px] font-display font-semibold tracking-label uppercase text-muted py-2 pr-3 border-b border-rule">
              Valore
            </th>
            <th className="text-right text-[11px] font-display font-semibold tracking-label uppercase text-muted py-2 border-b border-rule w-28">
              Contributo
            </th>
          </tr>
        </thead>
        <tbody>
          {base && (
            <tr>
              <td className="py-2 pr-3 border-b border-rule/60">
                <span className="font-medium">{etichettaFattore(base.chiave)}</span>
              </td>
              <td className="py-2 pr-3 border-b border-rule/60 font-mono tabular-nums text-slate">
                {typeof base.valore === "number" ? base.valore.toFixed(3) : String(base.valore)}
              </td>
              <td className="py-2 border-b border-rule/60 text-right font-mono tabular-nums">
                {base.contributo.toFixed(4)}
              </td>
            </tr>
          )}
          {moltiplicatori.map((f) => (
            <tr key={f.chiave + String(f.valore)}>
              <td className="py-2 pr-3 border-b border-rule/60 text-slate">
                {etichettaFattore(f.chiave)}
                {f.fonte === "segnale" && typeof f.valore === "string" && (
                  <span className="text-muted"> · da {etichettaOrigine(f.valore)}</span>
                )}
              </td>
              <td className="py-2 pr-3 border-b border-rule/60 font-mono tabular-nums text-slate">
                {typeof f.valore === "boolean"
                  ? f.valore ? "sì" : "no"
                  : typeof f.valore === "number"
                    ? f.valore.toString() + (f.unita ? ` ${f.unita}` : "")
                    : String(f.valore)}
              </td>
              <td className="py-2 border-b border-rule/60 text-right font-mono tabular-nums">
                × {f.contributo.toFixed(2)}
              </td>
            </tr>
          ))}
          <tr>
            <td className="py-3 pr-3 font-semibold">Punteggio finale</td>
            <td className="py-3 pr-3 text-muted text-[11.5px]">
              base × prodotto moltiplicatori
            </td>
            <td className="py-3 text-right font-mono tabular-nums font-semibold text-[15px]">
              {ass.punteggio.toFixed(4)}
            </td>
          </tr>
        </tbody>
      </table>

      {contestoIstat.length > 0 && (
        <div className="mt-5 pt-4 border-t border-rule/60">
          <div className="text-[11px] font-display font-semibold tracking-label uppercase text-muted mb-1">
            Contesto della sezione
          </div>
          <p className="text-[12px] text-muted italic mb-3 max-w-prose">
            Questi fattori sono già dentro «Punteggio della sezione» sopra.
            Sono mostrati come contesto della zona di residenza, non
            entrano una seconda volta nel prodotto.
          </p>
          <ul className="text-[12.5px] text-slate space-y-1">
            {contestoIstat.map((f) => (
              <li key={f.chiave}>
                {etichettaFattore(f.chiave)}:{" "}
                <span className="font-mono tabular-nums text-ink">
                  {typeof f.valore === "number" ? f.valore.toString() : String(f.valore)}
                  {f.unita ? ` ${f.unita}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- 3. condizioni

function CondizioniLista({
  segnali,
  chiudi,
}: {
  segnali: SegnalePersona[];
  chiudi: (id: number) => Promise<void>;
}) {
  if (segnali.length === 0) {
    return (
      <p className="px-5 pb-5 text-[13px] text-slate">
        Nessuna condizione registrata.
      </p>
    );
  }
  return (
    <ul className="divide-y divide-rule/60">
      {segnali.map((s) => (
        <RigaSegnale key={s.id} s={s} chiudi={chiudi} />
      ))}
    </ul>
  );
}

function RigaSegnale({
  s,
  chiudi,
}: {
  s: SegnalePersona;
  chiudi: (id: number) => Promise<void>;
}) {
  const aperto = s.chiusoIl === null;
  const label = etichettaTipoSegnale(s.tipo);
  return (
    <li className={`px-5 py-3 ${aperto ? "" : "text-slate"}`}>
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <div className="text-[13.5px]">
          <span className={aperto ? "font-medium text-ink" : "text-slate"}>{label}</span>
          <span className="text-muted text-[11.5px] ml-2">
            · da {etichettaOrigine(s.origine)}
          </span>
        </div>
        {aperto && (
          <PulsanteChiudiCondizione
            segnaleId={s.id}
            etichettaTipo={label}
            chiudi={chiudi}
          />
        )}
      </div>
      <div className="text-[12px] text-muted mt-1">
        Aperta il {formatoGiornoMese(s.creatoIl)}
        {s.validoFino && !s.chiusoIl && (
          <span> · scade il {formatoGiornoMese(s.validoFino)}</span>
        )}
        {s.chiusoIl && (
          <>
            <span> · chiusa il {formatoGiornoMese(s.chiusoIl)}</span>
            {s.chiusoDaNome ? (
              <span> da {s.chiusoDaNome}</span>
            ) : (
              <span> (chiusura tecnica, nessun operatore)</span>
            )}
          </>
        )}
      </div>
    </li>
  );
}

// ---------------------------------------------------------------- 4. contatti

function ContattiLista({ contatti }: { contatti: ContattoPersona[] }) {
  if (contatti.length === 0) {
    return (
      <p className="px-5 pb-5 text-[13px] text-slate">
        Nessun contatto registrato.
      </p>
    );
  }
  return (
    <ul className="divide-y divide-rule/60">
      {contatti.map((c) => (
        <li key={c.id} className="px-5 py-3 text-[13px] flex items-baseline justify-between flex-wrap gap-2">
          <div>
            <span className="font-medium">{formatoGiornoMese(c.data)}</span>
            <span className="text-slate ml-2">
              · {c.volontarioNome ?? `volontario #${c.volontarioId ?? "?"}`}
            </span>
          </div>
          <span className="text-[12.5px] text-slate">{etichettaEsito(c.esito)}</span>
        </li>
      ))}
    </ul>
  );
}
